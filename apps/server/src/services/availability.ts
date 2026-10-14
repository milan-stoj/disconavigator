import {
  checkCommitment,
  computeCapacity,
  eachDate,
  holdStrengthForBooking,
  type CapacityHold,
  type CapacityInput,
  type EquipmentRequirements,
  type IsoDate,
  type Shortfall,
} from '@disco/shared';
import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import type { TenantScope } from '../db/repository.js';
import {
  booking,
  bookingStaff,
  equipmentRequirement,
  equipmentType,
  quote,
  quoteRevision,
  staffMember,
  staffUnavailability,
} from '../db/schema.js';
import { equipmentCapacity } from './inventory.js';
import { getSettingsRow } from './settings.js';

type CapacityContext = Omit<CapacityInput, 'from' | 'to'>;

/**
 * Loads everything capacity calculations need for a date range: usable equipment, active
 * staff and their days off, and holds from non-cancelled bookings overlapping the range
 * (widened by the buffer so returns still occupy the following days).
 */
export function loadCapacityContext(
  scope: TenantScope,
  from: IsoDate,
  to: IsoDate,
): CapacityContext {
  const { bufferDays } = getSettingsRow(scope.db, scope.tenantId);
  const staff = scope.list(staffMember, { where: eq(staffMember.active, true) });
  const unavailability = scope.list(staffUnavailability, {
    where: and(gte(staffUnavailability.date, from), lte(staffUnavailability.date, to)),
  });
  // A booking ending up to bufferDays before `from` can still hold equipment on `from`.
  const earliestEnd = shiftDate(from, -Math.max(0, bufferDays));
  const bookings = scope.list(booking, {
    where: and(
      ne(booking.status, 'cancelled'),
      lte(booking.startDate, to),
      gte(booking.endDate, earliestEnd),
    ),
  });
  const ids = new Set(bookings.map((b) => b.id));
  const requirements = new Map<string, EquipmentRequirements>();
  for (const r of scope.db
    .select()
    .from(equipmentRequirement)
    .where(eq(equipmentRequirement.tenantId, scope.tenantId))
    .all()) {
    if (!ids.has(r.bookingId)) continue;
    const req = requirements.get(r.bookingId) ?? {};
    req[r.equipmentTypeId] = r.quantity;
    requirements.set(r.bookingId, req);
  }
  const assigned = new Map<string, string[]>();
  for (const a of scope.db
    .select()
    .from(bookingStaff)
    .where(eq(bookingStaff.tenantId, scope.tenantId))
    .all()) {
    if (!ids.has(a.bookingId)) continue;
    assigned.set(a.bookingId, [...(assigned.get(a.bookingId) ?? []), a.staffMemberId]);
  }

  const holds: CapacityHold[] = [];
  for (const b of bookings) {
    const strength = holdStrengthForBooking(b.status);
    if (!strength) continue;
    holds.push({
      id: b.id,
      source: 'booking',
      label: b.title,
      bookingType: b.bookingType,
      strength,
      startDate: b.startDate,
      endDate: b.endDate,
      requirements: requirements.get(b.id) ?? {},
      staffRequired: b.staffRequired,
      assignedStaffIds: assigned.get(b.id) ?? [],
    });
  }
  return {
    bufferDays,
    equipment: equipmentCapacity(scope),
    staffMemberIds: staff.map((s) => s.id),
    staffUnavailability: unavailability.map((u) => ({
      staffMemberId: u.staffMemberId,
      date: u.date,
    })),
    holds,
  };
}

function shiftDate(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface PlannedHold {
  label: string;
  bookingType: CapacityHold['bookingType'];
  startDate: IsoDate;
  endDate: IsoDate;
  requirements: EquipmentRequirements;
  staffRequired: number;
}

export interface OccurrenceAvailability {
  startDate: IsoDate;
  endDate: IsoDate;
  available: boolean;
  shortfalls: Shortfall[];
}

/**
 * Checks planned holds (one per occurrence) against committed bookings. Warns only:
 * nothing is blocked. Occurrences in the same plan are checked independently.
 */
export function checkPlannedHolds(
  scope: TenantScope,
  plans: PlannedHold[],
): OccurrenceAvailability[] {
  if (plans.length === 0) return [];
  const from = plans.reduce((m, p) => (p.startDate < m ? p.startDate : m), plans[0]!.startDate);
  const to = plans.reduce((m, p) => (p.endDate > m ? p.endDate : m), plans[0]!.endDate);
  const ctx = loadCapacityContext(scope, from, shiftDate(to, 31));
  return plans.map((p, i) => {
    const shortfalls = checkCommitment(ctx, {
      id: `planned-${i}`,
      source: 'quote',
      label: p.label,
      bookingType: p.bookingType,
      strength: 'confirmed',
      startDate: p.startDate,
      endDate: p.endDate,
      requirements: p.requirements,
      staffRequired: p.staffRequired,
      assignedStaffIds: [],
    });
    return {
      startDate: p.startDate,
      endDate: p.endDate,
      available: shortfalls.length === 0,
      shortfalls,
    };
  });
}

export const MAX_AVAILABILITY_DAYS = 100;

/** Sent/draft quotes as soft holds: they show demand without reducing capacity. */
function quoteIndicators(
  scope: TenantScope,
  from: IsoDate,
  to: IsoDate,
  today: IsoDate,
): CapacityHold[] {
  const quotes = scope.list(quote, { where: inArray(quote.status, ['draft', 'sent']) });
  const revIds = quotes.map((q) => q.currentRevisionId).filter((id): id is string => !!id);
  if (revIds.length === 0) return [];
  const revs = new Map(
    scope.list(quoteRevision, { where: inArray(quoteRevision.id, revIds) }).map((r) => [r.id, r]),
  );
  const holds: CapacityHold[] = [];
  for (const q of quotes) {
    const rev = q.currentRevisionId ? revs.get(q.currentRevisionId) : undefined;
    if (!rev) continue;
    if (q.status === 'sent' && rev.expiresOn && rev.expiresOn < today) continue;
    const spans = rev.occurrenceDates?.length
      ? rev.occurrenceDates.map((d) => ({ startDate: d, endDate: d }))
      : [{ startDate: rev.startDate, endDate: rev.endDate }];
    spans.forEach((span, i) => {
      if (span.startDate > to || span.endDate < from) return;
      holds.push({
        id: spans.length > 1 ? `${q.id}:${i}` : q.id,
        source: 'quote',
        label: `Quote Q-${q.number}${q.status === 'draft' ? ' (draft)' : ''}`,
        bookingType: rev.bookingType,
        strength: 'soft',
        ...span,
        requirements: rev.requirements,
        staffRequired: rev.staffRequired,
        assignedStaffIds: [],
      });
    });
  }
  return holds;
}

export function getAvailability(scope: TenantScope, from: IsoDate, to: IsoDate, today: IsoDate) {
  const ctx = loadCapacityContext(scope, from, to);
  const holds = [...ctx.holds, ...quoteIndicators(scope, from, to, today)];
  const days = computeCapacity({ ...ctx, from, to, holds });
  const types = scope.list(equipmentType, { orderBy: [{ column: equipmentType.name }] });
  const staff = scope.list(staffMember, { orderBy: [{ column: staffMember.name }] });
  const bookingIds = ctx.holds.map((h) => h.id);
  const rows = bookingIds.length
    ? scope.list(booking, { where: inArray(booking.id, bookingIds) })
    : [];
  const bookings = rows
    .map((b) => ({
      id: b.id,
      number: b.number,
      title: b.title,
      bookingType: b.bookingType,
      status: b.status,
      overdue: b.status === 'out' && !!b.overdueAt,
      strength: holdStrengthForBooking(b.status)!,
      startDate: b.startDate,
      endDate: b.endDate,
      holdEndDate: shiftDate(b.endDate, Math.max(0, ctx.bufferDays)),
      staffRequired: b.staffRequired,
    }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.number - b.number);
  const conflicts = days
    .filter((d) => d.conflict || d.fleetSplit)
    .map((d) => ({
      date: d.date,
      fleetSplit: d.fleetSplit,
      shortfalls: [
        ...Object.values(d.equipment)
          .filter((e) => e.shortfall > 0)
          .map((e) => ({ resource: e.equipmentTypeId, shortfall: e.shortfall })),
        ...(d.staff.shortfall > 0 ? [{ resource: 'staff', shortfall: d.staff.shortfall }] : []),
      ],
      holds: d.holds.filter((h) => h.strength !== 'soft'),
    }));
  return {
    from,
    to,
    bufferDays: ctx.bufferDays,
    equipmentTypes: types.map((t) => ({ id: t.id, name: t.name })),
    staff: staff.map((s) => ({ id: s.id, name: s.name, active: s.active })),
    staffUnavailability: ctx.staffUnavailability,
    days,
    bookings,
    conflicts,
  };
}

export function daysInRange(from: IsoDate, to: IsoDate) {
  return eachDate(from, to).length;
}
