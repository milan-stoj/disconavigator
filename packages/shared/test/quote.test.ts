import { describe, expect, it } from 'vitest';
import {
  bookingPolicy,
  canTransition,
  deliveryFeeLine,
  formatBookingNumber,
  formatQuoteNumber,
  holdingDeposit,
  isPricingTermAllowed,
  PricingError,
  pricingSummary,
  quoteFinancials,
  quoteTotal,
  requirementsFromLines,
} from '../src/index.js';

describe('booking-type policy', () => {
  it('equipment rentals: flat pricing only, deposit, awaiting deposit, loss charges', () => {
    const p = bookingPolicy('equipment_rental');
    expect(p.allowedPricingTerms).toEqual(['flat_fee']);
    expect(p.requiresDeposit).toBe(true);
    expect(p.initialStatus).toBe('awaiting_deposit');
    expect(p.invoicePlan('flat_fee')).toBe('deposit_and_balance');
    expect(p.proposesLossCharges).toBe(true);
  });

  it('full-service: all terms, no deposit, confirmed, no loss charges', () => {
    const p = bookingPolicy('full_service');
    expect(p.allowedPricingTerms).toEqual(['flat_fee', 'door_split', 'guarantee_plus_split']);
    expect(p.requiresDeposit).toBe(false);
    expect(p.initialStatus).toBe('confirmed');
    expect(p.invoicePlan('flat_fee')).toBe('single_full');
    expect(p.invoicePlan('door_split')).toBe('after_settlement');
    expect(p.invoicePlan('guarantee_plus_split')).toBe('after_settlement');
    expect(p.proposesLossCharges).toBe(false);
  });

  it('split terms are rejected for rentals', () => {
    expect(isPricingTermAllowed('equipment_rental', 'door_split')).toBe(false);
    expect(isPricingTermAllowed('equipment_rental', 'guarantee_plus_split')).toBe(false);
    expect(() =>
      quoteFinancials({
        bookingType: 'equipment_rental',
        pricingTerm: 'door_split',
        lines: [],
        splitBps: 4000,
        depositBps: 2000,
      }),
    ).toThrow(PricingError);
  });

  it('lifecycle transitions', () => {
    expect(canTransition('awaiting_deposit', 'confirmed')).toBe(true);
    expect(canTransition('awaiting_deposit', 'out')).toBe(false);
    expect(canTransition('confirmed', 'out')).toBe(true);
    expect(canTransition('out', 'returned')).toBe(true);
    expect(canTransition('closed', 'confirmed')).toBe(false);
  });
});

describe('quoteTotal and holdingDeposit', () => {
  it('Party 50 ($300) plus extra day ($75) totals $375 and requires the package equipment', () => {
    const lines = [
      {
        kind: 'package' as const,
        description: 'Party 50',
        quantity: 1,
        unitPriceCents: 30_000,
        packageId: 'p50',
      },
      { kind: 'addon' as const, description: 'Extra day', quantity: 1, unitPriceCents: 7_500 },
    ];
    expect(quoteTotal(lines)).toBe(37_500);
    const req = requirementsFromLines(lines, [
      {
        id: 'p50',
        items: [
          { equipmentTypeId: 'hp', quantity: 50 },
          { equipmentTypeId: 'tx', quantity: 1 },
        ],
      },
    ]);
    expect(req).toEqual({ hp: 50, tx: 1 });
  });

  it('adds extra requirements and multiplies package quantity', () => {
    const req = requirementsFromLines(
      [{ kind: 'package', quantity: 2, packageId: 'p' }],
      [{ id: 'p', items: [{ equipmentTypeId: 'hp', quantity: 25 }] }],
      { hp: 10 },
    );
    expect(req).toEqual({ hp: 60 });
  });

  it('$1,000 equipment rental → $200 deposit and $800 balance', () => {
    expect(
      holdingDeposit({ bookingType: 'equipment_rental', totalCents: 100_000, depositBps: 2000 }),
    ).toBe(20_000);
    const f = quoteFinancials({
      bookingType: 'equipment_rental',
      pricingTerm: 'flat_fee',
      lines: [{ quantity: 1, unitPriceCents: 100_000 }],
      depositBps: 2000,
    });
    expect(f).toMatchObject({ totalCents: 100_000, depositCents: 20_000, balanceCents: 80_000 });
  });

  it('$1,000 full-service flat fee → no deposit', () => {
    expect(
      holdingDeposit({ bookingType: 'full_service', totalCents: 100_000, depositBps: 2000 }),
    ).toBe(0);
    const f = quoteFinancials({
      bookingType: 'full_service',
      pricingTerm: 'flat_fee',
      lines: [{ quantity: 1, unitPriceCents: 100_000 }],
      depositBps: 2000,
    });
    expect(f).toMatchObject({ totalCents: 100_000, depositCents: 0, balanceCents: 100_000 });
  });

  it('$800 full-service flat fee totals $800', () => {
    expect(quoteTotal([{ quantity: 1, unitPriceCents: 80_000 }])).toBe(80_000);
  });

  it('40% door split: final amount determined after the event', () => {
    const f = quoteFinancials({
      bookingType: 'full_service',
      pricingTerm: 'door_split',
      lines: [],
      splitBps: 4000,
      depositBps: 2000,
    });
    expect(f).toMatchObject({
      totalCents: null,
      depositCents: 0,
      splitBps: 4000,
      finalDeterminedAfterEvent: true,
      minimumCents: null,
    });
  });

  it('$500 guarantee plus 40% split shows a $500 minimum', () => {
    const f = quoteFinancials({
      bookingType: 'full_service',
      pricingTerm: 'guarantee_plus_split',
      lines: [],
      splitBps: 4000,
      guaranteeCents: 50_000,
      depositBps: 2000,
    });
    expect(f.minimumCents).toBe(50_000);
    expect(() =>
      quoteFinancials({
        bookingType: 'full_service',
        pricingTerm: 'guarantee_plus_split',
        lines: [],
        splitBps: 4000,
        depositBps: 0,
      }),
    ).toThrow(PricingError);
  });

  it('delivery fee only for rentals outside the service area', () => {
    expect(
      deliveryFeeLine({
        bookingType: 'equipment_rental',
        insideServiceArea: false,
        suggestedFeeCents: 7_500,
      }),
    ).toMatchObject({ kind: 'delivery', unitPriceCents: 7_500 });
    expect(
      deliveryFeeLine({
        bookingType: 'equipment_rental',
        insideServiceArea: true,
        suggestedFeeCents: 7_500,
      }),
    ).toBeNull();
    expect(
      deliveryFeeLine({
        bookingType: 'full_service',
        insideServiceArea: false,
        suggestedFeeCents: 7_500,
      }),
    ).toBeNull();
  });
});

describe('pricingSummary', () => {
  it('describes each pricing term', () => {
    expect(pricingSummary({ pricingTerm: 'flat_fee', totalCents: 80_000 })).toBe(
      'Flat fee of $800.00',
    );
    expect(pricingSummary({ pricingTerm: 'door_split', splitBps: 4000 })).toMatch(
      /^40% of door revenue.*determined after the event$/,
    );
    expect(
      pricingSummary({
        pricingTerm: 'guarantee_plus_split',
        splitBps: 4000,
        guaranteeCents: 50_000,
      }),
    ).toMatch(/greater of \$500\.00 or 40%.*minimum \$500\.00/);
    expect(formatQuoteNumber(1001)).toBe('Q-1001');
    expect(formatBookingNumber(1001)).toBe('B-1001');
  });
});
