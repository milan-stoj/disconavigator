import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '@disco/shared';
import { TenantScope } from '../src/db/repository.js';
import {
  booking,
  charge,
  contact,
  equipmentType,
  equipmentUnit,
  invoice,
  job,
  payment,
  tenantSettings,
  webhookEvent,
} from '../src/db/schema.js';
import { squareSignature } from '../src/routes/payments.js';
import { reconcileSquare } from '../src/services/invoicing.js';
import type { CreateInvoiceInput } from '../src/services/square/gateway.js';
import type { MockSquare } from '../src/services/square/mock.js';
import { buildTestApp, client, signIn } from './app-helpers.js';

const TOKEN = 'sandbox-token-abc123';
const SIGNATURE_KEY = 'whsec-test-signature-key';
const WEBHOOK_URL = 'http://localhost:5173/api/webhooks/square/undercover-dance-party';

describe('Square payments', () => {
  let app: FastifyInstance;
  let built: Awaited<ReturnType<typeof buildTestApp>>;
  let admin: ReturnType<typeof client>;
  let scope: TenantScope;
  let mock: MockSquare;
  let hp: string;
  let tx: string;
  let txUnit: string;
  let contactId: string;
  let orgId: string;
  const today = todayIn('America/Chicago');

  beforeEach(async () => {
    built = await buildTestApp();
    app = built.app;
    scope = new TenantScope(built.db, app.deps.seedResult.tenantId);
    mock = app.deps.square as MockSquare;
    admin = client(app, await signIn(app));
    const types = scope.list(equipmentType);
    hp = types.find((t) => t.name === 'Headphones')!.id;
    tx = types.find((t) => t.name === 'Transmitters')!.id;
    txUnit = scope.list(equipmentUnit).sort((a, b) => a.label.localeCompare(b.label))[0]!.id;
    orgId = (await admin.post('/api/organizations', { name: 'Brew City', type: 'bar' })).json().id;
    contactId = (
      await admin.post('/api/contacts', {
        name: 'Jordan Lee',
        email: 'jordan@brewcity.test',
        organizationId: orgId,
      })
    ).json().id;
  });
  afterEach(() => app.close());

  const connect = (over: Record<string, unknown> = {}) =>
    admin.put('/api/settings/square', {
      environment: 'sandbox',
      accessToken: TOKEN,
      locationId: 'MOCK-LOC-1',
      webhookSignatureKey: SIGNATURE_KEY,
      ...over,
    });
  const tick = () => app.deps.scheduler.tick();
  const detail = async (id: string) => (await admin.get(`/api/bookings/${id}`)).json();
  const invoicesOf = (bookingId: string) =>
    scope.list(invoice, { where: eq(invoice.bookingId, bookingId) });
  const lastInvoiceInput = () => mock.callsTo('createInvoice').at(-1) as CreateInvoiceInput;

  async function book(over: Record<string, unknown> = {}) {
    const opp = (
      await admin.post('/api/opportunities', {
        title: `Event ${Math.random().toString(36).slice(2, 7)}`,
        stage: 'contacted',
        organizationId: orgId,
        contactId,
      })
    ).json();
    const type = (over.bookingType as string) ?? 'equipment_rental';
    const q = await admin.post('/api/quotes', {
      opportunityId: opp.id,
      bookingType: type,
      pricingTerm: 'flat_fee',
      startDate: '2099-07-10',
      endDate: type === 'full_service' ? '2099-07-10' : '2099-07-12',
      insideServiceArea: true,
      lines: [{ kind: 'custom', description: 'Package', quantity: 1, unitPriceCents: 100_000 }],
      requirements: { [hp]: 50, [tx]: 1 },
      staffRequired: type === 'full_service' ? 1 : 0,
      ...over,
    });
    expect(q.statusCode, q.body).toBe(201);
    const sent = await admin.post(`/api/quotes/${q.json().id}/send`);
    expect(sent.statusCode, sent.body).toBe(200);
    const token = sent.json().current.publicUrl.split('/q/')[1];
    const acc = await app.inject({
      method: 'POST',
      url: `/api/public/quotes/${token}/accept`,
      payload: { fullName: 'Jordan Lee', agreeToTerms: true },
    });
    expect(acc.statusCode, acc.body).toBe(200);
    return acc.json().bookingIds[0] as string;
  }

  function webhook(payload: string, signature?: string) {
    return app.inject({
      method: 'POST',
      url: '/api/webhooks/square/undercover-dance-party',
      payload,
      headers: {
        'content-type': 'application/json',
        'x-square-hmacsha256-signature':
          signature ?? squareSignature(SIGNATURE_KEY, WEBHOOK_URL, payload),
      },
    });
  }
  const paymentEvent = (squareInvoiceId: string, eventId = `evt-${Math.random()}`) =>
    JSON.stringify({
      merchant_id: 'MOCK',
      type: 'invoice.payment_made',
      event_id: eventId,
      data: { type: 'invoice', id: squareInvoiceId, object: { invoice: { id: squareInvoiceId } } },
    });

  describe('connection settings (13.2)', () => {
    it('does not activate credentials Square rejects', async () => {
      const res = await connect({ accessToken: 'invalid-token-123' });
      expect(res.statusCode).toBe(400);
      expect(res.json().details.fieldErrors.accessToken).toMatch(/rejected/);
      const settings = (await admin.get('/api/settings')).json();
      expect(settings.squareConnected).toBe(false);
      const row = built.db.select().from(tenantSettings).get()!;
      expect(row.squareAccessTokenEnc).toBeNull();
    });

    it('stores the token encrypted and never returns it', async () => {
      const locations = await admin.post('/api/settings/square/locations', {
        environment: 'sandbox',
        accessToken: TOKEN,
      });
      expect(locations.json().locations).toHaveLength(2);
      const res = await connect();
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        squareConnected: true,
        squareLocationName: 'Mock Milwaukee',
        squareEnvironment: 'sandbox',
        squareWebhookConfigured: true,
        squareWebhookUrl: WEBHOOK_URL,
      });
      for (const body of [res.body, (await admin.get('/api/settings')).body]) {
        expect(body).not.toContain(TOKEN);
        expect(body).not.toContain(SIGNATURE_KEY);
        expect(body).not.toMatch(/Enc"/);
      }
      const row = built.db.select().from(tenantSettings).get()!;
      expect(row.squareAccessTokenEnc).toBeTruthy();
      expect(row.squareAccessTokenEnc).not.toContain(TOKEN);

      // Changing the location keeps the stored token.
      const moved = await admin.put('/api/settings/square', {
        environment: 'sandbox',
        locationId: 'MOCK-LOC-2',
      });
      expect(moved.json()).toMatchObject({
        squareConnected: true,
        squareLocationName: 'Mock Madison',
      });
      expect((await admin.delete('/api/settings/square')).json().squareConnected).toBe(false);
    });

    it('is admin only', async () => {
      await admin.post('/api/users', {
        username: 'dj-sam',
        displayName: 'Sam',
        password: 'staff-password-1',
        role: 'staff',
      });
      const staff = client(app, await signIn(app, 'dj-sam', 'staff-password-1'));
      expect((await staff.put('/api/settings/square', { environment: 'sandbox' })).statusCode).toBe(
        403,
      );
    });
  });

  describe('invoices (13.3, 13.4)', () => {
    it('publishes a rental invoice with a 20% deposit and the balance before dispatch', async () => {
      await connect();
      const id = await book();
      await tick();
      const [inv] = invoicesOf(id);
      expect(inv).toMatchObject({
        kind: 'rental',
        status: 'published',
        amountCents: 100_000,
        depositCents: 20_000,
        depositDueDate: today,
        dueDate: '2099-07-03',
      });
      expect(inv!.publicUrl).toContain(inv!.squareInvoiceId);
      const input = lastInvoiceInput();
      expect(input.paymentRequests).toEqual([
        { type: 'DEPOSIT', amountCents: 20_000, dueDate: today },
        { type: 'BALANCE', dueDate: '2099-07-03' },
      ]);
      expect(input).toMatchObject({
        storeCard: true,
        deliverByEmail: true,
        locationId: 'MOCK-LOC-1',
      });
      expect(input.lineItems).toEqual([{ name: 'Package', quantity: 1, unitCents: 100_000 }]);
      const b = await detail(id);
      expect(b).toMatchObject({
        needsInvoice: false,
        invoiceError: null,
        status: 'awaiting_deposit',
      });
      expect(b.activity.map((a: { kind: string }) => a.kind)).toContain('invoice_published');
      expect(scope.get(contact, contactId).squareCustomerId).toMatch(/^MOCK-CUST/);
    });

    it('links an existing Square customer with the same email instead of creating one', async () => {
      await connect();
      mock.customers.set('EXISTING-1', {
        id: 'EXISTING-1',
        name: 'J',
        email: 'jordan@brewcity.test',
      });
      await book();
      await tick();
      expect(mock.callsTo('createCustomer')).toHaveLength(0);
      expect(scope.get(contact, contactId).squareCustomerId).toBe('EXISTING-1');
      expect(lastInvoiceInput().customerId).toBe('EXISTING-1');
    });

    it('invoices a full-service flat fee in full, due on the event date', async () => {
      await connect();
      const id = await book({
        bookingType: 'full_service',
        lines: [{ kind: 'custom', description: 'DJ night', quantity: 1, unitPriceCents: 80_000 }],
      });
      await tick();
      expect(invoicesOf(id)[0]).toMatchObject({
        kind: 'full_service',
        status: 'published',
        amountCents: 80_000,
        depositCents: 0,
        dueDate: '2099-07-10',
      });
      expect(lastInvoiceInput().paymentRequests).toEqual([
        { type: 'BALANCE', dueDate: '2099-07-10' },
      ]);
      expect(lastInvoiceInput().storeCard).toBe(false);
    });

    it('waits for settlement before invoicing a door split, then invoices the balance', async () => {
      await connect();
      const id = await book({
        bookingType: 'full_service',
        pricingTerm: 'door_split',
        splitBps: 6000,
        lines: [],
      });
      await tick();
      expect(invoicesOf(id)).toHaveLength(0);
      expect(mock.callsTo('createInvoice')).toHaveLength(0);
      expect((await detail(id)).needsInvoice).toBe(false);

      const settled = await admin.post(`/api/bookings/${id}/settlement`, {
        doorRevenueCents: 100_000,
      });
      expect(settled.statusCode, settled.body).toBe(201);
      await tick();
      expect(invoicesOf(id)[0]).toMatchObject({
        kind: 'settlement',
        status: 'published',
        amountCents: 60_000,
        dueDate: today,
      });
      expect(lastInvoiceInput().customerId).toBe(scope.get(contact, contactId).squareCustomerId);
    });

    it('accepts quotes while Square is down and creates the invoice on retry', async () => {
      await connect();
      mock.offline = true;
      const id = await book();
      await tick();
      let b = await detail(id);
      expect(b.status).toBe('awaiting_deposit');
      expect(b.needsInvoice).toBe(true);
      expect(b.invoiceError).toMatch(/unreachable/);
      const pending = built.db.select().from(job).where(eq(job.type, 'invoice.create')).get()!;
      expect(pending).toMatchObject({ status: 'pending', attempts: 1 });
      expect(pending.runAt > new Date().toISOString()).toBe(true);

      mock.offline = false;
      built.db
        .update(job)
        .set({ runAt: new Date(0).toISOString() })
        .where(eq(job.id, pending.id))
        .run();
      await tick();
      b = await detail(id);
      expect(b).toMatchObject({ needsInvoice: false, invoiceError: null });
      expect(invoicesOf(id)).toEqual([expect.objectContaining({ status: 'published' })]);
      expect(mock.invoices.size).toBe(1);
    });

    it('holds invoices until Square is connected, then creates them', async () => {
      const id = await book();
      await tick();
      const b = await detail(id);
      expect(b.needsInvoice).toBe(true);
      expect(b.invoiceError).toMatch(/not connected/);
      expect((await admin.post(`/api/bookings/${id}/invoice/retry`)).statusCode).toBe(409);
      await connect();
      await tick();
      expect((await detail(id)).needsInvoice).toBe(false);
      expect(invoicesOf(id)[0]!.status).toBe('published');
    });
  });

  describe('payment sync (13.5)', () => {
    async function publishedRental() {
      await connect();
      const id = await book();
      await tick();
      return { id, inv: invoicesOf(id)[0]! };
    }

    it('confirms a rental when Square reports the deposit paid', async () => {
      const { id, inv } = await publishedRental();
      mock.pay(inv.squareInvoiceId!);
      const event = paymentEvent(inv.squareInvoiceId!, 'evt-deposit-1');
      const res = await webhook(event);
      expect(res.statusCode, res.body).toBe(200);
      await tick();
      const b = await detail(id);
      expect(b.status).toBe('confirmed');
      expect(b.money).toMatchObject({ paidCents: 20_000, balanceCents: 80_000 });
      expect(b.payments).toEqual([
        expect.objectContaining({ source: 'square', amountCents: 20_000, receivedOn: today }),
      ]);
      expect(scope.get(invoice, inv.id)).toMatchObject({
        status: 'partially_paid',
        paidCents: 20_000,
      });
      const evt = built.db.select().from(webhookEvent).get()!;
      expect(evt.processedAt).toBeTruthy();

      // The same event again is acknowledged but not processed twice.
      expect((await webhook(event)).json()).toMatchObject({ duplicate: true });
      await tick();
      expect(scope.list(payment)).toHaveLength(1);
    });

    it('lets development runs pay an invoice and drain jobs through the dev routes', async () => {
      await connect();
      const id = await book();
      expect((await admin.post('/api/dev/jobs/run')).json().ran).toBeGreaterThan(0);
      const inv = invoicesOf(id)[0]!;
      expect(inv.squareInvoiceId).toBeTruthy();
      const paid = await admin.post(`/api/dev/square/invoices/${inv.id}/pay`);
      expect(paid.statusCode, paid.body).toBe(200);
      await admin.post('/api/dev/jobs/run');
      expect(await detail(id)).toMatchObject({
        status: 'confirmed',
        money: { paidCents: 20_000, balanceCents: 80_000 },
      });
    });

    it('rejects a forged webhook without changing any records', async () => {
      const { id, inv } = await publishedRental();
      mock.pay(inv.squareInvoiceId!);
      const res = await webhook(paymentEvent(inv.squareInvoiceId!), 'forged-signature');
      expect(res.statusCode).toBe(403);
      const unsigned = await app.inject({
        method: 'POST',
        url: '/api/webhooks/square/undercover-dance-party',
        payload: paymentEvent(inv.squareInvoiceId!),
        headers: { 'content-type': 'application/json' },
      });
      expect(unsigned.statusCode).toBe(403);
      await tick();
      expect(built.db.select().from(webhookEvent).all()).toHaveLength(0);
      expect(scope.list(payment)).toHaveLength(0);
      expect((await detail(id)).status).toBe('awaiting_deposit');
    });

    it('records a missed payment on the next reconciliation run', async () => {
      const { id, inv } = await publishedRental();
      mock.pay(inv.squareInvoiceId!, { amountCents: 100_000 });
      expect(await reconcileSquare({ db: built.db, config: built.config, square: mock })).toBe(1);
      const b = await detail(id);
      expect(b.status).toBe('confirmed');
      expect(b.money.balanceCents).toBe(0);
      expect(scope.get(invoice, inv.id).status).toBe('paid');
      // Paid invoices are no longer polled.
      expect(await reconcileSquare({ db: built.db, config: built.config, square: mock })).toBe(0);
    });
  });

  describe('payments outside Square and loss charges (13.6)', () => {
    it('records a cash payment that clears the balance', async () => {
      const id = await book({
        bookingType: 'full_service',
        lines: [{ kind: 'custom', description: 'DJ', quantity: 1, unitPriceCents: 30_000 }],
      });
      const res = await admin.post(`/api/bookings/${id}/payments`, {
        amountCents: 30_000,
        receivedOn: today,
        method: 'cash',
        note: 'Paid at the door',
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().money).toMatchObject({ paidCents: 30_000, balanceCents: 0 });
      expect(res.json().payments[0]).toMatchObject({ source: 'external', method: 'cash' });
      expect(res.json().activity.map((a: { kind: string }) => a.kind)).toContain(
        'payment_recorded',
      );
    });

    async function rentalWithLoss() {
      await connect();
      const id = await book();
      await tick();
      const inv = invoicesOf(id)[0]!;
      mock.pay(inv.squareInvoiceId!);
      await reconcileSquare({ db: built.db, config: built.config, square: mock });
      expect((await detail(id)).status).toBe('confirmed');
      const out = await admin.post(`/api/bookings/${id}/check-out`, {
        pooled: [{ equipmentTypeId: hp, quantity: 50 }],
        unitIds: [txUnit],
      });
      expect(out.statusCode, out.body).toBe(200);
      const back = await admin.post(`/api/bookings/${id}/check-in`, {
        pooled: [{ equipmentTypeId: hp, returned: 47, damaged: 0 }],
        returnedUnitIds: [txUnit],
        damagedUnitIds: [],
      });
      expect(back.statusCode, back.body).toBe(200);
      const [c] = scope.list(charge, { where: eq(charge.bookingId, id) });
      expect(c).toMatchObject({ status: 'proposed', proposedCents: 18_000 });
      return { id, chargeId: c!.id };
    }

    it('charges the saved card when a loss charge is approved', async () => {
      const { id, chargeId } = await rentalWithLoss();
      mock.addCard(scope.get(contact, contactId).squareCustomerId!);
      const res = await admin.post(`/api/bookings/${id}/charges/${chargeId}/decision`, {
        action: 'approve',
      });
      expect(res.statusCode, res.body).toBe(200);
      await tick();
      const b = await detail(id);
      expect(b.charges[0]).toMatchObject({ status: 'charged', amountCents: 18_000 });
      expect(b.payments).toContainEqual(
        expect.objectContaining({ amountCents: 18_000, method: 'card', source: 'square' }),
      );
      expect(mock.callsTo('chargeCard')).toEqual([
        expect.objectContaining({ amountCents: 18_000 }),
      ]);
      expect(b.money).toMatchObject({ chargesCents: 18_000, paidCents: 38_000 });
    });

    it('sends a loss invoice when there is no saved card', async () => {
      const { id, chargeId } = await rentalWithLoss();
      await admin.post(`/api/bookings/${id}/charges/${chargeId}/decision`, {
        action: 'approve',
        amountCents: 12_000,
        reason: 'Three found at the venue later',
      });
      await tick();
      const loss = invoicesOf(id).find((i) => i.kind === 'loss');
      expect(loss).toMatchObject({
        status: 'published',
        amountCents: 12_000,
        chargeId,
        dueDate: today,
      });
      expect(scope.get(charge, chargeId)).toMatchObject({
        status: 'invoiced',
        invoiceId: loss!.id,
      });
      expect(mock.callsTo('chargeCard')).toHaveLength(0);
      expect((await detail(id)).money.chargesCents).toBe(12_000);
    });

    it('waives a charge with a reason and makes no charge', async () => {
      const { id, chargeId } = await rentalWithLoss();
      const url = `/api/bookings/${id}/charges/${chargeId}/decision`;
      expect((await admin.post(url, { action: 'waive' })).statusCode).toBe(400);
      const res = await admin.post(url, { action: 'waive', reason: 'Regular customer' });
      expect(res.statusCode, res.body).toBe(200);
      await tick();
      expect(scope.get(charge, chargeId)).toMatchObject({
        status: 'waived',
        reason: 'Regular customer',
        decidedBy: expect.any(String),
      });
      expect(res.json().money.chargesCents).toBe(0);
      expect(mock.callsTo('chargeCard')).toHaveLength(0);
      expect(invoicesOf(id).filter((i) => i.kind === 'loss')).toHaveLength(0);
      expect((await admin.post(url, { action: 'approve' })).statusCode).toBe(409);
    });
  });

  describe('money owed (13.7)', () => {
    it('lists outstanding balances with due dates, overdue flags and invoice links', async () => {
      await connect();
      const past = addDays(today, -3);
      const overdueId = await book({ startDate: past, endDate: past });
      const futureId = await book();
      const paidId = await book({
        bookingType: 'full_service',
        lines: [{ kind: 'custom', description: 'DJ', quantity: 1, unitPriceCents: 30_000 }],
      });
      await tick();
      await admin.post(`/api/bookings/${paidId}/payments`, {
        amountCents: 30_000,
        receivedOn: today,
        method: 'check',
      });
      const rows = (await admin.get('/api/money-owed')).json();
      const ids = rows.map((r: { id: string }) => r.id);
      expect(ids).not.toContain(paidId);
      expect(rows.find((r: { id: string }) => r.id === overdueId)).toMatchObject({
        bookingType: 'equipment_rental',
        balanceCents: 100_000,
        dueDate: addDays(past, -7),
        overdue: true,
        customerName: 'Brew City',
        invoiceUrl: expect.stringContaining('squareup.test'),
      });
      expect(rows.find((r: { id: string }) => r.id === futureId)).toMatchObject({
        dueDate: today,
        overdue: false,
      });
      expect(ids.indexOf(overdueId)).toBeLessThan(ids.indexOf(futureId));
      // Once the deposit is in, the balance is next due a week before dispatch.
      await admin.post(`/api/bookings/${futureId}/payments`, {
        amountCents: 20_000,
        receivedOn: today,
        method: 'cash',
      });
      const after = (await admin.get('/api/money-owed')).json();
      expect(after.find((r: { id: string }) => r.id === futureId)).toMatchObject({
        balanceCents: 80_000,
        dueDate: '2099-07-03',
      });
      expect(scope.get(booking, futureId).status).toBe('confirmed');
    });
  });
});
