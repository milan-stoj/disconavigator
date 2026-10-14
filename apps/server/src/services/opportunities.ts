import {
  OPEN_STAGES,
  opportunitySchema,
  STAGE_LABELS,
  stageChangeSchema,
  type OpportunityStage,
} from '@disco/shared';
import { and, eq, gte, inArray, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { TenantScope } from '../db/repository.js';
import { contact, opportunity, organization } from '../db/schema.js';
import { NotFoundError, ValidationError } from '../lib/errors.js';
import { nowIso } from '../lib/id.js';
import { containsText } from '../lib/like.js';
import { assertRef, listOpportunityRows } from './crm.js';
import { recordActivity } from './activity.js';
import type { ServiceContext } from './context.js';

/** Changes an opportunity's stage and records the change in its activity history. */
export function changeStage(
  ctx: ServiceContext,
  id: string,
  input: z.input<typeof stageChangeSchema>,
  meta: { reason?: string; automatic?: boolean } = {},
) {
  const parsed = stageChangeSchema.parse(input);
  return ctx.scope.transaction((scope) => {
    const current = scope.get(opportunity, id, 'Opportunity');
    if (current.stage === parsed.stage && parsed.stage !== 'lost') return current;
    const closed = parsed.stage === 'won' || parsed.stage === 'lost';
    const updated = scope.update(opportunity, id, {
      stage: parsed.stage,
      stageChangedAt: nowIso(),
      closedAt: closed ? nowIso() : null,
      lossReason: parsed.stage === 'lost' ? parsed.lossReason : null,
      lossNote: parsed.stage === 'lost' ? parsed.lossNote : null,
      needsLossReason: false,
    });
    recordActivity(scope, {
      subjectType: 'opportunity',
      subjectId: id,
      organizationId: current.organizationId,
      kind: 'stage_changed',
      body: `${STAGE_LABELS[current.stage]} → ${STAGE_LABELS[parsed.stage]}${meta.reason ? ` (${meta.reason})` : ''}`,
      data: {
        from: current.stage,
        to: parsed.stage,
        lossReason: parsed.lossReason ?? null,
        lossNote: parsed.lossNote ?? null,
        automatic: meta.automatic ?? false,
      },
      userId: ctx.userId,
    });
    return updated;
  });
}

type OpportunityInput = z.output<typeof opportunitySchema>;

/** Validates linked records and fills the organization from the contact when omitted. */
function resolveLinks(scope: TenantScope, input: OpportunityInput) {
  assertRef(scope, organization, input.organizationId, 'organizationId', 'Choose an organization');
  const c = assertRef(scope, contact, input.contactId, 'contactId', 'Choose a contact') as
    typeof contact.$inferSelect | null;
  if (!input.organizationId && !input.contactId) {
    const msg = 'Choose an organization or a contact';
    throw new ValidationError(msg, { fieldErrors: { organizationId: msg } });
  }
  return {
    organizationId: input.organizationId ?? c?.organizationId ?? null,
    contactId: input.contactId ?? null,
  };
}

export function createOpportunity(
  ctx: ServiceContext,
  input: OpportunityInput,
  opts: { stage?: OpportunityStage; source?: string } = {},
) {
  return ctx.scope.transaction((scope) => {
    const links = resolveLinks(scope, input);
    const stage = opts.stage ?? 'new';
    const created = scope.insert(opportunity, {
      ...input,
      ...links,
      stage,
      source: opts.source ?? 'manual',
    });
    recordActivity(scope, {
      subjectType: 'opportunity',
      subjectId: created.id,
      organizationId: created.organizationId,
      kind: 'created',
      body: `Created in ${STAGE_LABELS[stage]}`,
      userId: ctx.userId,
    });
    return getOpportunity(scope, created.id);
  });
}

export function updateOpportunity(ctx: ServiceContext, id: string, input: OpportunityInput) {
  return ctx.scope.transaction((scope) => {
    scope.get(opportunity, id, 'Opportunity');
    scope.update(opportunity, id, { ...input, ...resolveLinks(scope, input) });
    return getOpportunity(scope, id);
  });
}

export function getOpportunity(scope: TenantScope, id: string) {
  const [row] = listOpportunityRows(scope, eq(opportunity.id, id));
  if (!row) throw new NotFoundError('Opportunity');
  return row;
}

export function listOpportunities(
  scope: TenantScope,
  opts: { stage?: OpportunityStage[]; q?: string; closedSince?: string } = {},
) {
  const conds: (SQL | undefined)[] = [];
  if (opts.stage?.length) conds.push(inArray(opportunity.stage, opts.stage));
  if (opts.q) {
    conds.push(
      or(
        containsText(opportunity.title, opts.q),
        containsText(organization.name, opts.q),
        containsText(contact.name, opts.q),
      ),
    );
  }
  if (opts.closedSince) {
    conds.push(
      or(inArray(opportunity.stage, [...OPEN_STAGES]), gte(opportunity.closedAt, opts.closedSince)),
    );
  }
  return listOpportunityRows(scope, and(...conds));
}
