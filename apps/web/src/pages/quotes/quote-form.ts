import {
  addDays,
  BOOKING_TYPES,
  bookingPolicy,
  bpsToPercent,
  centsToDollars,
  dayOfWeek,
  dollarsToCents,
  monthlyNthWeekday,
  percentToBps,
  PRICING_TERMS,
  QUOTE_LINE_KINDS,
  quoteFinancials,
  requirementsFromLines,
  weeklyDates,
  type BookingType,
  type PackageForQuote,
  type QuoteFinancials,
} from '@disco/shared';
import { z } from 'zod';
import { dollars, wholeNumber } from '@/lib/form-schemas';
import type { Quote, QuoteBody } from '@/lib/quotes';

export const SERIES_PATTERNS = ['monthly', 'weekly', 'biweekly'] as const;
export type SeriesPattern = (typeof SERIES_PATTERNS)[number];

const lineSchema = z.object({
  kind: z.enum(QUOTE_LINE_KINDS),
  description: z.string().trim().min(1, 'Describe this item').max(300),
  quantity: wholeNumber('a quantity', 1, 100_000),
  unitPrice: dollars('a price'),
  packageId: z.string().nullable(),
});

export const quoteFormSchema = z
  .object({
    bookingType: z.enum(BOOKING_TYPES),
    pricingTerm: z.enum(PRICING_TERMS),
    startDate: z.string().min(1, 'Choose a date'),
    endDate: z.string(),
    startTime: z.string(),
    endTime: z.string(),
    location: z.string().trim().max(300),
    insideServiceArea: z.boolean(),
    expectedAttendance: z.number().int('Use a whole number').min(0).nullable(),
    lines: z.array(lineSchema),
    splitPercent: z.number().nullable(),
    guarantee: z.number().nullable(),
    requirements: z.record(
      z.string(),
      z.number().int('Use a whole number').min(0).nullable().optional(),
    ),
    staffRequired: z.number().int('Use a whole number').min(0).max(20).nullable(),
    seriesEnabled: z.boolean(),
    seriesPattern: z.enum(SERIES_PATTERNS),
    seriesUntil: z.string(),
    notes: z.string().trim().max(5000),
  })
  .superRefine((v, ctx) => {
    if (v.bookingType === 'equipment_rental') {
      if (!v.endDate) {
        ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Choose a return date' });
      } else if (v.startDate && v.endDate < v.startDate) {
        ctx.addIssue({
          code: 'custom',
          path: ['endDate'],
          message: 'Return date must be on or after pickup',
        });
      }
    }
    if (v.pricingTerm === 'flat_fee' && v.lines.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Add at least one line item' });
    }
    if (v.pricingTerm !== 'flat_fee') {
      if (v.splitPercent == null || v.splitPercent <= 0 || v.splitPercent > 100) {
        ctx.addIssue({
          code: 'custom',
          path: ['splitPercent'],
          message: 'Enter a percentage between 1 and 100',
        });
      }
    }
    if (v.pricingTerm === 'guarantee_plus_split' && (v.guarantee == null || v.guarantee <= 0)) {
      ctx.addIssue({ code: 'custom', path: ['guarantee'], message: 'Enter the guarantee amount' });
    }
    if (v.bookingType === 'full_service' && v.seriesEnabled) {
      if (!v.seriesUntil) {
        ctx.addIssue({
          code: 'custom',
          path: ['seriesUntil'],
          message: 'Choose when the series ends',
        });
      } else if (seriesDates(v).length < 2) {
        ctx.addIssue({
          code: 'custom',
          path: ['seriesUntil'],
          message: 'A series needs at least two dates',
        });
      }
    }
  });
export type QuoteFormValues = z.infer<typeof quoteFormSchema>;

const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** e.g. "The first Friday of each month" for the start date. */
export function seriesPatternLabel(pattern: SeriesPattern, startDate: string): string {
  const weekday = startDate ? WEEKDAYS[dayOfWeek(startDate)] : 'weekday';
  if (pattern === 'weekly') return `Every ${weekday}`;
  if (pattern === 'biweekly') return `Every other ${weekday}`;
  const nth = startDate ? Math.ceil(Number(startDate.slice(8, 10)) / 7) : 1;
  return `The ${ORDINALS[nth - 1]} ${weekday} of each month`;
}

/** Occurrence dates for a recurring series, starting on the event date. */
export function seriesDates(
  v: Pick<QuoteFormValues, 'startDate' | 'seriesUntil' | 'seriesPattern'>,
): string[] {
  if (!v.startDate || !v.seriesUntil || v.seriesUntil < v.startDate) return [];
  if (v.seriesPattern === 'weekly') return weeklyDates(v.startDate, v.seriesUntil, 1).slice(0, 120);
  if (v.seriesPattern === 'biweekly') {
    return weeklyDates(v.startDate, v.seriesUntil, 2).slice(0, 120);
  }
  const nth = Math.ceil(Number(v.startDate.slice(8, 10)) / 7);
  return monthlyNthWeekday(v.startDate, v.seriesUntil, dayOfWeek(v.startDate), nth).slice(0, 120);
}

export function occurrenceDatesOf(
  v: Pick<
    QuoteFormValues,
    'bookingType' | 'seriesEnabled' | 'startDate' | 'seriesUntil' | 'seriesPattern'
  >,
): string[] | null {
  return v.bookingType === 'full_service' && v.seriesEnabled ? seriesDates(v) : null;
}

/** Live totals using the same shared function as the server; null while pricing is incomplete. */
export function liveFinancials(v: QuoteFormValues, depositBps: number): QuoteFinancials | null {
  try {
    return quoteFinancials({
      bookingType: v.bookingType,
      pricingTerm: v.pricingTerm,
      lines: (v.lines ?? []).map((l) => ({
        quantity: l.quantity ?? 0,
        unitPriceCents: l.unitPrice == null ? 0 : dollarsToCents(l.unitPrice),
      })),
      splitBps: v.splitPercent == null ? null : percentToBps(v.splitPercent),
      guaranteeCents: v.guarantee == null ? null : dollarsToCents(v.guarantee),
      depositBps: bookingPolicy(v.bookingType).requiresDeposit ? depositBps : 0,
    });
  } catch {
    return null;
  }
}

export function cleanRequirements(req: QuoteFormValues['requirements']): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(req ?? {})) if (n && n > 0) out[k] = n;
  return out;
}

export function toQuoteBody(v: QuoteFormValues, opportunityId: string): QuoteBody {
  const isRental = v.bookingType === 'equipment_rental';
  const lines = isRental || v.pricingTerm === 'flat_fee' ? v.lines : [];
  return {
    opportunityId,
    bookingType: v.bookingType,
    pricingTerm: isRental ? 'flat_fee' : v.pricingTerm,
    startDate: v.startDate,
    endDate: isRental ? v.endDate : v.startDate,
    startTime: v.startTime || null,
    endTime: v.endTime || null,
    location: v.location || null,
    insideServiceArea: isRental ? v.insideServiceArea : true,
    expectedAttendance: v.expectedAttendance,
    lines: lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: dollarsToCents(l.unitPrice),
      packageId: l.kind === 'package' ? l.packageId : null,
    })),
    splitBps:
      v.pricingTerm === 'flat_fee' || v.splitPercent == null ? null : percentToBps(v.splitPercent),
    guaranteeCents:
      v.pricingTerm === 'guarantee_plus_split' && v.guarantee != null
        ? dollarsToCents(v.guarantee)
        : null,
    requirements: cleanRequirements(v.requirements),
    staffRequired: v.staffRequired ?? 0,
    occurrenceDates: occurrenceDatesOf(v),
    notes: v.notes || null,
  };
}

export function emptyQuoteForm(
  bookingType: BookingType,
  opts: { startDate?: string | null; expectedAttendance?: number | null } = {},
): QuoteFormValues {
  const start = opts.startDate ?? '';
  return {
    bookingType,
    pricingTerm: 'flat_fee',
    startDate: start,
    endDate: bookingType === 'equipment_rental' && start ? addDays(start, 1) : start,
    startTime: '',
    endTime: '',
    location: '',
    insideServiceArea: true,
    expectedAttendance: opts.expectedAttendance ?? null,
    lines: [],
    splitPercent: null,
    guarantee: null,
    requirements: {},
    staffRequired: bookingPolicy(bookingType).defaultStaffRequired,
    seriesEnabled: false,
    seriesPattern: 'monthly',
    seriesUntil: '',
    notes: '',
  };
}

/** Infers the series pattern from saved occurrence dates. */
function inferPattern(dates: string[]): SeriesPattern {
  if (dates.length < 2) return 'monthly';
  const gap = (Date.parse(dates[1]!) - Date.parse(dates[0]!)) / 86_400_000;
  return gap === 7 ? 'weekly' : gap === 14 ? 'biweekly' : 'monthly';
}

export function quoteToForm(q: Quote, packages: PackageForQuote[]): QuoteFormValues {
  const r = q.current;
  const dates = r.occurrenceDates ?? [];
  // Saved requirements include package equipment; the form edits only the extra part.
  const fromPackages = requirementsFromLines(r.lines, packages);
  const requirements: Record<string, number | null> = {};
  for (const [id, n] of Object.entries(r.requirements)) {
    const extra = n - (fromPackages[id] ?? 0);
    if (extra > 0) requirements[id] = extra;
  }
  return {
    bookingType: r.bookingType,
    pricingTerm: r.pricingTerm,
    startDate: r.startDate,
    endDate: r.endDate,
    startTime: r.startTime ?? '',
    endTime: r.endTime ?? '',
    location: r.location ?? '',
    insideServiceArea: r.insideServiceArea,
    expectedAttendance: r.expectedAttendance,
    lines: r.lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unitPrice: centsToDollars(l.unitPriceCents),
      packageId: l.packageId,
    })),
    splitPercent: r.splitBps == null ? null : bpsToPercent(r.splitBps),
    guarantee: r.guaranteeCents == null ? null : centsToDollars(r.guaranteeCents),
    requirements,
    staffRequired: r.staffRequired,
    seriesEnabled: dates.length > 1,
    seriesPattern: inferPattern(dates),
    seriesUntil: dates.length > 1 ? dates[dates.length - 1]! : '',
    notes: r.notes ?? '',
  };
}

/** Maps server field names (cents, bps) to form field names. */
export function quoteServerFieldMap(keys: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const k of keys) {
    if (k === 'splitBps') map[k] = 'splitPercent';
    else if (k === 'guaranteeCents') map[k] = 'guarantee';
    else if (k === 'occurrenceDates') map[k] = 'seriesUntil';
    else if (/^lines\.\d+\.unitPriceCents$/.test(k)) {
      map[k] = k.replace('unitPriceCents', 'unitPrice');
    } else if (/^lines\.\d+\.(packageId|kind)$/.test(k)) {
      map[k] = k.replace(/(packageId|kind)$/, 'description');
    } else if (k.startsWith('requirements.')) map[k] = 'lines';
  }
  return map;
}
