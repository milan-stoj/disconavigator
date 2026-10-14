import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { resolveSession, createSession } from '../src/auth/sessions.js';
import { session, user } from '../src/db/schema.js';
import { ADMIN_PASSWORD, buildTestApp, client, cookieFrom, signIn } from './app-helpers.js';

describe('authentication', async () => {
  const { app, db } = await buildTestApp();
  afterAll(() => app.close());

  it('signs in with valid credentials and stores an argon2id hash', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { username: 'kali', password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: { username: 'kali', role: 'admin' },
      tenant: { name: 'Undercover Dance Party' },
    });
    const cookie = res.cookies.find((c) => c.name === 'disco_session')!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: cookieFrom(res) },
    });
    expect(me.json().user.username).toBe('kali');
    expect(db.select().from(user).where(eq(user.username, 'kali')).get()!.passwordHash).toMatch(
      /^\$argon2id\$/,
    );
  });

  it('usernames are case-insensitive', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { username: 'KALI', password: ADMIN_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
  });

  it('returns the same generic error for a bad password and an unknown user', async () => {
    const bad = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { username: 'kali', password: 'wrong-password' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in',
      payload: { username: 'nobody', password: 'wrong-password' },
    });
    expect(bad.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(bad.json().message).toBe('Incorrect username or password');
    expect(unknown.json().message).toBe(bad.json().message);
    expect(bad.cookies).toHaveLength(0);
  });

  it('unauthenticated API requests get 401', async () => {
    for (const url of ['/api/auth/me', '/api/users']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
    const bogus = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'disco_session=forged' },
    });
    expect(bogus.statusCode).toBe(401);
  });

  it('sign-out invalidates the session', async () => {
    const cookie = await signIn(app);
    const api = client(app, cookie);
    expect((await api.get('/api/auth/me')).statusCode).toBe(200);
    expect((await api.post('/api/auth/sign-out')).statusCode).toBe(204);
    expect((await api.get('/api/auth/me')).statusCode).toBe(401);
  });

  it('expires idle sessions and sessions past their absolute lifetime', () => {
    const kali = db.select().from(user).where(eq(user.username, 'kali')).get()!;
    const policy = { idleMinutes: 30, absoluteHours: 2 };
    const t0 = new Date('2026-01-01T00:00:00Z');
    const a = createSession(db, kali, policy, {}, t0);
    expect(resolveSession(db, a.token, policy, new Date('2026-01-01T00:29:00Z'))).not.toBeNull();
    expect(resolveSession(db, a.token, policy, new Date('2026-01-01T01:30:00Z'))).toBeNull();

    const b = createSession(db, kali, policy, {}, t0);
    // keep it active every 20 minutes, but absolute expiry still applies
    for (const m of [20, 40, 60, 80, 100]) {
      expect(
        resolveSession(db, b.token, policy, new Date(t0.getTime() + m * 60_000)),
      ).not.toBeNull();
    }
    expect(resolveSession(db, b.token, policy, new Date(t0.getTime() + 121 * 60_000))).toBeNull();
  });

  it('stores only a hash of the session token', async () => {
    const cookie = await signIn(app);
    const token = cookie.split('=')[1]!;
    expect(db.select().from(session).where(eq(session.id, token)).get()).toBeUndefined();
  });

  it('rejects cross-origin state-changing requests', async () => {
    const cookie = await signIn(app);
    const evil = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin: 'https://evil.example' },
    });
    expect(evil.statusCode).toBe(403);
    const good = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin: 'http://localhost:5173' },
    });
    expect(good.statusCode).toBe(204);
  });
});
