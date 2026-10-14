import { bookingPolicy, formatCents, type BookingType } from '@disco/shared';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Formats a YYYY-MM-DD date as e.g. "Friday, July 10, 2026" without time zone shifts. */
export function longDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

type Row = [label: string, value: string | number | null | undefined];

interface Layout {
  tenantName: string;
  heading: string;
  intro: string[];
  rows?: Row[];
  action?: { label: string; url: string };
  sections?: { title: string; body: string }[];
}

function render(subject: string, layout: Layout): RenderedEmail {
  const rows = (layout.rows ?? []).filter(([, v]) => v != null && v !== '');
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#18181b">
<table role="presentation" width="100%" style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">
<tr><td>
<p style="margin:0 0 4px;font-size:13px;color:#71717a">${escapeHtml(layout.tenantName)}</p>
<h1 style="margin:0 0 16px;font-size:20px">${escapeHtml(layout.heading)}</h1>
${layout.intro.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(p)}</p>`).join('\n')}
${
  rows.length
    ? `<table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0 16px">${rows
        .map(
          ([k, v]) =>
            `<tr><th align="left" style="padding:6px 8px 6px 0;font-weight:600;font-size:14px;vertical-align:top;white-space:nowrap">${escapeHtml(k)}</th><td style="padding:6px 0;font-size:14px;white-space:pre-wrap">${escapeHtml(String(v))}</td></tr>`,
        )
        .join('')}</table>`
    : ''
}
${(layout.sections ?? [])
  .map(
    (s) =>
      `<h2 style="margin:16px 0 8px;font-size:16px">${escapeHtml(s.title)}</h2><p style="margin:0 0 12px;line-height:1.5;white-space:pre-wrap">${escapeHtml(s.body)}</p>`,
  )
  .join('\n')}
${
  layout.action
    ? `<p style="margin:20px 0"><a href="${escapeHtml(layout.action.url)}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:600">${escapeHtml(layout.action.label)}</a></p>`
    : ''
}
</td></tr></table></body></html>`;
  const text = [
    layout.heading,
    '',
    ...layout.intro.flatMap((p) => [p, '']),
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(rows.length ? [''] : []),
    ...(layout.sections ?? []).flatMap((s) => [s.title, s.body, '']),
    ...(layout.action ? [`${layout.action.label}: ${layout.action.url}`, ''] : []),
    `— ${layout.tenantName}`,
  ].join('\n');
  return { subject, html, text };
}

export interface NewRequestEmailInput {
  tenantName: string;
  name: string;
  email: string;
  phone?: string | null;
  organization?: string | null;
  serviceInterest: BookingType;
  eventDate: string;
  expectedAttendance: number;
  location: string;
  message?: string | null;
  opportunityUrl: string;
}

export function newRequestEmail(i: NewRequestEmailInput): RenderedEmail {
  const who = i.organization ? `${i.name} (${i.organization})` : i.name;
  return render(`New quote request from ${who}`, {
    tenantName: i.tenantName,
    heading: 'New quote request',
    intro: [`${who} asked for a quote. Reply within a day to keep the lead warm.`],
    rows: [
      ['Name', i.name],
      ['Email', i.email],
      ['Phone', i.phone],
      ['Organization', i.organization],
      ['Service', bookingPolicy(i.serviceInterest).label],
      ['Event date', longDate(i.eventDate)],
      ['Expected attendance', i.expectedAttendance],
      ['Location', i.location],
      ['Message', i.message],
    ],
    action: { label: 'Open in Disco Controller', url: i.opportunityUrl },
  });
}

export interface QuoteSentEmailInput {
  tenantName: string;
  customerName: string;
  quoteNumber: string;
  bookingType: BookingType;
  eventDate: string;
  /** Quote total in cents, or null when pricing is a door split. */
  totalCents: number | null;
  pricingSummary?: string | null;
  depositCents?: number | null;
  expiresOn: string;
  quoteUrl: string;
}

export function quoteSentEmail(i: QuoteSentEmailInput): RenderedEmail {
  return render(`Your quote ${i.quoteNumber} from ${i.tenantName}`, {
    tenantName: i.tenantName,
    heading: `Quote ${i.quoteNumber}`,
    intro: [
      `Hi ${i.customerName},`,
      `Thanks for thinking of us. Your quote is ready to review and accept online.`,
    ],
    rows: [
      ['Service', bookingPolicy(i.bookingType).label],
      ['Event date', longDate(i.eventDate)],
      ['Total', i.totalCents != null ? formatCents(i.totalCents) : null],
      ['Pricing', i.pricingSummary],
      ['Holding deposit', i.depositCents ? formatCents(i.depositCents) : null],
      ['Valid until', longDate(i.expiresOn)],
    ],
    action: { label: 'Review and accept quote', url: i.quoteUrl },
  });
}

export interface RentalConfirmationEmailInput {
  tenantName: string;
  customerName: string;
  bookingNumber: string;
  eventDate?: string | null;
  dispatchDate: string;
  dispatchTime?: string | null;
  returnDate: string;
  returnTime?: string | null;
  fulfillment: 'pickup' | 'delivery';
  address?: string | null;
  items: { name: string; quantity: number }[];
  balanceDueOn?: string | null;
  usageInstructions?: string | null;
  customerInstructions?: string | null;
  /** False when an admin confirmed the rental before the deposit arrived. */
  depositReceived?: boolean;
}

/** Formats HH:MM as e.g. "3:30 PM". */
export function clockTime(time: string): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

const dateAndTime = (date: string, time?: string | null) =>
  time ? `${longDate(date)} at ${clockTime(time)}` : longDate(date);

export function rentalConfirmationEmail(i: RentalConfirmationEmailInput): RenderedEmail {
  const handoff = i.fulfillment === 'delivery' ? 'Delivery' : 'Pickup';
  const sections = [
    {
      title: 'Equipment',
      body: i.items.map((it) => `${it.quantity} × ${it.name}`).join('\n'),
    },
  ];
  if (i.customerInstructions?.trim()) {
    sections.push({ title: 'Notes for your rental', body: i.customerInstructions.trim() });
  }
  if (i.usageInstructions?.trim()) {
    sections.push({ title: 'How to use the equipment', body: i.usageInstructions.trim() });
  }
  return render(`Rental confirmed: ${i.bookingNumber}`, {
    tenantName: i.tenantName,
    heading: 'Your rental is confirmed',
    intro: [
      `Hi ${i.customerName},`,
      i.depositReceived === false
        ? `Your rental is confirmed. You're all set.`
        : `We received your holding deposit. You're all set.`,
    ],
    rows: [
      ['Booking', i.bookingNumber],
      ['Event date', i.eventDate ? longDate(i.eventDate) : null],
      [`${handoff} date`, dateAndTime(i.dispatchDate, i.dispatchTime)],
      ['Return date', dateAndTime(i.returnDate, i.returnTime)],
      [i.fulfillment === 'delivery' ? 'Delivery address' : 'Pickup address', i.address],
      ['Balance due', i.balanceDueOn ? longDate(i.balanceDueOn) : null],
    ],
    sections,
  });
}
