import { describe, expect, it } from 'vitest';
import {
  applyBps,
  assertCents,
  divRoundHalfUp,
  dollarsToCents,
  formatCents,
  percentToBps,
  sumCents,
} from '../src/index.js';

describe('money helpers', () => {
  it('applies basis points with half-up rounding', () => {
    expect(applyBps(100_000, 2000)).toBe(20_000);
    expect(applyBps(1, 5000)).toBe(1); // 0.5 cents rounds up
    expect(applyBps(3, 5000)).toBe(2); // 1.5 rounds up
    expect(applyBps(1, 4999)).toBe(0); // 0.4999 rounds down
    expect(applyBps(33_333, 2000)).toBe(6667); // 6666.6
    expect(applyBps(12_345, 2000)).toBe(2469); // 2469.0
    expect(applyBps(12_347, 2000)).toBe(2469); // 2469.4
    expect(applyBps(12_348, 2000)).toBe(2470); // 2469.6
  });

  it('rounds negative halves away from zero', () => {
    expect(divRoundHalfUp(-5, 10)).toBe(-1);
    expect(divRoundHalfUp(-4, 10)).toBe(-0);
  });

  it('rejects non-integer cents', () => {
    expect(() => assertCents(1.5)).toThrow(RangeError);
    expect(() => applyBps(10.1, 100)).toThrow(RangeError);
  });

  it('converts and formats', () => {
    expect(dollarsToCents('$1,234.56')).toBe(123_456);
    expect(dollarsToCents(0.1 + 0.2)).toBe(30);
    expect(percentToBps(20)).toBe(2000);
    expect(percentToBps(12.5)).toBe(1250);
    expect(formatCents(123_456)).toBe('$1,234.56');
    expect(sumCents([100, 250])).toBe(350);
    expect(() => dollarsToCents('abc')).toThrow();
  });
});
