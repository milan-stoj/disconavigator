import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface AppConfig {
  port: number;
  host: string;
  databasePath: string;
  webDistPath: string | null;
  appSecret: string;
  initialAdminPassword: string | undefined;
  publicBaseUrl: string;
  secureCookies: boolean;
  sessionIdleMinutes: number;
  sessionAbsoluteHours: number;
  smtpUrl: string | undefined;
  mailFrom: string;
  schedulerEnabled: boolean;
  /** Public quote request submissions allowed per client IP within the window. */
  quoteRequestRateLimit: number;
  quoteRequestRateWindowMinutes: number;
  /** `mock` swaps Square for an in-memory fake (development and tests only). */
  squareMode: 'live' | 'mock';
  /** How often open Square invoices are re-checked in case a webhook was missed. */
  squareReconcileMinutes: number;
}

/** The built SPA next to this server, from either `src/` (dev) or the `dist/` bundle. */
function defaultWebDist(): string | null {
  const dir = fileURLToPath(new URL('../../web/dist', import.meta.url));
  return fs.existsSync(path.join(dir, 'index.html')) ? dir : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProd = env.NODE_ENV === 'production';
  if (isProd && env.SQUARE_MODE === 'mock') {
    throw new Error('SQUARE_MODE=mock is for development and tests; it cannot run in production');
  }
  if (isProd && (env.APP_SECRET ?? '').length < 32) {
    throw new Error('APP_SECRET must be at least 32 characters in production');
  }
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databasePath: env.DATABASE_PATH ?? path.resolve(process.cwd(), 'data/disco.db'),
    webDistPath: env.WEB_DIST_PATH || (env.NODE_ENV === 'test' ? null : defaultWebDist()),
    appSecret: env.APP_SECRET ?? (isProd ? '' : 'dev-insecure-secret-change-me-0123456789'),
    initialAdminPassword: env.INITIAL_ADMIN_PASSWORD || undefined,
    publicBaseUrl: env.PUBLIC_BASE_URL ?? 'http://localhost:5173',
    secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === 'true' : isProd,
    sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES ?? 60 * 24),
    sessionAbsoluteHours: Number(env.SESSION_ABSOLUTE_HOURS ?? 24 * 30),
    smtpUrl: env.SMTP_URL || undefined,
    mailFrom: env.MAIL_FROM ?? 'Disco Controller <no-reply@localhost>',
    schedulerEnabled: env.SCHEDULER_ENABLED !== 'false',
    quoteRequestRateLimit: Number(env.QUOTE_REQUEST_RATE_LIMIT ?? 5),
    quoteRequestRateWindowMinutes: Number(env.QUOTE_REQUEST_RATE_WINDOW_MINUTES ?? 60),
    squareMode: env.SQUARE_MODE === 'mock' ? 'mock' : 'live',
    squareReconcileMinutes: Number(env.SQUARE_RECONCILE_MINUTES ?? 15),
  };
}
