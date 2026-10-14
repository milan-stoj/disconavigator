import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp, client, signIn } from './app-helpers.js';

describe('roles and user management', async () => {
  const { app } = await buildTestApp();
  afterAll(() => app.close());
  const admin = client(app, await signIn(app));

  it('admin creates a staff user who can sign in', async () => {
    const res = await admin.post('/api/users', {
      username: 'DJ-Sam',
      displayName: 'Sam',
      role: 'staff',
      password: 'sam-password-1',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ username: 'dj-sam', role: 'staff', active: true });
    expect(res.json()).not.toHaveProperty('passwordHash');
    const cookie = await signIn(app, 'dj-sam', 'sam-password-1');
    const me = await client(app, cookie).get('/api/auth/me');
    expect(me.json().user.role).toBe('staff');
  });

  it('staff cannot create or list users', async () => {
    const staff = client(app, await signIn(app, 'dj-sam', 'sam-password-1'));
    const create = await staff.post('/api/users', {
      username: 'x',
      displayName: 'X',
      role: 'admin',
      password: 'xxxxxxxxxxxx',
    });
    expect(create.statusCode).toBe(403);
    expect((await staff.get('/api/users')).statusCode).toBe(403);
  });

  it('rejects duplicate usernames and invalid input with field errors', async () => {
    const dup = await admin.post('/api/users', {
      username: 'kali',
      displayName: 'K2',
      role: 'staff',
      password: 'long-enough-pw',
    });
    expect(dup.statusCode).toBe(409);
    const bad = await admin.post('/api/users', {
      username: 'new',
      displayName: '',
      role: 'staff',
      password: 'short',
    });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().details.fieldErrors)).toEqual(
      expect.arrayContaining(['displayName', 'password']),
    );
  });

  it('deactivating a user ends their sessions and blocks sign-in', async () => {
    const created = await admin.post('/api/users', {
      username: 'temp',
      displayName: 'Temp',
      role: 'staff',
      password: 'temp-password-1',
    });
    const tempApi = client(app, await signIn(app, 'temp', 'temp-password-1'));
    expect(
      (await admin.patch(`/api/users/${created.json().id}`, { active: false })).statusCode,
    ).toBe(200);
    expect((await tempApi.get('/api/auth/me')).statusCode).toBe(401);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { username: 'temp', password: 'temp-password-1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('admin cannot deactivate themselves', async () => {
    const me = (await admin.get('/api/auth/me')).json();
    expect((await admin.patch(`/api/users/${me.user.id}`, { active: false })).statusCode).toBe(400);
  });
});
