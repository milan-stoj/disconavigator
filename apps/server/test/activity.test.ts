import { describe, expect, it } from 'vitest';
import { opportunity, organization } from '../src/db/schema.js';
import { listActivity, recordActivity } from '../src/services/activity.js';
import { changeStage } from '../src/services/opportunities.js';
import { createTenant, createTestDb } from './helpers.js';

describe('activity log', () => {
  const { db } = createTestDb();
  const t = createTenant(db, 'Alpha');
  const ctx = { scope: t.scope, userId: t.userId };
  const org = t.scope.insert(organization, { name: 'Bar X', type: 'bar' });
  const opp = t.scope.insert(opportunity, {
    title: 'Bar X silent disco',
    stage: 'contacted',
    organizationId: org.id,
  });

  it('stage changes create activity entries', () => {
    changeStage(ctx, opp.id, { stage: 'quote_requested' });
    const entries = listActivity(t.scope, { opportunityId: opp.id });
    expect(entries[0]).toMatchObject({
      kind: 'stage_changed',
      body: 'Contacted → Quote Requested',
      authorName: 'Alpha user',
    });
    expect(entries[0]!.data).toMatchObject({ from: 'contacted', to: 'quote_requested' });
  });

  it('marking Lost requires a reason and records it', () => {
    expect(() => changeStage(ctx, opp.id, { stage: 'lost' })).toThrow();
    changeStage(ctx, opp.id, { stage: 'lost', lossReason: 'capacity' });
    const updated = t.scope.get(opportunity, opp.id);
    expect(updated).toMatchObject({ stage: 'lost', lossReason: 'capacity' });
    expect(updated.closedAt).not.toBeNull();
  });

  it('manual notes appear in opportunity and organization timelines', () => {
    recordActivity(t.scope, {
      subjectType: 'opportunity',
      subjectId: opp.id,
      organizationId: org.id,
      kind: 'call',
      body: 'Called the manager',
      userId: t.userId,
    });
    const oppTimeline = listActivity(t.scope, { opportunityId: opp.id });
    const orgTimeline = listActivity(t.scope, { organizationId: org.id });
    expect(oppTimeline[0]).toMatchObject({
      kind: 'call',
      body: 'Called the manager',
      authorName: 'Alpha user',
    });
    expect(oppTimeline[0]!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(orgTimeline.map((e) => e.kind)).toContain('call');
    expect(orgTimeline.map((e) => e.kind)).toContain('stage_changed');
  });

  it('other tenants do not see the timeline', () => {
    const other = createTenant(db, 'Bravo');
    expect(listActivity(other.scope, { opportunityId: opp.id })).toEqual([]);
  });
});
