import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { TenantScope } from '../db/repository.js';
import { ForbiddenError, UnauthorizedError } from '../lib/errors.js';
import { resolveSession, SESSION_COOKIE, type ResolvedSession } from './sessions.js';

export interface AuthContext extends ResolvedSession {
  scope: TenantScope;
  token: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const PUBLIC_PREFIXES = [
  '/api/health',
  '/api/auth/sign-in',
  '/api/setup',
  '/api/public/',
  '/api/webhooks/',
];
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isPublicApiPath(url: string): boolean {
  const path = url.split('?')[0]!;
  return PUBLIC_PREFIXES.some((p) =>
    p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`),
  );
}

function allowedOrigins(config: AppConfig, req: FastifyRequest): Set<string> {
  const set = new Set<string>();
  try {
    set.add(new URL(config.publicBaseUrl).origin);
  } catch {
    /* ignore malformed config */
  }
  set.add(`${req.protocol}://${req.host}`);
  return set;
}

export function registerAuth(app: FastifyInstance, deps: { db: Db; config: AppConfig }) {
  const policy = {
    idleMinutes: deps.config.sessionIdleMinutes,
    absoluteHours: deps.config.sessionAbsoluteHours,
  };
  app.decorateRequest('auth', null);

  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;

    // CSRF defence: browsers always send Origin on cross-site state-changing requests.
    if (!SAFE_METHODS.has(req.method) && !req.url.startsWith('/api/webhooks/')) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins(deps.config, req).has(origin)) {
        return reply
          .code(403)
          .send({ error: 'forbidden', message: 'Cross-origin request blocked' });
      }
    }

    const token = req.cookies[SESSION_COOKIE];
    const resolved = resolveSession(deps.db, token, policy);
    if (resolved && token) {
      req.auth = { ...resolved, token, scope: new TenantScope(deps.db, resolved.tenant.id) };
    } else if (token) {
      clearSessionCookie(reply, deps.config);
    }

    if (!req.auth && !isPublicApiPath(req.url)) {
      return reply.code(401).send({ error: 'unauthorized', message: 'Sign in required' });
    }
  });
}

export function setSessionCookie(
  reply: FastifyReply,
  config: AppConfig,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply, config: AppConfig) {
  reply.clearCookie(SESSION_COOKIE, {
    path: '/',
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
  });
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}

export function requireAdmin(req: FastifyRequest): AuthContext {
  const auth = requireAuth(req);
  if (auth.user.role !== 'admin') throw new ForbiddenError('Only admins can do that');
  return auth;
}

/** Service context for the current request. */
export function ctxOf(req: FastifyRequest) {
  const auth = requireAuth(req);
  return { scope: auth.scope, userId: auth.user.id, auth };
}
