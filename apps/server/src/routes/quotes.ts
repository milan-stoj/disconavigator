import { BOOKING_TYPES, quoteLineSchema, requirementsFromLines } from '@disco/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { ctxOf } from '../auth/plugin.js';
import { parse } from '../lib/validation.js';
import { checkPlannedHolds } from '../services/availability.js';
import { getPackage, type PackageView } from '../services/inventory.js';
import {
  acceptPublicQuote,
  createQuote,
  declinePublicQuote,
  declineQuote,
  getPublicQuote,
  getQuote,
  getRevision,
  listQuotes,
  occurrencesOf,
  sendQuote,
  updateQuote,
} from '../services/quotes.js';

type IdParams = { Params: { id: string } };
type TokenParams = { Params: { token: string } };

const isoDate = z.iso.date();
const availabilityCheckSchema = z.object({
  bookingType: z.enum(BOOKING_TYPES),
  startDate: isoDate,
  endDate: isoDate,
  occurrenceDates: z.array(isoDate).max(120).optional().nullable(),
  // Only package lines affect capacity; prices are irrelevant to the check.
  lines: z
    .array(
      quoteLineSchema
        .pick({ kind: true, packageId: true })
        .extend({ quantity: z.number().int().min(0).max(100_000) }),
    )
    .max(200)
    .default([]),
  requirements: z.record(z.string(), z.number().int().min(0)).default({}),
  staffRequired: z.number().int().min(0).default(0),
  excludeQuoteId: z.string().optional(),
});

export async function quoteRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/api/quotes', async (req) => {
    const q = parse(z.object({ opportunityId: z.string().max(64).optional() }), req.query);
    return listQuotes(ctxOf(req).scope, q);
  });

  app.post('/api/quotes', async (req, reply) => {
    const ctx = ctxOf(req);
    const id = createQuote(ctx, req.body);
    return reply.code(201).send(getQuote(ctx, id, deps.config));
  });

  app.get<IdParams>('/api/quotes/:id', async (req) =>
    getQuote(ctxOf(req), req.params.id, deps.config),
  );

  app.put<IdParams>('/api/quotes/:id', async (req) => {
    const ctx = ctxOf(req);
    updateQuote(ctx, req.params.id, req.body);
    return getQuote(ctx, req.params.id, deps.config);
  });

  app.get<{ Params: { id: string; revisionId: string } }>(
    '/api/quotes/:id/revisions/:revisionId',
    async (req) => getRevision(ctxOf(req), req.params.id, req.params.revisionId),
  );

  app.post<IdParams>('/api/quotes/:id/send', async (req) => {
    const ctx = ctxOf(req);
    sendQuote(ctx, deps, req.params.id);
    return getQuote(ctx, req.params.id, deps.config);
  });

  app.post<IdParams>('/api/quotes/:id/decline', async (req) => {
    const ctx = ctxOf(req);
    declineQuote(ctx, req.params.id, req.body);
    return getQuote(ctx, req.params.id, deps.config);
  });

  /** Live capacity warnings for the quote builder, before anything is saved. */
  app.post('/api/quotes/availability-check', async (req) => {
    const { scope } = ctxOf(req);
    const input = parse(availabilityCheckSchema, req.body);
    const packages: PackageView[] = [];
    for (const l of input.lines) {
      if (l.kind === 'package' && l.packageId && !packages.some((p) => p.id === l.packageId)) {
        try {
          packages.push(getPackage(scope, l.packageId));
        } catch {
          // Unknown packages are reported when the quote is saved.
        }
      }
    }
    const requirements = requirementsFromLines(
      input.lines.map((l) => ({ kind: l.kind, quantity: l.quantity, packageId: l.packageId })),
      packages,
      input.requirements,
    );
    const end = input.endDate < input.startDate ? input.startDate : input.endDate;
    return checkPlannedHolds(
      scope,
      occurrencesOf({
        startDate: input.startDate,
        endDate: end,
        occurrenceDates: input.occurrenceDates ?? null,
      }).map((o) => ({
        ...o,
        label: 'This quote',
        bookingType: input.bookingType,
        requirements,
        staffRequired: input.staffRequired,
      })),
    );
  });

  // ---------- Public ----------
  app.get<TokenParams>('/api/public/quotes/:token', async (req) =>
    getPublicQuote(deps.db, req.params.token),
  );

  app.post<TokenParams>('/api/public/quotes/:token/accept', async (req) => {
    const ua = req.headers['user-agent'];
    return acceptPublicQuote(deps, req.params.token, req.body, {
      ip: req.ip ?? null,
      userAgent: typeof ua === 'string' ? ua : null,
    });
  });

  app.post<TokenParams>('/api/public/quotes/:token/decline', async (req) =>
    declinePublicQuote(deps.db, req.params.token, req.body),
  );
}
