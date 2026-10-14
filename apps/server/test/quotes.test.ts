import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { monthlyNthWeekday } from '@disco/shared';
import { TenantScope } from '../src/db/repository.js';
import {
  acceptance,
  booking,
  equipmentRequirement,
  equipmentType,
  job,
  opportunity,
  outboundEmail,
  quoteRevision,
  staffMember,
  staffUnavailability,
} from '../src/db/schema.js';
import { buildTestApp, client, signIn } from './app-helpers.js';

type Admin = ReturnType<typeof client>;

describe('quotes', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof buildTestApp>>['db'];
  let admin: Admin;
  let scope: TenantScope;
  let headphones: { id: string };
  let transmitters: { id: string };
  let party50: { id: string };
  let opp: { id: string };

  beforeEach(async () => {
    ({ app, db } = await buildTestApp());
    scope = new TenantScope(db, app.deps.seedResult.tenantId);
    admin = client(app, await signIn(app));
    const types = scope.list(equipmentType);
    headphones = types.find((t) => t.name === 'Headphones')!;
    transmitters = types.find((t) => t.name === 'Transmitters')!;
    party50 = (
      await admin.post('/api/packages', {
        name: 'Party 50',
        priceCents: 30_000,
        includedDays: 2,
        extraDayPriceCents: 7_500,
        items: [
          { equipmentTypeId: headphones.id, quantity: 50 },
          { equipmentTypeId: transmitters.id, quantity: 1 },
        ],
      })
    ).json();
    const org = (
      await admin.post('/api/organizations', { name: 'Brew City Taproom', type: 'bar' })
    ).json();
    const person = (
      await admin.post('/api/contacts', {
        name: 'Jordan Lee',
        email: 'jordan@brewcity.test',
        organizationId: org.id,
      })
    ).json();
    opp = (
      await admin.post('/api/opportunities', {
        title: 'Brew City rooftop',
        stage: 'contacted',
        organizationId: org.id,
        contactId: person.id,
      })
    ).json();
    await admin.post(`/api/opportunities/${opp.id}/stage`, { stage: 'quote_requested' });
  });
  afterEach(() => app.close());

  const rental = (over: object = {}) => ({
    opportunityId: opp.id,
    bookingType: 'equipment_rental',
    pricingTerm: 'flat_fee',
    startDate: '2099-07-10', // Friday
    endDate: '2099-07-12', // Sunday
    location: 'Bay View, Milwaukee',
    insideServiceArea: true,
    lines: [
      {
        kind: 'package',
        description: 'Party 50',
        quantity: 1,
        unitPriceCents: 30_000,
        packageId: party50.id,
      },
      { kind: 'addon', description: 'Extra day', quantity: 1, unitPriceCents: 7_500 },
    ],
    ...over,
  });
  const fullService = (over: object = {}) => ({
    opportunityId: opp.id,
    bookingType: 'full_service',
    pricingTerm: 'flat_fee',
    startDate: '2099-07-11', // Saturday
    endDate: '2099-07-11',
    startTime: '21:00',
    endTime: '01:00',
    lines: [
      {
        kind: 'custom',
        description: 'Silent disco night with 2 DJs',
        quantity: 1,
        unitPriceCents: 80_000,
      },
    ],
    requirements: { [headphones.id]: 100, [transmitters.id]: 3 },
    staffRequired: 2,
    ...over,
  });
  const create = async (body: object) => {
    const res = await admin.post('/api/quotes', body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json();
  };
  const publicUrlToken = (q: { current: { publicUrl: string } }) =>
    q.current.publicUrl.split('/q/')[1]!;
  const sendAndToken = async (id: string) => {
    const res = await admin.post(`/api/quotes/${id}/send`);
    expect(res.statusCode, res.body).toBe(200);
    return { quote: res.json(), token: publicUrlToken(res.json()) };
  };

  describe('creating and pricing (9.1)', () => {
    it('creates a draft equipment rental quote linked to the opportunity, Friday to Sunday', async () => {
      const q = await create(rental());
      expect(q).toMatchObject({
        status: 'draft',
        bookingType: 'equipment_rental',
        opportunityId: opp.id,
        displayNumber: expect.stringMatching(/^Q-\d+$/),
      });
      expect(q.current).toMatchObject({
        startDate: '2099-07-10',
        endDate: '2099-07-12',
        revisionNumber: 1,
      });
    });

    it('creates a draft full-service quote for a Saturday night', async () => {
      const q = await create(fullService());
      expect(q).toMatchObject({ status: 'draft', bookingType: 'full_service' });
      expect(q.current).toMatchObject({
        startDate: '2099-07-11',
        endDate: '2099-07-11',
        staffRequired: 2,
      });
    });

    it('Party 50 plus an extra day totals $375 and requires 50 headphones and 1 transmitter', async () => {
      const q = await create(rental());
      expect(q.current.financials.totalCents).toBe(37_500);
      expect(q.current.requirements).toEqual({ [headphones.id]: 50, [transmitters.id]: 1 });
    });

    it('flat-fee full-service totals $800 with no deposit', async () => {
      const q = await create(fullService());
      expect(q.current.financials).toMatchObject({
        totalCents: 80_000,
        depositCents: 0,
        balanceCents: 80_000,
      });
    });

    it('door split has no fixed total and is determined after the event', async () => {
      const q = await create(fullService({ pricingTerm: 'door_split', splitBps: 4000, lines: [] }));
      expect(q.current.financials).toMatchObject({
        totalCents: null,
        minimumCents: null,
        finalDeterminedAfterEvent: true,
      });
      expect(q.current.financials.summary).toMatch(
        /40% of door revenue.*determined after the event/,
      );
    });

    it('guarantee plus split shows a $500 minimum', async () => {
      const q = await create(
        fullService({
          pricingTerm: 'guarantee_plus_split',
          splitBps: 4000,
          guaranteeCents: 50_000,
          lines: [],
        }),
      );
      expect(q.current.financials).toMatchObject({ totalCents: null, minimumCents: 50_000 });
      expect(q.current.financials.summary).toMatch(/greater of \$500\.00 or 40%/);
    });

    it('rejects split pricing terms for equipment rentals', async () => {
      for (const pricingTerm of ['door_split', 'guarantee_plus_split']) {
        const res = await admin.post(
          '/api/quotes',
          rental({ pricingTerm, splitBps: 4000, guaranteeCents: 50_000 }),
        );
        expect(res.statusCode).toBe(400);
        expect(res.json().details.fieldErrors.pricingTerm).toMatch(/fixed pricing/);
      }
    });

    it('adds an editable delivery fee outside the service area and none inside', async () => {
      const inside = await create(rental());
      expect(inside.current.lines.some((l: { kind: string }) => l.kind === 'delivery')).toBe(false);

      const outside = await create(rental({ insideServiceArea: false, location: 'Lake Geneva' }));
      const fee = outside.current.lines.find((l: { kind: string }) => l.kind === 'delivery');
      expect(fee).toMatchObject({ quantity: 1, unitPriceCents: 7_500 });
      expect(outside.current.financials.totalCents).toBe(45_000);

      const overridden = await admin.put(`/api/quotes/${outside.id}`, {
        ...rental({ insideServiceArea: false }),
        lines: [
          ...rental().lines,
          {
            kind: 'delivery',
            description: 'Delivery to Lake Geneva',
            quantity: 1,
            unitPriceCents: 12_000,
          },
        ],
      });
      expect(overridden.statusCode).toBe(200);
      const lines = overridden
        .json()
        .current.lines.filter((l: { kind: string }) => l.kind === 'delivery');
      expect(lines).toEqual([expect.objectContaining({ unitPriceCents: 12_000 })]);

      const backInside = await admin.put(
        `/api/quotes/${outside.id}`,
        rental({ insideServiceArea: true }),
      );
      expect(
        backInside.json().current.lines.some((l: { kind: string }) => l.kind === 'delivery'),
      ).toBe(false);
    });

    it('rental deposit is 20% of the total; full-service has none', async () => {
      const lines = [
        { kind: 'custom', description: 'Big party', quantity: 1, unitPriceCents: 100_000 },
      ];
      const r = await create(rental({ lines }));
      expect(r.current.financials).toMatchObject({
        totalCents: 100_000,
        depositCents: 20_000,
        balanceCents: 80_000,
      });
      const f = await create(fullService({ lines }));
      expect(f.current.financials).toMatchObject({ totalCents: 100_000, depositCents: 0 });
    });

    it('uses the saved deposit percentage and delivery fee from settings (5.6)', async () => {
      const current = (await admin.get('/api/settings')).json();
      await admin.put('/api/settings', {
        ...current,
        rentalDepositBps: 2500,
        deliveryFeeCents: 10_000,
      });
      const lines = [
        { kind: 'custom', description: 'Big party', quantity: 1, unitPriceCents: 100_000 },
      ];
      const q = await create(rental({ lines, insideServiceArea: false }));
      expect(
        q.current.lines.find((l: { kind: string }) => l.kind === 'delivery').unitPriceCents,
      ).toBe(10_000);
      expect(q.current.financials).toMatchObject({ totalCents: 110_000, depositCents: 27_500 });
    });

    it('refuses deactivated packages on new quotes (6.2)', async () => {
      await admin.patch(`/api/packages/${party50.id}/active`, { active: false });
      const res = await admin.post('/api/quotes', rental());
      expect(res.statusCode).toBe(400);
      expect(res.json().details.fieldErrors['lines.0.packageId']).toMatch(/no longer offered/);
    });

    it('rejects packages on full-service quotes', async () => {
      const res = await admin.post('/api/quotes', fullService({ lines: rental().lines }));
      expect(res.statusCode).toBe(400);
      expect(res.json().details.fieldErrors['lines.0.kind']).toBeDefined();
    });

    it('lists six first-Friday dates for a January–June series and flags an unavailable date', async () => {
      const dates = monthlyNthWeekday('2099-01-01', '2099-06-30', 5, 1);
      expect(dates).toHaveLength(6);
      // Both DJs are off on the third occurrence.
      for (const s of scope.list(staffMember)) {
        scope.insert(staffUnavailability, { staffMemberId: s.id, date: dates[2]! });
      }
      const q = await create(
        fullService({ occurrenceDates: dates, startDate: dates[0], endDate: dates[0] }),
      );
      expect(q.current.occurrenceDates).toEqual(dates);
      expect(q.availability).toHaveLength(6);
      expect(
        q.availability
          .filter((a: { available: boolean }) => !a.available)
          .map((a: { startDate: string }) => a.startDate),
      ).toEqual([dates[2]]);
      expect(q.availability[2].shortfalls).toEqual([
        { date: dates[2], resource: 'staff', shortfall: 2 },
      ]);
    });

    it('rejects series dates on rentals', async () => {
      const res = await admin.post(
        '/api/quotes',
        rental({ occurrenceDates: ['2099-07-10', '2099-08-07'] }),
      );
      expect(res.statusCode).toBe(400);
      expect(res.json().details.fieldErrors.occurrenceDates).toBeDefined();
    });
  });

  describe('availability warnings (9.2)', () => {
    it('warns when 80 headphones are needed on a date with 40 already committed', async () => {
      const b = scope.insert(booking, {
        number: 1,
        bookingType: 'equipment_rental',
        status: 'confirmed',
        pricingTerm: 'flat_fee',
        title: 'Existing rental',
        startDate: '2099-07-11',
        endDate: '2099-07-11',
      });
      db.insert(equipmentRequirement)
        .values({
          tenantId: scope.tenantId,
          bookingId: b.id,
          equipmentTypeId: headphones.id,
          quantity: 40,
        })
        .run();
      const q = await create(
        rental({
          lines: [
            { kind: 'custom', description: '80 headphones', quantity: 1, unitPriceCents: 50_000 },
          ],
          requirements: { [headphones.id]: 80 },
        }),
      );
      expect(q.availability).toHaveLength(1);
      expect(q.availability[0].available).toBe(false);
      expect(q.availability[0].shortfalls).toContainEqual({
        date: '2099-07-11',
        resource: headphones.id,
        shortfall: 20,
      });

      // The live builder check agrees, and still nothing is blocked.
      const check = await admin.post('/api/quotes/availability-check', {
        bookingType: 'equipment_rental',
        startDate: '2099-07-10',
        endDate: '2099-07-12',
        requirements: { [headphones.id]: 80 },
      });
      expect(check.statusCode).toBe(200);
      expect(check.json()[0].available).toBe(false);

      // The builder sends package lines without prices; their equipment still counts.
      const withPackage = await admin.post('/api/quotes/availability-check', {
        bookingType: 'equipment_rental',
        startDate: '2099-07-10',
        endDate: '2099-07-12',
        lines: [{ kind: 'package', quantity: 2, packageId: party50.id }],
      });
      expect(withPackage.statusCode, withPackage.body).toBe(200);
      expect(withPackage.json()[0].shortfalls).toContainEqual({
        date: '2099-07-11',
        resource: headphones.id,
        shortfall: 40,
      });

      const fits = await create(rental());
      expect(fits.availability[0]).toMatchObject({ available: true, shortfalls: [] });
    });
  });

  describe('sending and revisions (9.3)', () => {
    it('sends a draft: public link, expiry, email to the contact, opportunity to Quoted', async () => {
      const q = await create(rental());
      const { quote: sent, token } = await sendAndToken(q.id);
      expect(sent.status).toBe('sent');
      expect(token.length).toBeGreaterThanOrEqual(40);
      expect(sent.current.expiresOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(sent.current.publicUrl).toBe(`http://localhost:5173/q/${token}`);
      expect(sent.opportunity.stage).toBe('quoted');

      const emails = db.select().from(outboundEmail).where(eq(outboundEmail.relatedId, q.id)).all();
      expect(emails).toHaveLength(1);
      expect(emails[0]).toMatchObject({ to: 'jordan@brewcity.test', status: 'queued' });
      expect(emails[0]!.text).toContain(`/q/${token}`);
      expect(emails[0]!.text).toContain('$375.00');

      const pub = await app.inject({ method: 'GET', url: `/api/public/quotes/${token}` });
      expect(pub.json()).toMatchObject({
        state: 'open',
        quote: { financials: { totalCents: 37_500 } },
      });
    });

    it('needs a contact email before sending', async () => {
      const org = (
        await admin.post('/api/organizations', { name: 'No Email Bar', type: 'bar' })
      ).json();
      const bareRes = await admin.post('/api/opportunities', {
        title: 'No contact',
        stage: 'contacted',
        organizationId: org.id,
      });
      expect(bareRes.statusCode, bareRes.body).toBe(201);
      const bare = bareRes.json();
      const q = await create(rental({ opportunityId: bare.id }));
      const res = await admin.post(`/api/quotes/${q.id}/send`);
      expect(res.statusCode).toBe(400);
    });

    it('editing a sent quote creates a revision; the old link stops working and the new one shows the new price', async () => {
      const q = await create(rental());
      const { token: oldToken } = await sendAndToken(q.id);

      const edited = await admin.put(`/api/quotes/${q.id}`, {
        ...rental(),
        lines: [
          rental().lines[0],
          { kind: 'addon', description: 'Extra day', quantity: 1, unitPriceCents: 5_000 },
        ],
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json()).toMatchObject({
        status: 'draft',
        current: { revisionNumber: 2, publicUrl: null },
      });
      expect(edited.json().revisions).toHaveLength(2);

      const old = await app.inject({ method: 'GET', url: `/api/public/quotes/${oldToken}` });
      expect(old.json()).toMatchObject({ state: 'revoked', quote: null });

      const { token: newToken } = await sendAndToken(q.id);
      expect(newToken).not.toBe(oldToken);
      const fresh = await app.inject({ method: 'GET', url: `/api/public/quotes/${newToken}` });
      expect(fresh.json()).toMatchObject({
        state: 'open',
        quote: { financials: { totalCents: 35_000 } },
      });

      // Earlier revisions stay viewable internally.
      const first = edited
        .json()
        .revisions.find((r: { revisionNumber: number }) => r.revisionNumber === 1);
      const rev1 = await admin.get(`/api/quotes/${q.id}/revisions/${first.id}`);
      expect(rev1.json().financials.totalCents).toBe(37_500);

      const accept = await app.inject({
        method: 'POST',
        url: `/api/public/quotes/${oldToken}/accept`,
        payload: { fullName: 'Jordan Lee', agreeToTerms: true },
      });
      expect(accept.statusCode).toBe(409);
    });
  });

  describe('public view, acceptance and decline (9.4)', () => {
    const accept = (
      token: string,
      payload: object = { fullName: 'Jordan Lee', agreeToTerms: true },
    ) =>
      app.inject({
        method: 'POST',
        url: `/api/public/quotes/${token}/accept`,
        payload,
        remoteAddress: '198.51.100.7',
        headers: { 'user-agent': 'TestBrowser/1.0' },
      });
    const invoiceJobs = () => db.select().from(job).where(eq(job.type, 'invoice.create')).all();

    it('shows rental terms with the holding deposit and loss and damage fees', async () => {
      const q = await create(rental());
      const { token } = await sendAndToken(q.id);
      const res = (await app.inject({ method: 'GET', url: `/api/public/quotes/${token}` })).json();
      expect(res.quote).toMatchObject({
        bookingType: 'equipment_rental',
        bookingTypeLabel: 'Equipment rental',
        financials: { totalCents: 37_500, depositCents: 7_500, balanceCents: 30_000 },
      });
      expect(res.quote.termsText).toMatch(/holding deposit/i);
      expect(res.quote.termsText).toMatch(/loss and damage/i);
      expect(res.quote.lines).toHaveLength(2);
    });

    it('rental acceptance records the acceptance and creates an Awaiting Deposit booking', async () => {
      const q = await create(rental());
      const { token } = await sendAndToken(q.id);
      expect((await accept(token, { fullName: 'Jordan Lee' })).statusCode).toBe(400);

      const res = await accept(token);
      expect(res.statusCode, res.body).toBe(200);
      const [bookingId] = res.json().bookingIds;

      const acc = db.select().from(acceptance).where(eq(acceptance.quoteId, q.id)).get()!;
      expect(acc).toMatchObject({
        fullName: 'Jordan Lee',
        ip: '198.51.100.7',
        userAgent: 'TestBrowser/1.0',
      });
      expect(acc.revisionId).toBe(q.current.id);

      const b = scope.get(booking, bookingId);
      expect(b).toMatchObject({
        bookingType: 'equipment_rental',
        status: 'awaiting_deposit',
        quoteId: q.id,
        startDate: '2099-07-10',
        endDate: '2099-07-12',
        totalCents: 37_500,
        depositCents: 7_500,
        needsInvoice: true,
      });
      const reqs = db
        .select()
        .from(equipmentRequirement)
        .where(eq(equipmentRequirement.bookingId, b.id))
        .all();
      expect(Object.fromEntries(reqs.map((r) => [r.equipmentTypeId, r.quantity]))).toEqual({
        [headphones.id]: 50,
        [transmitters.id]: 1,
      });
      expect(invoiceJobs().map((j) => j.payload)).toEqual([{ bookingId: b.id }]);
      // Rentals are won only once the deposit is paid.
      expect(scope.get(opportunity, opp.id).stage).toBe('quoted');

      const after = (await admin.get(`/api/quotes/${q.id}`)).json();
      expect(after).toMatchObject({ status: 'accepted', acceptance: { fullName: 'Jordan Lee' } });
      const view = (await app.inject({ method: 'GET', url: `/api/public/quotes/${token}` })).json();
      expect(view).toMatchObject({
        state: 'accepted',
        quote: { acceptedBy: { fullName: 'Jordan Lee' } },
      });
      expect((await accept(token)).statusCode).toBe(409);
      expect((await admin.put(`/api/quotes/${q.id}`, rental())).statusCode).toBe(409);
    });

    it('full-service flat-fee acceptance creates a Confirmed booking, wins the opportunity, and queues an invoice', async () => {
      const q = await create(fullService());
      const { token } = await sendAndToken(q.id);
      const res = await accept(token);
      expect(res.statusCode, res.body).toBe(200);
      const b = scope.get(booking, res.json().bookingIds[0]);
      expect(b).toMatchObject({
        bookingType: 'full_service',
        status: 'confirmed',
        staffRequired: 2,
        depositCents: 0,
      });
      expect(b.confirmedAt).not.toBeNull();
      expect(scope.get(opportunity, opp.id).stage).toBe('won');
      expect(invoiceJobs()).toHaveLength(1);
    });

    it('door-split acceptance waits for settlement before invoicing', async () => {
      const q = await create(fullService({ pricingTerm: 'door_split', splitBps: 4000, lines: [] }));
      const { token } = await sendAndToken(q.id);
      const res = await accept(token);
      const b = scope.get(booking, res.json().bookingIds[0]);
      expect(b).toMatchObject({
        status: 'confirmed',
        pricingTerm: 'door_split',
        splitBps: 4000,
        totalCents: null,
        needsInvoice: false,
      });
      expect(invoiceJobs()).toHaveLength(0);
    });

    it('accepting a six-date series creates six linked bookings', async () => {
      const dates = monthlyNthWeekday('2099-01-01', '2099-06-30', 5, 1);
      const q = await create(
        fullService({ occurrenceDates: dates, startDate: dates[0], endDate: dates[0] }),
      );
      const { token } = await sendAndToken(q.id);
      const res = await accept(token);
      expect(res.json().bookingIds).toHaveLength(6);
      const rows = scope.list(booking, { where: eq(booking.quoteId, q.id) });
      expect(rows.map((r) => r.startDate).sort()).toEqual(dates);
      expect(new Set(rows.map((r) => r.seriesId)).size).toBe(1);
      expect(rows[0]!.seriesId).toBe(res.json().seriesId);
      expect(invoiceJobs()).toHaveLength(6);
    });

    it('an expired link shows the quote has expired and cannot be accepted', async () => {
      const q = await create(rental());
      const { token } = await sendAndToken(q.id);
      db.update(quoteRevision)
        .set({ expiresOn: '2000-01-01' })
        .where(and(eq(quoteRevision.publicToken, token)))
        .run();
      const view = (await app.inject({ method: 'GET', url: `/api/public/quotes/${token}` })).json();
      expect(view.state).toBe('expired');
      const res = await accept(token);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('quote_expired');
      expect((await admin.get(`/api/quotes/${q.id}`)).json().status).toBe('expired');
      expect(scope.list(booking)).toHaveLength(0);

      // Resending an expired quote issues a fresh link.
      const { token: fresh } = await sendAndToken(q.id);
      expect(fresh).not.toBe(token);
      expect(
        (await app.inject({ method: 'GET', url: `/api/public/quotes/${fresh}` })).json().state,
      ).toBe('open');
    });

    it('customer decline marks the quote declined and flags the opportunity for a loss reason', async () => {
      const q = await create(rental());
      const { token } = await sendAndToken(q.id);
      const res = await app.inject({
        method: 'POST',
        url: `/api/public/quotes/${token}/decline`,
        payload: { reason: 'Went with another vendor' },
      });
      expect(res.statusCode).toBe(200);
      expect((await admin.get(`/api/quotes/${q.id}`)).json()).toMatchObject({
        status: 'declined',
        declineReason: 'Went with another vendor',
      });
      expect(scope.get(opportunity, opp.id).needsLossReason).toBe(true);
      expect((await accept(token)).statusCode).toBe(409);
    });

    it('staff can mark a quote declined', async () => {
      const q = await create(fullService());
      const res = await admin.post(`/api/quotes/${q.id}/decline`, { reason: 'Budget' });
      expect(res.json().status).toBe('declined');
      expect(scope.get(opportunity, opp.id).needsLossReason).toBe(true);
    });

    it('unknown tokens are not found', async () => {
      expect((await app.inject({ method: 'GET', url: '/api/public/quotes/nope' })).statusCode).toBe(
        404,
      );
    });
  });
});
