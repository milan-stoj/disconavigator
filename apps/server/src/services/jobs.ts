import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Db } from '../db/index.js';
import { job } from '../db/schema.js';
import { nowIso, uuidv7 } from '../lib/id.js';

export type JobRow = typeof job.$inferSelect;

export interface EnqueueInput {
  type: string;
  payload?: Record<string, unknown>;
  tenantId?: string | null;
  runAt?: Date;
  idempotencyKey?: string;
  maxAttempts?: number;
}

/** Adds a job to the outbox. With an idempotency key, re-enqueueing returns the existing job. */
export function enqueueJob(db: Db, input: EnqueueInput): JobRow {
  const values = {
    id: uuidv7(),
    tenantId: input.tenantId ?? null,
    type: input.type,
    payload: input.payload ?? {},
    runAt: nowIso(input.runAt ?? new Date()),
    idempotencyKey: input.idempotencyKey ?? null,
    maxAttempts: input.maxAttempts ?? 8,
  };
  const inserted = db.insert(job).values(values).onConflictDoNothing().returning().get();
  if (inserted) return inserted;
  return db.select().from(job).where(eq(job.idempotencyKey, input.idempotencyKey!)).get()!;
}

export type JobHandler = (job: JobRow) => Promise<void> | void;

export interface SchedulerOptions {
  logger?: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
  now?: () => Date;
  pollMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  batchSize?: number;
}

interface Recurring {
  name: string;
  intervalMs: number;
  fn: () => Promise<void> | void;
  nextAt: number;
}

export function backoffDelay(attempts: number, baseDelayMs: number, maxDelayMs: number): number {
  return Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempts - 1));
}

/** In-process scheduler that drains the job outbox and runs recurring tasks. */
export class Scheduler {
  private handlers = new Map<string, JobHandler>();
  private recurring: Recurring[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly now: () => Date;
  private readonly opts: Required<Omit<SchedulerOptions, 'logger' | 'now'>>;

  constructor(
    private readonly db: Db,
    private readonly options: SchedulerOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.opts = {
      pollMs: options.pollMs ?? 5_000,
      baseDelayMs: options.baseDelayMs ?? 30_000,
      maxDelayMs: options.maxDelayMs ?? 6 * 60 * 60 * 1000,
      batchSize: options.batchSize ?? 20,
    };
  }

  register(type: string, handler: JobHandler): this {
    this.handlers.set(type, handler);
    return this;
  }

  every(name: string, intervalMs: number, fn: () => Promise<void> | void): this {
    this.recurring.push({ name, intervalMs, fn, nextAt: this.now().getTime() + intervalMs });
    return this;
  }

  enqueue(input: EnqueueInput): JobRow {
    return enqueueJob(this.db, { ...input, runAt: input.runAt ?? this.now() });
  }

  /** Processes due jobs once. Returns the number of jobs attempted. */
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const nowDate = this.now();
      const due = this.db
        .select()
        .from(job)
        .where(and(eq(job.status, 'pending'), lte(job.runAt, nowIso(nowDate))))
        .orderBy(job.runAt)
        .limit(this.opts.batchSize)
        .all();
      for (const row of due) await this.runJob(row);
      for (const r of this.recurring) {
        if (nowDate.getTime() >= r.nextAt) {
          r.nextAt = nowDate.getTime() + r.intervalMs;
          try {
            await r.fn();
          } catch (err) {
            this.options.logger?.error({ err, task: r.name }, 'recurring task failed');
          }
        }
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }

  private async runJob(row: JobRow) {
    const claimed = this.db
      .update(job)
      .set({
        status: 'running',
        lockedAt: nowIso(this.now()),
        attempts: sql`${job.attempts} + 1`,
        updatedAt: nowIso(this.now()),
      })
      .where(and(eq(job.id, row.id), eq(job.status, 'pending')))
      .returning()
      .get();
    if (!claimed) return;
    const handler = this.handlers.get(claimed.type);
    try {
      if (!handler) throw new Error(`No handler registered for job type "${claimed.type}"`);
      await handler(claimed);
      this.db
        .update(job)
        .set({ status: 'done', lockedAt: null, lastError: null, updatedAt: nowIso(this.now()) })
        .where(eq(job.id, claimed.id))
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const exhausted = claimed.attempts >= claimed.maxAttempts;
      const delay = backoffDelay(claimed.attempts, this.opts.baseDelayMs, this.opts.maxDelayMs);
      this.db
        .update(job)
        .set({
          status: exhausted ? 'failed' : 'pending',
          lockedAt: null,
          lastError: message,
          runAt: exhausted ? claimed.runAt : nowIso(new Date(this.now().getTime() + delay)),
          updatedAt: nowIso(this.now()),
        })
        .where(eq(job.id, claimed.id))
        .run();
      this.options.logger?.warn(
        { jobId: claimed.id, type: claimed.type, attempts: claimed.attempts, err: message },
        'job failed',
      );
    }
  }

  /** Recovers jobs left running by a crash, then starts polling. */
  start(): void {
    this.db
      .update(job)
      .set({ status: 'pending', lockedAt: null })
      .where(inArray(job.status, ['running']))
      .run();
    const loop = async () => {
      try {
        await this.tick();
      } catch (err) {
        this.options.logger?.error({ err }, 'scheduler tick failed');
      }
      this.timer = setTimeout(loop, this.opts.pollMs);
      this.timer.unref?.();
    };
    this.timer = setTimeout(loop, 0);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
