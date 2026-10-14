import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { ctxOf } from '../auth/plugin.js';
import { parse } from '../lib/validation.js';
import {
  listQuoteRequests,
  markQuoteRequestsSeen,
  publicTenant,
  submitQuoteRequest,
} from '../services/quote-requests.js';
import { getSettingsRow } from '../services/settings.js';

type SlugParams = { Params: { slug: string } };

const seenBody = z.object({ ids: z.array(z.string().max(64)).max(200).optional() });

export async function quoteRequestRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get<SlugParams>('/api/public/tenants/:slug', async (req) => {
    const t = publicTenant(deps.db, req.params.slug);
    return {
      name: t.name,
      slug: t.slug,
      timeZone: t.timeZone,
      serviceAreas: getSettingsRow(deps.db, t.id).serviceAreas,
    };
  });

  app.post<SlugParams>(
    '/api/public/tenants/:slug/quote-requests',
    {
      config: {
        rateLimit: {
          max: deps.config.quoteRequestRateLimit,
          timeWindow: deps.config.quoteRequestRateWindowMinutes * 60_000,
        },
      },
    },
    async (req, reply) => {
      // Honeypot drops look identical to real submissions.
      submitQuoteRequest(deps, req.params.slug, req.body, req.ip ?? null);
      return reply.code(201).send({ received: true });
    },
  );

  app.get('/api/quote-requests', async (req) => {
    const { unseen } = parse(z.object({ unseen: z.enum(['true', 'false']).optional() }), req.query);
    return listQuoteRequests(ctxOf(req).scope, { unseenOnly: unseen === 'true' });
  });

  app.post('/api/quote-requests/seen', async (req) => {
    const { ids } = parse(seenBody, req.body ?? {});
    return markQuoteRequestsSeen(ctxOf(req).scope, ids);
  });
}
