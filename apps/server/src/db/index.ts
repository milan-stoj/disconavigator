import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import * as schema from './schema.js';

export { schema };
export type Db = BaseSQLiteDatabase<'sync', Database.RunResult, typeof schema>;

export interface OpenedDatabase {
  db: Db;
  sqlite: Database.Database;
  close(): void;
}

function findMigrationsFolder(): string {
  const candidates = [
    process.env.MIGRATIONS_PATH,
    fileURLToPath(new URL('../../drizzle', import.meta.url)), // src/db -> apps/server/drizzle
    fileURLToPath(new URL('../drizzle', import.meta.url)), // dist -> apps/server/drizzle
    fileURLToPath(new URL('./drizzle', import.meta.url)),
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => fs.existsSync(path.join(p, 'meta', '_journal.json')));
  if (!found) throw new Error(`Migrations folder not found (looked in ${candidates.join(', ')})`);
  return found;
}

export function openDatabase(databasePath: string): OpenedDatabase {
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  const db = drizzle({ client: sqlite, schema });
  migrate(db, { migrationsFolder: findMigrationsFolder() });
  return { db, sqlite, close: () => sqlite.close() };
}
