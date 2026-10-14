import {
  assignStaffSchema,
  BOOKING_STATUSES,
  BOOKING_TYPES,
  cancelBookingSchema,
  checkinSchema,
  checkoutSchema,
  foundCorrectionSchema,
  eventDetailsSchema,
  isoDate,
  overbookingConfirmation,
  rentalLogisticsSchema,
  settlementSchema,
} from '@disco/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ctxOf, requireAdmin } from '../auth/plugin.js';
import { parse } from '../lib/validation.js';
import {
  assignStaff,
  cancelBooking,
  closeBooking,
  confirmBooking,
  getBooking,
  listBookings,
  recordSettlement,
  sendRentalConfirmation,
  updateEventDetails,
  updateLogistics,
} from '../services/bookings.js';
import { checkIn, checkOut, recordFound } from '../services/checkout.js';

type IdParams = { Params: { id: string } };

const listQuery = z.object({
  status: z.enum([...BOOKING_STATUSES, 'open']).optional(),
  bookingType: z.enum(BOOKING_TYPES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().max(200).optional(),
});
const confirmBody = z
  .object({ reason: z.string().trim().max(1000).default('') })
  .merge(overbookingConfirmation);
const closeBody = z.object({ overrideReason: z.string().trim().max(1000).nullish() });

export async function bookingRoutes(app: FastifyInstance) {
  app.get('/api/bookings', async (req) =>
    listBookings(ctxOf(req).scope, parse(listQuery, req.query)),
  );

  app.get<IdParams>('/api/bookings/:id', async (req) =>
    getBooking(ctxOf(req).scope, req.params.id),
  );

  app.post<IdParams>('/api/bookings/:id/confirm', async (req) => {
    const { scope, user } = requireAdmin(req);
    const body = parse(confirmBody, req.body);
    confirmBooking({ scope, userId: user.id }, req.params.id, {
      via: 'manual',
      reason: body.reason,
      confirmOverbooking: body.confirmOverbooking,
    });
    return getBooking(scope, req.params.id);
  });

  app.post<IdParams>('/api/bookings/:id/cancel', async (req) => {
    const ctx = ctxOf(req);
    cancelBooking(ctx, req.params.id, parse(cancelBookingSchema, req.body));
    return getBooking(ctx.scope, req.params.id);
  });

  app.post<IdParams>('/api/bookings/:id/close', async (req) => {
    const ctx = ctxOf(req);
    const body = parse(closeBody, req.body);
    closeBooking({ ...ctx, isAdmin: ctx.auth.user.role === 'admin' }, req.params.id, body);
    return getBooking(ctx.scope, req.params.id);
  });

  app.patch<IdParams>('/api/bookings/:id/event-details', async (req) => {
    const ctx = ctxOf(req);
    updateEventDetails(ctx, req.params.id, parse(eventDetailsSchema, req.body));
    return getBooking(ctx.scope, req.params.id);
  });

  app.put<IdParams>('/api/bookings/:id/staff', async (req) => {
    const ctx = ctxOf(req);
    return assignStaff(
      ctx,
      req.params.id,
      parse(assignStaffSchema.merge(overbookingConfirmation), req.body),
    );
  });

  app.patch<IdParams>('/api/bookings/:id/logistics', async (req) => {
    const ctx = ctxOf(req);
    const body = parse(rentalLogisticsSchema.and(overbookingConfirmation), req.body);
    updateLogistics(ctx, req.params.id, body);
    return getBooking(ctx.scope, req.params.id);
  });

  app.post<IdParams>('/api/bookings/:id/send-confirmation', async (req) => {
    const ctx = ctxOf(req);
    sendRentalConfirmation(ctx, req.params.id);
    return getBooking(ctx.scope, req.params.id);
  });

  app.post<IdParams>('/api/bookings/:id/settlement', async (req, reply) => {
    const ctx = ctxOf(req);
    recordSettlement(ctx, req.params.id, parse(settlementSchema, req.body));
    return reply.code(201).send(getBooking(ctx.scope, req.params.id));
  });

  app.post<IdParams>('/api/bookings/:id/check-out', async (req) => {
    const ctx = ctxOf(req);
    checkOut(ctx, req.params.id, parse(checkoutSchema, req.body));
    return getBooking(ctx.scope, req.params.id);
  });

  app.post<IdParams>('/api/bookings/:id/check-in', async (req) => {
    const ctx = ctxOf(req);
    checkIn(ctx, req.params.id, parse(checkinSchema, req.body));
    return getBooking(ctx.scope, req.params.id);
  });

  app.post<IdParams>('/api/bookings/:id/found', async (req, reply) => {
    const ctx = ctxOf(req);
    recordFound(ctx, req.params.id, parse(foundCorrectionSchema, req.body));
    return reply.code(201).send(getBooking(ctx.scope, req.params.id));
  });
}
