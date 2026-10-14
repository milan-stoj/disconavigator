import type { z } from 'zod';
import { ValidationError } from './errors.js';

/** Parses input, converting Zod issues to a 400 with field errors keyed by dotted path. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join('.') || '_';
    fieldErrors[key] ??= issue.message;
  }
  throw new ValidationError('Please correct the highlighted fields', { fieldErrors });
}
