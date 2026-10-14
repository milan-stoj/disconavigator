import { applyBps, bpsToPercent, type Bps, type Cents, formatCents, sumCents } from './money.js';
import {
  bookingPolicy,
  type BookingType,
  type PricingTerm,
  isPricingTermAllowed,
} from './policy.js';

export const QUOTE_LINE_KINDS = ['package', 'addon', 'delivery', 'custom'] as const;
export type QuoteLineKind = (typeof QUOTE_LINE_KINDS)[number];

export interface QuoteLineInput {
  kind: QuoteLineKind;
  description: string;
  quantity: number;
  unitPriceCents: Cents;
  packageId?: string | null;
}

export type EquipmentRequirements = Record<string, number>;

export interface PackageForQuote {
  id: string;
  items: { equipmentTypeId: string; quantity: number }[];
}

export function lineTotal(line: Pick<QuoteLineInput, 'quantity' | 'unitPriceCents'>): Cents {
  return line.quantity * line.unitPriceCents;
}

export function quoteTotal(lines: Pick<QuoteLineInput, 'quantity' | 'unitPriceCents'>[]): Cents {
  return sumCents(lines.map(lineTotal));
}

export function holdingDeposit(input: {
  bookingType: BookingType;
  totalCents: Cents;
  depositBps: Bps;
}): Cents {
  if (!bookingPolicy(input.bookingType).requiresDeposit) return 0;
  return applyBps(input.totalCents, input.depositBps);
}

export interface QuotePricingInput {
  bookingType: BookingType;
  pricingTerm: PricingTerm;
  lines: Pick<QuoteLineInput, 'quantity' | 'unitPriceCents'>[];
  splitBps?: Bps | null;
  guaranteeCents?: Cents | null;
  depositBps: Bps;
}

export interface QuoteFinancials {
  /** Fixed total, or null when the final amount depends on the door. */
  totalCents: Cents | null;
  depositCents: Cents;
  balanceCents: Cents | null;
  minimumCents: Cents | null;
  splitBps: Bps | null;
  finalDeterminedAfterEvent: boolean;
}

export class PricingError extends Error {}

export function validateQuotePricing(input: Omit<QuotePricingInput, 'depositBps' | 'lines'>): void {
  if (!isPricingTermAllowed(input.bookingType, input.pricingTerm)) {
    throw new PricingError(
      `${bookingPolicy(input.bookingType).label} quotes cannot use ${input.pricingTerm} pricing`,
    );
  }
  if (input.pricingTerm !== 'flat_fee') {
    if (input.splitBps == null || input.splitBps <= 0 || input.splitBps > 10_000) {
      throw new PricingError('Door split percentage must be between 0 and 100');
    }
  }
  if (input.pricingTerm === 'guarantee_plus_split') {
    if (input.guaranteeCents == null || input.guaranteeCents <= 0) {
      throw new PricingError('A guarantee amount is required');
    }
  }
}

export function quoteFinancials(input: QuotePricingInput): QuoteFinancials {
  validateQuotePricing(input);
  if (input.pricingTerm === 'flat_fee') {
    const total = quoteTotal(input.lines);
    const deposit = holdingDeposit({
      bookingType: input.bookingType,
      totalCents: total,
      depositBps: input.depositBps,
    });
    return {
      totalCents: total,
      depositCents: deposit,
      balanceCents: total - deposit,
      minimumCents: null,
      splitBps: null,
      finalDeterminedAfterEvent: false,
    };
  }
  return {
    totalCents: null,
    depositCents: 0,
    balanceCents: null,
    minimumCents: input.pricingTerm === 'guarantee_plus_split' ? (input.guaranteeCents ?? 0) : null,
    splitBps: input.splitBps ?? null,
    finalDeterminedAfterEvent: true,
  };
}

/** Sums equipment needed by package lines plus explicit extra requirements. */
export function requirementsFromLines(
  lines: Pick<QuoteLineInput, 'kind' | 'quantity' | 'packageId'>[],
  packages: PackageForQuote[],
  extra: EquipmentRequirements = {},
): EquipmentRequirements {
  const out: EquipmentRequirements = { ...extra };
  for (const line of lines) {
    if (line.kind !== 'package' || !line.packageId) continue;
    const pkg = packages.find((p) => p.id === line.packageId);
    if (!pkg) continue;
    for (const item of pkg.items) {
      out[item.equipmentTypeId] = (out[item.equipmentTypeId] ?? 0) + item.quantity * line.quantity;
    }
  }
  return out;
}

/** Suggested delivery line: only for rentals outside the service area. */
export function deliveryFeeLine(input: {
  bookingType: BookingType;
  insideServiceArea: boolean;
  suggestedFeeCents: Cents;
}): QuoteLineInput | null {
  if (!bookingPolicy(input.bookingType).supportsDelivery || input.insideServiceArea) return null;
  return {
    kind: 'delivery',
    description: 'Delivery outside service area',
    quantity: 1,
    unitPriceCents: input.suggestedFeeCents,
  };
}

export function formatQuoteNumber(n: number): string {
  return `Q-${n}`;
}

export function formatBookingNumber(n: number): string {
  return `B-${n}`;
}

/** Plain-language pricing terms, e.g. "40% of door revenue, minimum $500". */
export function pricingSummary(input: {
  pricingTerm: PricingTerm;
  totalCents?: Cents | null;
  splitBps?: Bps | null;
  guaranteeCents?: Cents | null;
}): string {
  const pct = `${bpsToPercent(input.splitBps ?? 0)}%`;
  switch (input.pricingTerm) {
    case 'flat_fee':
      return `Flat fee of ${formatCents(input.totalCents ?? 0)}`;
    case 'door_split':
      return `${pct} of door revenue collected by the venue; final amount determined after the event`;
    case 'guarantee_plus_split':
      return `The greater of ${formatCents(input.guaranteeCents ?? 0)} or ${pct} of door revenue; minimum ${formatCents(input.guaranteeCents ?? 0)}, final amount determined after the event`;
  }
}
