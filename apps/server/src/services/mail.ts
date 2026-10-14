import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { outboundEmail } from '../db/schema.js';
import { nowIso, uuidv7 } from '../lib/id.js';
import type { RenderedEmail } from './email-templates.js';
import { enqueueJob, type JobRow } from './jobs.js';

export const SEND_EMAIL_JOB = 'email.send';

export interface MailMessage extends RenderedEmail {
  from: string;
  to: string;
}

/** Anything that can deliver a message. Nodemailer transports and test fakes both fit. */
export interface MailTransport {
  sendMail(message: MailMessage): Promise<unknown>;
}

export type Mailer =
  { mode: 'smtp'; from: string; transport: MailTransport } | { mode: 'log'; from: string };

/** SMTP when SMTP_URL is set; otherwise dev mode, which logs messages instead of sending. */
export function createMailer(config: AppConfig, transport?: MailTransport): Mailer {
  if (transport) return { mode: 'smtp', from: config.mailFrom, transport };
  if (config.smtpUrl) {
    return {
      mode: 'smtp',
      from: config.mailFrom,
      transport: nodemailer.createTransport(config.smtpUrl),
    };
  }
  return { mode: 'log', from: config.mailFrom };
}

export interface QueueEmailInput {
  tenantId: string;
  to: string;
  email: RenderedEmail;
  related?: { type: string; id: string };
}

/** Stores the message and schedules delivery through the job outbox (with retries). */
export function queueEmail(db: Db, input: QueueEmailInput) {
  return db.transaction((tx) => {
    const row = tx
      .insert(outboundEmail)
      .values({
        id: uuidv7(),
        tenantId: input.tenantId,
        to: input.to,
        subject: input.email.subject,
        text: input.email.text,
        html: input.email.html,
        status: 'queued',
        relatedType: input.related?.type ?? null,
        relatedId: input.related?.id ?? null,
      })
      .returning()
      .get();
    enqueueJob(tx as unknown as Db, {
      type: SEND_EMAIL_JOB,
      tenantId: input.tenantId,
      payload: { emailId: row.id },
      idempotencyKey: `email:${row.id}`,
      maxAttempts: 6,
    });
    return row;
  });
}

export function sendEmailHandler(
  db: Db,
  mailer: Mailer,
  logger?: Pick<FastifyBaseLogger, 'info' | 'warn'>,
) {
  return async (job: JobRow) => {
    const emailId = String(job.payload.emailId);
    const row = db.select().from(outboundEmail).where(eq(outboundEmail.id, emailId)).get();
    if (!row || row.status === 'sent' || row.status === 'logged') return;
    const finish = (status: 'sent' | 'logged') =>
      db
        .update(outboundEmail)
        .set({ status, error: null, sentAt: nowIso() })
        .where(eq(outboundEmail.id, row.id))
        .run();
    if (mailer.mode === 'log') {
      logger?.info(
        { emailId: row.id, to: row.to, subject: row.subject, text: row.text },
        'email (dev mode, not sent)',
      );
      finish('logged');
      return;
    }
    try {
      await mailer.transport.sendMail({
        from: mailer.from,
        to: row.to,
        subject: row.subject,
        text: row.text,
        html: row.html ?? row.text,
      });
      finish('sent');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const final = job.attempts >= job.maxAttempts;
      db.update(outboundEmail)
        .set({ status: final ? 'failed' : 'queued', error: message })
        .where(eq(outboundEmail.id, row.id))
        .run();
      throw err;
    }
  };
}
