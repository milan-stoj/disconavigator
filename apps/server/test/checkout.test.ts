import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TenantScope } from '../src/db/repository.js';
import { charge, equipmentType, equipmentUnit } from '../src/db/schema.js';
import { markOverdueBookings } from '../src/services/checkout.js';
import { buildTestApp, client, signIn } from './app-helpers.js';

describe('equipment check-out and check-in', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof buildTestApp>>['db'];
  let admin: ReturnType<typeof client>;
  let scope: TenantScope;
  let hp: string;
  let tx: string;
  let txUnits: { id: string; label: string }[];
  let contactId: string;
  let orgId: string;

  beforeEach(async () => {
    ({ app, db } = await buildTestApp());
    scope = new TenantScope(db, app.deps.seedResult.tenantId);
    admin = client(app, await signIn(app));
    const types = scope.list(equipmentType);
    hp = types.find((t) => t.name === 'Headphones')!.id;
    tx = types.find((t) => t.name === 'Transmitters')!.id;
    txUnits = scope.list(equipmentUnit).sort((a, b) => a.label.localeCompare(b.label));
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
  const detail = async (id: string) => (await admin.get(`/api/bookings/${id}`)).json();
  async function confirmed(over: Record<string, unknown> = {}) {
    const {
      ids: [id],
    } = await book(over);
    if ((await detail(id!)).status !== 'confirmed') {
      const res = await admin.post(`/api/bookings/${id}/confirm`, { reason: 'trusted' });
      expect(res.statusCode, res.body).toBe(200);
    }
    return id!;
  }
  const owned = (id: string) => scope.get(equipmentType, id).ownedQuantity;
  const outOfService = (id: string) => scope.get(equipmentType, id).outOfServiceQuantity;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON from the API
  const line = (b: any, t: string) => b.equipment.lines.find((l: any) => l.equipmentTypeId === t);

  async function checkOut(id: string, headphones = 50, unitIds = [txUnits[1]!.id]) {
    const res = await admin.post(`/api/bookings/${id}/check-out`, {
      pooled: [{ equipmentTypeId: hp, quantity: headphones }],
      unitIds,
    });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  }

  it('checks out and in a rental, proposing loss charges for missing headphones', async () => {
    const id = await confirmed();
    const out = await checkOut(id);
    expect(out.status).toBe('out');
    expect(line(out, hp)).toMatchObject({ required: 50, checkedOut: 50 });
    expect(out.equipment.checkedOut).toMatchObject({ by: 'Kali' });
    expect(out.equipment.checkedOut.at).toBeTruthy();
    expect(line(out, tx).units).toEqual([expect.objectContaining({ label: 'TX-2' })]);

    const res = await admin.post(`/api/bookings/${id}/check-in`, {
      pooled: [{ equipmentTypeId: hp, returned: 47, damaged: 0 }],
      returnedUnitIds: [txUnits[1]!.id],
      damagedUnitIds: [],
    });
    expect(res.statusCode, res.body).toBe(200);
    const back = res.json();
    expect(back.status).toBe('returned');
    expect(line(back, hp)).toMatchObject({ returned: 47, missing: 3 });
    expect(owned(hp)).toBe(97);
    const [c] = scope.list(charge);
    expect(c).toMatchObject({ kind: 'loss', status: 'proposed', proposedCents: 18_000 });
    expect(back.activity.map((a: { kind: string }) => a.kind)).toEqual(
      expect.arrayContaining(['checked_out', 'checked_in']),
    );

    const found = await admin.post(`/api/bookings/${id}/found`, {
      equipmentTypeId: hp,
      quantity: 2,
      note: 'Behind the bar',
    });
    expect(found.statusCode, found.body).toBe(201);
    expect(line(found.json(), hp)).toMatchObject({ missing: 1, found: 2 });
    expect(owned(hp)).toBe(99);
    expect(scope.get(charge, c!.id).proposedCents).toBe(6_000);

    await admin.post(`/api/bookings/${id}/found`, { equipmentTypeId: hp, quantity: 1 });
    expect(scope.get(charge, c!.id).status).toBe('waived');
    expect(owned(hp)).toBe(100);
  });

  it('records a full return with no losses', async () => {
    const id = await confirmed();
    await checkOut(id);
    const res = await admin.post(`/api/bookings/${id}/check-in`, {
      pooled: [{ equipmentTypeId: hp, returned: 50, damaged: 0 }],
      returnedUnitIds: [txUnits[1]!.id],
    });
    expect(res.json().status).toBe('returned');
    expect(line(res.json(), hp)).toMatchObject({ missing: 0, damaged: 0 });
    expect(owned(hp)).toBe(100);
    expect(scope.get(equipmentUnit, txUnits[1]!.id).status).toBe('in_service');
    expect(scope.list(charge)).toHaveLength(0);
  });

  it('records missing gear on a staffed event without charging anyone', async () => {
    const id = await confirmed({ bookingType: 'full_service', requirements: { [hp]: 100 } });
    await checkOut(id, 100, []);
    const res = await admin.post(`/api/bookings/${id}/check-in`, {
      pooled: [{ equipmentTypeId: hp, returned: 98, damaged: 0 }],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(line(res.json(), hp)).toMatchObject({ missing: 2 });
    expect(owned(hp)).toBe(98);
    expect(scope.list(charge)).toHaveLength(0);
  });

  it('takes damaged gear out of service and marks missing transmitters lost', async () => {
    const id = await confirmed();
    await checkOut(id);
    const res = await admin.post(`/api/bookings/${id}/check-in`, {
      pooled: [{ equipmentTypeId: hp, returned: 50, damaged: 2 }],
      returnedUnitIds: [],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(outOfService(hp)).toBe(2);
    expect(line(res.json(), hp)).toMatchObject({ damaged: 2, missing: 0 });
    expect(owned(hp)).toBe(100);
    expect(scope.get(equipmentUnit, txUnits[1]!.id).status).toBe('lost');
    const [c] = scope.list(charge);
    expect(c).toMatchObject({ status: 'proposed', proposedCents: 30_000 });
  });

  it('requires acknowledgement when what goes out differs from the booking', async () => {
    const id = await confirmed();
    const res = await admin.post(`/api/bookings/${id}/check-out`, {
      pooled: [{ equipmentTypeId: hp, quantity: 45 }],
      unitIds: [txUnits[0]!.id],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'quantity_mismatch' });
    expect(res.json().details.differences).toContainEqual(
      expect.objectContaining({ equipmentTypeId: hp, required: 50, checkedOut: 45 }),
    );
    const ok = await admin.post(`/api/bookings/${id}/check-out`, {
      pooled: [{ equipmentTypeId: hp, quantity: 45 }],
      unitIds: [txUnits[0]!.id],
      acknowledgeDifference: true,
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('out');
  });

  it('rejects check-in before check-out and checking out more than is in service', async () => {
    const id = await confirmed();
    const early = await admin.post(`/api/bookings/${id}/check-in`, {
      pooled: [{ equipmentTypeId: hp, returned: 50, damaged: 0 }],
    });
    expect(early.statusCode).toBe(409);
    const tooMany = await admin.post(`/api/bookings/${id}/check-out`, {
      pooled: [{ equipmentTypeId: hp, quantity: 101 }],
      acknowledgeDifference: true,
    });
    expect(tooMany.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('flags rentals that are not back by the return date', async () => {
    const id = await confirmed();
    await checkOut(id);
    expect(markOverdueBookings(db, new Date('2099-07-12T15:00:00Z'))).toEqual([]);
    expect(markOverdueBookings(db, new Date('2099-07-14T15:00:00Z'))).toEqual([id]);
    expect(markOverdueBookings(db, new Date('2099-07-14T16:00:00Z'))).toEqual([]);
    const b = await detail(id);
    expect(b.overdue).toBe(true);
    const cal = (await admin.get('/api/availability?from=2099-07-10&to=2099-07-12')).json();
    expect(cal.bookings.find((x: { id: string }) => x.id === id).overdue).toBe(true);
    expect(b.activity.map((a: { kind: string }) => a.kind)).toContain('return_overdue');
    await admin.post(`/api/bookings/${id}/check-in`, {
      pooled: [{ equipmentTypeId: hp, returned: 50, damaged: 0 }],
      returnedUnitIds: [txUnits[1]!.id],
    });
    expect((await detail(id)).overdue).toBe(false);
  });
});
