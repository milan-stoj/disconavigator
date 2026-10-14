import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { session, tenant, user } from '../db/schema.js';
import { randomToken } from '../lib/id.js';

export const SESSION_COOKIE = 'disco_session';

export interface SessionPolicy {
  idleMinutes: number;
  absoluteHours: number;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createSession(
  db: Db,
  u: { id: string; tenantId: string },
  policy: SessionPolicy,
  meta: { ip?: string; userAgent?: string } = {},
  now = new Date(),
): { token: string; expiresAt: Date } {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + policy.absoluteHours * 3_600_000);
  db.insert(session)
    .values({
      id: hashToken(token),
      tenantId: u.tenantId,
      userId: u.id,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
    })
    .run();
  return { token, expiresAt };
}

export interface ResolvedSession {
  sessionId: string;
  user: {
    id: string;
    tenantId: string;
    username: string;
    displayName: string;
    role: 'admin' | 'staff';
  };
  tenant: { id: string; name: string; timeZone: string };
}

/** Returns the session if valid, sliding its idle window; deletes expired sessions. */
export function resolveSession(
  db: Db,
  token: string | undefined,
  policy: SessionPolicy,
  now = new Date(),
): ResolvedSession | null {
  if (!token) return null;
  const id = hashToken(token);
  const row = db
    .select({
      session,
      user: {
        id: user.id,
        tenantId: user.tenantId,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        active: user.active,
      },
      tenant: { id: tenant.id, name: tenant.name, timeZone: tenant.timeZone },
    })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .innerJoin(tenant, eq(tenant.id, session.tenantId))
    .where(eq(session.id, id))
    .get();
  if (!row) return null;
  const idleDeadline = new Date(row.session.lastSeenAt).getTime() + policy.idleMinutes * 60_000;
  const expired =
    now.getTime() > idleDeadline || now.toISOString() > row.session.expiresAt || !row.user.active;
  if (expired) {
    db.delete(session).where(eq(session.id, id)).run();
    return null;
  }
  // Only write when at least a minute has passed, to avoid a write per request.
  if (now.getTime() - new Date(row.session.lastSeenAt).getTime() > 60_000) {
    db.update(session).set({ lastSeenAt: now.toISOString() }).where(eq(session.id, id)).run();
  }
  const { active: _active, ...u } = row.user;
  return { sessionId: id, user: u, tenant: row.tenant };
}

export function destroySession(db: Db, token: string | undefined) {
  if (token)
    db.delete(session)
      .where(eq(session.id, hashToken(token)))
      .run();
}

export function destroyUserSessions(db: Db, userId: string, exceptSessionId?: string) {
  const sessions = db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId))
    .all();
  for (const s of sessions)
    if (s.id !== exceptSessionId) db.delete(session).where(eq(session.id, s.id)).run();
}

export function purgeExpiredSessions(db: Db, now = new Date()) {
  db.delete(session)
    .where(and(lt(session.expiresAt, now.toISOString())))
    .run();
}
