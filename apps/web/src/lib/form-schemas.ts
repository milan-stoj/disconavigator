import { z } from 'zod';

/** A required number (NumberInput emits null when empty). */
export const num = (label: string) => z.number({ error: `Enter ${label}` });

export const wholeNumber = (label: string, min: number, max: number) =>
  num(label)
    .int('Use a whole number')
    .min(min, `Must be at least ${min}`)
    .max(max, `Must be at most ${max}`);

export const wholeDays = (label: string, min: number, max: number) =>
  num(label)
    .int('Use whole days')
    .min(min, `Must be at least ${min}`)
    .max(max, `Must be at most ${max}`);

/** A dollar amount entered in a form; convert with dollarsToCents before sending. */
export const dollars = (label = 'an amount') =>
  num(label).min(0, 'Cannot be negative').max(1_000_000, 'That amount is too large');
