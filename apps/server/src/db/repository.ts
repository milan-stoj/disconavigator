import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { NotFoundError } from '../lib/errors.js';
import { nowIso, uuidv7 } from '../lib/id.js';
import type { Db } from './index.js';

type TenantTable = SQLiteTable & { id: SQLiteColumn; tenantId: SQLiteColumn };
type Row<T extends TenantTable> = InferSelectModel<T>;
type NewRow<T extends TenantTable> = Omit<InferInsertModel<T>, 'id' | 'tenantId'> & { id?: string };
type Patch<T extends TenantTable> = Partial<Omit<InferInsertModel<T>, 'id' | 'tenantId'>>;
// Drizzle's generic table types don't compose here; the tenant filter is what matters.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;

export interface ListOptions {
  where?: SQL | undefined;
  orderBy?: { column: SQLiteColumn; direction?: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

/**
 * All business data access goes through a TenantScope. Every query is constrained to
 * `tenant_id = scope.tenantId`, so records from another tenant behave as if they do not exist.
 */
export class TenantScope {
  constructor(
    readonly db: Db,
    readonly tenantId: string,
  ) {}

  private own(table: TenantTable, extra?: SQL): SQL {
    return and(eq(table.tenantId, this.tenantId), extra)!;
  }

  list<T extends TenantTable>(table: T, opts: ListOptions = {}): Row<T>[] {
    let q: Loose = this.db
      .select()
      .from(table as Loose)
      .where(this.own(table, opts.where));
    if (opts.orderBy?.length) {
      q = q.orderBy(
        ...opts.orderBy.map((o) => (o.direction === 'desc' ? desc(o.column) : asc(o.column))),
      );
    }
    if (opts.limit != null) q = q.limit(opts.limit);
    if (opts.offset != null) q = q.offset(opts.offset);
    return q.all() as Row<T>[];
  }

  find<T extends TenantTable>(table: T, id: string): Row<T> | undefined {
    return this.first(table, eq(table.id, id));
  }

  first<T extends TenantTable>(table: T, where?: SQL): Row<T> | undefined {
    return this.list(table, { where, limit: 1 })[0];
  }

  get<T extends TenantTable>(table: T, id: string, what?: string): Row<T> {
    const row = this.find(table, id);
    if (!row) throw new NotFoundError(what);
    return row;
  }

  insert<T extends TenantTable>(table: T, values: NewRow<T>): Row<T> {
    const row = { id: uuidv7(), ...values, tenantId: this.tenantId };
    return (
      this.db
        .insert(table)
        .values(row as Loose)
        .returning() as Loose
    ).get() as Row<T>;
  }

  update<T extends TenantTable>(table: T, id: string, patch: Patch<T>, what?: string): Row<T> {
    const values: Record<string, unknown> = { ...patch };
    if ('updatedAt' in table) values.updatedAt = nowIso();
    const row = (
      this.db
        .update(table)
        .set(values as Loose)
        .where(this.own(table, eq(table.id, id)))
        .returning() as Loose
    ).get() as Row<T> | undefined;
    if (!row) throw new NotFoundError(what);
    return row;
  }

  delete<T extends TenantTable>(table: T, id: string, what?: string): void {
    const res = this.db
      .delete(table)
      .where(this.own(table, eq(table.id, id)))
      .run();
    if (res.changes === 0) throw new NotFoundError(what);
  }

  /** Runs `fn` in a transaction with a scope bound to the transaction. */
  transaction<R>(fn: (scope: TenantScope) => R): R {
    return this.db.transaction((tx) => fn(new TenantScope(tx as unknown as Db, this.tenantId)));
  }

  /** Condition helper for tables without an `id` column (join tables). */
  ownedBy(column: SQLiteColumn, extra?: SQL): SQL {
    return and(eq(column, this.tenantId), extra)!;
  }
}
