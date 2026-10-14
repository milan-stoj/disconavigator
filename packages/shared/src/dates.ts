/** Calendar dates are `YYYY-MM-DD` strings in the tenant's time zone. */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function eachDate(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function todayIn(timeZone: string, now: Date = new Date()): IsoDate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Local wall-clock time `HH:MM` in the given time zone. */
export function timeIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);
}

/**
 * Whether equipment that is out should be back by now. Rentals are due at the return date and
 * time (end of day when no time is set). Full-service gear comes back after a late-night event, so
 * it is only overdue once the day after the event has passed.
 */
export function isReturnOverdue(
  b: {
    bookingType: 'equipment_rental' | 'full_service';
    endDate: IsoDate;
    returnTime: string | null;
  },
  timeZone: string,
  now: Date = new Date(),
): boolean {
  const today = todayIn(timeZone, now);
  if (b.bookingType === 'full_service') return today > addDays(b.endDate, 1);
  if (today !== b.endDate) return today > b.endDate;
  return !!b.returnTime && timeIn(timeZone, now) >= b.returnTime;
}

export function dayOfWeek(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Nth weekday (0=Sun) of each month between from and to, inclusive. nth = -1 means last. */
export function monthlyNthWeekday(
  from: IsoDate,
  to: IsoDate,
  weekday: number,
  nth: number,
): IsoDate[] {
  const out: IsoDate[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7)) - 1;
  for (let guard = 0; guard < 240; guard++) {
    const first = new Date(Date.UTC(year, month, 1));
    if (first.toISOString().slice(0, 10) > to) break;
    const candidates: IsoDate[] = [];
    for (let day = 1; day <= 31; day++) {
      const d = new Date(Date.UTC(year, month, day));
      if (d.getUTCMonth() !== month) break;
      if (d.getUTCDay() === weekday) candidates.push(d.toISOString().slice(0, 10));
    }
    const pick = nth === -1 ? candidates[candidates.length - 1] : candidates[nth - 1];
    if (pick && pick >= from && pick <= to) out.push(pick);
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }
  return out;
}

export function weeklyDates(from: IsoDate, to: IsoDate, intervalWeeks = 1): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d <= to; d = addDays(d, 7 * intervalWeeks)) out.push(d);
  return out;
}
