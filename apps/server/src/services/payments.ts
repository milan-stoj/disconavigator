import {
  externalPaymentSchema,
  formatBookingNumber,
  formatCents,
  lossChargeDecisionSchema,
  todayIn,
  type IsoDate,
} from '@disco/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { z } from 'zod';
import type { TenantScope } from '../db/repository.js';
import { booking, charge, contact, invoice, organization, payment, tenant } from '../db/schema.js';
import { ConflictError, ValidationError } from '../lib/errors.js';
import { nowIso } from '../lib/id.js';
import { activityFor, latestSettlement, moneySummary, settlementRequired } from './bookings.js';
import type { ServiceContext } from './context.js';
import { confirmIfDepositPaid, flatFeeDueDate, rentalBalanceDueDate } from './invoicing.js';
import { getSettingsRow } from './settings.js';

type BookingRow = typeof booking.$inferSelect;

export function recordExternalPayment(
  ctx: ServiceContext,
  bookingId: string,
  input: z.output<typeof externalPaymentSchema>,
) {
  const row = ctx.scope.transaction((scope) => {
    const b = scope.get(booking, bookingId, 'Booking');
    const p = scope.insert(payment, {
      bookingId,
      source: 'external',
      method: input.method,
      amountCents: input.amountCents,
      receivedOn: input.receivedOn,
      note: input.note ?? null,
      userId: ctx.userId,
    });
    activityFor(scope, b, ctx.userId)(
      'payment_recorded',
      `${input.method[0]!.toUpperCase()}${input.method.slice(1)} payment of ${formatCents(input.amountCents)} recorded`,
      { paymentId: p.id, amountCents: input.amountCents, method: input.method },
    );
    return p;
  });
  confirmIfDepositPaid(ctx.scope, bookingId);
  return row;
}

/**
 * Approves (optionally adjusting the amount) or waives a proposed loss/damage charge.
 * Returns true when an approved charge should be collected through Square.
 */
export function decideCharge(
  ctx: ServiceContext,
  bookingId: string,
  chargeId: string,
  input: z.output<typeof lossChargeDecisionSchema>,
) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, bookingId, 'Booking');
    const c = scope.get(charge, chargeId, 'Charge');
    if (c.bookingId !== b.id) throw new ValidationError('That charge belongs to another booking');
    if (c.status !== 'proposed') {
      throw new ConflictError(`This charge has already been ${c.status}`);
    }
    const log = activityFor(scope, b, ctx.userId);
    const decided = { decidedBy: ctx.userId, decidedAt: nowIso() };
    if (input.action === 'waive') {
      scope.update(charge, c.id, { ...decided, status: 'waived', reason: input.reason! });
      log(
        'charge_waived',
        `Loss charge of ${formatCents(c.proposedCents)} waived: ${input.reason}`,
        {
          chargeId: c.id,
          reason: input.reason,
        },
      );
      return false;
    }
    const amount = input.amountCents ?? c.proposedCents;
    if (amount <= 0) {
      throw new ValidationError('Enter an amount greater than zero, or waive the charge', {
        fieldErrors: { amountCents: 'Enter an amount greater than zero' },
      });
    }
    scope.update(charge, c.id, {
      ...decided,
      status: 'approved',
      amountCents: amount,
      reason: input.reason ?? null,
    });
    log(
      'charge_approved',
      amount === c.proposedCents
        ? `Loss charge of ${formatCents(amount)} approved`
        : `Loss charge adjusted from ${formatCents(c.proposedCents)} to ${formatCents(amount)} and approved`,
      { chargeId: c.id, amountCents: amount, proposedCents: c.proposedCents },
    );
    return true;
  });
}

// ---------- Money owed ----------

function localDate(iso: string, timeZone: string): IsoDate {
  return todayIn(timeZone, new Date(iso));
}

/**
 * When the unpaid part of the balance is due, from the booking's payment schedule: deposit
 * and balance (or flat fee, or settlement), then approved charges.
 */
export function balanceDueDate(
  scope: TenantScope,
  b: BookingRow,
  paidCents: number,
  timeZone: string,
) {
  const s = getSettingsRow(scope.db, scope.tenantId);
  const schedule: { due: IsoDate; amount: number }[] = [];
  if (settlementRequired(b)) {
    const settled = latestSettlement(scope, b.id);
    if (settled)
      schedule.push({ due: localDate(settled.createdAt, timeZone), amount: settled.amountCents });
  } else if (b.bookingType === 'equipment_rental') {
    if (b.depositCents > 0) {
      schedule.push({ due: localDate(b.createdAt, timeZone), amount: b.depositCents });
    }
    schedule.push({
      due: rentalBalanceDueDate(b, s.rentalBalanceDueDays),
      amount: (b.totalCents ?? 0) - b.depositCents,
    });
  } else {
    schedule.push({
      due: flatFeeDueDate(b, s.fullServiceInvoiceDueOffsetDays),
      amount: b.totalCents ?? 0,
    });
  }
  const charges = scope
    .list(charge, { where: eq(charge.bookingId, b.id) })
    .filter((c) => ['approved', 'charged', 'invoiced'].includes(c.status))
    .sort((x, y) => (x.decidedAt ?? x.createdAt).localeCompare(y.decidedAt ?? y.createdAt));
  for (const c of charges) {
    schedule.push({
      due: localDate(c.decidedAt ?? c.createdAt, timeZone),
      amount: c.amountCents ?? c.proposedCents,
    });
  }
  // Payments cover the schedule in order; the earliest date among what is still unpaid wins
  // (a past-dated rental's balance can fall due before its deposit).
  let cumulative = 0;
  let earliest: IsoDate | null = null;
  for (const item of schedule) {
    cumulative += item.amount;
    if (cumulative > paidCents && (!earliest || item.due < earliest)) earliest = item.due;
  }
  return earliest ?? schedule.at(-1)?.due ?? b.startDate;
}

export function listMoneyOwed(scope: TenantScope) {
  const timeZone =
    scope.db.select().from(tenant).where(eq(tenant.id, scope.tenantId)).get()?.timeZone ??
    'America/Chicago';
  const today = todayIn(timeZone);
  const rows = scope.db
    .select({ b: booking, organizationName: organization.name, contactName: contact.name })
    .from(booking)
    .leftJoin(organization, eq(organization.id, booking.organizationId))
    .leftJoin(contact, eq(contact.id, booking.contactId))
    .where(scope.ownedBy(booking.tenantId, ne(booking.status, 'cancelled')))
    .all();
  const owed = [];
  for (const { b, organizationName, contactName } of rows) {
    const money = moneySummary(scope, b);
    if (money.balanceCents == null || money.balanceCents <= 0) continue;
    const dueDate = balanceDueDate(scope, b, money.paidCents, timeZone);
    const openInvoice = scope
      .list(invoice, {
        where: and(eq(invoice.bookingId, b.id), ne(invoice.status, 'cancelled')),
        orderBy: [{ column: invoice.createdAt, direction: 'desc' }],
      })
      .find((i) => i.publicUrl && (i.status === 'published' || i.status === 'partially_paid'));
    owed.push({
      id: b.id,
      numberLabel: formatBookingNumber(b.number),
      title: b.title,
      bookingType: b.bookingType,
      status: b.status,
      startDate: b.startDate,
      customerName: organizationName ?? contactName ?? null,
      owedCents: money.owedCents!,
      paidCents: money.paidCents,
      balanceCents: money.balanceCents,
      dueDate,
      overdue: dueDate < today,
      invoiceUrl: openInvoice?.publicUrl ?? null,
      needsInvoice: b.needsInvoice,
      invoiceError: b.invoiceError,
    });
  }
  return owed.sort((x, y) => x.dueDate.localeCompare(y.dueDate) || y.balanceCents - x.balanceCents);
}
