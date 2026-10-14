import { createHmac, timingSafeEqual } from 'node:crypto';
import { externalPaymentSchema, lossChargeDecisionSchema } from '@disco/shared';
import type { FastifyInstance } from 'fastify';
import { ctxOf, requireAdmin } from '../auth/plugin.js';
import { TenantScope } from '../db/repository.js';
import { eq } from 'drizzle-orm';
import { booking, invoice, tenant as tenantTable, webhookEvent } from '../db/schema.js';
import { AppError, ConflictError, NotFoundError } from '../lib/errors.js';
import { uuidv7 } from '../lib/id.js';
import { parse } from '../lib/validation.js';
import type { AppDeps } from '../app.js';
import { getBooking } from '../services/bookings.js';
import { syncInvoice } from '../services/invoicing.js';
import { decideCharge, listMoneyOwed, recordExternalPayment } from '../services/payments.js';
import { squareWebhookUrl } from '../services/settings.js';
import {
  enqueueChargeCollection,
  retryPendingInvoices,
  squareSession,
  squareWebhookSignatureKey,
  SYNC_INVOICE_JOB,
  tenantBySlug,
} from '../services/square/connection.js';
import { MockSquare } from '../services/square/mock.js';
import { enqueueJob } from '../services/jobs.js';

type IdParams = { Params: { id: string } };

/** Square signs `notification URL + raw body` with HMAC-SHA256 (base64). */
export function squareSignature(key: string, url: string, body: string) {
  return createHmac('sha256', key)
    .update(url + body)
    .digest('base64');
}

function signatureMatches(expected: string, given: string | undefined) {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface SquareEvent {
  event_id?: string;
  type?: string;
  data?: {
    type?: string;
    id?: string;
    object?: {
      invoice?: { id?: string; order_id?: string };
      payment?: { order_id?: string };
    };
  };
}

export async function paymentRoutes(app: FastifyInstance, deps: AppDeps) {
  const { db, config } = deps;

  app.post<IdParams>('/api/bookings/:id/payments', async (req, reply) => {
    const ctx = ctxOf(req);
    recordExternalPayment(ctx, req.params.id, parse(externalPaymentSchema, req.body));
    return reply.code(201).send(getBooking(ctx.scope, req.params.id));
  });

  app.post<{ Params: { id: string; chargeId: string } }>(
    '/api/bookings/:id/charges/:chargeId/decision',
    async (req) => {
      const ctx = ctxOf(req);
      const collect = decideCharge(
        ctx,
        req.params.id,
        req.params.chargeId,
        parse(lossChargeDecisionSchema, req.body),
      );
      if (collect && squareSession(deps, ctx.scope.tenantId)) {
        enqueueChargeCollection(db, ctx.scope.tenantId, req.params.id, req.params.chargeId);
      }
      return getBooking(ctx.scope, req.params.id);
    },
  );

  /** Retries invoice creation for a booking whose invoice could not be created. */
  app.post<IdParams>('/api/bookings/:id/invoice/retry', async (req) => {
    const ctx = ctxOf(req);
    const b = ctx.scope.get(booking, req.params.id, 'Booking');
    if (!b.needsInvoice) throw new ConflictError('This booking does not need an invoice');
    if (!squareSession(deps, ctx.scope.tenantId)) {
      throw new ConflictError('Connect Square in Settings before creating invoices');
    }
    retryPendingInvoices(db, ctx.scope.tenantId, [b.id]);
    return getBooking(ctx.scope, req.params.id);
  });

  app.get('/api/money-owed', async (req) => listMoneyOwed(ctxOf(req).scope));

  // Square webhooks need the raw body for signature verification.
  await app.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
      done(null, body),
    );
    hooks.post<{ Params: { slug: string } }>(
      '/api/webhooks/square/:slug',
      { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const t = tenantBySlug(db, req.params.slug);
        const key = t ? squareWebhookSignatureKey(deps, t.id) : null;
        const raw = typeof req.body === 'string' ? req.body : '';
        const expected = key
          ? squareSignature(key, squareWebhookUrl(config.publicBaseUrl, req.params.slug), raw)
          : null;
        const given = req.headers['x-square-hmacsha256-signature'];
        if (
          !t ||
          !expected ||
          !signatureMatches(expected, typeof given === 'string' ? given : undefined)
        ) {
          return reply.code(403).send({ error: 'forbidden', message: 'Invalid signature' });
        }
        let event: SquareEvent;
        try {
          event = JSON.parse(raw) as SquareEvent;
        } catch {
          return reply.code(400).send({ error: 'bad_request', message: 'Invalid JSON' });
        }
        if (!event.event_id || !event.type) {
          return reply
            .code(400)
            .send({ error: 'bad_request', message: 'Missing event_id or type' });
        }
        const inserted = db
          .insert(webhookEvent)
          .values({
            id: uuidv7(),
            tenantId: t.id,
            provider: 'square',
            eventId: event.event_id,
            type: event.type,
            payload: event as Record<string, unknown>,
          })
          .onConflictDoNothing()
          .returning()
          .get();
        if (!inserted) return { received: true, duplicate: true };
        const obj = event.data?.object;
        const squareInvoiceId =
          obj?.invoice?.id ?? (event.data?.type === 'invoice' ? event.data.id : undefined);
        const squareOrderId = obj?.invoice?.order_id ?? obj?.payment?.order_id;
        if (squareInvoiceId || squareOrderId) {
          enqueueJob(db, {
            type: SYNC_INVOICE_JOB,
            tenantId: t.id,
            payload: { squareInvoiceId, squareOrderId, eventId: event.event_id },
            idempotencyKey: `square-event:${event.event_id}`,
          });
        }
        return { received: true };
      },
    );
  });

  // Development helper (SQUARE_MODE=mock only): the customer pays an invoice, and Square
  // sends a signed webhook for it.
  if (deps.square instanceof MockSquare) {
    const mock = deps.square;
    app.post<IdParams>('/api/dev/square/invoices/:id/pay', async (req) => {
      const { tenant } = requireAdmin(req);
      const scope = new TenantScope(db, tenant.id);
      const inv = scope.get(invoice, req.params.id, 'Invoice');
      if (!inv.squareInvoiceId) throw new NotFoundError('Square invoice');
      const body = (req.body ?? {}) as { amountCents?: number; saveCard?: boolean };
      const paid = mock.pay(inv.squareInvoiceId, {
        amountCents: body.amountCents,
        saveCard: body.saveCard ?? true,
      });
      const key = squareWebhookSignatureKey(deps, tenant.id);
      const slug = db.select().from(tenantTable).where(eq(tenantTable.id, tenant.id)).get()!.slug;
      if (key) {
        const payload = JSON.stringify({
          event_id: `mock-${paid.id}`,
          type: 'invoice.payment_made',
          data: {
            type: 'invoice',
            id: inv.squareInvoiceId,
            object: { invoice: { id: inv.squareInvoiceId } },
          },
        });
        const res = await app.inject({
          method: 'POST',
          url: `/api/webhooks/square/${slug}`,
          payload,
          headers: {
            'content-type': 'application/json',
            'x-square-hmacsha256-signature': squareSignature(
              key,
              squareWebhookUrl(config.publicBaseUrl, slug),
              payload,
            ),
          },
        });
        if (res.statusCode !== 200) throw new AppError(502, 'webhook_failed', res.body);
      }
      // Sync now rather than waiting for the job poll; syncing is idempotent.
      const session = squareSession(deps, tenant.id);
      if (session) await syncInvoice(scope, session, inv);
      return getBooking(scope, inv.bookingId);
    });

    // Runs queued background jobs now, for end-to-end tests that run without the scheduler.
    app.post('/api/dev/jobs/run', async (req) => {
      requireAdmin(req);
      let ran = 0;
      for (let n = await deps.scheduler.tick(); n > 0; n = await deps.scheduler.tick()) ran += n;
      return { ran };
    });
  }
}
