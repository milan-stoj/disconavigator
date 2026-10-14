import { and, desc, eq, or, type SQL } from 'drizzle-orm';
import type { TenantScope } from '../db/repository.js';
import { activity, user } from '../db/schema.js';

export type ActivitySubject =
  'organization' | 'contact' | 'opportunity' | 'quote' | 'booking' | 'equipment';

export interface ActivityInput {
  subjectType: ActivitySubject;
  subjectId: string;
  kind: string;
  body?: string | null;
  data?: Record<string, unknown> | null;
  organizationId?: string | null;
  opportunityId?: string | null;
  bookingId?: string | null;
  userId?: string | null;
}

export function recordActivity(scope: TenantScope, input: ActivityInput) {
  return scope.insert(activity, {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    kind: input.kind,
    body: input.body ?? null,
    data: input.data ?? null,
    organizationId:
      input.organizationId ?? (input.subjectType === 'organization' ? input.subjectId : null),
    opportunityId:
      input.opportunityId ?? (input.subjectType === 'opportunity' ? input.subjectId : null),
    bookingId: input.bookingId ?? (input.subjectType === 'booking' ? input.subjectId : null),
    userId: input.userId ?? null,
  });
}

export interface TimelineFilter {
  organizationId?: string;
  opportunityId?: string;
  bookingId?: string;
  subject?: { type: ActivitySubject; id: string };
}

export function listActivity(scope: TenantScope, filter: TimelineFilter, limit = 200) {
  const conds: SQL[] = [];
  if (filter.organizationId) conds.push(eq(activity.organizationId, filter.organizationId));
  if (filter.opportunityId) conds.push(eq(activity.opportunityId, filter.opportunityId));
  if (filter.bookingId) conds.push(eq(activity.bookingId, filter.bookingId));
  if (filter.subject) {
    conds.push(
      and(
        eq(activity.subjectType, filter.subject.type),
        eq(activity.subjectId, filter.subject.id),
      )!,
    );
  }
  const rows = scope.db
    .select({
      id: activity.id,
      subjectType: activity.subjectType,
      subjectId: activity.subjectId,
      kind: activity.kind,
      body: activity.body,
      data: activity.data,
      organizationId: activity.organizationId,
      opportunityId: activity.opportunityId,
      bookingId: activity.bookingId,
      createdAt: activity.createdAt,
      userId: activity.userId,
      authorName: user.displayName,
    })
    .from(activity)
    .leftJoin(user, eq(user.id, activity.userId))
    .where(scope.ownedBy(activity.tenantId, conds.length ? or(...conds) : undefined))
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(limit)
    .all();
  return rows;
}
