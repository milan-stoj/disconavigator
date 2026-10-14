import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';
import {
  equipmentType,
  equipmentUnit,
  staffMember,
  tenant,
  tenantSettings,
  user,
} from '../src/db/schema.js';
import { seed } from '../src/services/seed.js';
import { ADMIN_PASSWORD, buildTestApp, client, cookieFrom } from './app-helpers.js';

describe('first-run seeding', () => {
  it('seeds tenant, admin kali, 100 headphones, TX-1..TX-3, and two DJs', async () => {
    const { db } = openDatabase(':memory:');
    const r = await seed(db, { initialAdminPassword: ADMIN_PASSWORD });
    expect(r).toMatchObject({ created: true, setupRequired: false });
    expect(
      db
        .select()
        .from(tenant)
        .all()
        .map((t) => t.name),
    ).toEqual(['Undercover Dance Party']);
    expect(db.select().from(user).all()).toMatchObject([{ username: 'kali', role: 'admin' }]);
    const types = db.select().from(equipmentType).all();
    expect(types.find((t) => t.name === 'Headphones')).toMatchObject({
      trackingMode: 'pooled',
      ownedQuantity: 100,
    });
    const tx = types.find((t) => t.name === 'Transmitters')!;
    expect(tx.trackingMode).toBe('serialized');
    expect(
      db
        .select()
        .from(equipmentUnit)
        .where(eq(equipmentUnit.equipmentTypeId, tx.id))
        .all()
        .map((u) => u.label),
    ).toEqual(['TX-1', 'TX-2', 'TX-3']);
    expect(db.select().from(staffMember).all()).toHaveLength(2);
    expect(db.select().from(tenantSettings).get()).toMatchObject({
      rentalDepositBps: 2000,
      bufferDays: 1,
    });
  });

  it('does not duplicate on restart', async () => {
    const opened = openDatabase(':memory:');
    await seed(opened.db, { initialAdminPassword: ADMIN_PASSWORD });
    const again = await seed(opened.db, { initialAdminPassword: 'different-password' });
    expect(again.created).toBe(false);
    expect(opened.db.select().from(tenant).all()).toHaveLength(1);
    expect(opened.db.select().from(user).all()).toHaveLength(1);
    expect(opened.db.select().from(equipmentUnit).all()).toHaveLength(3);
    // restarting the app against the same DB also does not duplicate
    const { app } = await buildTestApp({}, opened);
    expect(opened.db.select().from(tenant).all()).toHaveLength(1);
    await app.close();
  });

  it('requires one-time setup when no initial password is configured', async () => {
    const { app } = await buildTestApp({ INITIAL_ADMIN_PASSWORD: '' });
    expect((await app.inject({ method: 'GET', url: '/api/setup/status' })).json()).toEqual({
      setupRequired: true,
    });
    const cannotSignIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { username: 'kali', password: 'anything-at-all' },
    });
    expect(cannotSignIn.statusCode).toBe(401);

    const weak = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'short' },
    });
    expect(weak.statusCode).toBe(400);
    const res = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'my-new-password' },
    });
    expect(res.statusCode).toBe(200);
    expect((await client(app, cookieFrom(res)).get('/api/auth/me')).json().user.username).toBe(
      'kali',
    );

    expect((await app.inject({ method: 'GET', url: '/api/setup/status' })).json()).toEqual({
      setupRequired: false,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { password: 'attacker-password' },
    });
    expect(second.statusCode).toBe(409);
    const signIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { username: 'kali', password: 'my-new-password' },
    });
    expect(signIn.statusCode).toBe(200);
    await app.close();
  });
});
