import { afterAll, describe, expect, it } from 'vitest';
import { normalizePhone } from '../src/services/crm.js';
import { buildTestApp, client, signIn } from './app-helpers.js';
import { createTenant } from './helpers.js';

describe('customer relationships API', async () => {
  const { app, db } = await buildTestApp();
  afterAll(() => app.close());
  const admin = client(app, await signIn(app));

  const barX = (
    await admin.post('/api/organizations', {
      name: 'Bar X',
      type: 'bar',
      city: 'Milwaukee',
      competitorNote: 'Used Quiet Events last summer',
    })
  ).json();

  describe('organizations', () => {
    it('creates and finds an organization by search', async () => {
      expect(barX).toMatchObject({ name: 'Bar X', type: 'bar', city: 'Milwaukee' });
      await admin.post('/api/organizations', { name: 'Madison Town Hall', type: 'municipality' });
      const found = (await admin.get('/api/organizations?q=bar%20x')).json();
      expect(found.map((o: { name: string }) => o.name)).toEqual(['Bar X']);
      expect(found[0]).toMatchObject({
        competitorNote: 'Used Quiet Events last summer',
        contactCount: 0,
        openOpportunityCount: 0,
        lastActivityAt: expect.any(String),
      });
      const search = (await admin.get('/api/search?q=bar%20x')).json();
      expect(search[0]).toMatchObject({ kind: 'organization', id: barX.id });
    });

    it('validates input', async () => {
      const res = await admin.post('/api/organizations', { name: ' ', type: 'castle' });
      expect(res.statusCode).toBe(400);
      expect(Object.keys(res.json().details.fieldErrors)).toEqual(['name', 'type']);
    });

    it('warns about a duplicate name in the same city unless confirmed', async () => {
      const dup = await admin.post('/api/organizations', {
        name: 'bar x ',
        type: 'bar',
        city: 'milwaukee',
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json()).toMatchObject({
        error: 'duplicate',
        details: { duplicates: [{ id: barX.id, name: 'Bar X', detail: 'Milwaukee' }] },
      });
      const otherCity = await admin.post('/api/organizations', {
        name: 'Bar X',
        type: 'bar',
        city: 'Madison',
      });
      expect(otherCity.statusCode).toBe(201);
      const confirmed = await admin.post('/api/organizations', {
        name: 'Bar X',
        type: 'bar',
        city: 'Milwaukee',
        allowDuplicate: true,
      });
      expect(confirmed.statusCode).toBe(201);
      await admin.put(`/api/organizations/${confirmed.json().id}/archived`, { archived: true });
    });

    it('hides archived organizations by default but keeps them viewable', async () => {
      const org = (await admin.post('/api/organizations', { name: 'Old Pub', type: 'bar' })).json();
      await admin.post(`/api/organizations/${org.id}/activity`, { kind: 'note', body: 'Closed' });
      const res = await admin.put(`/api/organizations/${org.id}/archived`, { archived: true });
      expect(res.json().archivedAt).toEqual(expect.any(String));
      const names = async (qs: string) =>
        (await admin.get(`/api/organizations${qs}`)).json().map((o: { name: string }) => o.name);
      expect(await names('')).not.toContain('Old Pub');
      expect(await names('?archived=archived')).toContain('Old Pub');
      expect(await names('?archived=all')).toContain('Old Pub');
      const detail = (await admin.get(`/api/organizations/${org.id}`)).json();
      expect(detail.name).toBe('Old Pub');
      const history = (await admin.get(`/api/organizations/${org.id}/activity`)).json();
      expect(history.map((a: { kind: string }) => a.kind)).toEqual(['archived', 'note', 'created']);
      await admin.put(`/api/organizations/${org.id}/archived`, { archived: false });
      expect(await names('')).toContain('Old Pub');
    });

    it('edits an organization', async () => {
      const res = await admin.put(`/api/organizations/${barX.id}`, {
        ...barX,
        phone: '(414) 555-0100',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().phone).toBe('(414) 555-0100');
    });
  });

  describe('contacts', () => {
    let jordanId = '';

    it('links a contact to an organization', async () => {
      const res = await admin.post('/api/contacts', {
        name: 'Jordan',
        email: 'Jordan@BarX.test',
        phone: '(414) 555-0123',
        role: 'Owner',
        organizationId: barX.id,
      });
      expect(res.statusCode).toBe(201);
      jordanId = res.json().id;
      expect(res.json().email).toBe('jordan@barx.test');
      const org = (await admin.get(`/api/organizations/${barX.id}`)).json();
      expect(org.contacts.map((c: { name: string }) => c.name)).toEqual(['Jordan']);
      const list = (await admin.get('/api/contacts?q=bar%20x')).json();
      expect(list[0]).toMatchObject({ name: 'Jordan', organizationName: 'Bar X' });
    });

    it('rejects an organization from another tenant', async () => {
      const other = createTenant(db, 'Other');
      const foreign = other.scope.insert((await import('../src/db/schema.js')).organization, {
        name: 'Theirs',
        type: 'bar',
      });
      const res = await admin.post('/api/contacts', { name: 'Sneaky', organizationId: foreign.id });
      expect(res.statusCode).toBe(400);
      expect(res.json().details.fieldErrors.organizationId).toBeDefined();
      expect((await admin.get(`/api/organizations/${foreign.id}`)).statusCode).toBe(404);
    });

    it('warns about a duplicate email or phone and allows continuing', async () => {
      const dupEmail = await admin.post('/api/contacts', {
        name: 'J. Smith',
        email: 'jordan@barx.test',
      });
      expect(dupEmail.statusCode).toBe(409);
      expect(dupEmail.json().details.duplicates).toEqual([
        expect.objectContaining({ id: jordanId, name: 'Jordan', matchedOn: ['email'] }),
      ]);
      const dupPhone = await admin.post('/api/contacts', {
        name: 'Front desk',
        phone: '+1 414-555-0123',
      });
      expect(dupPhone.json().details.duplicates[0].matchedOn).toEqual(['phone']);
      const anyway = await admin.post('/api/contacts', {
        name: 'J. Smith',
        email: 'jordan@barx.test',
        allowDuplicate: true,
      });
      expect(anyway.statusCode).toBe(201);
      await admin.put(`/api/contacts/${anyway.json().id}/archived`, { archived: true });
      expect((await admin.get('/api/contacts')).json()).toHaveLength(1);
    });

    it('normalizes phone numbers for comparison', () => {
      expect(normalizePhone('+1 (414) 555-0123')).toBe('4145550123');
      expect(normalizePhone('414.555.0123')).toBe('4145550123');
      expect(normalizePhone(null)).toBe('');
    });

    it('logs notes on contacts into the organization timeline', async () => {
      const note = await admin.post(`/api/contacts/${jordanId}/activity`, {
        kind: 'call',
        body: 'Interested in a Friday night',
      });
      expect(note.statusCode).toBe(201);
      expect(note.json()).toMatchObject({ kind: 'call', authorName: 'Kali' });
      const orgTimeline = (await admin.get(`/api/organizations/${barX.id}/activity`)).json();
      expect(orgTimeline[0]).toMatchObject({ kind: 'call', body: 'Interested in a Friday night' });
      const bad = await admin.post(`/api/contacts/${jordanId}/activity`, { kind: 'fax', body: '' });
      expect(Object.keys(bad.json().details.fieldErrors)).toEqual(['kind', 'body']);
    });
  });

  describe('opportunities', () => {
    let oppId = '';

    it('creates an opportunity and records it', async () => {
      const contacts = (await admin.get('/api/contacts')).json();
      const res = await admin.post('/api/opportunities', {
        title: 'Bar X summer silent disco',
        contactId: contacts[0].id,
        serviceInterest: 'full_service',
        eventDate: '2026-07-18',
        expectedAttendance: 120,
        stage: 'contacted',
      });
      expect(res.statusCode).toBe(201);
      oppId = res.json().id;
      expect(res.json()).toMatchObject({
        stage: 'contacted',
        organizationId: barX.id,
        organizationName: 'Bar X',
        contactName: 'Jordan',
      });
      const org = (await admin.get(`/api/organizations?q=bar%20x`)).json();
      expect(org[0].openOpportunityCount).toBe(1);
      expect(
        (await admin.post('/api/opportunities', { title: 'Orphan' })).json().details.fieldErrors,
      ).toEqual({ organizationId: 'Choose an organization or a contact' });
    });

    it('stage changes create activity entries', async () => {
      const res = await admin.post(`/api/opportunities/${oppId}/stage`, {
        stage: 'quote_requested',
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().stage).toBe('quote_requested');
      const history = (await admin.get(`/api/opportunities/${oppId}/activity`)).json();
      expect(history[0]).toMatchObject({
        kind: 'stage_changed',
        body: 'Contacted → Quote Requested',
        authorName: 'Kali',
      });
      const orgHistory = (await admin.get(`/api/organizations/${barX.id}/activity`)).json();
      expect(orgHistory[0].kind).toBe('stage_changed');
    });

    it('rejects Lost without a reason', async () => {
      const res = await admin.post(`/api/opportunities/${oppId}/stage`, { stage: 'lost' });
      expect(res.statusCode).toBe(400);
      expect(res.json().details.fieldErrors).toEqual({ lossReason: 'Choose a loss reason' });
      const other = await admin.post(`/api/opportunities/${oppId}/stage`, {
        stage: 'lost',
        lossReason: 'other',
      });
      expect(other.json().details.fieldErrors).toEqual({ lossNote: 'Add a note for "other"' });
      expect((await admin.get(`/api/opportunities/${oppId}`)).json().stage).toBe('quote_requested');
    });

    it('marks Lost for capacity and closes the opportunity', async () => {
      const res = await admin.post(`/api/opportunities/${oppId}/stage`, {
        stage: 'lost',
        lossReason: 'capacity',
      });
      expect(res.json()).toMatchObject({
        stage: 'lost',
        lossReason: 'capacity',
        closedAt: expect.any(String),
      });
      const open = (
        await admin.get('/api/opportunities?stage=new,contacted,quote_requested,quoted')
      )
        .json()
        .map((o: { id: string }) => o.id);
      expect(open).not.toContain(oppId);
      const recent = (await admin.get('/api/opportunities?closedSince=2000-01-01')).json();
      expect(recent.map((o: { id: string }) => o.id)).toContain(oppId);
      const future = (await admin.get('/api/opportunities?closedSince=2999-01-01')).json();
      expect(future.map((o: { id: string }) => o.id)).not.toContain(oppId);
    });

    it('edits an opportunity and searches by organization', async () => {
      const current = (await admin.get(`/api/opportunities/${oppId}`)).json();
      const res = await admin.put(`/api/opportunities/${oppId}`, {
        ...current,
        estimatedValueCents: 90000,
      });
      expect(res.json().estimatedValueCents).toBe(90000);
      expect((await admin.get('/api/opportunities?q=bar%20x')).json()).toHaveLength(1);
      expect((await admin.get('/api/opportunities?stage=bogus')).statusCode).toBe(400);
    });
  });
});
