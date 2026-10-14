import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { AppConfig } from './config.js';
import { openDatabase, type OpenedDatabase } from './db/index.js';
import { registerAuth } from './auth/plugin.js';
import { AppError } from './lib/errors.js';
import { markOverdueBookings, OVERDUE_INTERVAL_MS } from './services/checkout.js';
import { Scheduler } from './services/jobs.js';
import {
  createMailer,
  SEND_EMAIL_JOB,
  sendEmailHandler,
  type Mailer,
  type MailTransport,
} from './services/mail.js';
import { seed, type SeedResult } from './services/seed.js';
import {
  collectChargeHandler,
  createInvoiceHandler,
  reconcileSquare,
  syncInvoiceHandler,
} from './services/invoicing.js';
import { CREATE_INVOICE_JOB } from './services/quotes.js';
import { COLLECT_CHARGE_JOB, SYNC_INVOICE_JOB } from './services/square/connection.js';
import type { SquareConnector } from './services/square/gateway.js';
import { liveSquareConnector } from './services/square/live.js';
import { MockSquare } from './services/square/mock.js';
import { authRoutes } from './routes/auth.js';
import { userRoutes } from './routes/users.js';
import { searchRoutes } from './routes/search.js';
import { settingsRoutes } from './routes/settings.js';
import { inventoryRoutes } from './routes/inventory.js';
import { crmRoutes } from './routes/crm.js';
import { quoteRequestRoutes } from './routes/quote-requests.js';
import { quoteRoutes } from './routes/quotes.js';
import { staffRoutes } from './routes/staff.js';
import { bookingRoutes } from './routes/bookings.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { paymentRoutes } from './routes/payments.js';

export interface BuildAppOptions {
  config: AppConfig;
  logger?: boolean;
  /** Use an existing database (tests); otherwise one is opened from config.databasePath. */
  database?: OpenedDatabase;
  /** Overrides SMTP delivery (tests). */
  mailTransport?: MailTransport;
  /** Overrides the Square connection (tests); otherwise chosen by config.squareMode. */
  square?: SquareConnector;
}

export interface AppDeps {
  config: AppConfig;
  db: OpenedDatabase['db'];
  scheduler: Scheduler;
  mailer: Mailer;
  square: SquareConnector;
  seedResult: SeedResult;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

export async function buildApp({
  config,
  logger = false,
  database,
  mailTransport,
  square: squareOverride,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger, trustProxy: true, bodyLimit: 1_000_000 });
  const opened = database ?? openDatabase(config.databasePath);
  const { db } = opened;
  const seedResult = await seed(db, { initialAdminPassword: config.initialAdminPassword });
  if (seedResult.setupRequired) {
    app.log.warn('No INITIAL_ADMIN_PASSWORD configured: open the app to complete first-run setup.');
  }
  const scheduler = new Scheduler(db, { logger: app.log });
  const mailer = createMailer(config, mailTransport);
  scheduler.register(SEND_EMAIL_JOB, sendEmailHandler(db, mailer, app.log));
  scheduler.every('overdue-returns', OVERDUE_INTERVAL_MS, () => {
    markOverdueBookings(db);
  });
  const square =
    squareOverride ?? (config.squareMode === 'mock' ? new MockSquare() : liveSquareConnector);
  const squareDeps = { db, config, square };
  scheduler.register(CREATE_INVOICE_JOB, createInvoiceHandler(squareDeps));
  scheduler.register(SYNC_INVOICE_JOB, syncInvoiceHandler(squareDeps));
  scheduler.register(COLLECT_CHARGE_JOB, collectChargeHandler(squareDeps));
  scheduler.every('square-reconcile', config.squareReconcileMinutes * 60_000, async () => {
    await reconcileSquare(squareDeps, app.log);
  });
  const deps: AppDeps = { config, db, scheduler, mailer, square, seedResult };
  app.decorate('deps', deps);

  await app.register(fastifyCookie);
  await app.register(fastifyRateLimit, { global: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      req.log.error({ err }, 'unhandled error');
      return reply.code(500).send({ error: 'internal_error', message: 'Something went wrong' });
    }
    return reply.code(status).send({
      error: status === 429 ? 'rate_limited' : 'bad_request',
      message: (err as Error).message,
    });
  });

  registerAuth(app, { db, config });

  app.get('/api/health', async () => ({ status: 'ok' }));
  await authRoutes(app, deps);
  await userRoutes(app, deps);
  await searchRoutes(app, deps);
  await settingsRoutes(app, deps);
  await inventoryRoutes(app);
  await crmRoutes(app);
  await quoteRequestRoutes(app, deps);
  await quoteRoutes(app, deps);
  await staffRoutes(app);
  await bookingRoutes(app);
  await paymentRoutes(app, deps);
  await dashboardRoutes(app);

  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && hasWebDist) {
      return reply.sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: 'Not found' });
  });
  const hasWebDist = !!config.webDistPath && fs.existsSync(config.webDistPath);
  if (hasWebDist) {
    await app.register(fastifyStatic, { root: path.resolve(config.webDistPath!), wildcard: false });
  }

  if (config.schedulerEnabled) {
    app.addHook('onReady', async () => scheduler.start());
  }
  app.addHook('onClose', async () => {
    scheduler.stop();
    if (!database) opened.close();
  });

  return app;
}
