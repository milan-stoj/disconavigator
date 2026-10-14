import { eq } from 'drizzle-orm';
import { passwordSchema, signInSchema } from '@disco/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { dummyPasswordHash, hashPassword, verifyPassword } from '../auth/passwords.js';
import { clearSessionCookie, requireAuth, setSessionCookie } from '../auth/plugin.js';
import { createSession, destroySession, SESSION_COOKIE } from '../auth/sessions.js';
import { tenant, user } from '../db/schema.js';
import { ConflictError, UnauthorizedError } from '../lib/errors.js';
import { nowIso } from '../lib/id.js';
import { parse } from '../lib/validation.js';
import { SEED_ADMIN } from '../services/seed.js';
import type { AppDeps } from '../app.js';

export function meResponse(auth: {
  user: { id: string; username: string; displayName: string; role: string };
  tenant: { id: string; name: string; timeZone: string };
}) {
  return {
    user: {
      id: auth.user.id,
      username: auth.user.username,
      displayName: auth.user.displayName,
      role: auth.user.role,
    },
    tenant: auth.tenant,
  };
}

export async function authRoutes(app: FastifyInstance, { db, config }: AppDeps) {
  const policy = {
    idleMinutes: config.sessionIdleMinutes,
    absoluteHours: config.sessionAbsoluteHours,
  };

  app.post(
    '/api/auth/sign-in',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const input = parse(signInSchema, req.body);
      const row = db
        .select()
        .from(user)
        .where(eq(user.username, input.username.toLowerCase()))
        .get();
      const ok =
        row?.active && row.passwordHash
          ? await verifyPassword(row.passwordHash, input.password)
          : (await verifyPassword(await dummyPasswordHash(), input.password + 'x'), false);
      if (!row || !ok) throw new UnauthorizedError('Incorrect username or password');
      const t = db.select().from(tenant).where(eq(tenant.id, row.tenantId)).get()!;
      const { token, expiresAt } = createSession(db, row, policy, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      db.update(user).set({ lastLoginAt: nowIso() }).where(eq(user.id, row.id)).run();
      setSessionCookie(reply, config, token, expiresAt);
      return meResponse({ user: row, tenant: t });
    },
  );

  app.post('/api/auth/sign-out', async (req, reply) => {
    destroySession(db, req.cookies[SESSION_COOKIE]);
    clearSessionCookie(reply, config);
    return reply.code(204).send();
  });

  app.get('/api/auth/me', async (req) => meResponse(requireAuth(req)));

  app.get('/api/setup/status', async () => {
    const t = db.select().from(tenant).where(eq(tenant.setupRequired, true)).get();
    return { setupRequired: !!t };
  });

  app.post(
    '/api/setup',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const { password } = parse(z.object({ password: passwordSchema }), req.body);
      const t = db.select().from(tenant).where(eq(tenant.setupRequired, true)).get();
      const admin = db.select().from(user).where(eq(user.username, SEED_ADMIN)).get();
      if (!t || !admin || admin.passwordHash)
        throw new ConflictError('Setup has already been completed');
      const passwordHash = await hashPassword(password);
      db.transaction((tx) => {
        tx.update(user)
          .set({ passwordHash, updatedAt: nowIso() })
          .where(eq(user.id, admin.id))
          .run();
        tx.update(tenant).set({ setupRequired: false }).where(eq(tenant.id, t.id)).run();
      });
      const { token, expiresAt } = createSession(db, admin, policy, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      setSessionCookie(reply, config, token, expiresAt);
      return meResponse({ user: admin, tenant: t });
    },
  );
}
