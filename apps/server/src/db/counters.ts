import { sql } from 'drizzle-orm';
import type { TenantScope } from './repository.js';
import { counter } from './schema.js';

/** Atomically increments and returns a per-tenant counter (quote and booking numbers). */
export function nextNumber(scope: TenantScope, name: string, start = 1000): number {
  const row = scope.db
    .insert(counter)
    .values({ tenantId: scope.tenantId, name, value: start + 1 })
    .onConflictDoUpdate({
      target: [counter.tenantId, counter.name],
      set: { value: sql`${counter.value} + 1` },
    })
    .returning({ value: counter.value })
    .get();
  return row.value;
}
