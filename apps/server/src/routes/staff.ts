import { isoDate, staffMemberSchema, staffUnavailabilitySchema } from '@disco/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf, requireAdmin } from '../auth/plugin.js';
import { ValidationError } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import { daysInRange, getAvailability, MAX_AVAILABILITY_DAYS } from '../services/availability.js';
import { tenantToday } from '../services/quotes.js';
import {
  addUnavailability,
  createStaff,
  listStaff,
  listUnavailability,
  removeUnavailability,
  updateStaff,
} from '../services/staff.js';

type IdParams = { Params: { id: string } };
// No defaults on update, so an omitted `active` is left unchanged.
const updateStaffSchema = staffMemberSchema.extend({ active: z.boolean() }).partial();
const rangeSchema = z
  .object({ from: isoDate, to: isoDate })
  .refine((r) => r.to >= r.from, { message: 'End date must be on or after start', path: ['to'] });

function parseRange(query: unknown) {
  const range = parse(rangeSchema, query);
  if (daysInRange(range.from, range.to) > MAX_AVAILABILITY_DAYS)
    throw new ValidationError(`Choose a range of at most ${MAX_AVAILABILITY_DAYS} days`);
  return range;
}

export async function staffRoutes(app: FastifyInstance) {
  app.get('/api/staff', async (req) => {
    const { scope } = ctxOf(req);
    return listStaff(scope, tenantToday(scope.db, scope.tenantId));
  });

  app.post('/api/staff', async (req, reply) => {
    const { scope } = requireAdmin(req);
    return reply.code(201).send(createStaff(scope, parse(staffMemberSchema, req.body)));
  });

  app.patch<IdParams>('/api/staff/:id', async (req) => {
    const { scope } = requireAdmin(req);
    return updateStaff(scope, req.params.id, parse(updateStaffSchema, req.body));
  });

  app.get<IdParams>('/api/staff/:id/unavailability', async (req) => {
    const { from, to } = parseRange(req.query);
    return listUnavailability(ctxOf(req).scope, req.params.id, from, to);
  });

  app.post<IdParams>('/api/staff/:id/unavailability', async (req, reply) => {
    const { scope } = requireAdmin(req);
    const input = parse(staffUnavailabilitySchema, req.body);
    return reply.code(201).send(addUnavailability(scope, req.params.id, input));
  });

  app.delete<{ Params: { id: string; date: string } }>(
    '/api/staff/:id/unavailability/:date',
    async (req, reply) => {
      const { scope } = requireAdmin(req);
      removeUnavailability(scope, req.params.id, req.params.date);
      return reply.code(204).send();
    },
  );

  app.get('/api/availability', async (req) => {
    const { scope } = ctxOf(req);
    const { from, to } = parseRange(req.query);
    return getAvailability(scope, from, to, tenantToday(scope.db, scope.tenantId));
  });
}
