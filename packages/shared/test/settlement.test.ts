import { describe, expect, it } from 'vitest';
import { balanceDue, settlementAmount } from '../src/index.js';

describe('settlementAmount', () => {
  it('$1,500 door at 40% → $600', () => {
    expect(
      settlementAmount({ pricingTerm: 'door_split', doorRevenueCents: 150_000, splitBps: 4000 }),
    ).toBe(60_000);
  });
  it('$500 guarantee with $1,000 door at 40% → $500', () => {
    expect(
      settlementAmount({
        pricingTerm: 'guarantee_plus_split',
        doorRevenueCents: 100_000,
        splitBps: 4000,
        guaranteeCents: 50_000,
      }),
    ).toBe(50_000);
  });
  it('guarantee plus split pays the split when larger', () => {
    expect(
      settlementAmount({
        pricingTerm: 'guarantee_plus_split',
        doorRevenueCents: 200_000,
        splitBps: 4000,
        guaranteeCents: 50_000,
      }),
    ).toBe(80_000);
  });
  it('rejects flat fee and negative door', () => {
    expect(() =>
      settlementAmount({ pricingTerm: 'flat_fee', doorRevenueCents: 1, splitBps: 1 }),
    ).toThrow();
    expect(() =>
      settlementAmount({ pricingTerm: 'door_split', doorRevenueCents: -1, splitBps: 1 }),
    ).toThrow();
  });
  it('balance due never negative', () => {
    expect(balanceDue(60_000, 0)).toBe(60_000);
    expect(balanceDue(60_000, 70_000)).toBe(0);
  });
});
