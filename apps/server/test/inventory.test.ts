import { computeCapacity } from '@disco/shared';
import { afterAll, describe, expect, it } from 'vitest';
import { TenantScope } from '../src/db/repository.js';
import { equipmentType } from '../src/db/schema.js';
import { equipmentCapacity, requireQuotablePackage } from '../src/services/inventory.js';
import { buildTestApp, client, signIn } from './app-helpers.js';
import { createTenant } from './helpers.js';

interface Unit {
  id: string;
  label: string;
  status: string;
}
interface TypeView {
  id: string;
  name: string;
  trackingMode: string;
  owned: number;
  outOfService: number;
  inService: number;
  units: Unit[];
}

describe('equipment inventory and packages', async () => {
  const { app, db } = await buildTestApp();
  afterAll(() => app.close());
  const admin = client(app, await signIn(app));
  const me = (await admin.get('/api/auth/me')).json();
  const scope = new TenantScope(db, me.tenant.id);
  await admin.post('/api/users', {
    username: 'sam',
    displayName: 'Sam',
    role: 'staff',
    password: 'staff-password-123',
  });
  const staff = client(app, await signIn(app, 'sam', 'staff-password-123'));

  const equipment = async () => (await admin.get('/api/equipment')).json() as TypeView[];
  const byName = async (name: string) => (await equipment()).find((t) => t.name === name)!;
  const headphones = await byName('Headphones');
  const transmitters = await byName('Transmitters');

  it('lists the seeded pooled and serialized equipment', () => {
    expect(headphones).toMatchObject({ trackingMode: 'pooled', owned: 100, inService: 100 });
    expect(transmitters).toMatchObject({ trackingMode: 'serialized', owned: 3 });
    expect(transmitters.units.map((u) => u.label)).toEqual(['TX-1', 'TX-2', 'TX-3']);
  });

  it('buying 50 headphones raises the owned count from 100 to 150 with history', async () => {
    const res = await admin.post(`/api/equipment/${headphones.id}/adjustments`, {
      delta: 50,
      reason: 'purchase',
      note: 'Spring order',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ owned: 150, inService: 150 });
    const history = (await admin.get(`/api/equipment/${headphones.id}/adjustments`)).json();
    expect(history[0]).toMatchObject({
      delta: 50,
      reason: 'purchase',
      note: 'Spring order',
      userName: 'Kali',
    });
  });

  it('rejects adjustments with the wrong sign, too large a removal, or from staff', async () => {
    const wrongSign = await admin.post(`/api/equipment/${headphones.id}/adjustments`, {
      delta: -5,
      reason: 'purchase',
    });
    expect(wrongSign.statusCode).toBe(400);
    expect(wrongSign.json().details.fieldErrors.delta).toBe('This reason adds equipment');
    const tooMany = await admin.post(`/api/equipment/${headphones.id}/adjustments`, {
      delta: -500,
      reason: 'lost',
    });
    expect(tooMany.statusCode).toBe(400);
    const asStaff = await staff.post(`/api/equipment/${headphones.id}/adjustments`, {
      delta: 1,
      reason: 'found',
    });
    expect(asStaff.statusCode).toBe(403);
  });

  it('retiring a transmitter removes it from capacity but keeps it in history', async () => {
    const tx1 = transmitters.units.find((u) => u.label === 'TX-1')!;
    expect(
      (await staff.put(`/api/equipment-units/${tx1.id}/status`, { status: 'retired' })).statusCode,
    ).toBe(403);
    const res = await admin.put(`/api/equipment-units/${tx1.id}/status`, {
      status: 'retired',
      note: 'Cracked case',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ owned: 2, inService: 2 });
    expect(res.json().units.find((u: Unit) => u.id === tx1.id).status).toBe('retired');
    expect(equipmentCapacity(scope).find((c) => c.equipmentTypeId === transmitters.id)).toEqual({
      equipmentTypeId: transmitters.id,
      owned: 2,
      outOfService: 0,
    });
    const history = (await admin.get(`/api/equipment/${transmitters.id}/adjustments`)).json();
    expect(history[0]).toMatchObject({ delta: -1, reason: 'retired', unitLabel: 'TX-1' });
  });

  it('staff can take a transmitter out of service and back', async () => {
    const tx2 = transmitters.units.find((u) => u.label === 'TX-2')!;
    const out = await staff.put(`/api/equipment-units/${tx2.id}/status`, {
      status: 'out_of_service',
    });
    expect(out.json()).toMatchObject({ owned: 2, outOfService: 1, inService: 1 });
    const back = await staff.put(`/api/equipment-units/${tx2.id}/status`, {
      status: 'in_service',
    });
    expect(back.json()).toMatchObject({ outOfService: 0, inService: 2 });
  });

  it('adds serialized units with unique labels', async () => {
    const res = await admin.post(`/api/equipment/${transmitters.id}/units`, { label: 'TX-4' });
    expect(res.statusCode).toBe(201);
    expect(res.json().owned).toBe(3);
    const dup = await admin.post(`/api/equipment/${transmitters.id}/units`, { label: 'TX-4' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().details.fieldErrors.label).toBeDefined();
  });

  it('5 headphones out of service reduce available capacity on every date', async () => {
    const res = await staff.put(`/api/equipment/${headphones.id}/out-of-service`, {
      quantity: 5,
      note: 'Not charging',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ owned: 150, outOfService: 5, inService: 145 });
    const days = computeCapacity({
      from: '2026-06-01',
      to: '2026-06-07',
      bufferDays: 1,
      equipment: equipmentCapacity(scope),
      staffMemberIds: [],
      staffUnavailability: [],
      holds: [],
    });
    expect(days).toHaveLength(7);
    for (const day of days) expect(day.equipment[headphones.id]!.available).toBe(145);
    const tooMany = await staff.put(`/api/equipment/${headphones.id}/out-of-service`, {
      quantity: 151,
    });
    expect(tooMany.statusCode).toBe(400);
    const history = (await admin.get(`/api/equipment/${headphones.id}/adjustments`)).json();
    expect(history[0]).toMatchObject({ delta: 5, reason: 'out_of_service', note: 'Not charging' });
  });

  it('admin creates equipment types with unique names', async () => {
    const res = await admin.post('/api/equipment', {
      name: 'Charging cases',
      trackingMode: 'pooled',
      lossFeeCents: 4000,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ owned: 0, trackingMode: 'pooled' });
    const dup = await admin.post('/api/equipment', {
      name: 'charging cases',
      trackingMode: 'pooled',
      lossFeeCents: 0,
    });
    expect(dup.statusCode).toBe(409);
    const renamed = await admin.patch(`/api/equipment/${res.json().id}`, {
      name: 'Charging case',
      lossFeeCents: 4500,
    });
    expect(renamed.json()).toMatchObject({ name: 'Charging case', lossFeeCents: 4500 });
  });

  describe('rental packages', () => {
    const party50 = () => ({
      name: 'Party 50',
      description: '50 headphones and a transmitter',
      priceCents: 30000,
      includedDays: 2,
      extraDayPriceCents: 7500,
      items: [
        { equipmentTypeId: headphones.id, quantity: 50, lossFeeCents: 6000 },
        { equipmentTypeId: transmitters.id, quantity: 1 },
      ],
    });

    it('creates "Party 50" with item loss fees', async () => {
      const res = await admin.post('/api/packages', party50());
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ name: 'Party 50', active: true, includedDays: 2 });
      expect(res.json().items).toEqual([
        expect.objectContaining({
          equipmentName: 'Headphones',
          quantity: 50,
          lossFeeCents: 6000,
          effectiveLossFeeCents: 6000,
        }),
        expect.objectContaining({
          equipmentName: 'Transmitters',
          quantity: 1,
          lossFeeCents: null,
          effectiveLossFeeCents: 30000,
        }),
      ]);
    });

    it('validates names, items, and admin access', async () => {
      const dup = await admin.post('/api/packages', party50());
      expect(dup.statusCode).toBe(400);
      expect(dup.json().details.fieldErrors.name).toBeDefined();
      const repeated = await admin.post('/api/packages', {
        ...party50(),
        name: 'Repeat',
        items: [party50().items[0], party50().items[0]],
      });
      expect(repeated.json().details.fieldErrors['items.1.equipmentTypeId']).toBeDefined();
      const empty = await admin.post('/api/packages', { ...party50(), name: 'Empty', items: [] });
      expect(empty.json().details.fieldErrors.items).toBe('Add at least one item');
      expect((await staff.post('/api/packages', { ...party50(), name: 'X' })).statusCode).toBe(403);
    });

    it('edits a package and replaces its items', async () => {
      const [pkg] = (await admin.get('/api/packages')).json();
      const res = await admin.put(`/api/packages/${pkg.id}`, {
        ...party50(),
        priceCents: 32500,
        items: [{ equipmentTypeId: headphones.id, quantity: 60 }],
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().priceCents).toBe(32500);
      expect(res.json().items).toHaveLength(1);
      expect(res.json().items[0]).toMatchObject({ quantity: 60, effectiveLossFeeCents: 6000 });
    });

    it('deactivated packages cannot be added to new quotes', async () => {
      const [pkg] = (await admin.get('/api/packages')).json();
      expect(requireQuotablePackage(scope, pkg.id).id).toBe(pkg.id);
      const res = await admin.patch(`/api/packages/${pkg.id}/active`, { active: false });
      expect(res.json().active).toBe(false);
      expect((await admin.get('/api/packages?active=true')).json()).toEqual([]);
      expect((await admin.get('/api/packages')).json()).toHaveLength(1);
      expect(() => requireQuotablePackage(scope, pkg.id)).toThrow(/no longer offered/);
      await admin.patch(`/api/packages/${pkg.id}/active`, { active: true });
      expect((await admin.get('/api/packages?active=true')).json()).toHaveLength(1);
    });

    it('hides other tenants’ packages and equipment', async () => {
      const other = createTenant(db, 'Other');
      const res = await admin.get(`/api/packages`);
      const ids = res.json().map((p: { id: string }) => p.id);
      expect(
        (await admin.get(`/api/equipment/${ids[0]}`)).statusCode,
        'package id is not an equipment id',
      ).toBe(404);
      const foreignType = other.scope.insert(equipmentType, {
        name: 'Theirs',
        trackingMode: 'pooled',
        ownedQuantity: 10,
      });
      expect((await admin.get(`/api/equipment/${foreignType.id}`)).statusCode).toBe(404);
      const sneaky = await admin.post('/api/packages', {
        ...party50(),
        name: 'Sneaky',
        items: [{ equipmentTypeId: foreignType.id, quantity: 1 }],
      });
      expect(sneaky.statusCode).toBe(400);
    });
  });
});
