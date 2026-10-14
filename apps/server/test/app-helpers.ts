import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase, type OpenedDatabase } from '../src/db/index.js';

export const ADMIN_PASSWORD = 'test-admin-password';

export async function buildTestApp(env: Record<string, string> = {}, database?: OpenedDatabase) {
  const opened = database ?? openDatabase(':memory:');
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    INITIAL_ADMIN_PASSWORD: ADMIN_PASSWORD,
    PUBLIC_BASE_URL: 'http://localhost:5173',
    SCHEDULER_ENABLED: 'false',
    SQUARE_MODE: 'mock',
    ...env,
  });
  const app = await buildApp({ config, database: opened });
  await app.ready();
  return { app, db: opened.db, opened, config };
}

export function cookieFrom(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === 'disco_session');
  if (!c) throw new Error('No session cookie set');
  return `disco_session=${c.value}`;
}

export async function signIn(app: FastifyInstance, username = 'kali', password = ADMIN_PASSWORD) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-in',
    payload: { username, password },
  });
  if (res.statusCode !== 200) throw new Error(`sign-in failed: ${res.statusCode} ${res.body}`);
  return cookieFrom(res);
}

/** Returns an inject helper bound to a session cookie. */
export function client(app: FastifyInstance, cookie: string) {
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
  ) => app.inject({ method, url, payload: payload as never, headers: { cookie } });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: unknown) => call('POST', url, payload ?? {}),
    patch: (url: string, payload?: unknown) => call('PATCH', url, payload ?? {}),
    put: (url: string, payload?: unknown) => call('PUT', url, payload ?? {}),
    delete: (url: string) => call('DELETE', url),
  };
}
