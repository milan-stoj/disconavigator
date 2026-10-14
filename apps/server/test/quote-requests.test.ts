import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  contact,
  job,
  opportunity,
  organization,
  outboundEmail,
  quoteRequest,
  tenantSettings,
} from '../src/db/schema.js';
import { listQuoteRequests, markQuoteRequestsSeen } from '../src/services/quote-requests.js';
import { SEED_TENANT } from '../src/services/seed.js';
import { buildTestApp, client, signIn } from './app-helpers.js';
import { createTenant } from './helpers.js';

const url = `/api/public/tenants/${SEED_TENANT.slug}/quote-requests`;
const valid = {
  name: 'Jordan Lee',
  email: 'Jordan@BrewCity.test',
  phone: '414-555-0100',
  organization: 'Brew City Taproom',
  serviceInterest: 'equipment_rental',
  eventDate: '2099-07-10',
  expectedAttendance: 80,
  location: 'Bay View, Milwaukee',
  message: 'Rooftop party',
  website: '',
};

describe('public quote requests', () => {
  let app: FastifyInstance;
  let db: Awaited<ReturnType<typeof buildTestApp>>['db'];
  let tenantId: string;

  beforeEach(async () => {
    ({ app, db } = await buildTestApp({ QUOTE_REQUEST_RATE_LIMIT: '3' }));
    tenantId = app.deps.seedResult.tenantId;
  });
  afterEach(() => app.close());

  const submit = (body: object, ip = '203.0.113.1') =>
    app.inject({ method: 'POST', url, payload: body, remoteAddress: ip });

  it('exposes the business name for the public form', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/public/tenants/${SEED_TENANT.slug}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Undercover Dance Party' });
    const missing = await app.inject({ method: 'GET', url: '/api/public/tenants/nope' });
    expect(missing.statusCode).toBe(404);
  });

  it('creates a contact, organization, and Quote Requested opportunity for a new requester', async () => {
    const res = await submit(valid);
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ received: true });

    const people = db.select().from(contact).where(eq(contact.tenantId, tenantId)).all();
    expect(people).toHaveLength(1);
    expect(people[0]).toMatchObject({ name: 'Jordan Lee', email: 'jordan@brewcity.test' });
    const org = db
      .select()
      .from(organization)
      .where(eq(organization.id, people[0]!.organizationId!))
      .get()!;
    expect(org).toMatchObject({ name: 'Brew City Taproom', type: 'other', tenantId });

    const opps = db.select().from(opportunity).where(eq(opportunity.tenantId, tenantId)).all();
    expect(opps).toHaveLength(1);
    expect(opps[0]).toMatchObject({
      stage: 'quote_requested',
      source: 'quote_request',
      contactId: people[0]!.id,
      organizationId: org.id,
      serviceInterest: 'equipment_rental',
      eventDate: '2099-07-10',
      expectedAttendance: 80,
      title: 'Brew City Taproom – Equipment rental',
    });
    expect(opps[0]!.notes).toContain('Bay View, Milwaukee');
    const reqRow = db.select().from(quoteRequest).get()!;
    expect(reqRow).toMatchObject({ opportunityId: opps[0]!.id, ip: '203.0.113.1', seenAt: null });
  });

  it('creates only a contact when no organization is named', async () => {
    await submit({ ...valid, organization: '' });
    expect(
      db.select().from(organization).where(eq(organization.tenantId, tenantId)).all(),
    ).toHaveLength(0);
    const opp = db.select().from(opportunity).get()!;
    expect(opp).toMatchObject({ organizationId: null, title: 'Jordan Lee – Equipment rental' });
  });

  it('links a returning requester to the existing contact', async () => {
    const cookie = await signIn(app);
    const api = client(app, cookie);
    const org = (
      await api.post('/api/organizations', { name: 'Lakefront Lounge', type: 'bar' })
    ).json();
    const existing = (
      await api.post('/api/contacts', {
        name: 'Jordan L.',
        email: 'jordan@brewcity.test',
        organizationId: org.id,
      })
    ).json();

    const res = await submit({ ...valid, serviceInterest: 'full_service' });
    expect(res.statusCode).toBe(201);
    expect(db.select().from(contact).where(eq(contact.tenantId, tenantId)).all()).toHaveLength(1);
    // The existing organization is kept; the named one is not created.
    expect(
      db.select().from(organization).where(eq(organization.tenantId, tenantId)).all(),
    ).toHaveLength(1);
    const opp = db.select().from(opportunity).get()!;
    expect(opp).toMatchObject({
      contactId: existing.id,
      organizationId: org.id,
      stage: 'quote_requested',
      title: 'Lakefront Lounge – Full-service event',
    });
    const timeline = (await api.get(`/api/opportunities/${opp.id}/activity`)).json();
    expect(timeline.map((a: { kind: string }) => a.kind)).toContain('quote_request');
  });

  it('rejects invalid input with field errors and records nothing', async () => {
    const res = await submit({ ...valid, email: '', eventDate: '2000-01-01' });
    expect(res.statusCode).toBe(400);
    const { fieldErrors } = res.json().details;
    expect(Object.keys(fieldErrors)).toEqual(expect.arrayContaining(['email', 'eventDate']));
    expect(fieldErrors.eventDate).toBe('Event date cannot be in the past');
    expect(db.select().from(quoteRequest).all()).toHaveLength(0);
    expect(db.select().from(contact).all()).toHaveLength(0);
  });

  it('silently drops honeypot submissions', async () => {
    const res = await submit({ ...valid, website: 'http://spam.example' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ received: true });
    expect(db.select().from(quoteRequest).all()).toHaveLength(0);
    expect(db.select().from(opportunity).all()).toHaveLength(0);
  });

  it('rate limits submissions per client', async () => {
    for (let i = 0; i < 3; i++) {
      expect((await submit({ ...valid, email: `p${i}@x.test` })).statusCode).toBe(201);
    }
    const limited = await submit({ ...valid, email: 'p9@x.test' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toBe('rate_limited');
    // Another client is unaffected.
    expect((await submit({ ...valid, email: 'other@x.test' }, '198.51.100.7')).statusCode).toBe(
      201,
    );
    expect(db.select().from(quoteRequest).all()).toHaveLength(4);
  });

  it('returns 404 for an unknown business', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/public/tenants/nope/quote-requests',
      payload: valid,
    });
    expect(res.statusCode).toBe(404);
  });

  it('queues a notification email and shows the request as new', async () => {
    db.update(tenantSettings)
      .set({ notificationEmail: 'bookings@udp.test' })
      .where(eq(tenantSettings.tenantId, tenantId))
      .run();
    await submit(valid);

    const email = db.select().from(outboundEmail).get()!;
    expect(email).toMatchObject({
      to: 'bookings@udp.test',
      status: 'queued',
      subject: 'New quote request from Jordan Lee (Brew City Taproom)',
      relatedType: 'quote_request',
    });
    expect(email.text).toContain('Rooftop party');
    const opp = db.select().from(opportunity).get()!;
    expect(email.text).toContain(`http://localhost:5173/pipeline/${opp.id}`);
    expect(
      db
        .select()
        .from(job)
        .all()
        .map((j) => j.type),
    ).toContain('email.send');

    const api = client(app, await signIn(app));
    const list = (await api.get('/api/quote-requests?unseen=true')).json();
    expect(list.unseenCount).toBe(1);
    expect(list.items[0]).toMatchObject({
      name: 'Jordan Lee',
      opportunityId: opp.id,
      seenAt: null,
    });

    const after = (await api.post('/api/quote-requests/seen', { ids: [list.items[0].id] })).json();
    expect(after.unseenCount).toBe(0);
    expect((await api.get('/api/quote-requests')).json().items[0].seenAt).toBeTruthy();
  });

  it('skips the email when no notification address is configured', async () => {
    await submit(valid);
    expect(db.select().from(outboundEmail).all()).toHaveLength(0);
    expect(db.select().from(quoteRequest).all()).toHaveLength(1);
  });

  it('keeps quote requests tenant-scoped', async () => {
    await submit(valid);
    const other = createTenant(db, 'Other Co');
    expect(listQuoteRequests(other.scope)).toEqual({ items: [], unseenCount: 0 });
    expect(markQuoteRequestsSeen(other.scope).unseenCount).toBe(0);
    expect(db.select().from(quoteRequest).get()!.seenAt).toBeNull();
  });
});
