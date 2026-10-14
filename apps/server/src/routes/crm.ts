import {
  activityNoteSchema,
  contactSchema,
  OPPORTUNITY_STAGES,
  opportunitySchema,
  organizationSchema,
  stageChangeSchema,
} from '@disco/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf } from '../auth/plugin.js';
import { parse } from '../lib/validation.js';
import type { ActivitySubject } from '../services/activity.js';
import {
  addNote,
  createContact,
  createOrganization,
  getContact,
  getOrganization,
  listContacts,
  listOrganizations,
  setContactArchived,
  setOrganizationArchived,
  timeline,
  updateContact,
  updateOrganization,
} from '../services/crm.js';
import {
  changeStage,
  createOpportunity,
  getOpportunity,
  listOpportunities,
  updateOpportunity,
} from '../services/opportunities.js';

type IdParams = { Params: { id: string } };

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  archived: z.enum(['active', 'archived', 'all']).default('active'),
  type: z.string().max(50).optional(),
  organizationId: z.string().max(64).optional(),
});
const allowDuplicate = z.object({ allowDuplicate: z.boolean().optional() });
const archivedBody = z.object({ archived: z.boolean() });
const opportunityQuery = z.object({
  q: z.string().trim().max(100).optional(),
  stage: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : undefined))
    .pipe(z.array(z.enum(OPPORTUNITY_STAGES)).optional()),
  closedSince: z.string().max(40).optional(),
});
const createOpportunityBody = opportunitySchema.extend({
  stage: z.enum(['new', 'contacted']).optional(),
});

function activityRoutes(app: FastifyInstance, base: string, subject: ActivitySubject) {
  app.get<IdParams>(`${base}/:id/activity`, async (req) =>
    timeline(ctxOf(req).scope, subject, req.params.id),
  );
  app.post<IdParams>(`${base}/:id/activity`, async (req, reply) => {
    const input = parse(activityNoteSchema, req.body);
    return reply.code(201).send(addNote(ctxOf(req), subject, req.params.id, input));
  });
}

export async function crmRoutes(app: FastifyInstance) {
  // Organizations
  app.get('/api/organizations', async (req) => {
    const q = parse(listQuery, req.query);
    return listOrganizations(ctxOf(req).scope, q);
  });
  app.get<IdParams>('/api/organizations/:id', async (req) =>
    getOrganization(ctxOf(req).scope, req.params.id),
  );
  app.post('/api/organizations', async (req, reply) => {
    const input = parse(organizationSchema, req.body);
    const opts = parse(allowDuplicate, req.body);
    return reply.code(201).send(createOrganization(ctxOf(req), input, opts));
  });
  app.put<IdParams>('/api/organizations/:id', async (req) =>
    updateOrganization(ctxOf(req), req.params.id, parse(organizationSchema, req.body)),
  );
  app.put<IdParams>('/api/organizations/:id/archived', async (req) =>
    setOrganizationArchived(ctxOf(req), req.params.id, parse(archivedBody, req.body).archived),
  );
  activityRoutes(app, '/api/organizations', 'organization');

  // Contacts
  app.get('/api/contacts', async (req) => {
    const q = parse(listQuery, req.query);
    return listContacts(ctxOf(req).scope, q);
  });
  app.get<IdParams>('/api/contacts/:id', async (req) =>
    getContact(ctxOf(req).scope, req.params.id),
  );
  app.post('/api/contacts', async (req, reply) => {
    const input = parse(contactSchema, req.body);
    const opts = parse(allowDuplicate, req.body);
    return reply.code(201).send(createContact(ctxOf(req), input, opts));
  });
  app.put<IdParams>('/api/contacts/:id', async (req) =>
    updateContact(ctxOf(req), req.params.id, parse(contactSchema, req.body)),
  );
  app.put<IdParams>('/api/contacts/:id/archived', async (req) =>
    setContactArchived(ctxOf(req), req.params.id, parse(archivedBody, req.body).archived),
  );
  activityRoutes(app, '/api/contacts', 'contact');

  // Opportunities
  app.get('/api/opportunities', async (req) => {
    const q = parse(opportunityQuery, req.query);
    return listOpportunities(ctxOf(req).scope, q);
  });
  app.get<IdParams>('/api/opportunities/:id', async (req) =>
    getOpportunity(ctxOf(req).scope, req.params.id),
  );
  app.post('/api/opportunities', async (req, reply) => {
    const { stage, ...input } = parse(createOpportunityBody, req.body);
    return reply.code(201).send(createOpportunity(ctxOf(req), input, { stage }));
  });
  app.put<IdParams>('/api/opportunities/:id', async (req) =>
    updateOpportunity(ctxOf(req), req.params.id, parse(opportunitySchema, req.body)),
  );
  app.post<IdParams>('/api/opportunities/:id/stage', async (req) => {
    const ctx = ctxOf(req);
    const input = parse(stageChangeSchema, req.body);
    changeStage(ctx, req.params.id, input);
    return getOpportunity(ctx.scope, req.params.id);
  });
  activityRoutes(app, '/api/opportunities', 'opportunity');
}
