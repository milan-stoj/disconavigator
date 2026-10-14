import { activityNoteSchema, contactSchema, organizationSchema, OPEN_STAGES } from '@disco/shared';
import { and, eq, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { z } from 'zod';
import type { TenantScope } from '../db/repository.js';
import { activity, contact, opportunity, organization } from '../db/schema.js';
import { AppError, ValidationError } from '../lib/errors.js';
import { nowIso } from '../lib/id.js';
import { containsText } from '../lib/like.js';
import { listActivity, recordActivity, type ActivitySubject } from './activity.js';
import type { ServiceContext } from './context.js';

type OrgRow = typeof organization.$inferSelect;
type ContactRow = typeof contact.$inferSelect;
type OrgInput = z.output<typeof organizationSchema>;
type ContactInput = z.output<typeof contactSchema>;

export type ArchiveFilter = 'active' | 'archived' | 'all';

export interface DuplicateMatch {
  id: string;
  name: string;
  detail: string | null;
  archived: boolean;
  matchedOn: string[];
}

/** 409 listing likely duplicates; the client may retry with `allowDuplicate: true`. */
export class DuplicateError extends AppError {
  constructor(what: string, duplicates: DuplicateMatch[]) {
    super(409, 'duplicate', `This looks like an existing ${what}`, { duplicates });
  }
}

function archiveCondition(column: SQLiteColumn, filter: ArchiveFilter) {
  if (filter === 'active') return isNull(column);
  if (filter === 'archived') return isNotNull(column);
  return undefined;
}

/** Throws a field validation error if a referenced record is not in this tenant. */
export function assertRef(
  scope: TenantScope,
  table: typeof organization | typeof contact | typeof opportunity,
  id: string | null | undefined,
  field: string,
  message: string,
) {
  if (!id) return null;
  const row = scope.find(table, id);
  if (!row) throw new ValidationError(message, { fieldErrors: { [field]: message } });
  return row;
}

// ---------- Organizations ----------

export interface OrganizationListItem extends OrgRow {
  contactCount: number;
  openOpportunityCount: number;
  lastActivityAt: string | null;
}

export function listOrganizations(
  scope: TenantScope,
  opts: { q?: string; archived?: ArchiveFilter; type?: string } = {},
): OrganizationListItem[] {
  const conds: (SQL | undefined)[] = [
    archiveCondition(organization.archivedAt, opts.archived ?? 'active'),
  ];
  if (opts.type) conds.push(eq(organization.type, opts.type));
  if (opts.q) {
    conds.push(
      or(
        containsText(organization.name, opts.q),
        containsText(organization.city, opts.q),
        containsText(organization.phone, opts.q),
      ),
    );
  }
  const orgs = scope.list(organization, {
    where: and(...conds),
    orderBy: [{ column: organization.name }],
  });
  if (orgs.length === 0) return [];
  const ids = orgs.map((o) => o.id);
  const contactCounts = new Map(
    scope.db
      .select({ id: contact.organizationId, n: sql<number>`count(*)` })
      .from(contact)
      .where(
        scope.ownedBy(
          contact.tenantId,
          and(inArray(contact.organizationId, ids), isNull(contact.archivedAt)),
        ),
      )
      .groupBy(contact.organizationId)
      .all()
      .map((r) => [r.id, r.n]),
  );
  const oppCounts = new Map(
    scope.db
      .select({ id: opportunity.organizationId, n: sql<number>`count(*)` })
      .from(opportunity)
      .where(
        scope.ownedBy(
          opportunity.tenantId,
          and(
            inArray(opportunity.organizationId, ids),
            inArray(opportunity.stage, [...OPEN_STAGES]),
          ),
        ),
      )
      .groupBy(opportunity.organizationId)
      .all()
      .map((r) => [r.id, r.n]),
  );
  const lastActivity = new Map(
    scope.db
      .select({ id: activity.organizationId, at: sql<string>`max(${activity.createdAt})` })
      .from(activity)
      .where(scope.ownedBy(activity.tenantId, inArray(activity.organizationId, ids)))
      .groupBy(activity.organizationId)
      .all()
      .map((r) => [r.id, r.at]),
  );
  return orgs.map((o) => ({
    ...o,
    contactCount: contactCounts.get(o.id) ?? 0,
    openOpportunityCount: oppCounts.get(o.id) ?? 0,
    lastActivityAt: lastActivity.get(o.id) ?? null,
  }));
}

export function findDuplicateOrganizations(
  scope: TenantScope,
  input: Pick<OrgInput, 'name' | 'city'>,
  exceptId?: string,
): DuplicateMatch[] {
  const city = input.city?.trim().toLowerCase() ?? '';
  return scope
    .list(organization, {
      where: sql`lower(trim(${organization.name})) = ${input.name.trim().toLowerCase()}`,
    })
    .filter((o) => o.id !== exceptId && (o.city?.trim().toLowerCase() ?? '') === city)
    .map((o) => ({
      id: o.id,
      name: o.name,
      detail: o.city,
      archived: !!o.archivedAt,
      matchedOn: ['name', 'city'],
    }));
}

export function getOrganization(scope: TenantScope, id: string) {
  const org = scope.get(organization, id, 'Organization');
  const contacts = scope.list(contact, {
    where: eq(contact.organizationId, id),
    orderBy: [{ column: contact.name }],
  });
  const opportunities = listOpportunityRows(scope, eq(opportunity.organizationId, id));
  return { ...org, contacts, opportunities };
}

export function createOrganization(
  ctx: ServiceContext,
  input: OrgInput,
  opts: { allowDuplicate?: boolean } = {},
) {
  if (!opts.allowDuplicate) {
    const dups = findDuplicateOrganizations(ctx.scope, input);
    if (dups.length) throw new DuplicateError('organization', dups);
  }
  return ctx.scope.transaction((scope) => {
    const org = scope.insert(organization, input);
    recordActivity(scope, {
      subjectType: 'organization',
      subjectId: org.id,
      kind: 'created',
      userId: ctx.userId,
    });
    return org;
  });
}

export function updateOrganization(ctx: ServiceContext, id: string, input: OrgInput) {
  ctx.scope.get(organization, id, 'Organization');
  return ctx.scope.update(organization, id, input, 'Organization');
}

function setArchived(
  ctx: ServiceContext,
  table: typeof organization | typeof contact,
  subjectType: ActivitySubject,
  id: string,
  archived: boolean,
  what: string,
) {
  return ctx.scope.transaction((scope) => {
    const row = scope.get(table, id, what) as OrgRow | ContactRow;
    if (!!row.archivedAt === archived) return row;
    const patch = { archivedAt: archived ? nowIso() : null };
    const updated =
      table === organization
        ? scope.update(organization, id, patch, what)
        : scope.update(contact, id, patch, what);
    recordActivity(scope, {
      subjectType,
      subjectId: id,
      organizationId: subjectType === 'contact' ? (row as ContactRow).organizationId : undefined,
      kind: archived ? 'archived' : 'restored',
      userId: ctx.userId,
    });
    return updated;
  });
}

export const setOrganizationArchived = (ctx: ServiceContext, id: string, archived: boolean) =>
  setArchived(ctx, organization, 'organization', id, archived, 'Organization');

// ---------- Contacts ----------

export interface ContactListItem extends ContactRow {
  organizationName: string | null;
}

/** Digits only, without a leading US country code, so "(414) 555-0100" matches "+1 414 555 0100". */
export function normalizePhone(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

export function listContacts(
  scope: TenantScope,
  opts: { q?: string; archived?: ArchiveFilter; organizationId?: string } = {},
): ContactListItem[] {
  const conds: (SQL | undefined)[] = [
    archiveCondition(contact.archivedAt, opts.archived ?? 'active'),
  ];
  if (opts.organizationId) conds.push(eq(contact.organizationId, opts.organizationId));
  if (opts.q) {
    conds.push(
      or(
        containsText(contact.name, opts.q),
        containsText(contact.email, opts.q),
        containsText(contact.phone, opts.q),
        containsText(organization.name, opts.q),
      ),
    );
  }
  return scope.db
    .select({ contact, organizationName: organization.name })
    .from(contact)
    .leftJoin(organization, eq(organization.id, contact.organizationId))
    .where(scope.ownedBy(contact.tenantId, and(...conds)))
    .orderBy(contact.name)
    .all()
    .map((r) => ({ ...r.contact, organizationName: r.organizationName }));
}

export function findDuplicateContacts(
  scope: TenantScope,
  input: Pick<ContactInput, 'email' | 'phone'>,
  exceptId?: string,
): DuplicateMatch[] {
  const email = input.email?.toLowerCase() ?? null;
  const phone = normalizePhone(input.phone);
  if (!email && phone.length < 7) return [];
  const candidates = scope.list(contact, {
    where: or(
      email ? eq(contact.email, email) : undefined,
      phone.length >= 7 ? isNotNull(contact.phone) : undefined,
    ),
  });
  const matches: DuplicateMatch[] = [];
  for (const c of candidates) {
    if (c.id === exceptId) continue;
    const matchedOn: string[] = [];
    if (email && c.email === email) matchedOn.push('email');
    if (phone.length >= 7 && normalizePhone(c.phone) === phone) matchedOn.push('phone');
    if (matchedOn.length) {
      matches.push({
        id: c.id,
        name: c.name,
        detail: c.email ?? c.phone,
        archived: !!c.archivedAt,
        matchedOn,
      });
    }
  }
  return matches;
}

export function getContact(scope: TenantScope, id: string) {
  const c = scope.get(contact, id, 'Contact');
  const org = c.organizationId ? scope.find(organization, c.organizationId) : undefined;
  const opportunities = listOpportunityRows(scope, eq(opportunity.contactId, id));
  return {
    ...c,
    organizationName: org?.name ?? null,
    opportunities,
  };
}

export function createContact(
  ctx: ServiceContext,
  input: ContactInput,
  opts: { allowDuplicate?: boolean } = {},
) {
  assertRef(
    ctx.scope,
    organization,
    input.organizationId,
    'organizationId',
    'Choose an organization',
  );
  if (!opts.allowDuplicate) {
    const dups = findDuplicateContacts(ctx.scope, input);
    if (dups.length) throw new DuplicateError('contact', dups);
  }
  return ctx.scope.transaction((scope) => {
    const c = scope.insert(contact, { ...input, organizationId: input.organizationId ?? null });
    recordActivity(scope, {
      subjectType: 'contact',
      subjectId: c.id,
      organizationId: c.organizationId,
      kind: 'created',
      userId: ctx.userId,
    });
    return c;
  });
}

export function updateContact(ctx: ServiceContext, id: string, input: ContactInput) {
  ctx.scope.get(contact, id, 'Contact');
  assertRef(
    ctx.scope,
    organization,
    input.organizationId,
    'organizationId',
    'Choose an organization',
  );
  return ctx.scope.update(
    contact,
    id,
    { ...input, organizationId: input.organizationId ?? null },
    'Contact',
  );
}

export const setContactArchived = (ctx: ServiceContext, id: string, archived: boolean) =>
  setArchived(ctx, contact, 'contact', id, archived, 'Contact');

// ---------- Opportunity rows (shared with organization/contact detail) ----------

export function listOpportunityRows(scope: TenantScope, where?: SQL) {
  return scope.db
    .select({
      opportunity,
      organizationName: organization.name,
      contactName: contact.name,
    })
    .from(opportunity)
    .leftJoin(organization, eq(organization.id, opportunity.organizationId))
    .leftJoin(contact, eq(contact.id, opportunity.contactId))
    .where(scope.ownedBy(opportunity.tenantId, where))
    .orderBy(sql`${opportunity.stageChangedAt} desc`)
    .all()
    .map((r) => ({
      ...r.opportunity,
      organizationName: r.organizationName,
      contactName: r.contactName,
    }));
}

// ---------- Activity notes and timelines ----------

/** Where a subject's activity should also appear (its organization and opportunity timelines). */
function subjectLinks(scope: TenantScope, type: ActivitySubject, id: string) {
  switch (type) {
    case 'organization':
      scope.get(organization, id, 'Organization');
      return { organizationId: id };
    case 'contact':
      return { organizationId: scope.get(contact, id, 'Contact').organizationId };
    case 'opportunity': {
      const o = scope.get(opportunity, id, 'Opportunity');
      return { organizationId: o.organizationId, opportunityId: id };
    }
    default:
      throw new ValidationError('Notes cannot be added here');
  }
}

export function addNote(
  ctx: ServiceContext,
  subjectType: ActivitySubject,
  subjectId: string,
  input: z.output<typeof activityNoteSchema>,
) {
  const links = subjectLinks(ctx.scope, subjectType, subjectId);
  const entry = recordActivity(ctx.scope, {
    subjectType,
    subjectId,
    ...links,
    kind: input.kind,
    body: input.body,
    userId: ctx.userId,
  });
  return timeline(ctx.scope, subjectType, subjectId).find((e) => e.id === entry.id)!;
}

/** The activity timeline for a record, including linked records' activity. */
export function timeline(scope: TenantScope, subjectType: ActivitySubject, subjectId: string) {
  switch (subjectType) {
    case 'organization':
      scope.get(organization, subjectId, 'Organization');
      return listActivity(scope, {
        organizationId: subjectId,
        subject: { type: 'organization', id: subjectId },
      });
    case 'contact':
      scope.get(contact, subjectId, 'Contact');
      return listActivity(scope, { subject: { type: 'contact', id: subjectId } });
    case 'opportunity':
      scope.get(opportunity, subjectId, 'Opportunity');
      return listActivity(scope, { opportunityId: subjectId });
    default:
      throw new ValidationError('Unsupported timeline');
  }
}
