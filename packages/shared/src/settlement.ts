import { applyBps, type Bps, type Cents } from './money.js';
import type { PricingTerm } from './policy.js';

export function settlementAmount(input: {
  pricingTerm: PricingTerm;
  doorRevenueCents: Cents;
  splitBps: Bps;
  guaranteeCents?: Cents | null;
}): Cents {
  if (input.doorRevenueCents < 0) throw new RangeError('Door revenue cannot be negative');
  const split = applyBps(input.doorRevenueCents, input.splitBps);
  switch (input.pricingTerm) {
    case 'door_split':
      return split;
    case 'guarantee_plus_split':
      return Math.max(input.guaranteeCents ?? 0, split);
    default:
      throw new RangeError('Settlement only applies to door split pricing');
  }
}

export function balanceDue(amountOwedCents: Cents, paidCents: Cents): Cents {
  return Math.max(0, amountOwedCents - paidCents);
}
