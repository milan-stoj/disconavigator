import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TenantScope } from '../src/db/repository.js';
import {
  booking,
  equipmentType,
  job,
  opportunity,
  outboundEmail,
  payment,
  staffMember,
  tenantSettings,
} from '../src/db/schema.js';
import { confirmBooking, transitionBooking } from '../src/services/bookings.js';
import { buildTestApp, client, signIn } from './app-helpers.js';

type Admin = ReturnType<typeof client>;

describe('bookings', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof buildTestApp>>['db'];
  let admin: Admin;
  let scope: TenantScope;
  let hp: string;
  let tx: string;
  let djs: { id: string; name: string }[];
  let contactId: string;
  let orgId: string;

  beforeEach(async () => {
    ({ app, db } = await buildTestApp());
    scope = new TenantScope(db, app.deps.seedResult.tenantId);
    admin = client(app, await signIn(app));
    const types = scope.list(equipmentType);
    hp = types.find((t) => t.name === 'Headphones')!.id;
    tx = types.find((t) => t.name === 'Transmitters')!.id;
    djs = scope.list(staffMember).sort((a, b) => a.name.localeCompare(b.name));
    const org = (await admin.post('/api/organizations', { name: 'Brew City', type: 'bar' })).json();
    orgId = org.id;
    contactId = (
      await admin.post('/api/contacts', {
        name: 'Jordan Lee',
        email: 'jordan@brewcity.test',
        organizationId: org.id,
      })
    ).json().id;
  });
  afterEach(() => app.close());

  /** Creates, sends and accepts a quote; returns the resulting booking id(s). */
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
      lines: [{ kind: 'custom', description: 'Package', quantity: 1, unitPriceCents: 50_000 }],
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
    return { ids: acc.json().bookingIds as string[], oppId: opp.id as string };
  }
  const fullService = (over: Record<string, unknown> = {}) =>
    book({ bookingType: 'full_service', ...over });
  const detail = async (id: string) => {
    const res = await admin.get(`/api/bookings/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };
  const pay = (bookingId: string, amountCents: number) =>
    scope.insert(payment, {
      bookingId,
      source: 'external',
      method: 'cash',
      amountCents,
      receivedOn: '2099-07-01',
    });
  const ctx = () => ({ scope, userId: null });
  const committedHeadphones = async (date: string) => {
    const a = (await admin.get(`/api/availability?from=${date}&to=${date}`)).json();
    const d = a.days[0];
    return d.equipment[hp].committed;
  };
  async function staffClient() {
    await admin.post('/api/users', {
      username: 'dj-sam',
      displayName: 'Sam',
      role: 'staff',
      password: 'sam-password-1',
    });
    return client(app, await signIn(app, 'dj-sam', 'sam-password-1'));
  }

  describe('lifecycle (11.1)', () => {
    it('lists bookings with filters and returns details with the money summary', async () => {
      const {
        ids: [rental],
      } = await book();
      await fullService({ startDate: '2099-08-01', endDate: '2099-08-01' });
      const all = (await admin.get('/api/bookings')).json();
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({ organizationName: 'Brew City', contactName: 'Jordan Lee' });
      const rentals = (await admin.get('/api/bookings?bookingType=equipment_rental')).json();
      expect(rentals.map((b: { id: string }) => b.id)).toEqual([rental]);
      expect((await admin.get('/api/bookings?status=awaiting_deposit')).json()).toHaveLength(1);
      expect((await admin.get('/api/bookings?from=2099-07-20')).json()).toHaveLength(1);
      expect((await admin.get('/api/bookings?q=brew')).json()).toHaveLength(2);

      const d = await detail(rental!);
      expect(d).toMatchObject({
        status: 'awaiting_deposit',
        organization: { name: 'Brew City' },
        contact: { email: 'jordan@brewcity.test' },
        money: { owedCents: 50_000, paidCents: 0, balanceCents: 50_000, settlementRequired: false },
      });
      expect(d.requirements).toEqual([
        { equipmentTypeId: hp, name: 'Headphones', quantity: 50 },
        { equipmentTypeId: tx, name: 'Transmitters', quantity: 1 },
      ]);
      expect(d.activity.some((a: { kind: string }) => a.kind === 'booking_created')).toBe(true);
    });

    it('an admin confirms a rental without a deposit, recording the reason and winning the opportunity', async () => {
      const {
        ids: [id],
        oppId,
      } = await book();
      const staff = await staffClient();
      expect((await staff.post(`/api/bookings/${id}/confirm`, { reason: 'x' })).statusCode).toBe(
        403,
      );
      expect((await admin.post(`/api/bookings/${id}/confirm`, { reason: '' })).statusCode).toBe(
        400,
      );
      const res = await admin.post(`/api/bookings/${id}/confirm`, {
        reason: 'repeat client, pays at pickup',
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        status: 'confirmed',
        confirmOverrideReason: 'repeat client, pays at pickup',
      });
      expect(res.json().activity[0]).toMatchObject({
        kind: 'booking_confirmed',
        body: 'Confirmed without deposit: repeat client, pays at pickup',
      });
      expect(scope.get(opportunity, oppId).stage).toBe('won');
      expect(
        (await admin.post(`/api/bookings/${id}/confirm`, { reason: 'again' })).statusCode,
      ).toBe(409);
    });

    it('a paid deposit confirms the rental (idempotently) and wins the opportunity', async () => {
      const {
        ids: [id],
        oppId,
      } = await book();
      expect(confirmBooking(ctx(), id!, { via: 'deposit' }).status).toBe('confirmed');
      expect(confirmBooking(ctx(), id!, { via: 'deposit' }).status).toBe('confirmed');
      expect(scope.get(opportunity, oppId).stage).toBe('won');
      const d = await detail(id!);
      expect(d.confirmOverrideReason).toBeNull();
      expect(
        d.activity.filter((a: { kind: string }) => a.kind === 'booking_confirmed'),
      ).toHaveLength(1);
    });

    it('asks before confirming a rental that would overbook headphones', async () => {
      await fullService({
        requirements: { [hp]: 80 },
        startDate: '2099-07-11',
        endDate: '2099-07-11',
      });
      const {
        ids: [id],
      } = await book();
      const blocked = await admin.post(`/api/bookings/${id}/confirm`, { reason: 'trusted' });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json()).toMatchObject({ error: 'overbooking' });
      expect(blocked.json().details.shortfalls).toContainEqual({
        date: '2099-07-11',
        resource: hp,
        shortfall: 30,
      });
      const ok = await admin.post(`/api/bookings/${id}/confirm`, {
        reason: 'trusted',
        confirmOverbooking: true,
      });
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json()).toMatchObject({ status: 'confirmed', overbookingAcknowledged: true });
    });

    it('cancelling releases the calendar hold and keeps the paid deposit recorded', async () => {
      const {
        ids: [id],
      } = await book();
      confirmBooking(ctx(), id!, { via: 'deposit' });
      pay(id!, 10_000);
      expect(await committedHeadphones('2099-07-11')).toBe(50);
      expect((await admin.post(`/api/bookings/${id}/cancel`, {})).statusCode).toBe(400);
      const res = await admin.post(`/api/bookings/${id}/cancel`, { reason: 'Event called off' });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ status: 'cancelled', cancelReason: 'Event called off' });
      expect(res.json().payments).toHaveLength(1);
      expect(res.json().money.paidCents).toBe(10_000);
      expect(res.json().activity[0].body).toContain('$100.00 received stays recorded');
      expect(await committedHeadphones('2099-07-11')).toBe(0);
      expect((await admin.post(`/api/bookings/${id}/cancel`, { reason: 'again' })).statusCode).toBe(
        409,
      );
    });

    it('moves an equipment rental through confirmed, out, returned and closed', async () => {
      const {
        ids: [id],
      } = await book();
      expect(() => transitionBooking(ctx(), id!, 'out')).toThrow(
        /Awaiting deposit booking cannot become Out/,
      );
      confirmBooking(ctx(), id!, { via: 'deposit' });
      transitionBooking(ctx(), id!, 'out');
      expect((await admin.post(`/api/bookings/${id}/close`, {})).statusCode).toBe(409);
      expect((await admin.post(`/api/bookings/${id}/cancel`, { reason: 'x' })).statusCode).toBe(
        409,
      );
      transitionBooking(ctx(), id!, 'returned');
      pay(id!, 50_000);
      const res = await admin.post(`/api/bookings/${id}/close`, {});
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().status).toBe('closed');
      expect(() => transitionBooking(ctx(), id!, 'out')).toThrow(
        /Closed booking cannot become Out/,
      );
      expect((await admin.post(`/api/bookings/${id}/cancel`, { reason: 'x' })).statusCode).toBe(
        409,
      );
    });

    it('moves a full-service event from confirmed through out, returned and closed; it cannot be deposit-confirmed', async () => {
      const {
        ids: [id],
      } = await fullService();
      expect((await detail(id!)).status).toBe('confirmed');
      expect((await admin.post(`/api/bookings/${id}/confirm`, { reason: 'x' })).statusCode).toBe(
        409,
      );
      transitionBooking(ctx(), id!, 'out');
      transitionBooking(ctx(), id!, 'returned');
      pay(id!, 50_000);
      const res = await admin.post(`/api/bookings/${id}/close`, {});
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().status).toBe('closed');
    });

    it('cancels a full-service event and rejects unknown bookings', async () => {
      const {
        ids: [id],
      } = await fullService();
      const res = await admin.post(`/api/bookings/${id}/cancel`, { reason: 'Bar closed' });
      expect(res.json().status).toBe('cancelled');
      expect((await admin.get('/api/bookings/nope')).statusCode).toBe(404);
    });
  });

  describe('full-service details (11.2)', () => {
    it('records event details only for full-service bookings', async () => {
      const {
        ids: [id],
      } = await fullService();
      const res = await admin.patch(`/api/bookings/${id}/event-details`, {
        venueContact: 'Sam (manager) 414-555-0100',
        loadInTime: '19:30',
        startTime: '21:00',
        endTime: '01:00',
        channels: 3,
        runOfShow: '9pm open\n11pm battle',
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({ loadInTime: '19:30', channels: 3 });
      expect(
        (await admin.patch(`/api/bookings/${id}/event-details`, { channels: 4 })).statusCode,
      ).toBe(400);
      const {
        ids: [rental],
      } = await book({ startDate: '2099-09-01', endDate: '2099-09-02' });
      expect((await admin.patch(`/api/bookings/${rental}/event-details`, {})).statusCode).toBe(400);
    });

    it('an assigned DJ is committed on that date and listed on the booking', async () => {
      const {
        ids: [id],
      } = await fullService({ staffRequired: 0 });
      const djsOn = async () =>
        (await admin.get('/api/availability?from=2099-07-10&to=2099-07-10')).json().days[0].staff;
      expect((await djsOn()).committed).toBe(0);
      const res = await admin.put(`/api/bookings/${id}/staff`, { staffMemberIds: [djs[0]!.id] });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().staff).toEqual([expect.objectContaining({ id: djs[0]!.id, name: 'DJ 1' })]);
      expect(await djsOn()).toMatchObject({ committed: 1, available: 1 });
    });

    it('warns before assigning a DJ who is off or already booked that night', async () => {
      await admin.post(`/api/staff/${djs[1]!.id}/unavailability`, { date: '2099-07-10' });
      const {
        ids: [first],
      } = await fullService();
      const {
        ids: [second],
      } = await fullService();
      await admin.put(`/api/bookings/${first}/staff`, { staffMemberIds: [djs[0]!.id] });

      const off = await admin.put(`/api/bookings/${second}/staff`, {
        staffMemberIds: [djs[1]!.id],
      });
      expect(off.statusCode).toBe(409);
      expect(off.json().details.staffWarnings).toEqual([
        { date: '2099-07-10', staffMemberId: djs[1]!.id, name: 'DJ 2', reason: 'unavailable' },
      ]);
      const dup = await admin.put(`/api/bookings/${second}/staff`, {
        staffMemberIds: [djs[0]!.id],
      });
      expect(dup.json().details.staffWarnings[0]).toMatchObject({ reason: 'double_booked' });
      const forced = await admin.put(`/api/bookings/${second}/staff`, {
        staffMemberIds: [djs[0]!.id],
        confirmOverbooking: true,
      });
      expect(forced.statusCode, forced.body).toBe(200);
      expect(forced.json().overbookingAcknowledged).toBe(true);
      expect(
        (await admin.put(`/api/bookings/${second}/staff`, { staffMemberIds: ['nope'] })).statusCode,
      ).toBe(400);
    });
  });

  describe('rental logistics (11.3)', () => {
    const logistics = {
      fulfillment: 'delivery',
      dispatchDate: '2099-07-10',
      dispatchTime: '15:00',
      returnDate: '2099-07-12',
      returnTime: '10:30',
      deliveryAddress: '123 Main St, Waukesha',
      customerInstructions: 'Use the loading dock.',
    };

    it('records logistics and moves the hold to the new dates, warning on overbooking', async () => {
      const {
        ids: [id],
      } = await book();
      expect(
        (await admin.patch(`/api/bookings/${id}/logistics`, { ...logistics, deliveryAddress: '' }))
          .statusCode,
      ).toBe(400);
      const res = await admin.patch(`/api/bookings/${id}/logistics`, {
        ...logistics,
        dispatchDate: '2099-07-09',
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json()).toMatchObject({
        startDate: '2099-07-09',
        endDate: '2099-07-12',
        fulfillment: 'delivery',
        dispatchTime: '15:00',
      });
      expect(await committedHeadphones('2099-07-09')).toBe(50);

      await fullService({
        startDate: '2099-07-20',
        endDate: '2099-07-20',
        requirements: { [hp]: 80 },
      });
      const moved = { ...logistics, dispatchDate: '2099-07-19', returnDate: '2099-07-20' };
      const blocked = await admin.patch(`/api/bookings/${id}/logistics`, moved);
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json().error).toBe('overbooking');
      const ok = await admin.patch(`/api/bookings/${id}/logistics`, {
        ...moved,
        confirmOverbooking: true,
      });
      expect(ok.statusCode, ok.body).toBe(200);
      const {
        ids: [event],
      } = await fullService({ startDate: '2099-10-01', endDate: '2099-10-01' });
      expect((await admin.patch(`/api/bookings/${event}/logistics`, logistics)).statusCode).toBe(
        400,
      );
    });

    it('emails the rental confirmation with delivery and return times, address and instructions', async () => {
      db.update(tenantSettings)
        .set({ rentalUsageInstructions: 'Charge the headphones overnight.' })
        .where(eq(tenantSettings.tenantId, scope.tenantId))
        .run();
      const {
        ids: [id],
      } = await book();
      expect((await admin.post(`/api/bookings/${id}/send-confirmation`)).statusCode).toBe(409);
      confirmBooking(ctx(), id!, { via: 'deposit' });
      await admin.patch(`/api/bookings/${id}/logistics`, logistics);
      const res = await admin.post(`/api/bookings/${id}/send-confirmation`);
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().confirmationSentAt).toBeTruthy();
      const email = db.select().from(outboundEmail).where(eq(outboundEmail.relatedId, id!)).get()!;
      expect(email.to).toBe('jordan@brewcity.test');
      for (const part of [
        'Delivery date: Friday, July 10, 2099 at 3:00 PM',
        'Return date: Sunday, July 12, 2099 at 10:30 AM',
        '123 Main St, Waukesha',
        'Use the loading dock.',
        'Charge the headphones overnight.',
        '50 × Headphones',
        'We received your holding deposit',
      ]) {
        expect(email.text).toContain(part);
      }
    });
  });

  describe('settlement (11.4)', () => {
    it('settles a 40% split with $1,500 door revenue: $600 owed and due', async () => {
      const {
        ids: [id],
      } = await fullService({ pricingTerm: 'door_split', splitBps: 4000, lines: [] });
      expect((await detail(id!)).money).toMatchObject({
        owedCents: null,
        settlementRequired: true,
      });
      const res = await admin.post(`/api/bookings/${id}/settlement`, {
        doorRevenueCents: 150_000,
        note: 'Per venue report',
      });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().money).toMatchObject({
        owedCents: 60_000,
        balanceCents: 60_000,
        settled: true,
      });
      expect(res.json().settlement).toMatchObject({
        doorRevenueCents: 150_000,
        amountCents: 60_000,
        userId: expect.any(String),
        createdAt: expect.any(String),
      });
      const jobs = db.select().from(job).where(eq(job.type, 'invoice.create')).all();
      expect(jobs.some((j) => j.payload.bookingId === id)).toBe(true);
    });

    it('settles a $500 guarantee + 40% split with $1,000 door revenue: $500 owed', async () => {
      const {
        ids: [id],
      } = await fullService({
        pricingTerm: 'guarantee_plus_split',
        splitBps: 4000,
        guaranteeCents: 50_000,
        lines: [],
      });
      const res = await admin.post(`/api/bookings/${id}/settlement`, { doorRevenueCents: 100_000 });
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().money).toMatchObject({ owedCents: 50_000, balanceCents: 50_000 });
    });

    it('rejects settling flat-fee bookings', async () => {
      const {
        ids: [id],
      } = await fullService();
      expect(
        (await admin.post(`/api/bookings/${id}/settlement`, { doorRevenueCents: 1 })).statusCode,
      ).toBe(400);
    });
  });

  describe('closure (11.5)', () => {
    it('blocks closing a returned booking with a balance and shows the balance', async () => {
      const {
        ids: [id],
      } = await book();
      confirmBooking(ctx(), id!, { via: 'deposit' });
      transitionBooking(ctx(), id!, 'out');
      transitionBooking(ctx(), id!, 'returned');
      pay(id!, 10_000);
      const res = await admin.post(`/api/bookings/${id}/close`, {});
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: 'close_blocked',
        message: 'Balance of $400.00 is outstanding',
        details: { balanceCents: 40_000, blockers: [{ code: 'balance_due' }] },
      });
      expect((await detail(id!)).closeBlockers).toHaveLength(1);

      const staff = await staffClient();
      expect(
        (await staff.post(`/api/bookings/${id}/close`, { overrideReason: 'x' })).statusCode,
      ).toBe(403);
      const forced = await admin.post(`/api/bookings/${id}/close`, {
        overrideReason: 'Written off: friend of the business',
      });
      expect(forced.statusCode, forced.body).toBe(200);
      expect(forced.json().activity[0]).toMatchObject({
        kind: 'booking_closed',
        body: 'Closed by admin override: Written off: friend of the business',
      });
    });

    it('requires check-in and settlement before closing', async () => {
      const {
        ids: [id],
      } = await fullService({ pricingTerm: 'door_split', splitBps: 4000, lines: [] });
      const res = await admin.post(`/api/bookings/${id}/close`, {});
      expect(res.statusCode).toBe(409);
      expect(res.json().details.blockers.map((b: { code: string }) => b.code)).toEqual([
        'not_checked_in',
        'settlement_missing',
      ]);
    });

    it('closes a booking without equipment once paid', async () => {
      const {
        ids: [id],
      } = await fullService({ requirements: {} });
      pay(id!, 50_000);
      const res = await admin.post(`/api/bookings/${id}/close`, {});
      expect(res.statusCode, res.body).toBe(200);
      expect(scope.get(booking, id!).closedAt).toBeTruthy();
    });
  });
});
