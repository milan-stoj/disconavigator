import {
  equipmentTypeSchema,
  equipmentUnitSchema,
  inventoryAdjustmentSchema,
  outOfServiceSchema,
  rentalPackageSchema,
  unitStatusSchema,
} from '@disco/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf, requireAdmin } from '../auth/plugin.js';
import { ForbiddenError } from '../lib/errors.js';
import { parse } from '../lib/validation.js';
import {
  addUnit,
  adjustPooledQuantity,
  createEquipmentType,
  createPackage,
  getEquipment,
  getPackage,
  getUnit,
  listAdjustments,
  listEquipment,
  listPackages,
  setPackageActive,
  setPooledOutOfService,
  setUnitStatus,
  unitStatusNeedsAdmin,
  updateEquipmentType,
  updatePackage,
} from '../services/inventory.js';

type IdParams = { Params: { id: string } };
const updateTypeSchema = equipmentTypeSchema.pick({ name: true, lossFeeCents: true });
const activeSchema = z.object({ active: z.boolean() });

export async function inventoryRoutes(app: FastifyInstance) {
  app.get('/api/equipment', async (req) => listEquipment(ctxOf(req).scope));

  app.get<IdParams>('/api/equipment/:id', async (req) =>
    getEquipment(ctxOf(req).scope, req.params.id),
  );

  app.post('/api/equipment', async (req, reply) => {
    const auth = requireAdmin(req);
    const input = parse(equipmentTypeSchema, req.body);
    const created = createEquipmentType({ scope: auth.scope, userId: auth.user.id }, input);
    return reply.code(201).send(created);
  });

  app.patch<IdParams>('/api/equipment/:id', async (req) => {
    const auth = requireAdmin(req);
    const input = parse(updateTypeSchema, req.body);
    return updateEquipmentType({ scope: auth.scope, userId: auth.user.id }, req.params.id, input);
  });

  app.get<IdParams>('/api/equipment/:id/adjustments', async (req) =>
    listAdjustments(ctxOf(req).scope, req.params.id),
  );

  app.post<IdParams>('/api/equipment/:id/adjustments', async (req) => {
    const auth = requireAdmin(req);
    const input = parse(inventoryAdjustmentSchema, req.body);
    return adjustPooledQuantity({ scope: auth.scope, userId: auth.user.id }, req.params.id, input);
  });

  app.put<IdParams>('/api/equipment/:id/out-of-service', async (req) => {
    const input = parse(outOfServiceSchema, req.body);
    return setPooledOutOfService(ctxOf(req), req.params.id, input);
  });

  app.post<IdParams>('/api/equipment/:id/units', async (req, reply) => {
    const auth = requireAdmin(req);
    const input = parse(equipmentUnitSchema, req.body);
    const view = addUnit({ scope: auth.scope, userId: auth.user.id }, req.params.id, input);
    return reply.code(201).send(view);
  });

  app.put<IdParams>('/api/equipment-units/:id/status', async (req) => {
    const ctx = ctxOf(req);
    const input = parse(unitStatusSchema, req.body);
    const unit = getUnit(ctx.scope, req.params.id);
    if (unitStatusNeedsAdmin(unit.status, input.status) && ctx.auth.user.role !== 'admin') {
      throw new ForbiddenError('Only admins can retire, lose, or restore units');
    }
    return setUnitStatus(ctx, req.params.id, input);
  });

  app.get<{ Querystring: { active?: string } }>('/api/packages', async (req) =>
    listPackages(ctxOf(req).scope, { activeOnly: req.query.active === 'true' }),
  );

  app.get<IdParams>('/api/packages/:id', async (req) =>
    getPackage(ctxOf(req).scope, req.params.id),
  );

  app.post('/api/packages', async (req, reply) => {
    const auth = requireAdmin(req);
    const input = parse(rentalPackageSchema, req.body);
    const created = createPackage({ scope: auth.scope, userId: auth.user.id }, input);
    return reply.code(201).send(created);
  });

  app.put<IdParams>('/api/packages/:id', async (req) => {
    const auth = requireAdmin(req);
    const input = parse(rentalPackageSchema, req.body);
    return updatePackage({ scope: auth.scope, userId: auth.user.id }, req.params.id, input);
  });

  app.patch<IdParams>('/api/packages/:id/active', async (req) => {
    const auth = requireAdmin(req);
    const { active } = parse(activeSchema, req.body);
    return setPackageActive({ scope: auth.scope, userId: auth.user.id }, req.params.id, active);
  });
}
