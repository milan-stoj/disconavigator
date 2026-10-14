import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { job, outboundEmail } from '../src/db/schema.js';
import {
  newRequestEmail,
  quoteSentEmail,
  rentalConfirmationEmail,
} from '../src/services/email-templates.js';
import { Scheduler } from '../src/services/jobs.js';
import {
  createMailer,
  queueEmail,
  SEND_EMAIL_JOB,
  sendEmailHandler,
  type MailTransport,
} from '../src/services/mail.js';
import { createTenant, createTestDb } from './helpers.js';

describe('email templates', () => {
  it('renders a new request notification with all request details', () => {
    const email = newRequestEmail({
      tenantName: 'Undercover Dance Party',
      name: 'Jordan Lee',
      email: 'jordan@example.com',
      phone: '414-555-0100',
      organization: 'Brew City <Taproom>',
      serviceInterest: 'equipment_rental',
      eventDate: '2026-07-10',
      expectedAttendance: 80,
      location: 'Bay View, Milwaukee',
      message: 'Rooftop party',
      opportunityUrl: 'https://app.test/pipeline/abc',
    });
    expect(email.subject).toBe('New quote request from Jordan Lee (Brew City <Taproom>)');
    for (const part of [
      'jordan@example.com',
      '414-555-0100',
      'Equipment rental',
      'Friday, July 10, 2026',
      '80',
      'Bay View, Milwaukee',
      'Rooftop party',
      'https://app.test/pipeline/abc',
    ]) {
      expect(email.text).toContain(part);
      expect(email.html).toContain(part);
    }
    expect(email.html).toContain('Brew City &lt;Taproom&gt;');
    expect(email.html).not.toContain('<Taproom>');
  });

  it('renders a quote email with total, deposit, expiry, and link', () => {
    const email = quoteSentEmail({
      tenantName: 'Undercover Dance Party',
      customerName: 'Jordan',
      quoteNumber: 'Q-0007',
      bookingType: 'equipment_rental',
      eventDate: '2026-07-10',
      totalCents: 45000,
      depositCents: 9000,
      expiresOn: '2026-06-24',
      quoteUrl: 'https://app.test/q/token123',
    });
    expect(email.subject).toBe('Your quote Q-0007 from Undercover Dance Party');
    for (const part of [
      'Hi Jordan',
      '$450.00',
      '$90.00',
      'June 24, 2026',
      'https://app.test/q/token123',
    ]) {
      expect(email.text).toContain(part);
      expect(email.html).toContain(part);
    }
  });

  it('omits deposit and total rows when they do not apply', () => {
    const email = quoteSentEmail({
      tenantName: 'UDP',
      customerName: 'Sam',
      quoteNumber: 'Q-0008',
      bookingType: 'full_service',
      eventDate: '2026-07-10',
      totalCents: null,
      pricingSummary: '60% of door to us',
      depositCents: 0,
      expiresOn: '2026-06-24',
      quoteUrl: 'https://app.test/q/t',
    });
    expect(email.text).toContain('Full-service event');
    expect(email.text).toContain('Pricing: 60% of door to us');
    expect(email.text).not.toContain('Holding deposit');
    expect(email.text).not.toContain('Total:');
  });

  it('renders a rental confirmation with dates, items, and usage instructions', () => {
    const email = rentalConfirmationEmail({
      tenantName: 'Undercover Dance Party',
      customerName: 'Pat',
      bookingNumber: 'B-0003',
      eventDate: '2026-07-11',
      dispatchDate: '2026-07-10',
      returnDate: '2026-07-12',
      fulfillment: 'delivery',
      address: '123 Main St, Waukesha',
      items: [
        { name: 'Headphones', quantity: 50 },
        { name: 'Transmitter', quantity: 1 },
      ],
      balanceDueOn: '2026-07-03',
      usageInstructions: 'Charge headphones overnight.',
    });
    expect(email.subject).toBe('Rental confirmed: B-0003');
    for (const part of [
      'B-0003',
      'Saturday, July 11, 2026',
      'Delivery date: Friday, July 10, 2026',
      'Return date: Sunday, July 12, 2026',
      '123 Main St, Waukesha',
      '50 × Headphones',
      '1 × Transmitter',
      'Friday, July 3, 2026',
      'Charge headphones overnight.',
    ]) {
      expect(email.text).toContain(part);
    }
    expect(email.html).toContain('50 × Headphones');
  });
});

describe('mail outbox', () => {
  const sample = { subject: 'Hello', text: 'Body', html: '<p>Body</p>' };
  const config = (env: Record<string, string> = {}) =>
    loadConfig({ NODE_ENV: 'test', MAIL_FROM: 'UDP <hi@udp.test>', ...env });

  function setup(transport?: MailTransport) {
    const { db } = createTestDb();
    const { tenantId } = createTenant(db);
    const mailer = createMailer(config(), transport);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const scheduler = new Scheduler(db, { baseDelayMs: 0 }).register(
      SEND_EMAIL_JOB,
      sendEmailHandler(db, mailer, logger),
    );
    return { db, tenantId, mailer, scheduler, logger };
  }

  it('logs instead of sending in dev mode', async () => {
    const { db, tenantId, mailer, scheduler, logger } = setup();
    expect(mailer.mode).toBe('log');
    const row = queueEmail(db, { tenantId, to: 'a@b.test', email: sample });
    expect(row.status).toBe('queued');
    await scheduler.tick();
    const after = db.select().from(outboundEmail).where(eq(outboundEmail.id, row.id)).get()!;
    expect(after.status).toBe('logged');
    expect(after.sentAt).toBeTruthy();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.test', subject: 'Hello' }),
      expect.any(String),
    );
  });

  it('sends through SMTP and retries failures', async () => {
    const sendMail = vi
      .fn<MailTransport['sendMail']>()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({});
    const { db, tenantId, scheduler } = setup({ sendMail });
    const row = queueEmail(db, {
      tenantId,
      to: 'a@b.test',
      email: sample,
      related: { type: 'quote_request', id: 'qr1' },
    });

    await scheduler.tick();
    let after = db.select().from(outboundEmail).where(eq(outboundEmail.id, row.id)).get()!;
    expect(after).toMatchObject({ status: 'queued', error: 'connection refused' });

    await scheduler.tick();
    after = db.select().from(outboundEmail).where(eq(outboundEmail.id, row.id)).get()!;
    expect(after).toMatchObject({ status: 'sent', error: null, relatedId: 'qr1' });
    expect(sendMail).toHaveBeenLastCalledWith({
      from: 'UDP <hi@udp.test>',
      to: 'a@b.test',
      subject: 'Hello',
      text: 'Body',
      html: '<p>Body</p>',
    });
    expect(db.select().from(job).all()[0]!.status).toBe('done');
  });

  it('uses SMTP when SMTP_URL is configured', () => {
    const mailer = createMailer(config({ SMTP_URL: 'smtp://user:pass@localhost:2525' }));
    expect(mailer.mode).toBe('smtp');
  });
});
