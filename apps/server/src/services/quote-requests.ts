import {
  bookingPolicy,
  contactSchema,
  makeQuoteRequestSchema,
  organizationSchema,
  todayIn,
} from '@disco/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/index.js';
import { TenantScope } from '../db/repository.js';
import { contact, organization, quoteRequest, tenant } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';
import { nowIso } from '../lib/id.js';
import { parse } from '../lib/validation.js';
import { recordActivity } from './activity.js';
import { createContact, createOrganization } from './crm.js';
import { newRequestEmail } from './email-templates.js';
import { queueEmail } from './mail.js';
import { createOpportunity } from './opportunities.js';
import { getSettingsRow } from './settings.js';

export function publicTenant(db: Db, slug: string) {
  const t = db.select().from(tenant).where(eq(tenant.slug, slug)).get();
  if (!t) throw new NotFoundError('Business');
  return t;
}

export type SubmitResult =
  | { recorded: false }
  | { recorded: true; quoteRequestId: string; opportunityId: string; contactId: string };

/**
 * Records a public quote request as a Quote Requested opportunity linked to an existing
 * contact (matched by email) or a new one. Honeypot submissions are dropped silently.
 */
export function submitQuoteRequest(
  deps: { db: Db; config: AppConfig },
  slug: string,
  body: unknown,
  ip: string | null,
): SubmitResult {
  const t = publicTenant(deps.db, slug);
  const input = parse(
    makeQuoteRequestSchema(() => todayIn(t.timeZone)),
    body,
  );
  if (input.website?.trim()) return { recorded: false };

  const ctx = { scope: new TenantScope(deps.db, t.id), userId: null };
  const result = ctx.scope.transaction((scope) => {
    const tx = { scope, userId: null };
    const orgByName = (name: string) =>
      scope.first(
        organization,
        and(
          isNull(organization.archivedAt),
          sql`lower(trim(${organization.name})) = ${name.trim().toLowerCase()}`,
        ),
      ) ??
      createOrganization(tx, parse(organizationSchema, { name, type: 'other' }), {
        allowDuplicate: true,
      });

    let person = scope.list(contact, {
      where: eq(contact.email, input.email),
      // Prefer an active contact (NULL archivedAt sorts first), then the oldest record.
      orderBy: [{ column: contact.archivedAt }, { column: contact.createdAt }],
      limit: 1,
    })[0];
    let orgId: string | null;
    if (person) {
      orgId = person.organizationId;
      if (!orgId && input.organization) {
        orgId = orgByName(input.organization).id;
        person = scope.update(contact, person.id, { organizationId: orgId });
      }
      if (!person.phone && input.phone) {
        person = scope.update(contact, person.id, { phone: input.phone });
      }
    } else {
      orgId = input.organization ? orgByName(input.organization).id : null;
      person = createContact(
        tx,
        parse(contactSchema, {
          name: input.name,
          email: input.email,
          phone: input.phone,
          organizationId: orgId,
        }),
        { allowDuplicate: true },
      );
    }

    const orgName = orgId ? scope.get(organization, orgId).name : null;
    const label = bookingPolicy(input.serviceInterest).label;
    const notes = [`Location: ${input.location}`, input.message].filter(Boolean).join('\n\n');
    const opp = createOpportunity(
      tx,
      {
        title: `${orgName ?? input.name} – ${label}`,
        organizationId: orgId,
        contactId: person.id,
        serviceInterest: input.serviceInterest,
        eventDate: input.eventDate,
        expectedAttendance: input.expectedAttendance,
        notes,
      },
      { stage: 'quote_requested', source: 'quote_request' },
    );
    const request = scope.insert(quoteRequest, {
      opportunityId: opp.id,
      name: input.name,
      email: input.email,
      phone: input.phone ?? null,
      organization: input.organization ?? null,
      serviceInterest: input.serviceInterest,
      eventDate: input.eventDate,
      expectedAttendance: input.expectedAttendance,
      location: input.location,
      message: input.message ?? null,
      ip,
    });
    recordActivity(scope, {
      subjectType: 'opportunity',
      subjectId: opp.id,
      organizationId: orgId,
      kind: 'quote_request',
      body: input.message ?? 'Submitted the quote request form',
      data: { quoteRequestId: request.id, contactId: person.id },
    });

    const notify = getSettingsRow(deps.db, t.id).notificationEmail;
    if (notify) {
      queueEmail(scope.db, {
        tenantId: t.id,
        to: notify,
        related: { type: 'quote_request', id: request.id },
        email: newRequestEmail({
          tenantName: t.name,
          name: input.name,
          email: input.email,
          phone: input.phone,
          organization: input.organization,
          serviceInterest: input.serviceInterest,
          eventDate: input.eventDate,
          expectedAttendance: input.expectedAttendance,
          location: input.location,
          message: input.message,
          opportunityUrl: new URL(`/pipeline/${opp.id}`, deps.config.publicBaseUrl).toString(),
        }),
      });
    }
    return { quoteRequestId: request.id, opportunityId: opp.id, contactId: person.id };
  });
  return { recorded: true, ...result };
}

/** Quote requests for the in-app indicator; unseen ones first. */
export function listQuoteRequests(scope: TenantScope, opts: { unseenOnly?: boolean } = {}) {
  const rows = scope.list(quoteRequest, {
    where: opts.unseenOnly ? isNull(quoteRequest.seenAt) : undefined,
    orderBy: [{ column: quoteRequest.createdAt, direction: 'desc' }],
    limit: 50,
  });
  const unseenCount = scope.db
    .select({ n: sql<number>`count(*)` })
    .from(quoteRequest)
    .where(scope.ownedBy(quoteRequest.tenantId, isNull(quoteRequest.seenAt)))
    .get()!.n;
  return { items: rows, unseenCount };
}

export function markQuoteRequestsSeen(scope: TenantScope, ids?: string[]) {
  if (ids && !ids.length) return listQuoteRequests(scope, { unseenOnly: true });
  const where = ids ? inArray(quoteRequest.id, ids) : undefined;
  scope.db
    .update(quoteRequest)
    .set({ seenAt: nowIso() })
    .where(scope.ownedBy(quoteRequest.tenantId, and(isNull(quoteRequest.seenAt), where)))
    .run();
  return listQuoteRequests(scope, { unseenOnly: true });
}
