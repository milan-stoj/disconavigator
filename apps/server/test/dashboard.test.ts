import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '@disco/shared';
import { TenantScope } from '../src/db/repository.js';
import { charge, equipmentType, equipmentUnit } from '../src/db/schema.js';
import { markOverdueBookings } from '../src/services/checkout.js';
import { buildTestApp, client, signIn } from './app-helpers.js';

describe('dashboard', () => {
  let app: FastifyInstance;
  let built: Awaited<ReturnType<typeof buildTestApp>>;
  let admin: ReturnType<typeof client>;
  let scope: TenantScope;
  let hp: string;
  let tx: string;
  let txUnit: string;
  let orgId: string;
  let contactId: string;
  const today = todayIn('America/Chicago');

  beforeEach(async () => {
    built = await buildTestApp();
    app = built.app;
    scope = new TenantScope(built.db, app.deps.seedResult.tenantId);
    admin = client(app, await signIn(app));
    const types = scope.list(equipmentType);
    hp = types.find((t) => t.name === 'Headphones')!.id;
    tx = types.find((t) => t.name === 'Transmitters')!.id;
    txUnit = scope.list(equipmentUnit).sort((a, b) => a.label.localeCompare(b.label))[0]!.id;
    orgId = (await admin.post('/api/organizations', { name: 'Brew City', type: 'bar' })).json().id;
    contactId = (
      await admin.post('/api/contacts', {
        name: 'Jordan Lee',
        email: 'jordan@brewcity.test',
        organizationId: orgId,
      })
    ).json().id;
  });
  afterEach(() => app.close());

  async function book(startDate: string, endDate = addDays(startDate, 1)) {
    const opp = (
      await admin.post('/api/opportunities', {
        title: `Event ${startDate}`,
        stage: 'contacted',
        organizationId: orgId,
        contactId,
      })
    ).json();
    const q = await admin.post('/api/quotes', {
      opportunityId: opp.id,
      bookingType: 'equipment_rental',
      pricingTerm: 'flat_fee',
      startDate,
      endDate,
      insideServiceArea: true,
      lines: [{ kind: 'custom', description: 'Package', quantity: 1, unitPriceCents: 50_000 }],
      requirements: { [hp]: 20, [tx]: 1 },
      staffRequired: 0,
    });
    expect(q.statusCode, q.body).toBe(201);
    const sent = await admin.post(`/api/quotes/${q.json().id}/send`);
    expect(sent.statusCode, sent.body).toBe(200);
    const token = sent.json().current.publicUrl.split('/q/')[1];
    const acc = await app.inject({
      method: 'POST',
      url: `/api/public/quotes/${token}/accept`,
      payload: { fullName: 'Jordan Lee', agreeToTerms: true },
    });
    expect(acc.statusCode, acc.body).toBe(200);
    return acc.json().bookingIds[0] as string;
  }

  it('summarizes upcoming bookings, overdue returns, money owed and pending charges', async () => {
    const soon = await book(addDays(today, 3));
    const later = await book(addDays(today, 20));
    const late = await book(addDays(today, -6), addDays(today, -4));
    await admin.post(`/api/bookings/${late}/payments`, {
      amountCents: 10_000,
      receivedOn: today,
      method: 'cash',
    });
    const out = await admin.post(`/api/bookings/${late}/check-out`, {
      pooled: [{ equipmentTypeId: hp, quantity: 20 }],
      unitIds: [txUnit],
    });
    expect(out.statusCode, out.body).toBe(200);
    expect(markOverdueBookings(built.db)).toEqual([late]);

    let d = (await admin.get('/api/dashboard')).json();
    const upcomingIds = d.upcoming.map((b: { id: string }) => b.id);
    expect(upcomingIds).toContain(soon);
    expect(upcomingIds).not.toContain(later);
    expect(upcomingIds).not.toContain(late);
    expect(d.overdueReturns).toEqual([
      expect.objectContaining({ id: late, customerName: 'Brew City', status: 'out' }),
    ]);
    expect(d.moneyOwed).toEqual({
      totalCents: 50_000 + 50_000 + 40_000,
      count: 3,
      // The rental 3 days out passed its balance due date (7 days before start).
      overdueCents: 50_000 + 40_000,
      overdueCount: 2,
    });
    expect(d.pendingCharges).toEqual([]);

    const back = await admin.post(`/api/bookings/${late}/check-in`, {
      pooled: [{ equipmentTypeId: hp, returned: 18, damaged: 0 }],
      returnedUnitIds: [txUnit],
      damagedUnitIds: [],
    });
    expect(back.statusCode, back.body).toBe(200);
    const [c] = scope.list(charge, { where: eq(charge.bookingId, late) });
    d = (await admin.get('/api/dashboard')).json();
    expect(d.overdueReturns).toEqual([]);
    expect(d.pendingCharges).toEqual([
      expect.objectContaining({
        id: c!.id,
        bookingId: late,
        kind: 'loss',
        proposedCents: c!.proposedCents,
        customerName: 'Brew City',
      }),
    ]);
  });

  it('requires a signed-in user', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/dashboard' })).statusCode).toBe(401);
  });
});
