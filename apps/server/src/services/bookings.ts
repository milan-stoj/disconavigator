import {
  addDays,
  assignStaffSchema,
  balanceDue,
  BOOKING_STATUS_LABELS,
  bookingPolicy,
  canTransition,
  checkCommitment,
  computeCapacity,
  eventDetailsSchema,
  formatBookingNumber,
  formatCents,
  holdStrengthForBooking,
  rentalLogisticsSchema,
  settlementAmount,
  settlementSchema,
  sumCents,
  type BookingStatus,
  type CapacityHold,
  type EquipmentRequirements,
  type IsoDate,
  type Shortfall,
} from '@disco/shared';
import { and, asc, eq, gte, inArray, like, lte, ne, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { TenantScope } from '../db/repository.js';
import {
  booking,
  bookingStaff,
  charge,
  contact,
  equipmentRequirement,
  equipmentType,
  invoice,
  opportunity,
  organization,
  payment,
  quoteRevision,
  settlement,
  staffMember,
  tenant,
} from '../db/schema.js';
import { AppError, ConflictError, ForbiddenError, ValidationError } from '../lib/errors.js';
import { nowIso } from '../lib/id.js';
import { listActivity, recordActivity } from './activity.js';
import { loadCapacityContext } from './availability.js';
import { equipmentStatus } from './checkout.js';
import type { ServiceContext } from './context.js';
import { rentalConfirmationEmail } from './email-templates.js';
import { enqueueJob } from './jobs.js';
import { queueEmail } from './mail.js';
import { changeStage } from './opportunities.js';
import { CREATE_INVOICE_JOB } from './quotes.js';
import { getSettingsRow } from './settings.js';

type BookingRow = typeof booking.$inferSelect;

/** Thrown when an action would overbook equipment or DJs; repeat with confirmOverbooking. */
export class OverbookingError extends AppError {
  constructor(details: { shortfalls: Shortfall[]; staffWarnings?: StaffWarning[] }) {
    super(
      409,
      'overbooking',
      'This would overbook equipment or DJs. Confirm to continue anyway.',
      details,
    );
  }
}

export interface StaffWarning {
  date: IsoDate;
  staffMemberId: string;
  name: string;
  reason: 'unavailable' | 'double_booked';
}

const label = (s: BookingStatus) => BOOKING_STATUS_LABELS[s];

export function assertTransition(b: BookingRow, to: BookingStatus) {
  if (!canTransition(b.status, to)) {
    throw new ConflictError(`A ${label(b.status)} booking cannot become ${label(to)}`, {
      from: b.status,
      to,
    });
  }
}

export function activityFor(scope: TenantScope, b: BookingRow, userId: string | null) {
  return (kind: string, body: string, data?: Record<string, unknown>) =>
    recordActivity(scope, {
      subjectType: 'booking',
      subjectId: b.id,
      opportunityId: b.opportunityId,
      organizationId: b.organizationId,
      kind,
      body,
      data: data ?? null,
      userId,
    });
}

// ---------- Reading ----------

const OPEN_STATUSES: BookingStatus[] = ['awaiting_deposit', 'confirmed', 'out', 'returned'];

export interface BookingListFilter {
  status?: BookingStatus | 'open';
  bookingType?: BookingRow['bookingType'];
  from?: IsoDate;
  to?: IsoDate;
  q?: string;
}

export function listBookings(scope: TenantScope, filter: BookingListFilter = {}) {
  const conds: SQL[] = [];
  if (filter.status === 'open') conds.push(inArray(booking.status, OPEN_STATUSES));
  else if (filter.status) conds.push(eq(booking.status, filter.status));
  if (filter.bookingType) conds.push(eq(booking.bookingType, filter.bookingType));
  if (filter.from) conds.push(gte(booking.endDate, filter.from));
  if (filter.to) conds.push(lte(booking.startDate, filter.to));
  if (filter.q?.trim()) {
    const term = `%${filter.q.trim()}%`;
    const num = /^b-?(\d+)$/i.exec(filter.q.trim())?.[1];
    conds.push(
      or(
        like(booking.title, term),
        like(booking.location, term),
        like(organization.name, term),
        like(contact.name, term),
        ...(num ? [eq(booking.number, Number(num))] : []),
      )!,
    );
  }
  const rows = scope.db
    .select({
      b: booking,
      organizationName: organization.name,
      contactName: contact.name,
    })
    .from(booking)
    .leftJoin(organization, eq(organization.id, booking.organizationId))
    .leftJoin(contact, eq(contact.id, booking.contactId))
    .where(scope.ownedBy(booking.tenantId, conds.length ? and(...conds) : undefined))
    .orderBy(asc(booking.startDate), asc(booking.number))
    .all();
  return rows.map(({ b, organizationName, contactName }) => ({
    ...b,
    numberLabel: formatBookingNumber(b.number),
    organizationName,
    contactName,
  }));
}

function requirementsOf(scope: TenantScope, bookingId: string) {
  return scope.db
    .select({
      equipmentTypeId: equipmentRequirement.equipmentTypeId,
      name: equipmentType.name,
      quantity: equipmentRequirement.quantity,
    })
    .from(equipmentRequirement)
    .innerJoin(equipmentType, eq(equipmentType.id, equipmentRequirement.equipmentTypeId))
    .where(
      scope.ownedBy(equipmentRequirement.tenantId, eq(equipmentRequirement.bookingId, bookingId)),
    )
    .orderBy(asc(equipmentType.sortOrder), asc(equipmentType.name))
    .all();
}

function assignedStaffOf(scope: TenantScope, bookingId: string) {
  return scope.db
    .select({ id: staffMember.id, name: staffMember.name, phone: staffMember.phone })
    .from(bookingStaff)
    .innerJoin(staffMember, eq(staffMember.id, bookingStaff.staffMemberId))
    .where(scope.ownedBy(bookingStaff.tenantId, eq(bookingStaff.bookingId, bookingId)))
    .orderBy(asc(staffMember.name))
    .all();
}

export function latestSettlement(scope: TenantScope, bookingId: string) {
  return (
    scope.list(settlement, {
      where: eq(settlement.bookingId, bookingId),
      orderBy: [
        { column: settlement.createdAt, direction: 'desc' },
        { column: settlement.id, direction: 'desc' },
      ],
      limit: 1,
    })[0] ?? null
  );
}

const OWED_CHARGE_STATUSES = ['approved', 'charged', 'invoiced'] as const;

export function settlementRequired(b: Pick<BookingRow, 'bookingType' | 'pricingTerm'>) {
  return b.bookingType === 'full_service' && b.pricingTerm !== 'flat_fee';
}

/**
 * What the customer owes and has paid. Owed is the flat total (or the settled split amount)
 * plus approved loss/damage charges; it is unknown (null) until a split booking is settled.
 */
export function moneySummary(scope: TenantScope, b: BookingRow) {
  const s = settlementRequired(b) ? latestSettlement(scope, b.id) : null;
  const charges = scope.list(charge, { where: eq(charge.bookingId, b.id) });
  const chargesCents = sumCents(
    charges
      .filter((c) => (OWED_CHARGE_STATUSES as readonly string[]).includes(c.status))
      .map((c) => c.amountCents ?? c.proposedCents),
  );
  const base = settlementRequired(b) ? (s?.amountCents ?? null) : (b.totalCents ?? 0);
  const owedCents = base == null ? null : base + chargesCents;
  const paidCents = sumCents(
    scope.list(payment, { where: eq(payment.bookingId, b.id) }).map((p) => p.amountCents),
  );
  return {
    owedCents,
    chargesCents,
    paidCents,
    balanceCents: owedCents == null ? null : balanceDue(owedCents, paidCents),
    settlementRequired: settlementRequired(b),
    settled: s != null,
  };
}

/** What would stop the booking from closing right now. */
export function closeBlockers(scope: TenantScope, b: BookingRow) {
  const money = moneySummary(scope, b);
  const blockers: { code: string; message: string }[] = [];
  if (requirementsOf(scope, b.id).length > 0 && b.status !== 'returned') {
    blockers.push({ code: 'not_checked_in', message: 'Equipment has not been checked in' });
  }
  if (money.settlementRequired && !money.settled) {
    blockers.push({ code: 'settlement_missing', message: 'Door split has not been settled' });
  }
  if ((money.balanceCents ?? 0) > 0) {
    blockers.push({
      code: 'balance_due',
      message: `Balance of ${formatCents(money.balanceCents!)} is outstanding`,
    });
  }
  return { blockers, money };
}

export function getBooking(scope: TenantScope, id: string) {
  const b = scope.get(booking, id, 'Booking');
  const org = b.organizationId ? (scope.find(organization, b.organizationId) ?? null) : null;
  const person = b.contactId ? (scope.find(contact, b.contactId) ?? null) : null;
  const rev = b.revisionId ? (scope.find(quoteRevision, b.revisionId) ?? null) : null;
  const { blockers, money } = closeBlockers(scope, b);
  const series = b.seriesId
    ? scope
        .list(booking, {
          where: eq(booking.seriesId, b.seriesId),
          orderBy: [{ column: booking.startDate }],
        })
        .map((s) => ({
          id: s.id,
          numberLabel: formatBookingNumber(s.number),
          startDate: s.startDate,
          status: s.status,
        }))
    : [];
  return {
    ...b,
    numberLabel: formatBookingNumber(b.number),
    policy: { label: bookingPolicy(b.bookingType).label },
    organization: org ? { id: org.id, name: org.name } : null,
    contact: person
      ? { id: person.id, name: person.name, email: person.email, phone: person.phone }
      : null,
    quote: rev ? { id: rev.quoteId, eventDate: rev.startDate } : null,
    requirements: requirementsOf(scope, b.id),
    staff: assignedStaffOf(scope, b.id),
    settlement: latestSettlement(scope, b.id),
    payments: scope.list(payment, {
      where: eq(payment.bookingId, b.id),
      orderBy: [{ column: payment.receivedOn, direction: 'desc' }],
    }),
    charges: scope.list(charge, {
      where: eq(charge.bookingId, b.id),
      orderBy: [{ column: charge.createdAt, direction: 'desc' }],
    }),
    invoices: scope.list(invoice, {
      where: eq(invoice.bookingId, b.id),
      orderBy: [{ column: invoice.createdAt, direction: 'desc' }],
    }),
    money,
    closeBlockers: blockers,
    overdue: b.status === 'out' && !!b.overdueAt,
    equipment: equipmentStatus(scope, b),
    series,
    activity: listActivity(scope, { bookingId: b.id }),
  };
}

// ---------- Capacity checks ----------

function holdOf(
  scope: TenantScope,
  b: BookingRow,
  over: Partial<Pick<CapacityHold, 'startDate' | 'endDate' | 'assignedStaffIds'>> = {},
): CapacityHold {
  const requirements: EquipmentRequirements = {};
  for (const r of requirementsOf(scope, b.id)) requirements[r.equipmentTypeId] = r.quantity;
  return {
    id: b.id,
    source: 'booking',
    label: b.title,
    bookingType: b.bookingType,
    strength: holdStrengthForBooking(b.status) ?? 'confirmed',
    startDate: b.startDate,
    endDate: b.endDate,
    requirements,
    staffRequired: b.staffRequired,
    assignedStaffIds: assignedStaffOf(scope, b.id).map((s) => s.id),
    ...over,
  };
}

/** Shortfalls the booking would cause or join if it were confirmed as `candidate`. */
function shortfallsFor(scope: TenantScope, candidate: CapacityHold) {
  const ctx = loadCapacityContext(scope, candidate.startDate, addDays(candidate.endDate, 31));
  return checkCommitment(ctx, candidate);
}

// ---------- Lifecycle ----------

export interface ConfirmOptions {
  via: 'manual' | 'deposit';
  reason?: string;
  confirmOverbooking?: boolean;
}

/**
 * Confirms an Awaiting Deposit rental: when its deposit is paid (`via: 'deposit'`) or when an
 * admin overrides with a reason. Wins the opportunity. Idempotent for deposit confirmations.
 */
export function confirmBooking(ctx: ServiceContext, id: string, opts: ConfirmOptions) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, id, 'Booking');
    if (opts.via === 'deposit' && b.status !== 'awaiting_deposit') return b;
    if (b.status !== 'awaiting_deposit') {
      throw new ConflictError(`Only bookings awaiting a deposit can be confirmed`);
    }
    assertTransition(b, 'confirmed');
    const reason = opts.reason?.trim();
    if (opts.via === 'manual' && !reason) {
      throw new ValidationError('Enter a reason for confirming without a deposit', {
        fieldErrors: { reason: 'Enter a reason' },
      });
    }
    const shortfalls = shortfallsFor(scope, holdOf(scope, b, {}));
    if (shortfalls.length > 0 && opts.via === 'manual' && !opts.confirmOverbooking) {
      throw new OverbookingError({ shortfalls });
    }
    const updated = scope.update(booking, id, {
      status: 'confirmed',
      confirmedAt: nowIso(),
      confirmOverrideReason: opts.via === 'manual' ? reason! : null,
      overbookingAcknowledged: b.overbookingAcknowledged || shortfalls.length > 0,
    });
    const log = activityFor(scope, b, ctx.userId);
    log(
      'booking_confirmed',
      opts.via === 'manual'
        ? `Confirmed without deposit: ${reason}`
        : 'Holding deposit paid; booking confirmed',
      { via: opts.via, reason: reason ?? null, shortfalls },
    );
    if (b.opportunityId) {
      const opp = scope.find(opportunity, b.opportunityId);
      if (opp && opp.stage !== 'won') {
        changeStage(
          { scope, userId: ctx.userId },
          opp.id,
          { stage: 'won' },
          {
            automatic: true,
            reason: opts.via === 'manual' ? 'rental confirmed' : 'deposit paid',
          },
        );
      }
    }
    return updated;
  });
}

export function cancelBooking(ctx: ServiceContext, id: string, input: { reason: string }) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, id, 'Booking');
    assertTransition(b, 'cancelled');
    const updated = scope.update(booking, id, {
      status: 'cancelled',
      cancelledAt: nowIso(),
      cancelReason: input.reason,
    });
    const paid = moneySummary(scope, b).paidCents;
    activityFor(scope, b, ctx.userId)(
      'booking_cancelled',
      `Cancelled: ${input.reason}${paid > 0 ? ` (${formatCents(paid)} received stays recorded for refund handling)` : ''}`,
      { from: b.status, reason: input.reason, paidCents: paid },
    );
    return updated;
  });
}

/**
 * Moves a booking to Out or Returned. Used by equipment check-out and check-in, which own the
 * side effects; this only validates and records the status change.
 */
export function transitionBooking(
  ctx: ServiceContext,
  id: string,
  to: Extract<BookingStatus, 'out' | 'returned'>,
  note?: string,
) {
  const b = ctx.scope.get(booking, id, 'Booking');
  assertTransition(b, to);
  const updated = ctx.scope.update(booking, id, { status: to });
  activityFor(ctx.scope, b, ctx.userId)(
    'status_changed',
    `${label(b.status)} → ${label(to)}${note ? ` (${note})` : ''}`,
    { from: b.status, to },
  );
  return updated;
}

export function closeBooking(
  ctx: ServiceContext & { isAdmin: boolean },
  id: string,
  input: { overrideReason?: string | null },
) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, id, 'Booking');
    assertTransition(b, 'closed');
    const { blockers, money } = closeBlockers(scope, b);
    const reason = input.overrideReason?.trim();
    if (blockers.length > 0) {
      if (!reason) {
        throw new AppError(409, 'close_blocked', blockers.map((x) => x.message).join('. '), {
          blockers,
          balanceCents: money.balanceCents,
        });
      }
      if (!ctx.isAdmin)
        throw new ForbiddenError('Only admins can close a booking with an override');
    }
    const updated = scope.update(booking, id, { status: 'closed', closedAt: nowIso() });
    activityFor(scope, b, ctx.userId)(
      'booking_closed',
      blockers.length > 0 ? `Closed by admin override: ${reason}` : 'Booking closed',
      { override: blockers.length > 0, reason: reason ?? null, blockers },
    );
    return updated;
  });
}

// ---------- Details ----------

const EDITABLE: BookingStatus[] = ['awaiting_deposit', 'confirmed', 'out', 'returned'];

function assertEditable(b: BookingRow) {
  if (!EDITABLE.includes(b.status)) {
    throw new ConflictError(`A ${label(b.status)} booking cannot be changed`);
  }
}

function assertType(b: BookingRow, type: BookingRow['bookingType'], what: string) {
  if (b.bookingType !== type) {
    throw new ValidationError(`${what} only apply to ${bookingPolicy(type).label.toLowerCase()}s`);
  }
}

export function updateEventDetails(
  ctx: ServiceContext,
  id: string,
  input: z.output<typeof eventDetailsSchema>,
) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, id, 'Booking');
    assertType(b, 'full_service', 'Event details');
    assertEditable(b);
    const updated = scope.update(booking, id, {
      venueContact: input.venueContact ?? null,
      loadInTime: input.loadInTime ?? null,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      channels: input.channels ?? null,
      runOfShow: input.runOfShow ?? null,
    });
    activityFor(scope, b, ctx.userId)('event_details_updated', 'Event details updated');
    return updated;
  });
}

/** DJs who would be double-booked or are marked unavailable on the booking's event days. */
function staffWarnings(scope: TenantScope, b: BookingRow, staffIds: string[]): StaffWarning[] {
  if (staffIds.length === 0) return [];
  const ctx = loadCapacityContext(scope, b.startDate, b.endDate);
  const candidate = holdOf(scope, b, { assignedStaffIds: staffIds });
  const days = computeCapacity({
    ...ctx,
    from: b.startDate,
    to: b.endDate,
    holds: [...ctx.holds.filter((h) => h.id !== b.id), candidate],
  });
  const names = new Map(scope.list(staffMember).map((s) => [s.id, s.name]));
  const out: StaffWarning[] = [];
  for (const day of days) {
    for (const sid of staffIds) {
      const name = names.get(sid) ?? 'DJ';
      if (day.staff.assignedButUnavailableIds.includes(sid))
        out.push({ date: day.date, staffMemberId: sid, name, reason: 'unavailable' });
      if (day.staff.doubleBookedStaffIds.includes(sid))
        out.push({ date: day.date, staffMemberId: sid, name, reason: 'double_booked' });
    }
  }
  return out;
}

export function assignStaff(
  ctx: ServiceContext,
  id: string,
  input: z.output<typeof assignStaffSchema> & { confirmOverbooking?: boolean },
) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, id, 'Booking');
    assertType(b, 'full_service', 'DJ assignments');
    assertEditable(b);
    const ids = [...new Set(input.staffMemberIds)];
    const members = ids.length
      ? scope.list(staffMember, { where: inArray(staffMember.id, ids) })
      : [];
    if (members.length !== ids.length || members.some((m) => !m.active)) {
      throw new ValidationError('Choose active DJs', {
        fieldErrors: { staffMemberIds: 'Choose active DJs' },
      });
    }
    const warnings = staffWarnings(scope, b, ids);
    if (warnings.length > 0 && !input.confirmOverbooking) {
      throw new OverbookingError({ shortfalls: [], staffWarnings: warnings });
    }
    scope.db
      .delete(bookingStaff)
      .where(scope.ownedBy(bookingStaff.tenantId, eq(bookingStaff.bookingId, id)))
      .run();
    if (ids.length) {
      scope.db
        .insert(bookingStaff)
        .values(
          ids.map((staffMemberId) => ({ tenantId: scope.tenantId, bookingId: id, staffMemberId })),
        )
        .run();
    }
    if (warnings.length > 0) scope.update(booking, id, { overbookingAcknowledged: true });
    const names = members.map((m) => m.name).sort((a, c) => a.localeCompare(c));
    activityFor(scope, b, ctx.userId)(
      'staff_assigned',
      names.length ? `DJs assigned: ${names.join(', ')}` : 'DJs unassigned',
      { staffMemberIds: ids, warnings },
    );
    return getBooking(scope, id);
  });
}

export function updateLogistics(
  ctx: ServiceContext,
  id: string,
  input: z.output<typeof rentalLogisticsSchema> & { confirmOverbooking?: boolean },
) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, id, 'Booking');
    assertType(b, 'equipment_rental', 'Rental logistics');
    assertEditable(b);
    const datesChanged = input.dispatchDate !== b.startDate || input.returnDate !== b.endDate;
    if (datesChanged) {
      const shortfalls = shortfallsFor(
        scope,
        holdOf(scope, b, { startDate: input.dispatchDate, endDate: input.returnDate }),
      );
      if (shortfalls.length > 0 && !input.confirmOverbooking) {
        throw new OverbookingError({ shortfalls });
      }
      if (shortfalls.length > 0) scope.update(booking, id, { overbookingAcknowledged: true });
    }
    const updated = scope.update(booking, id, {
      fulfillment: input.fulfillment,
      startDate: input.dispatchDate,
      endDate: input.returnDate,
      dispatchTime: input.dispatchTime ?? null,
      returnTime: input.returnTime ?? null,
      deliveryAddress: input.fulfillment === 'delivery' ? (input.deliveryAddress ?? null) : null,
      customerInstructions: input.customerInstructions ?? null,
    });
    activityFor(
      scope,
      b,
      ctx.userId,
    )(
      'logistics_updated',
      datesChanged
        ? `Logistics updated; rental now ${input.dispatchDate} to ${input.returnDate}`
        : 'Logistics updated',
    );
    return updated;
  });
}

export function sendRentalConfirmation(ctx: ServiceContext, id: string) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, id, 'Booking');
    assertType(b, 'equipment_rental', 'Rental confirmations');
    if (b.status !== 'confirmed' && b.status !== 'out') {
      throw new ConflictError('Confirm the rental before sending its confirmation');
    }
    if (!b.fulfillment) {
      throw new ValidationError('Choose pickup or delivery first');
    }
    const person = b.contactId ? scope.find(contact, b.contactId) : undefined;
    if (!person?.email) throw new ValidationError('The customer has no email address');
    const t = scope.db.select().from(tenant).where(eq(tenant.id, scope.tenantId)).get()!;
    const settings = getSettingsRow(scope.db, scope.tenantId);
    const money = moneySummary(scope, b);
    const rev = b.revisionId ? scope.find(quoteRevision, b.revisionId) : undefined;
    const eventDate = rev?.startDate && rev.startDate !== b.startDate ? rev.startDate : null;
    const email = rentalConfirmationEmail({
      tenantName: t.name,
      customerName: person.name,
      bookingNumber: formatBookingNumber(b.number),
      eventDate,
      dispatchDate: b.startDate,
      dispatchTime: b.dispatchTime,
      returnDate: b.endDate,
      returnTime: b.returnTime,
      fulfillment: b.fulfillment,
      address: b.fulfillment === 'delivery' ? b.deliveryAddress : null,
      items: requirementsOf(scope, b.id).map((r) => ({ name: r.name, quantity: r.quantity })),
      balanceDueOn:
        (money.balanceCents ?? 0) > 0 ? addDays(b.startDate, -settings.rentalBalanceDueDays) : null,
      usageInstructions: settings.rentalUsageInstructions,
      customerInstructions: b.customerInstructions,
      depositReceived: !b.confirmOverrideReason,
    });
    queueEmail(scope.db, {
      tenantId: scope.tenantId,
      to: person.email,
      email,
      related: { type: 'booking', id },
    });
    const updated = scope.update(booking, id, { confirmationSentAt: nowIso() });
    activityFor(
      scope,
      b,
      ctx.userId,
    )('rental_confirmation_sent', `Rental confirmation emailed to ${person.email}`);
    return updated;
  });
}

// ---------- Settlement ----------

export function recordSettlement(
  ctx: ServiceContext,
  id: string,
  input: z.output<typeof settlementSchema>,
) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, id, 'Booking');
    if (!settlementRequired(b)) {
      throw new ValidationError('Only door-split full-service bookings are settled');
    }
    if (!['confirmed', 'out', 'returned'].includes(b.status)) {
      throw new ConflictError(`A ${label(b.status)} booking cannot be settled`);
    }
    const invoiced = scope
      .list(invoice, { where: and(eq(invoice.bookingId, id), ne(invoice.status, 'cancelled')) })
      .some((i) => i.status !== 'pending' && i.status !== 'failed');
    if (invoiced) {
      throw new ConflictError('The settlement has already been invoiced in Square');
    }
    if (b.splitBps == null) throw new ValidationError('This booking has no split percentage');
    const amountCents = settlementAmount({
      pricingTerm: b.pricingTerm,
      doorRevenueCents: input.doorRevenueCents,
      splitBps: b.splitBps,
      guaranteeCents: b.guaranteeCents,
    });
    const row = scope.insert(settlement, {
      bookingId: id,
      doorRevenueCents: input.doorRevenueCents,
      splitBps: b.splitBps,
      guaranteeCents: b.guaranteeCents,
      amountCents,
      note: input.note ?? null,
      userId: ctx.userId,
    });
    scope.update(booking, id, { needsInvoice: true, invoiceError: null });
    enqueueJob(scope.db, {
      type: CREATE_INVOICE_JOB,
      tenantId: scope.tenantId,
      payload: { bookingId: id, settlementId: row.id },
      idempotencyKey: `invoice:${id}:settlement:${row.id}`,
    });
    activityFor(scope, b, ctx.userId)(
      'settlement_recorded',
      `Door revenue ${formatCents(input.doorRevenueCents)} settled; amount owed ${formatCents(amountCents)}`,
      { settlementId: row.id, doorRevenueCents: input.doorRevenueCents, amountCents },
    );
    return row;
  });
}
