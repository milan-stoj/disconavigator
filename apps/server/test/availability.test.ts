import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CapacityDay } from '@disco/shared';
import { TenantScope } from '../src/db/repository.js';
import {
  booking,
  bookingStaff,
  equipmentRequirement,
  equipmentType,
  staffMember,
} from '../src/db/schema.js';
import { buildTestApp, client, signIn } from './app-helpers.js';

type Admin = ReturnType<typeof client>;
type Status = (typeof booking.$inferInsert)['status'];

describe('staff and availability', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof buildTestApp>>['db'];
  let admin: Admin;
  let scope: TenantScope;
  let hp: string;
  let tx: string;
  let djs: { id: string; name: string }[];
  let n = 0;

  beforeEach(async () => {
    ({ app, db } = await buildTestApp());
    scope = new TenantScope(db, app.deps.seedResult.tenantId);
    admin = client(app, await signIn(app));
    const types = scope.list(equipmentType);
    hp = types.find((t) => t.name === 'Headphones')!.id;
    tx = types.find((t) => t.name === 'Transmitters')!.id;
    djs = scope.list(staffMember).sort((a, b) => a.name.localeCompare(b.name));
    n = 0;
  });
  afterEach(() => app.close());

  function addBooking(opts: {
    type?: 'equipment_rental' | 'full_service';
    status?: Status;
    start: string;
    end?: string;
    headphones?: number;
    transmitters?: number;
    staff?: number;
    assigned?: string[];
  }) {
    const b = scope.insert(booking, {
      number: ++n,
      bookingType: opts.type ?? 'equipment_rental',
      status: opts.status ?? 'confirmed',
      pricingTerm: 'flat_fee',
      title: `Booking ${n}`,
      startDate: opts.start,
      endDate: opts.end ?? opts.start,
      staffRequired: opts.staff ?? 0,
    });
    for (const [typeId, quantity] of [
      [hp, opts.headphones ?? 0],
      [tx, opts.transmitters ?? 0],
    ] as const) {
      if (quantity)
        db.insert(equipmentRequirement)
          .values({ tenantId: scope.tenantId, bookingId: b.id, equipmentTypeId: typeId, quantity })
          .run();
    }
    for (const staffMemberId of opts.assigned ?? [])
      db.insert(bookingStaff)
        .values({ tenantId: scope.tenantId, bookingId: b.id, staffMemberId })
        .run();
    return b;
  }

  async function availability(from: string, to = from) {
    const res = await admin.get(`/api/availability?from=${from}&to=${to}`);
    expect(res.statusCode).toBe(200);
    return res.json();
  }
  const day = (a: { days: { date: string }[] }, date: string) =>
    a.days.find((d) => d.date === date) as CapacityDay;

  describe('staff (10.1)', () => {
    it('seeds two DJ placeholders that an admin can rename', async () => {
      const list = (await admin.get('/api/staff')).json();
      expect(list.map((s: { name: string }) => s.name)).toEqual(['DJ 1', 'DJ 2']);
      const res = await admin.patch(`/api/staff/${djs[0]!.id}`, { name: 'DJ Kali' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ name: 'DJ Kali', active: true });
      const created = await admin.post('/api/staff', { name: 'DJ 3' });
      expect(created.statusCode).toBe(201);
      expect((await admin.get('/api/staff')).json()).toHaveLength(3);
    });

    it('deactivating via partial patch keeps other fields', async () => {
      await admin.patch(`/api/staff/${djs[0]!.id}`, { email: 'dj1@udp.test' });
      const res = await admin.patch(`/api/staff/${djs[0]!.id}`, { active: false });
      expect(res.json()).toMatchObject({ active: false, email: 'dj1@udp.test', name: 'DJ 1' });
      const partial = await admin.patch(`/api/staff/${djs[0]!.id}`, { name: 'DJ One' });
      expect(partial.json()).toMatchObject({ active: false, name: 'DJ One' });
    });

    it('only admins edit staff', async () => {
      await admin.post('/api/users', {
        username: 'dj-sam',
        displayName: 'Sam',
        role: 'staff',
        password: 'sam-password-1',
      });
      const staff = client(app, await signIn(app, 'dj-sam', 'sam-password-1'));
      expect((await staff.get('/api/staff')).statusCode).toBe(200);
      expect((await staff.patch(`/api/staff/${djs[0]!.id}`, { name: 'x' })).statusCode).toBe(403);
      expect(
        (await staff.post(`/api/staff/${djs[0]!.id}/unavailability`, { date: '2099-07-11' }))
          .statusCode,
      ).toBe(403);
    });

    it('a DJ unavailable on a date leaves at most one DJ available', async () => {
      const res = await admin.post(`/api/staff/${djs[0]!.id}/unavailability`, {
        date: '2099-07-11',
        note: 'Wedding',
      });
      expect(res.statusCode).toBe(201);
      const dup = await admin.post(`/api/staff/${djs[0]!.id}/unavailability`, {
        date: '2099-07-11',
      });
      expect(dup.statusCode).toBe(409);
      const a = await availability('2099-07-10', '2099-07-12');
      expect(day(a, '2099-07-11').staff).toMatchObject({ total: 2, unavailable: 1, available: 1 });
      expect(day(a, '2099-07-10').staff.available).toBe(2);
      expect(a.staffUnavailability).toEqual([{ staffMemberId: djs[0]!.id, date: '2099-07-11' }]);
      const listed = await admin.get(
        `/api/staff/${djs[0]!.id}/unavailability?from=2099-07-01&to=2099-07-31`,
      );
      expect(listed.json()).toEqual([{ date: '2099-07-11', note: 'Wedding' }]);

      const del = await admin.delete(`/api/staff/${djs[0]!.id}/unavailability/2099-07-11`);
      expect(del.statusCode).toBe(204);
      expect(day(await availability('2099-07-11'), '2099-07-11').staff.available).toBe(2);
    });

    it('lists upcoming days off with each staff member', async () => {
      await admin.post(`/api/staff/${djs[1]!.id}/unavailability`, { date: '2099-01-02' });
      const list = (await admin.get('/api/staff')).json();
      // 2099 is beyond the one-year lookahead
      expect(list[1].unavailable).toEqual([]);
    });
  });

  describe('availability API (10.2)', () => {
    it('day with one booking: 0 headphones, 1 transmitter, 1 DJ available', async () => {
      const b = addBooking({
        type: 'full_service',
        start: '2099-07-11',
        headphones: 100,
        transmitters: 2,
        staff: 1,
      });
      const a = await availability('2099-07-11');
      const sat = day(a, '2099-07-11');
      expect(sat.equipment[hp]).toMatchObject({ usable: 100, committed: 100, available: 0 });
      expect(sat.equipment[tx]).toMatchObject({ usable: 3, committed: 2, available: 1 });
      expect(sat.staff.available).toBe(1);
      expect(sat.holds).toEqual([expect.objectContaining({ id: b.id, strength: 'confirmed' })]);
      expect(a.bookings).toEqual([expect.objectContaining({ id: b.id, title: 'Booking 1' })]);
      expect(a.equipmentTypes.map((t: { name: string }) => t.name)).toEqual([
        'Headphones',
        'Transmitters',
      ]);
      expect(a.conflicts).toEqual([]);
    });

    it('weekend rental with a one-day buffer is committed Friday through Monday', async () => {
      addBooking({ start: '2099-07-10', end: '2099-07-12', headphones: 50 });
      const a = await availability('2099-07-09', '2099-07-14');
      const committed = a.days.map((d: CapacityDay) => [d.date, d.equipment[hp]!.committed]);
      expect(committed).toEqual([
        ['2099-07-09', 0],
        ['2099-07-10', 50],
        ['2099-07-11', 50],
        ['2099-07-12', 50],
        ['2099-07-13', 50],
        ['2099-07-14', 0],
      ]);
      expect(a.bookings[0]).toMatchObject({ holdEndDate: '2099-07-13' });
    });

    it('a hold ending before the range still shows its buffer day', async () => {
      addBooking({ start: '2099-07-10', end: '2099-07-12', headphones: 50 });
      const a = await availability('2099-07-13', '2099-07-14');
      expect(day(a, '2099-07-13').equipment[hp]!.committed).toBe(50);
      expect(a.bookings).toHaveLength(1);
    });

    it('distinguishes tentative from confirmed and both reduce capacity', async () => {
      const t = addBooking({ status: 'awaiting_deposit', start: '2099-07-11', headphones: 30 });
      const c = addBooking({
        type: 'full_service',
        start: '2099-07-11',
        headphones: 50,
        staff: 1,
      });
      const sat = day(await availability('2099-07-11'), '2099-07-11');
      expect(sat.equipment[hp]).toMatchObject({ committed: 80, tentative: 30, available: 20 });
      expect(sat.holds).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: t.id, strength: 'tentative' }),
          expect.objectContaining({ id: c.id, strength: 'confirmed' }),
        ]),
      );
    });

    it('cancelled bookings do not appear or consume capacity', async () => {
      addBooking({ status: 'cancelled', start: '2099-07-11', headphones: 100 });
      const a = await availability('2099-07-11');
      expect(day(a, '2099-07-11').equipment[hp]!.available).toBe(100);
      expect(a.bookings).toEqual([]);
    });

    it('a sent quote shows as an indicator without consuming capacity', async () => {
      const org = (await admin.post('/api/organizations', { name: 'Taproom', type: 'bar' })).json();
      const contact = (
        await admin.post('/api/contacts', {
          name: 'Jo',
          email: 'jo@tap.test',
          organizationId: org.id,
        })
      ).json();
      const opp = (
        await admin.post('/api/opportunities', {
          title: 'Taproom party',
          stage: 'contacted',
          organizationId: org.id,
          contactId: contact.id,
        })
      ).json();
      const q = (
        await admin.post('/api/quotes', {
          opportunityId: opp.id,
          bookingType: 'equipment_rental',
          pricingTerm: 'flat_fee',
          startDate: '2099-07-11',
          endDate: '2099-07-11',
          insideServiceArea: true,
          lines: [{ kind: 'custom', description: 'Headphones', quantity: 1, unitPriceCents: 1 }],
          requirements: { [hp]: 60 },
          staffRequired: 0,
        })
      ).json();
      expect(q.id).toBeDefined();
      expect((await admin.post(`/api/quotes/${q.id}/send`)).statusCode).toBe(200);
      const sat = day(await availability('2099-07-11'), '2099-07-11');
      expect(sat.equipment[hp]).toMatchObject({ available: 100, softDemand: 60 });
      expect(sat.holds).toEqual([
        expect.objectContaining({ source: 'quote', strength: 'soft', id: q.id }),
      ]);
      expect(sat.conflict).toBe(false);
    });

    it('flags equipment and staff conflicts and fleet splits', async () => {
      addBooking({ type: 'full_service', start: '2099-07-11', headphones: 80, staff: 1 });
      addBooking({ type: 'full_service', start: '2099-07-11', headphones: 50, staff: 1 });
      await admin.post(`/api/staff/${djs[0]!.id}/unavailability`, { date: '2099-07-11' });
      const a = await availability('2099-07-10', '2099-07-12');
      // Headphones stay out on the buffer day, so Sunday is short too (no DJ split there).
      expect(a.conflicts.map((c: { date: string }) => c.date)).toEqual([
        '2099-07-11',
        '2099-07-12',
      ]);
      expect(a.conflicts[0]).toMatchObject({ date: '2099-07-11', fleetSplit: true });
      expect(a.conflicts[1]).toMatchObject({
        fleetSplit: false,
        shortfalls: [{ resource: hp, shortfall: 30 }],
      });
      expect(a.conflicts[0].shortfalls).toEqual(
        expect.arrayContaining([
          { resource: hp, shortfall: 30 },
          { resource: 'staff', shortfall: 1 },
        ]),
      );
      expect(a.conflicts[0].holds).toHaveLength(2);
      expect(day(a, '2099-07-11').conflict).toBe(true);
    });

    it('flags an assigned DJ who is unavailable', async () => {
      addBooking({ type: 'full_service', start: '2099-07-11', staff: 1, assigned: [djs[0]!.id] });
      await admin.post(`/api/staff/${djs[0]!.id}/unavailability`, { date: '2099-07-11' });
      const sat = day(await availability('2099-07-11'), '2099-07-11');
      expect(sat.staff.assignedButUnavailableIds).toEqual([djs[0]!.id]);
      expect(sat.conflict).toBe(true);
    });

    it('validates the date range', async () => {
      expect((await admin.get('/api/availability?from=2099-07-11')).statusCode).toBe(400);
      expect((await admin.get('/api/availability?from=2099-07-11&to=2099-07-01')).statusCode).toBe(
        400,
      );
      expect((await admin.get('/api/availability?from=2099-01-01&to=2099-12-31')).statusCode).toBe(
        400,
      );
    });
  });
});
