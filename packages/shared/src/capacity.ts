import { addDays, eachDate, type IsoDate } from './dates.js';
import type { BookingStatus, BookingType } from './policy.js';
import type { EquipmentRequirements } from './quote.js';

/** tentative/confirmed reduce capacity; soft (sent/draft quotes) only indicate demand. */
export type HoldStrength = 'tentative' | 'confirmed' | 'soft';

export interface CapacityHold {
  id: string;
  source: 'booking' | 'quote';
  label: string;
  bookingType: BookingType;
  strength: HoldStrength;
  /** First day equipment/staff are committed (dispatch date or event date). */
  startDate: IsoDate;
  /** Last day of use (return date or event date); buffer days are added after this. */
  endDate: IsoDate;
  requirements: EquipmentRequirements;
  /** Number of staff needed. Assigned staff count toward this. */
  staffRequired: number;
  assignedStaffIds: string[];
}

export interface EquipmentCapacity {
  equipmentTypeId: string;
  owned: number;
  outOfService: number;
}

export interface StaffUnavailability {
  staffMemberId: string;
  date: IsoDate;
}

export interface CapacityInput {
  from: IsoDate;
  to: IsoDate;
  bufferDays: number;
  equipment: EquipmentCapacity[];
  staffMemberIds: string[];
  staffUnavailability: StaffUnavailability[];
  holds: CapacityHold[];
}

export interface EquipmentDay {
  equipmentTypeId: string;
  usable: number;
  committed: number;
  tentative: number;
  softDemand: number;
  available: number;
  shortfall: number;
}

export interface StaffDay {
  total: number;
  unavailable: number;
  committed: number;
  available: number;
  shortfall: number;
  doubleBookedStaffIds: string[];
  assignedButUnavailableIds: string[];
}

export interface CapacityDay {
  date: IsoDate;
  equipment: Record<string, EquipmentDay>;
  staff: StaffDay;
  holds: {
    id: string;
    source: CapacityHold['source'];
    label: string;
    strength: HoldStrength;
    bookingType: BookingType;
  }[];
  /** More than one capacity-consuming full-service event on the same date. */
  fleetSplit: boolean;
  conflict: boolean;
}

export function holdStrengthForBooking(status: BookingStatus): HoldStrength | null {
  if (status === 'cancelled') return null;
  if (status === 'awaiting_deposit') return 'tentative';
  return 'confirmed';
}

/** Dates a hold occupies: start through end plus buffer days. */
export function holdWindow(
  hold: Pick<CapacityHold, 'startDate' | 'endDate'>,
  bufferDays: number,
): { from: IsoDate; to: IsoDate } {
  return { from: hold.startDate, to: addDays(hold.endDate, Math.max(0, bufferDays)) };
}

export function computeCapacity(input: CapacityInput): CapacityDay[] {
  const days = eachDate(input.from, input.to);
  const windows = input.holds.map((h) => ({ hold: h, ...holdWindow(h, input.bufferDays) }));
  const unavailableByDate = new Map<IsoDate, Set<string>>();
  for (const u of input.staffUnavailability) {
    if (!unavailableByDate.has(u.date)) unavailableByDate.set(u.date, new Set());
    unavailableByDate.get(u.date)!.add(u.staffMemberId);
  }
  const staffSet = new Set(input.staffMemberIds);

  return days.map((date) => {
    const active = windows.filter((w) => w.from <= date && date <= w.to).map((w) => w.hold);
    const consuming = active.filter((h) => h.strength !== 'soft');

    const equipment: Record<string, EquipmentDay> = {};
    const typeIds = new Set<string>(input.equipment.map((e) => e.equipmentTypeId));
    for (const h of active) for (const id of Object.keys(h.requirements)) typeIds.add(id);
    for (const id of typeIds) {
      const cap = input.equipment.find((e) => e.equipmentTypeId === id);
      const usable = cap ? Math.max(0, cap.owned - cap.outOfService) : 0;
      let committed = 0;
      let tentative = 0;
      let softDemand = 0;
      for (const h of active) {
        const qty = h.requirements[id] ?? 0;
        if (h.strength === 'soft') softDemand += qty;
        else {
          committed += qty;
          if (h.strength === 'tentative') tentative += qty;
        }
      }
      equipment[id] = {
        equipmentTypeId: id,
        usable,
        committed,
        tentative,
        softDemand,
        available: Math.max(0, usable - committed),
        shortfall: Math.max(0, committed - usable),
      };
    }

    // Staff: only the event day itself counts (no buffer) — DJs are free the next day.
    const staffHolds = consuming.filter((h) => h.startDate <= date && date <= h.endDate);
    const unavailable = new Set(
      [...(unavailableByDate.get(date) ?? [])].filter((id) => staffSet.has(id)),
    );
    const assignedCounts = new Map<string, number>();
    let unassignedNeed = 0;
    for (const h of staffHolds) {
      for (const id of h.assignedStaffIds)
        assignedCounts.set(id, (assignedCounts.get(id) ?? 0) + 1);
      unassignedNeed += Math.max(0, h.staffRequired - h.assignedStaffIds.length);
    }
    const assigned = new Set(assignedCounts.keys());
    const doubleBookedStaffIds = [...assignedCounts].filter(([, n]) => n > 1).map(([id]) => id);
    const assignedButUnavailableIds = [...assigned].filter((id) => unavailable.has(id));
    const freeStaff = [...staffSet].filter(
      (id) => !unavailable.has(id) && !assigned.has(id),
    ).length;
    const staffCommitted = assigned.size + unassignedNeed;
    const staffShortfall =
      Math.max(0, unassignedNeed - freeStaff) +
      doubleBookedStaffIds.length +
      assignedButUnavailableIds.length;
    const staff: StaffDay = {
      total: staffSet.size,
      unavailable: unavailable.size,
      committed: staffCommitted,
      available: Math.max(0, freeStaff - unassignedNeed),
      shortfall: staffShortfall,
      doubleBookedStaffIds,
      assignedButUnavailableIds,
    };

    const fullServiceNights = staffHolds.filter((h) => h.bookingType === 'full_service').length;
    const conflict = Object.values(equipment).some((e) => e.shortfall > 0) || staff.shortfall > 0;

    return {
      date,
      equipment,
      staff,
      holds: active.map((h) => ({
        id: h.id,
        source: h.source,
        label: h.label,
        strength: h.strength,
        bookingType: h.bookingType,
      })),
      fleetSplit: fullServiceNights > 1,
      conflict,
    };
  });
}

export interface Shortfall {
  date: IsoDate;
  resource: string;
  shortfall: number;
}

/**
 * Checks what committing `candidate` would do to existing capacity. Returns every shortfall
 * the candidate would cause or join; empty means the commitment fits.
 */
export function checkCommitment(
  input: Omit<CapacityInput, 'from' | 'to' | 'holds'> & { holds: CapacityHold[] },
  candidate: CapacityHold,
): Shortfall[] {
  const existing = input.holds.filter((h) => h.id !== candidate.id);
  const window = holdWindow(candidate, input.bufferDays);
  const days = computeCapacity({
    ...input,
    from: window.from,
    to: window.to,
    holds: [
      ...existing,
      { ...candidate, strength: candidate.strength === 'soft' ? 'confirmed' : candidate.strength },
    ],
  });
  const out: Shortfall[] = [];
  for (const day of days) {
    for (const [id, e] of Object.entries(day.equipment)) {
      if (e.shortfall > 0 && (candidate.requirements[id] ?? 0) > 0) {
        out.push({ date: day.date, resource: id, shortfall: e.shortfall });
      }
    }
    const usesStaff = candidate.staffRequired > 0 || candidate.assignedStaffIds.length > 0;
    const isEventDay = candidate.startDate <= day.date && day.date <= candidate.endDate;
    if (usesStaff && isEventDay && day.staff.shortfall > 0) {
      out.push({ date: day.date, resource: 'staff', shortfall: day.staff.shortfall });
    }
  }
  return out;
}
