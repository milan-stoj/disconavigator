import { addDays, dayOfWeek, eachDate, type IsoDate } from '@disco/shared';

export const CALENDAR_VIEWS = ['month', 'week', 'day'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export const startOfWeek = (d: IsoDate) => addDays(d, -dayOfWeek(d));
export const startOfMonth = (d: IsoDate) => `${d.slice(0, 8)}01`;

export function addMonths(d: IsoDate, months: number): IsoDate {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return first.toISOString().slice(0, 10);
}

export const endOfMonth = (d: IsoDate) => addDays(addMonths(startOfMonth(d), 1), -1);

/** The dates shown for a view: whole weeks covering the month, one week, or one day. */
export function visibleRange(view: CalendarView, date: IsoDate): { from: IsoDate; to: IsoDate } {
  if (view === 'day') return { from: date, to: date };
  if (view === 'week') return { from: startOfWeek(date), to: addDays(startOfWeek(date), 6) };
  const from = startOfWeek(startOfMonth(date));
  return { from, to: addDays(startOfWeek(endOfMonth(date)), 6) };
}

export function weeksOf(from: IsoDate, to: IsoDate): IsoDate[][] {
  const dates = eachDate(from, to);
  const weeks: IsoDate[][] = [];
  for (let i = 0; i < dates.length; i += 7) weeks.push(dates.slice(i, i + 7));
  return weeks;
}

/** Moves the anchor date one view-length forward or back. */
export function step(view: CalendarView, date: IsoDate, dir: 1 | -1): IsoDate {
  if (view === 'month') return addMonths(date, dir);
  return addDays(date, view === 'week' ? 7 * dir : dir);
}

/** Grid keyboard movement: arrows by day/week, Home/End within the week, PageUp/Down by month. */
export function keyTarget(key: string, date: IsoDate): IsoDate | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(date, -1);
    case 'ArrowRight':
      return addDays(date, 1);
    case 'ArrowUp':
      return addDays(date, -7);
    case 'ArrowDown':
      return addDays(date, 7);
    case 'Home':
      return startOfWeek(date);
    case 'End':
      return addDays(startOfWeek(date), 6);
    case 'PageUp':
      return addMonths(date, -1);
    case 'PageDown':
      return addMonths(date, 1);
    default:
      return null;
  }
}

const fmt = (d: IsoDate, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { ...opts, timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

export const formatLongDate = (d: IsoDate) =>
  fmt(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export const formatShortDate = (d: IsoDate) => fmt(d, { month: 'short', day: 'numeric' });

export function viewTitle(view: CalendarView, date: IsoDate): string {
  if (view === 'month') return fmt(date, { month: 'long', year: 'numeric' });
  if (view === 'day') return formatLongDate(date);
  const { from, to } = visibleRange('week', date);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  const start = fmt(from, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${start} – ${fmt(to, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
