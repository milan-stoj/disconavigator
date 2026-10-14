import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { job } from '../src/db/schema.js';
import { backoffDelay, enqueueJob, Scheduler } from '../src/services/jobs.js';
import { createTestDb } from './helpers.js';

describe('job outbox and scheduler', () => {
  it('a succeeding job completes exactly once', async () => {
    const { db } = createTestDb();
    let calls = 0;
    const s = new Scheduler(db).register('ok', () => {
      calls++;
    });
    const j = s.enqueue({ type: 'ok' });
    await s.tick();
    await s.tick();
    expect(calls).toBe(1);
    expect(db.select().from(job).where(eq(job.id, j.id)).get()!.status).toBe('done');
  });

  it('a failing job is retried with exponential backoff, then succeeds', async () => {
    const { db } = createTestDb();
    let clock = new Date('2026-01-01T00:00:00Z');
    let calls = 0;
    const s = new Scheduler(db, { now: () => clock, baseDelayMs: 1000 }).register('flaky', () => {
      calls++;
      if (calls < 3) throw new Error(`fail ${calls}`);
    });
    const j = s.enqueue({ type: 'flaky' });
    await s.tick();
    let row = db.select().from(job).where(eq(job.id, j.id)).get()!;
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'fail 1',
      runAt: '2026-01-01T00:00:01.000Z',
    });

    await s.tick(); // not due yet
    expect(calls).toBe(1);

    clock = new Date('2026-01-01T00:00:01Z');
    await s.tick();
    row = db.select().from(job).where(eq(job.id, j.id)).get()!;
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 2,
      runAt: '2026-01-01T00:00:03.000Z',
    });

    clock = new Date('2026-01-01T00:00:03Z');
    await s.tick();
    row = db.select().from(job).where(eq(job.id, j.id)).get()!;
    expect(row).toMatchObject({ status: 'done', attempts: 3 });
    expect(calls).toBe(3);
  });

  it('gives up after max attempts', async () => {
    const { db } = createTestDb();
    const s = new Scheduler(db, { baseDelayMs: 0 }).register('bad', () => {
      throw new Error('nope');
    });
    const j = s.enqueue({ type: 'bad', maxAttempts: 2 });
    await s.tick();
    await s.tick();
    await s.tick();
    expect(db.select().from(job).where(eq(job.id, j.id)).get()).toMatchObject({
      status: 'failed',
      attempts: 2,
    });
  });

  it('idempotency key deduplicates enqueues', () => {
    const { db } = createTestDb();
    const a = enqueueJob(db, { type: 'x', idempotencyKey: 'k1' });
    const b = enqueueJob(db, { type: 'x', idempotencyKey: 'k1' });
    expect(a.id).toBe(b.id);
    expect(db.select().from(job).all()).toHaveLength(1);
  });

  it('backoff is capped', () => {
    expect(backoffDelay(1, 1000, 10_000)).toBe(1000);
    expect(backoffDelay(4, 1000, 10_000)).toBe(8000);
    expect(backoffDelay(10, 1000, 10_000)).toBe(10_000);
  });

  it('runs recurring tasks on their interval', async () => {
    const { db } = createTestDb();
    let clock = new Date('2026-01-01T00:00:00Z');
    let runs = 0;
    const s = new Scheduler(db, { now: () => clock }).every('reconcile', 15 * 60_000, () => {
      runs++;
    });
    await s.tick();
    expect(runs).toBe(0);
    clock = new Date('2026-01-01T00:15:00Z');
    await s.tick();
    expect(runs).toBe(1);
  });
});
