import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp, client, signIn } from './app-helpers.js';

describe('tenant settings API', async () => {
  const { app } = await buildTestApp();
  afterAll(() => app.close());
  const admin = client(app, await signIn(app));

  it('returns seeded defaults', async () => {
    const res = await admin.get('/api/settings');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      businessName: 'Undercover Dance Party',
      rentalDepositBps: 2000,
      bufferDays: 1,
      deliveryFeeCents: 7500,
      squareConnected: false,
    });
    expect(res.json().rentalTerms).toContain('holding deposit');
  });

  it('admin saves settings', async () => {
    const current = (await admin.get('/api/settings')).json();
    const res = await admin.put('/api/settings', {
      ...current,
      rentalDepositBps: 2500,
      deliveryFeeCents: 10000,
      notificationEmail: 'Hi@UDP.test',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      rentalDepositBps: 2500,
      deliveryFeeCents: 10000,
      notificationEmail: 'hi@udp.test',
    });
    expect((await admin.get('/api/settings')).json().rentalDepositBps).toBe(2500);
  });

  it('validates input and restricts writes to admins', async () => {
    const current = (await admin.get('/api/settings')).json();
    const bad = await admin.put('/api/settings', {
      ...current,
      rentalDepositBps: 20000,
      bufferDays: -1,
    });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().details.fieldErrors)).toEqual(
      expect.arrayContaining(['rentalDepositBps', 'bufferDays']),
    );

    await admin.post('/api/users', {
      username: 'dj',
      displayName: 'DJ',
      role: 'staff',
      password: 'dj-password-1',
    });
    const staff = client(app, await signIn(app, 'dj', 'dj-password-1'));
    expect((await staff.get('/api/settings')).statusCode).toBe(200);
    expect((await staff.put('/api/settings', current)).statusCode).toBe(403);
  });
});
