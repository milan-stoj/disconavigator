import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/index.js';

describe('database', () => {
  it('applies the migration cleanly to a fresh file database with WAL and foreign keys', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'disco-db-'));
    const file = path.join(dir, 'nested', 'test.db');
    const { sqlite, close } = openDatabase(file);
    expect(sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
    const tables = sqlite
      .prepare(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'",
      )
      .all()
      .map((r) => (r as { name: string }).name);
    for (const t of [
      'tenant',
      'user',
      'session',
      'organization',
      'contact',
      'opportunity',
      'quote',
      'quote_revision',
      'quote_line',
      'acceptance',
      'booking',
      'booking_staff',
      'staff_member',
      'staff_unavailability',
      'equipment_type',
      'equipment_unit',
      'equipment_requirement',
      'checkout_record',
      'checkout_item',
      'settlement',
      'payment',
      'charge',
      'rental_package',
      'package_item',
      'inventory_adjustment',
      'activity',
      'tenant_settings',
      'job',
    ]) {
      expect(tables).toContain(t);
    }
    // every business table has tenant_id
    for (const t of tables.filter((n) => n !== 'tenant' && n !== 'job' && n !== 'webhook_event')) {
      const cols = sqlite
        .prepare(`pragma table_info(${t})`)
        .all()
        .map((c) => (c as { name: string }).name);
      expect(cols, t).toContain('tenant_id');
    }
    close();
    // re-opening is idempotent
    openDatabase(file).close();
    fs.rmSync(dir, { recursive: true });
  });
});
