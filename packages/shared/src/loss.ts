import type { Cents } from './money.js';
import { bookingPolicy, type BookingType } from './policy.js';

export interface ReturnCount {
  equipmentTypeId: string;
  checkedOut: number;
  returned: number;
  damaged?: number;
}

export interface LossLine {
  equipmentTypeId: string;
  missing: number;
  damaged: number;
}

export function computeLosses(counts: ReturnCount[]): LossLine[] {
  return counts.map((c) => {
    if (c.returned < 0 || c.returned > c.checkedOut) {
      throw new RangeError('Returned quantity must be between 0 and the checked-out quantity');
    }
    const damaged = c.damaged ?? 0;
    if (damaged < 0 || damaged > c.returned) {
      throw new RangeError('Damaged quantity cannot exceed returned quantity');
    }
    return { equipmentTypeId: c.equipmentTypeId, missing: c.checkedOut - c.returned, damaged };
  });
}

export interface LossFeeLine {
  missing: number;
  lossFeeCents: Cents;
  damaged?: number;
  damageFeeCents?: Cents;
}

/** Proposed customer charge. Equipment rentals only; full-service losses are internal. */
export function lossCharge(input: { bookingType: BookingType; lines: LossFeeLine[] }): Cents {
  if (!bookingPolicy(input.bookingType).proposesLossCharges) return 0;
  return input.lines.reduce(
    (sum, l) => sum + l.missing * l.lossFeeCents + (l.damaged ?? 0) * (l.damageFeeCents ?? 0),
    0,
  );
}

/** Applies a found-items correction; returns the remaining missing count. */
export function applyFound(missing: number, found: number): number {
  if (!Number.isInteger(found) || found <= 0)
    throw new RangeError('Found quantity must be positive');
  if (found > missing) throw new RangeError('Cannot find more items than are missing');
  return missing - found;
}
