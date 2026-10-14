import { addDays, formatBookingNumber, formatCents, sumCents, todayIn } from '@disco/shared';
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { TenantScope } from '../db/repository.js';
import {
  booking,
  charge,
  contact,
  invoice,
  payment,
  quoteLine,
  tenant,
  tenantSettings,
  webhookEvent,
} from '../db/schema.js';
import { nowIso } from '../lib/id.js';
import { activityFor, confirmBooking, latestSettlement, settlementRequired } from './bookings.js';
import type { JobRow } from './jobs.js';
import { getSettingsRow } from './settings.js';
import {
  SquareDeclinedError,
  localInvoiceStatus,
  type SquarePaymentRequest,
} from './square/gateway.js';
import { squareSession, type SquareDeps, type SquareSession } from './square/connection.js';

type BookingRow = typeof booking.$inferSelect;
type InvoiceRow = typeof invoice.$inferSelect;
type InvoiceKind = InvoiceRow['kind'];

const OPEN_STATUSES = ['published', 'partially_paid'] as const;

function tenantTimeZone(scope: TenantScope) {
  return (
    scope.db.select().from(tenant).where(eq(tenant.id, scope.tenantId)).get()?.timeZone ??
    'America/Chicago'
  );
}

const later = (a: string, b: string) => (a > b ? a : b);

export function paidCentsOf(scope: TenantScope, bookingId: string) {
  return sumCents(
    scope.list(payment, { where: eq(payment.bookingId, bookingId) }).map((p) => p.amountCents),
  );
}

// ---------- What to invoice ----------

interface InvoiceSpec {
  kind: InvoiceKind;
  amountCents: number;
  depositCents: number;
  depositDueDate: string | null;
  dueDate: string;
  chargeId: string | null;
  lines: { name: string; quantity: number; unitCents: number }[];
  storeCard: boolean;
}

/** Contractual due dates; Square invoices clamp them to today. */
export function rentalBalanceDueDate(b: Pick<BookingRow, 'startDate'>, balanceDueDays: number) {
  return addDays(b.startDate, -balanceDueDays);
}

export function flatFeeDueDate(b: Pick<BookingRow, 'startDate'>, offsetDays: number) {
  return addDays(b.startDate, offsetDays);
}

function quoteLinesFor(scope: TenantScope, b: BookingRow, total: number) {
  if (b.revisionId) {
    const lines = scope
      .list(quoteLine, {
        where: eq(quoteLine.revisionId, b.revisionId),
        orderBy: [{ column: quoteLine.position }],
      })
      .map((l) => ({ name: l.description, quantity: l.quantity, unitCents: l.unitPriceCents }))
      .filter((l) => l.quantity > 0);
    if (lines.length > 0 && sumCents(lines.map((l) => l.quantity * l.unitCents)) === total) {
      return lines;
    }
  }
  return [{ name: b.title, quantity: 1, unitCents: total }];
}

/**
 * Decides which invoice a booking needs now: the rental deposit/balance invoice, the flat
 * fee invoice, or the settlement balance. Returns null when nothing should be invoiced.
 */
function bookingInvoiceSpec(scope: TenantScope, b: BookingRow, today: string): InvoiceSpec | null {
  const s = getSettingsRow(scope.db, scope.tenantId);
  const label = formatBookingNumber(b.number);
  if (settlementRequired(b)) {
    const settled = latestSettlement(scope, b.id);
    if (!settled) return null;
    const amount = settled.amountCents - paidCentsOf(scope, b.id);
    if (amount <= 0) return null;
    return {
      kind: 'settlement',
      amountCents: amount,
      depositCents: 0,
      depositDueDate: null,
      dueDate: today,
      chargeId: null,
      lines: [
        { name: `Door split settlement — ${b.title} (${label})`, quantity: 1, unitCents: amount },
      ],
      storeCard: false,
    };
  }
  const total = b.totalCents ?? 0;
  if (total <= 0) return null;
  if (b.bookingType === 'equipment_rental') {
    const deposit = b.depositCents > 0 && b.depositCents < total ? b.depositCents : 0;
    return {
      kind: 'rental',
      amountCents: total,
      depositCents: deposit,
      depositDueDate: deposit ? today : null,
      dueDate: later(today, rentalBalanceDueDate(b, s.rentalBalanceDueDays)),
      chargeId: null,
      lines: quoteLinesFor(scope, b, total),
      storeCard: true,
    };
  }
  return {
    kind: 'full_service',
    amountCents: total,
    depositCents: 0,
    depositDueDate: null,
    dueDate: later(today, flatFeeDueDate(b, s.fullServiceInvoiceDueOffsetDays)),
    chargeId: null,
    lines: quoteLinesFor(scope, b, total),
    storeCard: false,
  };
}

function lossInvoiceSpec(b: BookingRow, c: typeof charge.$inferSelect, today: string): InvoiceSpec {
  const amount = c.amountCents ?? c.proposedCents;
  return {
    kind: 'loss',
    amountCents: amount,
    depositCents: 0,
    depositDueDate: null,
    dueDate: today,
    chargeId: c.id,
    lines: [
      {
        name: `Lost or damaged equipment — ${b.title} (${formatBookingNumber(b.number)})`,
        quantity: 1,
        unitCents: amount,
      },
    ],
    storeCard: false,
  };
}

/** Finds the local invoice row for a spec, or creates a pending one. */
function localInvoiceFor(scope: TenantScope, b: BookingRow, spec: InvoiceSpec): InvoiceRow {
  const existing = scope.list(invoice, {
    where: and(
      eq(invoice.bookingId, b.id),
      eq(invoice.kind, spec.kind),
      ne(invoice.status, 'cancelled'),
      spec.chargeId ? eq(invoice.chargeId, spec.chargeId) : undefined,
    ),
    orderBy: [{ column: invoice.createdAt, direction: 'desc' }],
  });
  const unpublished = existing.find((i) => i.status === 'pending' || i.status === 'failed');
  if (unpublished) {
    if (unpublished.amountCents === spec.amountCents) return unpublished;
    // A settlement was corrected before its invoice went out: start over.
    scope.update(invoice, unpublished.id, { status: 'cancelled' });
  } else if (existing.length > 0 && spec.kind !== 'settlement') {
    return existing[0]!;
  }
  return scope.insert(invoice, {
    bookingId: b.id,
    chargeId: spec.chargeId,
    kind: spec.kind,
    status: 'pending',
    amountCents: spec.amountCents,
    depositCents: spec.depositCents,
    depositDueDate: spec.depositDueDate,
    dueDate: spec.dueDate,
  });
}

// ---------- Square customers ----------

async function ensureCustomer(scope: TenantScope, session: SquareSession, b: BookingRow) {
  const person = b.contactId ? scope.find(contact, b.contactId) : undefined;
  if (!person) throw new Error('The booking has no contact to send the invoice to');
  if (person.squareCustomerId) return { customerId: person.squareCustomerId, email: person.email };
  let customerId = person.email ? await session.gateway.findCustomerByEmail(person.email) : null;
  customerId ??= await session.gateway.createCustomer({
    name: person.name,
    email: person.email,
    phone: person.phone,
    idempotencyKey: `customer:${person.id}`,
  });
  scope.update(contact, person.id, { squareCustomerId: customerId });
  return { customerId, email: person.email };
}

// ---------- Publishing ----------

/** Creates (if needed) and publishes the Square invoice behind a local invoice row. */
async function publish(
  scope: TenantScope,
  session: SquareSession,
  b: BookingRow,
  inv: InvoiceRow,
  spec: InvoiceSpec,
): Promise<InvoiceRow> {
  if (inv.status !== 'pending' && inv.status !== 'failed') return inv;
  const gw = session.gateway;
  const { customerId, email } = await ensureCustomer(scope, session, b);
  let squareId = inv.squareInvoiceId;
  if (!squareId) {
    const requests: SquarePaymentRequest[] = inv.depositCents
      ? [
          { type: 'DEPOSIT', amountCents: inv.depositCents, dueDate: inv.depositDueDate! },
          { type: 'BALANCE', dueDate: inv.dueDate },
        ]
      : [{ type: 'BALANCE', dueDate: inv.dueDate }];
    const created = await gw.createInvoice({
      locationId: session.locationId,
      customerId,
      title: `${b.title} (${formatBookingNumber(b.number)})`,
      referenceId: formatBookingNumber(b.number),
      lineItems: spec.lines,
      paymentRequests: requests,
      storeCard: spec.storeCard,
      deliverByEmail: !!email,
      idempotencyKey: inv.id,
    });
    squareId = created.invoiceId;
    scope.update(invoice, inv.id, {
      squareInvoiceId: squareId,
      squareOrderId: created.orderId,
      squareVersion: created.version,
    });
  }
  const current = await gw.getInvoice(squareId);
  const state =
    current.status === 'DRAFT'
      ? await gw.publishInvoice({
          invoiceId: squareId,
          version: current.version,
          idempotencyKey: `${inv.id}:publish`,
        })
      : current;
  const updated = scope.update(invoice, inv.id, {
    status: localInvoiceStatus(state.status),
    squareVersion: state.version,
    publicUrl: state.publicUrl,
    lastError: null,
  });
  activityFor(scope, b, null)(
    'invoice_published',
    `${KIND_LABELS[spec.kind]} invoice for ${formatCents(spec.amountCents)} published in Square`,
    { invoiceId: inv.id, squareInvoiceId: squareId, amountCents: spec.amountCents },
  );
  return updated;
}

const KIND_LABELS: Record<InvoiceKind, string> = {
  rental: 'Rental',
  full_service: 'Flat fee',
  settlement: 'Settlement',
  loss: 'Loss charge',
};

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Job handler: creates and publishes the invoice a booking needs. When Square is not
 * connected the booking stays marked as needing an invoice (retried once connected); when
 * Square fails the error is recorded and the job is retried with backoff.
 */
export function createInvoiceHandler(deps: SquareDeps) {
  return async (job: JobRow) => {
    const { bookingId, settlementId } = job.payload as { bookingId: string; settlementId?: string };
    const scope = new TenantScope(deps.db, job.tenantId!);
    const b = scope.find(booking, bookingId);
    if (!b || !b.needsInvoice) return;
    if (b.status === 'cancelled') {
      scope.update(booking, b.id, { needsInvoice: false, invoiceError: null });
      return;
    }
    if (settlementId && latestSettlement(scope, b.id)?.id !== settlementId) return; // superseded
    const spec = bookingInvoiceSpec(scope, b, todayIn(tenantTimeZone(scope)));
    if (!spec) {
      if (!settlementRequired(b) || latestSettlement(scope, b.id)) {
        scope.update(booking, b.id, { needsInvoice: false, invoiceError: null });
      }
      return;
    }
    const session = squareSession(deps, scope.tenantId);
    if (!session) {
      scope.update(booking, b.id, {
        invoiceError: 'Square is not connected; the invoice will be created once it is',
      });
      return;
    }
    const inv = localInvoiceFor(scope, b, spec);
    try {
      await publish(scope, session, b, inv, spec);
      scope.update(booking, b.id, { needsInvoice: false, invoiceError: null });
    } catch (err) {
      const message = errorMessage(err);
      scope.update(invoice, inv.id, { lastError: message });
      scope.update(booking, b.id, { invoiceError: message });
      throw err;
    }
  };
}

// ---------- Payment sync ----------

/** Confirms an equipment rental once its holding deposit has been paid. */
export function confirmIfDepositPaid(scope: TenantScope, bookingId: string) {
  const b = scope.find(booking, bookingId);
  if (!b || b.status !== 'awaiting_deposit') return;
  if (paidCentsOf(scope, b.id) >= b.depositCents) {
    confirmBooking({ scope, userId: null }, b.id, { via: 'deposit' });
  }
}

/** Pulls an invoice's status and payments from Square and records anything new. */
export async function syncInvoice(scope: TenantScope, session: SquareSession, inv: InvoiceRow) {
  if (!inv.squareInvoiceId) return inv;
  const state = await session.gateway.getInvoice(inv.squareInvoiceId);
  const tz = tenantTimeZone(scope);
  const updated = scope.transaction((tx) => {
    const b = tx.get(booking, inv.bookingId, 'Booking');
    const ids = state.payments.map((p) => p.id);
    const known = new Set(
      ids.length
        ? tx
            .list(payment, { where: inArray(payment.squarePaymentId, ids) })
            .map((p) => p.squarePaymentId)
        : [],
    );
    const fresh = state.payments.filter((p) => !known.has(p.id));
    for (const p of fresh) {
      tx.insert(payment, {
        bookingId: inv.bookingId,
        invoiceId: inv.id,
        source: 'square',
        method: p.method,
        amountCents: p.amountCents,
        receivedOn: todayIn(tz, new Date(p.createdAt)),
        squarePaymentId: p.id,
      });
      activityFor(tx, b, null)(
        'payment_received',
        `Square payment of ${formatCents(p.amountCents)} received`,
        { invoiceId: inv.id, squarePaymentId: p.id, amountCents: p.amountCents },
      );
    }
    return tx.update(invoice, inv.id, {
      status: localInvoiceStatus(state.status),
      paidCents: state.paidCents,
      squareVersion: state.version,
      publicUrl: state.publicUrl ?? inv.publicUrl,
    });
  });
  confirmIfDepositPaid(scope, inv.bookingId);
  return updated;
}

/** Job handler for webhook notifications: syncs the invoice the event refers to. */
export function syncInvoiceHandler(deps: SquareDeps) {
  return async (job: JobRow) => {
    const { squareInvoiceId, squareOrderId, eventId } = job.payload as {
      squareInvoiceId?: string;
      squareOrderId?: string;
      eventId?: string;
    };
    const scope = new TenantScope(deps.db, job.tenantId!);
    const inv = squareInvoiceId
      ? scope.first(invoice, eq(invoice.squareInvoiceId, squareInvoiceId))
      : squareOrderId
        ? scope.first(invoice, eq(invoice.squareOrderId, squareOrderId))
        : undefined;
    const session = inv ? squareSession(deps, scope.tenantId) : null;
    if (inv && session) await syncInvoice(scope, session, inv);
    if (eventId) {
      deps.db
        .update(webhookEvent)
        .set({ processedAt: nowIso() })
        .where(eq(webhookEvent.eventId, eventId))
        .run();
    }
  };
}

/** Fallback for missed webhooks: re-checks every open Square invoice. */
export async function reconcileSquare(
  deps: SquareDeps,
  log?: { warn: (o: object, m: string) => void },
) {
  const tenants = deps.db
    .select({ tenantId: tenantSettings.tenantId })
    .from(tenantSettings)
    .where(
      and(
        isNotNull(tenantSettings.squareAccessTokenEnc),
        isNotNull(tenantSettings.squareLocationId),
      ),
    )
    .all();
  let synced = 0;
  for (const { tenantId } of tenants) {
    const session = squareSession(deps, tenantId);
    if (!session) continue;
    const scope = new TenantScope(deps.db, tenantId);
    const open = scope.list(invoice, {
      where: and(isNotNull(invoice.squareInvoiceId), inArray(invoice.status, [...OPEN_STATUSES])),
    });
    for (const inv of open) {
      try {
        await syncInvoice(scope, session, inv);
        synced++;
      } catch (err) {
        log?.warn({ err: errorMessage(err), invoiceId: inv.id }, 'square reconciliation failed');
      }
    }
  }
  return synced;
}

// ---------- Loss charges ----------

/**
 * Job handler: collects an approved loss charge by charging the customer's saved Square
 * card, or by publishing a Square invoice when no card is saved or the card is declined.
 */
export function collectChargeHandler(deps: SquareDeps) {
  return async (job: JobRow) => {
    const { chargeId } = job.payload as { chargeId: string };
    const scope = new TenantScope(deps.db, job.tenantId!);
    const c = scope.find(charge, chargeId);
    if (!c || c.status !== 'approved') return;
    const session = squareSession(deps, scope.tenantId);
    if (!session) return; // stays approved; collected once Square is connected
    const b = scope.get(booking, c.bookingId, 'Booking');
    const amount = c.amountCents ?? c.proposedCents;
    const log = activityFor(scope, b, null);
    const priorInvoice = scope.first(
      invoice,
      and(eq(invoice.chargeId, c.id), ne(invoice.status, 'cancelled')),
    );
    if (!priorInvoice) {
      const { customerId } = await ensureCustomer(scope, session, b);
      const cards = await session.gateway.listCards(customerId);
      const card = cards[0];
      if (card) {
        try {
          const paid = await session.gateway.chargeCard({
            locationId: session.locationId,
            customerId,
            cardId: card.id,
            amountCents: amount,
            note: `Loss charge for ${b.title} (${formatBookingNumber(b.number)})`,
            idempotencyKey: c.id,
          });
          scope.transaction((tx) => {
            tx.insert(payment, {
              bookingId: b.id,
              source: 'square',
              method: 'card',
              amountCents: paid.amountCents,
              receivedOn: todayIn(tenantTimeZone(tx), new Date(paid.createdAt)),
              squarePaymentId: paid.id,
              note: 'Loss charge on saved card',
            });
            tx.update(charge, c.id, { status: 'charged', squarePaymentId: paid.id });
            activityFor(tx, b, null)(
              'charge_collected',
              `Charged ${formatCents(paid.amountCents)} to ${card.label}`,
              { chargeId: c.id, squarePaymentId: paid.id },
            );
          });
          return;
        } catch (err) {
          if (!(err instanceof SquareDeclinedError)) throw err;
          log(
            'charge_card_declined',
            `Saved card was declined: ${err.message}; sending an invoice`,
            {
              chargeId: c.id,
            },
          );
        }
      }
    }
    const spec = lossInvoiceSpec(b, c, todayIn(tenantTimeZone(scope)));
    const inv = priorInvoice ?? localInvoiceFor(scope, b, spec);
    try {
      const published = await publish(scope, session, b, inv, spec);
      scope.update(charge, c.id, { status: 'invoiced', invoiceId: published.id });
    } catch (err) {
      scope.update(invoice, inv.id, { lastError: errorMessage(err) });
      throw err;
    }
  };
}
