import { addDays, formatBookingNumber, todayIn } from '@disco/shared';
import { asc, eq } from 'drizzle-orm';
import type { TenantScope } from '../db/repository.js';
import { booking, charge, contact, organization, tenant } from '../db/schema.js';
import { listBookings } from './bookings.js';
import { listMoneyOwed } from './payments.js';

/** Days ahead the "upcoming bookings" widget covers, including today. */
export const UPCOMING_DAYS = 14;

export function getDashboard(scope: TenantScope) {
  const timeZone =
    scope.db.select().from(tenant).where(eq(tenant.id, scope.tenantId)).get()?.timeZone ??
    'America/Chicago';
  const today = todayIn(timeZone);
  const summary = (b: ReturnType<typeof listBookings>[number]) => ({
    id: b.id,
    numberLabel: b.numberLabel,
    title: b.title,
    bookingType: b.bookingType,
    status: b.status,
    startDate: b.startDate,
    endDate: b.endDate,
    startTime: b.startTime,
    customerName: b.organizationName ?? b.contactName ?? null,
  });

  const upcoming = listBookings(scope, {
    status: 'open',
    from: today,
    to: addDays(today, UPCOMING_DAYS - 1),
  })
    .filter((b) => b.startDate >= today && b.status !== 'returned')
    .map(summary);

  const overdueReturns = listBookings(scope, { status: 'out' })
    .filter((b) => b.overdueAt)
    .map((b) => ({ ...summary(b), returnTime: b.returnTime, overdueAt: b.overdueAt! }));

  const owed = listMoneyOwed(scope);
  const overdueOwed = owed.filter((r) => r.overdue);
  const moneyOwed = {
    totalCents: owed.reduce((s, r) => s + r.balanceCents, 0),
    count: owed.length,
    overdueCents: overdueOwed.reduce((s, r) => s + r.balanceCents, 0),
    overdueCount: overdueOwed.length,
  };

  const pendingCharges = scope.db
    .select({
      id: charge.id,
      bookingId: booking.id,
      number: booking.number,
      title: booking.title,
      kind: charge.kind,
      proposedCents: charge.proposedCents,
      createdAt: charge.createdAt,
      organizationName: organization.name,
      contactName: contact.name,
    })
    .from(charge)
    .innerJoin(booking, eq(booking.id, charge.bookingId))
    .leftJoin(organization, eq(organization.id, booking.organizationId))
    .leftJoin(contact, eq(contact.id, booking.contactId))
    .where(scope.ownedBy(charge.tenantId, eq(charge.status, 'proposed')))
    .orderBy(asc(charge.createdAt))
    .all()
    .map(({ number, organizationName, contactName, ...c }) => ({
      ...c,
      numberLabel: formatBookingNumber(number),
      customerName: organizationName ?? contactName ?? null,
    }));

  return { today, upcoming, overdueReturns, moneyOwed, pendingCharges };
}
