import {
  acceptQuoteSchema,
  addDays,
  bookingPolicy,
  declineQuoteSchema,
  deliveryFeeLine,
  formatQuoteNumber,
  pricingSummary,
  PricingError,
  quoteFinancials,
  quoteSchema,
  requirementsFromLines,
  todayIn,
  type EquipmentRequirements,
  type QuoteFinancials,
} from '@disco/shared';
import { eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { nextNumber } from '../db/counters.js';
import { TenantScope } from '../db/repository.js';
import {
  acceptance,
  booking,
  contact,
  equipmentRequirement,
  equipmentType,
  opportunity,
  organization,
  quote,
  quoteLine,
  quoteRevision,
  tenant,
} from '../db/schema.js';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../lib/errors.js';
import { nowIso, randomToken, uuidv7 } from '../lib/id.js';
import { parse } from '../lib/validation.js';
import { recordActivity } from './activity.js';
import { checkPlannedHolds } from './availability.js';
import type { ServiceContext } from './context.js';
import { quoteSentEmail } from './email-templates.js';
import { requireQuotablePackage, type PackageView } from './inventory.js';
import { enqueueJob } from './jobs.js';
import { queueEmail } from './mail.js';
import { changeStage } from './opportunities.js';
import { getSettingsRow } from './settings.js';

export const CREATE_INVOICE_JOB = 'invoice.create';

type QuoteInput = z.output<typeof quoteSchema>;
type RevisionRow = typeof quoteRevision.$inferSelect;
type LineRow = typeof quoteLine.$inferSelect;
type QuoteRow = typeof quote.$inferSelect;

interface PreparedRevision {
  values: Omit<typeof quoteRevision.$inferInsert, 'id' | 'tenantId' | 'quoteId' | 'revisionNumber'>;
  lines: QuoteInput['lines'];
}

function pricingError(err: unknown): never {
  if (err instanceof PricingError) {
    throw new ValidationError(err.message, { fieldErrors: { pricingTerm: err.message } });
  }
  throw err;
}

/** Turns validated input into revision values: lines, delivery fee, requirements, totals. */
function prepareRevision(scope: TenantScope, input: QuoteInput): PreparedRevision {
  const settings = getSettingsRow(scope.db, scope.tenantId);
  const policy = bookingPolicy(input.bookingType);
  const fieldErrors: Record<string, string> = {};

  let lines = input.lines.map((l) => ({ ...l, packageId: l.packageId ?? null }));
  if (policy.supportsDelivery) {
    if (input.insideServiceArea) {
      lines = lines.filter((l) => l.kind !== 'delivery');
    } else if (!lines.some((l) => l.kind === 'delivery')) {
      const fee = deliveryFeeLine({
        bookingType: input.bookingType,
        insideServiceArea: false,
        suggestedFeeCents: settings.deliveryFeeCents,
      });
      if (fee) lines.push({ ...fee, packageId: null });
    }
  }

  const packages: PackageView[] = [];
  lines.forEach((line, i) => {
    if (line.kind === 'package') {
      if (!policy.usesPackages) {
        fieldErrors[`lines.${i}.kind`] = 'Rental packages are only for equipment rentals';
      } else if (!line.packageId) {
        fieldErrors[`lines.${i}.packageId`] = 'Choose a package';
      } else {
        try {
          const pkg = requireQuotablePackage(scope, line.packageId);
          if (!packages.some((p) => p.id === pkg.id)) packages.push(pkg);
        } catch (err) {
          if (err instanceof AppError) {
            fieldErrors[`lines.${i}.packageId`] =
              err instanceof ValidationError ? 'This package is no longer offered' : err.message;
          } else throw err;
        }
      }
    } else if (line.kind === 'delivery' && !policy.supportsDelivery) {
      fieldErrors[`lines.${i}.kind`] = 'Delivery fees are only for equipment rentals';
    }
  });

  const typeIds = new Set(scope.list(equipmentType).map((t) => t.id));
  for (const id of Object.keys(input.requirements)) {
    if (!typeIds.has(id)) fieldErrors[`requirements.${id}`] = 'Unknown equipment';
  }

  let occurrenceDates: string[] | null = null;
  if (input.occurrenceDates && input.occurrenceDates.length > 0) {
    occurrenceDates = [...new Set(input.occurrenceDates)].sort();
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Please correct the highlighted fields', { fieldErrors });
  }

  const extra: EquipmentRequirements = {};
  for (const [id, qty] of Object.entries(input.requirements)) if (qty > 0) extra[id] = qty;
  const requirements = requirementsFromLines(lines, packages, extra);
  const depositBps = policy.requiresDeposit ? settings.rentalDepositBps : 0;
  let fin: QuoteFinancials;
  try {
    fin = quoteFinancials({
      bookingType: input.bookingType,
      pricingTerm: input.pricingTerm,
      lines,
      splitBps: input.splitBps,
      guaranteeCents: input.guaranteeCents,
      depositBps,
    });
  } catch (err) {
    pricingError(err);
  }
  const startDate = occurrenceDates ? occurrenceDates[0]! : input.startDate;
  const endDate = occurrenceDates ? occurrenceDates[occurrenceDates.length - 1]! : input.endDate;
  return {
    lines,
    values: {
      bookingType: input.bookingType,
      pricingTerm: input.pricingTerm,
      startDate,
      endDate,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      location: input.location ?? null,
      insideServiceArea: policy.supportsDelivery ? input.insideServiceArea : true,
      expectedAttendance: input.expectedAttendance ?? null,
      splitBps: input.pricingTerm === 'flat_fee' ? null : (input.splitBps ?? null),
      guaranteeCents:
        input.pricingTerm === 'guarantee_plus_split' ? (input.guaranteeCents ?? null) : null,
      depositBps,
      totalCents: fin.totalCents,
      depositCents: fin.depositCents,
      requirements,
      staffRequired: input.staffRequired ?? policy.defaultStaffRequired,
      occurrenceDates,
      notes: input.notes ?? null,
      expiresOn: input.expiresOn ?? null,
    },
  };
}

function insertLines(scope: TenantScope, revisionId: string, lines: QuoteInput['lines']) {
  lines.forEach((l, position) => {
    scope.insert(quoteLine, {
      revisionId,
      position,
      kind: l.kind,
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      packageId: l.packageId ?? null,
    });
  });
}

function linesOf(scope: TenantScope, revisionId: string): LineRow[] {
  return scope.list(quoteLine, {
    where: eq(quoteLine.revisionId, revisionId),
    orderBy: [{ column: quoteLine.position }],
  });
}

/** One planned hold per event: each occurrence of a series, or the single date range. */
export function occurrencesOf(rev: Pick<RevisionRow, 'startDate' | 'endDate' | 'occurrenceDates'>) {
  if (rev.occurrenceDates && rev.occurrenceDates.length > 0) {
    return rev.occurrenceDates.map((d) => ({ startDate: d, endDate: d }));
  }
  return [{ startDate: rev.startDate, endDate: rev.endDate }];
}

function availabilityFor(scope: TenantScope, rev: RevisionRow, label: string) {
  return checkPlannedHolds(
    scope,
    occurrencesOf(rev).map((o) => ({
      ...o,
      label,
      bookingType: rev.bookingType,
      requirements: rev.requirements,
      staffRequired: rev.staffRequired,
    })),
  );
}

function financialsOf(rev: RevisionRow) {
  return {
    totalCents: rev.totalCents,
    depositCents: rev.depositCents,
    balanceCents: rev.totalCents == null ? null : rev.totalCents - rev.depositCents,
    minimumCents: rev.pricingTerm === 'guarantee_plus_split' ? rev.guaranteeCents : null,
    finalDeterminedAfterEvent: rev.pricingTerm !== 'flat_fee',
    summary: pricingSummary(rev),
  };
}

function revisionView(scope: TenantScope, rev: RevisionRow, publicBaseUrl?: string) {
  const { publicToken, ...rest } = rev;
  return {
    ...rest,
    lines: linesOf(scope, rev.id),
    financials: financialsOf(rev),
    publicUrl:
      publicToken && !rev.tokenRevokedAt && publicBaseUrl
        ? `${publicBaseUrl}/q/${publicToken}`
        : null,
  };
}

/** Marks a sent quote expired once its current revision's expiry date has passed. */
function refreshExpiry(scope: TenantScope, q: QuoteRow, rev: RevisionRow, today: string): QuoteRow {
  if (q.status === 'sent' && rev.expiresOn && rev.expiresOn < today) {
    return scope.update(quote, q.id, { status: 'expired' });
  }
  return q;
}

export function tenantToday(db: Db, tenantId: string): string {
  const t = db.select().from(tenant).where(eq(tenant.id, tenantId)).get();
  return todayIn(t?.timeZone ?? 'America/Chicago');
}

export function getQuote(
  ctx: ServiceContext,
  id: string,
  config?: Pick<AppConfig, 'publicBaseUrl'>,
) {
  const scope = ctx.scope;
  let q = scope.get(quote, id, 'Quote');
  const revisions = scope.list(quoteRevision, {
    where: eq(quoteRevision.quoteId, id),
    orderBy: [{ column: quoteRevision.revisionNumber, direction: 'desc' }],
  });
  const current = revisions.find((r) => r.id === q.currentRevisionId) ?? revisions[0]!;
  q = refreshExpiry(scope, q, current, tenantToday(scope.db, scope.tenantId));
  const opp = scope.get(opportunity, q.opportunityId, 'Opportunity');
  const c = opp.contactId ? scope.find(contact, opp.contactId) : undefined;
  const org = opp.organizationId ? scope.find(organization, opp.organizationId) : undefined;
  const acc = scope.first(acceptance, eq(acceptance.quoteId, id));
  const bookings = scope.list(booking, {
    where: eq(booking.quoteId, id),
    orderBy: [{ column: booking.startDate }],
  });
  return {
    ...q,
    displayNumber: formatQuoteNumber(q.number),
    opportunity: { id: opp.id, title: opp.title, stage: opp.stage },
    contact: c ? { id: c.id, name: c.name, email: c.email } : null,
    organization: org ? { id: org.id, name: org.name } : null,
    current: revisionView(scope, current, config?.publicBaseUrl),
    revisions: revisions.map((r) => ({
      id: r.id,
      revisionNumber: r.revisionNumber,
      sentAt: r.sentAt,
      tokenRevokedAt: r.tokenRevokedAt,
      totalCents: r.totalCents,
      pricingTerm: r.pricingTerm,
      createdAt: r.createdAt,
    })),
    availability: availabilityFor(scope, current, opp.title),
    acceptance: acc
      ? {
          fullName: acc.fullName,
          acceptedAt: acc.acceptedAt,
          revisionId: acc.revisionId,
          ip: acc.ip,
        }
      : null,
    bookings: bookings.map((b) => ({
      id: b.id,
      number: b.number,
      status: b.status,
      startDate: b.startDate,
    })),
  };
}
export type QuoteView = ReturnType<typeof getQuote>;

export function getRevision(ctx: ServiceContext, quoteId: string, revisionId: string) {
  const rev = ctx.scope.get(quoteRevision, revisionId, 'Revision');
  if (rev.quoteId !== quoteId) throw new NotFoundError('Revision');
  return revisionView(ctx.scope, rev);
}

export function listQuotes(scope: TenantScope, filter: { opportunityId?: string } = {}) {
  const rows = scope.list(quote, {
    where: filter.opportunityId ? eq(quote.opportunityId, filter.opportunityId) : undefined,
    orderBy: [{ column: quote.number, direction: 'desc' }],
    limit: 500,
  });
  if (rows.length === 0) return [];
  const revs = new Map(
    scope
      .list(quoteRevision, {
        where: inArray(quoteRevision.id, rows.map((r) => r.currentRevisionId!).filter(Boolean)),
      })
      .map((r) => [r.id, r]),
  );
  const opps = new Map(
    scope
      .list(opportunity, {
        where: inArray(opportunity.id, [...new Set(rows.map((r) => r.opportunityId))]),
      })
      .map((o) => [o.id, o]),
  );
  const today = tenantToday(scope.db, scope.tenantId);
  return rows.map((r) => {
    const rev = revs.get(r.currentRevisionId ?? '');
    const q = rev ? refreshExpiry(scope, r, rev, today) : r;
    return {
      id: q.id,
      number: q.number,
      displayNumber: formatQuoteNumber(q.number),
      status: q.status,
      bookingType: q.bookingType,
      opportunityId: q.opportunityId,
      opportunityTitle: opps.get(q.opportunityId)?.title ?? '',
      startDate: rev?.startDate ?? null,
      endDate: rev?.endDate ?? null,
      occurrenceCount: rev?.occurrenceDates?.length ?? 0,
      pricingTerm: rev?.pricingTerm ?? 'flat_fee',
      totalCents: rev?.totalCents ?? null,
      revisionNumber: rev?.revisionNumber ?? 1,
      sentAt: q.sentAt,
      updatedAt: q.updatedAt,
    };
  });
}

export function createQuote(ctx: ServiceContext, body: unknown) {
  const input = parse(quoteSchema, body);
  return ctx.scope.transaction((scope) => {
    const opp = scope.get(opportunity, input.opportunityId, 'Opportunity');
    const prepared = prepareRevision(scope, input);
    const q = scope.insert(quote, {
      number: nextNumber(scope, 'quote'),
      opportunityId: opp.id,
      bookingType: input.bookingType,
      status: 'draft',
    });
    const rev = scope.insert(quoteRevision, {
      ...prepared.values,
      quoteId: q.id,
      revisionNumber: 1,
      createdBy: ctx.userId,
    });
    insertLines(scope, rev.id, prepared.lines);
    scope.update(quote, q.id, { currentRevisionId: rev.id });
    recordActivity(scope, {
      subjectType: 'quote',
      subjectId: q.id,
      opportunityId: opp.id,
      organizationId: opp.organizationId,
      kind: 'quote_created',
      body: `Quote ${formatQuoteNumber(q.number)} created (${bookingPolicy(input.bookingType).label})`,
      userId: ctx.userId,
    });
    return q.id;
  });
}

/**
 * Edits a quote. Unsent drafts change in place; once a revision has been sent it is frozen,
 * so edits create a new draft revision and the previous public link stops working.
 */
export function updateQuote(ctx: ServiceContext, id: string, body: unknown) {
  return ctx.scope.transaction((scope) => {
    const q = scope.get(quote, id, 'Quote');
    const input = parse(quoteSchema, { ...(body as object), opportunityId: q.opportunityId });
    if (q.status === 'accepted') {
      throw new ConflictError('Accepted quotes cannot be edited');
    }
    const current = scope.get(quoteRevision, q.currentRevisionId!, 'Revision');
    const prepared = prepareRevision(scope, input);
    if (!current.sentAt) {
      scope.update(quoteRevision, current.id, prepared.values);
      scope.db
        .delete(quoteLine)
        .where(scope.ownedBy(quoteLine.tenantId, eq(quoteLine.revisionId, current.id)))
        .run();
      insertLines(scope, current.id, prepared.lines);
      scope.update(quote, id, { bookingType: input.bookingType });
      return id;
    }
    if (!current.tokenRevokedAt) {
      scope.update(quoteRevision, current.id, { tokenRevokedAt: nowIso() });
    }
    const rev = scope.insert(quoteRevision, {
      ...prepared.values,
      quoteId: id,
      revisionNumber: current.revisionNumber + 1,
      createdBy: ctx.userId,
    });
    insertLines(scope, rev.id, prepared.lines);
    scope.update(quote, id, {
      currentRevisionId: rev.id,
      bookingType: input.bookingType,
      status: 'draft',
      declinedAt: null,
      declineReason: null,
    });
    recordActivity(scope, {
      subjectType: 'quote',
      subjectId: id,
      opportunityId: q.opportunityId,
      kind: 'quote_revised',
      body: `Quote ${formatQuoteNumber(q.number)} revised (revision ${rev.revisionNumber}); the previous link no longer works`,
      userId: ctx.userId,
    });
    return id;
  });
}

export interface SendDeps {
  db: Db;
  config: Pick<AppConfig, 'publicBaseUrl'>;
}

/** Sends (or re-sends) the current revision: public link, expiry, email, opportunity to Quoted. */
export function sendQuote(ctx: ServiceContext, deps: SendDeps, id: string) {
  return ctx.scope.transaction((scope) => {
    const q = scope.get(quote, id, 'Quote');
    if (q.status === 'accepted') throw new ConflictError('This quote has already been accepted');
    const opp = scope.get(opportunity, q.opportunityId, 'Opportunity');
    const c = opp.contactId ? scope.find(contact, opp.contactId) : undefined;
    if (!c?.email) {
      throw new ValidationError('Add a contact with an email address to the opportunity first', {
        fieldErrors: { contact: 'The opportunity needs a contact with an email address' },
      });
    }
    const settings = getSettingsRow(scope.db, scope.tenantId);
    const t = scope.db.select().from(tenant).where(eq(tenant.id, scope.tenantId)).get()!;
    const today = todayIn(t.timeZone);
    let rev = scope.get(quoteRevision, q.currentRevisionId!, 'Revision');
    const reusable =
      rev.sentAt &&
      rev.publicToken &&
      !rev.tokenRevokedAt &&
      (!rev.expiresOn || rev.expiresOn >= today);
    if (!reusable) {
      if (rev.sentAt) {
        // Expired or revoked: resend as a fresh revision with a new link.
        if (!rev.tokenRevokedAt) scope.update(quoteRevision, rev.id, { tokenRevokedAt: nowIso() });
        const lines = linesOf(scope, rev.id);
        const { id: _old, createdAt: _c, ...copy } = rev;
        rev = scope.insert(quoteRevision, {
          ...copy,
          revisionNumber: rev.revisionNumber + 1,
          publicToken: null,
          tokenRevokedAt: null,
          sentAt: null,
          expiresOn: null,
          createdBy: ctx.userId,
        });
        insertLines(scope, rev.id, lines);
      }
      const expiresOn =
        rev.expiresOn && rev.expiresOn >= today
          ? rev.expiresOn
          : addDays(today, settings.quoteValidityDays);
      rev = scope.update(quoteRevision, rev.id, {
        publicToken: randomToken(32),
        expiresOn,
        sentAt: nowIso(),
        termsText:
          rev.bookingType === 'equipment_rental' ? settings.rentalTerms : settings.fullServiceTerms,
      });
    }
    scope.update(quote, id, { status: 'sent', sentAt: nowIso(), currentRevisionId: rev.id });

    const url = `${deps.config.publicBaseUrl}/q/${rev.publicToken}`;
    queueEmail(scope.db, {
      tenantId: scope.tenantId,
      to: c.email,
      email: quoteSentEmail({
        tenantName: t.name,
        customerName: c.name,
        quoteNumber: formatQuoteNumber(q.number),
        bookingType: rev.bookingType,
        eventDate: rev.startDate,
        totalCents: rev.totalCents,
        pricingSummary: rev.pricingTerm === 'flat_fee' ? null : pricingSummary(rev),
        depositCents: rev.depositCents || null,
        expiresOn: rev.expiresOn!,
        quoteUrl: url,
      }),
      related: { type: 'quote', id },
    });
    recordActivity(scope, {
      subjectType: 'quote',
      subjectId: id,
      opportunityId: opp.id,
      organizationId: opp.organizationId,
      kind: 'quote_sent',
      body: `Quote ${formatQuoteNumber(q.number)} sent to ${c.email}`,
      data: { revisionId: rev.id, expiresOn: rev.expiresOn },
      userId: ctx.userId,
    });
    if (['new', 'contacted', 'quote_requested'].includes(opp.stage)) {
      changeStage(
        { scope, userId: ctx.userId },
        opp.id,
        { stage: 'quoted' },
        { automatic: true, reason: 'quote sent' },
      );
    }
    return { id, publicUrl: url, expiresOn: rev.expiresOn };
  });
}

/** Staff marks a quote declined (e.g. the customer said no by phone). */
export function declineQuote(ctx: ServiceContext, id: string, body: unknown) {
  const { reason } = parse(declineQuoteSchema, body ?? {});
  return ctx.scope.transaction((scope) =>
    applyDecline(scope, id, reason ?? null, ctx.userId, 'staff'),
  );
}

function applyDecline(
  scope: TenantScope,
  id: string,
  reason: string | null,
  userId: string | null,
  by: 'customer' | 'staff',
) {
  const q = scope.get(quote, id, 'Quote');
  if (q.status === 'accepted') throw new ConflictError('This quote has already been accepted');
  if (q.status === 'declined') return q;
  const updated = scope.update(quote, id, {
    status: 'declined',
    declinedAt: nowIso(),
    declineReason: reason,
  });
  const opp = scope.get(opportunity, q.opportunityId, 'Opportunity');
  if (opp.stage !== 'won' && opp.stage !== 'lost') {
    scope.update(opportunity, opp.id, { needsLossReason: true });
  }
  recordActivity(scope, {
    subjectType: 'quote',
    subjectId: id,
    opportunityId: opp.id,
    organizationId: opp.organizationId,
    kind: 'quote_declined',
    body: `Quote ${formatQuoteNumber(q.number)} declined by ${by === 'customer' ? 'the customer' : 'staff'}${reason ? `: ${reason}` : ''}`,
    userId,
  });
  return updated;
}

// ---------- Public (customer) side ----------

export type PublicQuoteState = 'open' | 'expired' | 'revoked' | 'accepted' | 'declined';

function findByToken(db: Db, token: string) {
  if (!token || token.length > 128) throw new NotFoundError('Quote');
  const rev = db.select().from(quoteRevision).where(eq(quoteRevision.publicToken, token)).get();
  if (!rev) throw new NotFoundError('Quote');
  const scope = new TenantScope(db, rev.tenantId);
  const q = scope.get(quote, rev.quoteId, 'Quote');
  return { scope, rev, q };
}

function stateOf(q: QuoteRow, rev: RevisionRow, today: string): PublicQuoteState {
  if (rev.tokenRevokedAt || q.currentRevisionId !== rev.id) {
    // An accepted revision keeps its link so the customer can see what they agreed to.
    if (q.status === 'accepted' && q.currentRevisionId === rev.id) return 'accepted';
    return 'revoked';
  }
  if (q.status === 'accepted') return 'accepted';
  if (q.status === 'declined') return 'declined';
  if (q.status === 'expired' || (rev.expiresOn && rev.expiresOn < today)) return 'expired';
  return 'open';
}

export function getPublicQuote(db: Db, token: string) {
  const { scope, rev, q: q0 } = findByToken(db, token);
  const t = db.select().from(tenant).where(eq(tenant.id, scope.tenantId)).get()!;
  const today = todayIn(t.timeZone);
  const q = refreshExpiry(scope, q0, rev, today);
  const state = stateOf(q, rev, today);
  const base = {
    state,
    tenant: { name: t.name, slug: t.slug },
    number: formatQuoteNumber(q.number),
  };
  if (state === 'revoked') return { ...base, quote: null };
  const opp = scope.get(opportunity, q.opportunityId, 'Opportunity');
  const c = opp.contactId ? scope.find(contact, opp.contactId) : undefined;
  const org = opp.organizationId ? scope.find(organization, opp.organizationId) : undefined;
  const acc = scope.first(acceptance, eq(acceptance.revisionId, rev.id));
  const policy = bookingPolicy(rev.bookingType);
  return {
    ...base,
    quote: {
      bookingType: rev.bookingType,
      bookingTypeLabel: policy.label,
      title: opp.title,
      customerName: c?.name ?? null,
      organizationName: org?.name ?? null,
      pricingTerm: rev.pricingTerm,
      startDate: rev.startDate,
      endDate: rev.endDate,
      startTime: rev.startTime,
      endTime: rev.endTime,
      location: rev.location,
      expectedAttendance: rev.expectedAttendance,
      occurrenceDates: rev.occurrenceDates,
      lines: linesOf(scope, rev.id).map((l) => ({
        kind: l.kind,
        description: l.description,
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
      })),
      splitBps: rev.splitBps,
      guaranteeCents: rev.guaranteeCents,
      depositBps: rev.depositBps,
      financials: financialsOf(rev),
      notes: rev.notes,
      termsText: rev.termsText ?? '',
      expiresOn: rev.expiresOn,
      acceptedBy: acc ? { fullName: acc.fullName, acceptedAt: acc.acceptedAt } : null,
      declinedAt: q.declinedAt,
    },
  };
}

export interface AcceptDeps {
  db: Db;
}

export interface AcceptResult {
  bookingIds: string[];
  seriesId: string | null;
}

/** Records the customer's acceptance and turns the quote into booking(s). */
export function acceptPublicQuote(
  deps: AcceptDeps,
  token: string,
  body: unknown,
  client: { ip: string | null; userAgent: string | null },
): AcceptResult {
  const input = parse(acceptQuoteSchema, body);
  const { scope: outer } = findByToken(deps.db, token);
  return outer.transaction((scope) => {
    const { rev, q } = findByToken(scope.db, token);
    const t = scope.db.select().from(tenant).where(eq(tenant.id, scope.tenantId)).get()!;
    const state = stateOf(q, rev, todayIn(t.timeZone));
    if (state !== 'open') throw quoteUnavailable(state);

    scope.insert(acceptance, {
      quoteId: q.id,
      revisionId: rev.id,
      fullName: input.fullName,
      ip: client.ip,
      userAgent: client.userAgent?.slice(0, 500) ?? null,
    });
    scope.update(quote, q.id, { status: 'accepted', acceptedAt: nowIso() });

    const opp = scope.get(opportunity, q.opportunityId, 'Opportunity');
    const policy = bookingPolicy(rev.bookingType);
    const plan = policy.invoicePlan(rev.pricingTerm);
    const occurrences = occurrencesOf(rev);
    const seriesId = occurrences.length > 1 ? uuidv7() : null;
    const bookingIds: string[] = [];
    for (const occ of occurrences) {
      const b = scope.insert(booking, {
        number: nextNumber(scope, 'booking'),
        opportunityId: opp.id,
        contactId: opp.contactId,
        organizationId: opp.organizationId,
        quoteId: q.id,
        revisionId: rev.id,
        seriesId,
        bookingType: rev.bookingType,
        status: policy.initialStatus,
        pricingTerm: rev.pricingTerm,
        title: opp.title,
        startDate: occ.startDate,
        endDate: occ.endDate,
        startTime: rev.startTime,
        endTime: rev.endTime,
        location: rev.location,
        expectedAttendance: rev.expectedAttendance,
        totalCents: rev.totalCents,
        depositCents: rev.depositCents,
        splitBps: rev.splitBps,
        guaranteeCents: rev.guaranteeCents,
        staffRequired: rev.staffRequired,
        fulfillment:
          rev.bookingType === 'equipment_rental'
            ? rev.insideServiceArea
              ? 'pickup'
              : 'delivery'
            : null,
        deliveryAddress:
          rev.bookingType === 'equipment_rental' && !rev.insideServiceArea ? rev.location : null,
        needsInvoice: plan !== 'after_settlement',
        confirmedAt: policy.initialStatus === 'confirmed' ? nowIso() : null,
      });
      const reqs = Object.entries(rev.requirements).filter(([, n]) => n > 0);
      if (reqs.length > 0) {
        scope.db
          .insert(equipmentRequirement)
          .values(
            reqs.map(([equipmentTypeId, quantity]) => ({
              tenantId: scope.tenantId,
              bookingId: b.id,
              equipmentTypeId,
              quantity,
            })),
          )
          .run();
      }
      recordActivity(scope, {
        subjectType: 'booking',
        subjectId: b.id,
        opportunityId: opp.id,
        organizationId: opp.organizationId,
        kind: 'booking_created',
        body: `Booking created from quote ${formatQuoteNumber(q.number)} accepted by ${input.fullName}`,
      });
      if (plan !== 'after_settlement') {
        enqueueJob(scope.db, {
          type: CREATE_INVOICE_JOB,
          tenantId: scope.tenantId,
          payload: { bookingId: b.id },
          idempotencyKey: `invoice:${b.id}`,
        });
      }
      bookingIds.push(b.id);
    }
    recordActivity(scope, {
      subjectType: 'quote',
      subjectId: q.id,
      opportunityId: opp.id,
      organizationId: opp.organizationId,
      kind: 'quote_accepted',
      body: `Quote ${formatQuoteNumber(q.number)} accepted online by ${input.fullName}`,
      data: { revisionId: rev.id, ip: client.ip },
    });
    // Rentals are won when the deposit is paid; full-service bookings are confirmed now.
    if (policy.initialStatus === 'confirmed' && opp.stage !== 'won') {
      changeStage(
        { scope, userId: null },
        opp.id,
        { stage: 'won' },
        { automatic: true, reason: 'quote accepted' },
      );
    }
    return { bookingIds, seriesId };
  });
}

export function declinePublicQuote(db: Db, token: string, body: unknown) {
  const { reason } = parse(declineQuoteSchema, body ?? {});
  const { scope: outer } = findByToken(db, token);
  return outer.transaction((scope) => {
    const { rev, q } = findByToken(scope.db, token);
    const t = scope.db.select().from(tenant).where(eq(tenant.id, scope.tenantId)).get()!;
    const state = stateOf(q, rev, todayIn(t.timeZone));
    if (state !== 'open') throw quoteUnavailable(state);
    applyDecline(scope, q.id, reason ?? null, null, 'customer');
    return { declined: true };
  });
}

function quoteUnavailable(state: PublicQuoteState): AppError {
  const messages: Record<PublicQuoteState, string> = {
    open: '',
    expired: 'This quote has expired. Please contact us for an updated quote.',
    revoked: 'This quote is no longer valid. Please use the most recent link we sent you.',
    accepted: 'This quote has already been accepted.',
    declined: 'This quote was declined.',
  };
  return new AppError(409, `quote_${state}`, messages[state]);
}
