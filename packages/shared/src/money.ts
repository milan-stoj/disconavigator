/** Integer cents. All money in the system is stored and computed as integer cents. */
export type Cents = number;
/** Basis points: 1% = 100 bps. */
export type Bps = number;

export function assertCents(value: number): Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`Not an integer cent amount: ${value}`);
  return value;
}

/** Divides with half-up rounding (away from zero at .5), using integers only. */
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (denominator <= 0) throw new RangeError('Denominator must be positive');
  const sign = numerator < 0 ? -1 : 1;
  const abs = Math.abs(numerator);
  return sign * Math.floor((abs * 2 + denominator) / (denominator * 2));
}

/** Applies a basis-point percentage to an amount, rounding half-up to the cent. */
export function applyBps(amount: Cents, bps: Bps): Cents {
  return divRoundHalfUp(assertCents(amount) * bps, 10_000);
}

export function percentToBps(percent: number): Bps {
  return Math.round(percent * 100);
}

export function bpsToPercent(bps: Bps): number {
  return bps / 100;
}

export function dollarsToCents(dollars: number | string): Cents {
  const n = typeof dollars === 'string' ? Number(dollars.replace(/[$,\s]/g, '')) : dollars;
  if (!Number.isFinite(n)) throw new RangeError(`Invalid dollar amount: ${dollars}`);
  return Math.round(n * 100);
}

export function centsToDollars(cents: Cents): number {
  return cents / 100;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatCents(cents: Cents): string {
  return usd.format(cents / 100);
}

export function sumCents(values: Cents[]): Cents {
  return values.reduce((a, b) => a + b, 0);
}
