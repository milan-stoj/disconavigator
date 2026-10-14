import { sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';

/** Escapes LIKE wildcards so user input matches literally. */
export const likePattern = (q: string) =>
  `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Case-insensitive "contains" match on a column. */
export const containsText = (col: SQLiteColumn | SQL, q: string): SQL =>
  sql`lower(${col}) like ${likePattern(q)} escape '\\'`;
