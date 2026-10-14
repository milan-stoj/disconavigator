import { describe, expect, it } from 'vitest';
import {
  acceptQuoteSchema,
  checkinSchema,
  contactSchema,
  createUserSchema,
  externalPaymentSchema,
  inventoryAdjustmentSchema,
  lossChargeDecisionSchema,
  makeQuoteRequestSchema,
  organizationSchema,
  quoteSchema,
  rentalLogisticsSchema,
  settingsSchema,
  stageChangeSchema,
} from '../src/index.js';

const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join('.'));

describe('quote request schema', () => {
  const schema = makeQuoteRequestSchema(() => '2026-05-01');
  const valid = {
    name: 'Pat',
    email: 'Pat@Example.com',
    serviceInterest: 'equipment_rental',
    eventDate: '2026-06-01',
    expectedAttendance: 80,
    location: 'Madison',
  };
  it('accepts a complete request and normalizes email', () => {
    const r = schema.safeParse(valid);
    expect(r.success).toBe(true);
    expect(r.data!.email).toBe('pat@example.com');
  });
  it('rejects missing email and past event date', () => {
    const { email: _omit, ...noEmail } = valid;
    expect(paths(schema.safeParse(noEmail))).toContain('email');
    expect(paths(schema.safeParse({ ...valid, eventDate: '2026-04-30' }))).toContain('eventDate');
  });
});

describe('CRM schemas', () => {
  it('requires organization name and valid type', () => {
    expect(paths(organizationSchema.safeParse({ name: ' ', type: 'bar' }))).toContain('name');
    expect(paths(organizationSchema.safeParse({ name: 'Bar X', type: 'spaceship' }))).toContain(
      'type',
    );
    expect(
      organizationSchema.safeParse({ name: 'Bar X', type: 'bar', city: 'Milwaukee' }).success,
    ).toBe(true);
  });
  it('validates contact email', () => {
    expect(paths(contactSchema.safeParse({ name: 'Jordan', email: 'nope' }))).toContain('email');
    expect(contactSchema.parse({ name: 'Jordan', email: '' }).email).toBeNull();
  });
  it('requires a loss reason when marking Lost', () => {
    expect(paths(stageChangeSchema.safeParse({ stage: 'lost' }))).toContain('lossReason');
    expect(paths(stageChangeSchema.safeParse({ stage: 'lost', lossReason: 'other' }))).toContain(
      'lossNote',
    );
    expect(stageChangeSchema.safeParse({ stage: 'lost', lossReason: 'capacity' }).success).toBe(
      true,
    );
    expect(stageChangeSchema.safeParse({ stage: 'contacted' }).success).toBe(true);
  });
});

describe('quote schema', () => {
  const base = {
    opportunityId: 'o1',
    bookingType: 'equipment_rental',
    pricingTerm: 'flat_fee',
    startDate: '2026-06-05',
    endDate: '2026-06-07',
    lines: [
      {
        kind: 'package',
        description: 'Party 50',
        quantity: 1,
        unitPriceCents: 30000,
        packageId: 'p',
      },
    ],
  };
  it('accepts a rental quote', () => {
    expect(quoteSchema.safeParse(base).success).toBe(true);
  });
  it('rejects split pricing on rentals', () => {
    expect(
      paths(quoteSchema.safeParse({ ...base, pricingTerm: 'door_split', splitBps: 4000 })),
    ).toContain('pricingTerm');
  });
  it('requires split and guarantee for split terms', () => {
    const fs = { ...base, bookingType: 'full_service', lines: [] };
    expect(paths(quoteSchema.safeParse({ ...fs, pricingTerm: 'door_split' }))).toContain(
      'splitBps',
    );
    expect(
      paths(quoteSchema.safeParse({ ...fs, pricingTerm: 'guarantee_plus_split', splitBps: 4000 })),
    ).toContain('guaranteeCents');
  });
  it('rejects end before start, empty flat quote, fractional cents, series on rentals', () => {
    expect(paths(quoteSchema.safeParse({ ...base, endDate: '2026-06-01' }))).toContain('endDate');
    expect(paths(quoteSchema.safeParse({ ...base, lines: [] }))).toContain('lines');
    expect(
      quoteSchema.safeParse({ ...base, lines: [{ ...base.lines[0], unitPriceCents: 1.5 }] })
        .success,
    ).toBe(false);
    expect(paths(quoteSchema.safeParse({ ...base, occurrenceDates: ['2026-06-05'] }))).toContain(
      'occurrenceDates',
    );
  });
  it('acceptance requires agreeing and a full name', () => {
    expect(paths(acceptQuoteSchema.safeParse({ fullName: '', agreeToTerms: true }))).toContain(
      'fullName',
    );
    expect(
      paths(acceptQuoteSchema.safeParse({ fullName: 'Pat Doe', agreeToTerms: false })),
    ).toContain('agreeToTerms');
  });
});

describe('operations schemas', () => {
  it('delivery requires an address and return after dispatch', () => {
    const r = rentalLogisticsSchema.safeParse({
      fulfillment: 'delivery',
      dispatchDate: '2026-06-05',
      returnDate: '2026-06-04',
    });
    expect(paths(r)).toEqual(expect.arrayContaining(['returnDate', 'deliveryAddress']));
  });
  it('damaged cannot exceed returned at check-in', () => {
    expect(
      paths(
        checkinSchema.safeParse({
          pooled: [{ equipmentTypeId: 'hp', returned: 1, damaged: 2 }],
          returnedUnitIds: [],
        }),
      ),
    ).toContain('pooled.0.damaged');
  });
  it('inventory adjustment direction matches reason', () => {
    expect(inventoryAdjustmentSchema.safeParse({ delta: 50, reason: 'purchase' }).success).toBe(
      true,
    );
    expect(paths(inventoryAdjustmentSchema.safeParse({ delta: 5, reason: 'retired' }))).toContain(
      'delta',
    );
    expect(paths(inventoryAdjustmentSchema.safeParse({ delta: 0, reason: 'lost' }))).toContain(
      'delta',
    );
  });
  it('external payment must be positive; waiving needs a reason', () => {
    expect(
      externalPaymentSchema.safeParse({ amountCents: 0, receivedOn: '2026-06-01', method: 'cash' })
        .success,
    ).toBe(false);
    expect(paths(lossChargeDecisionSchema.safeParse({ action: 'waive' }))).toContain('reason');
  });
  it('user creation requires a strong-enough password and a role', () => {
    expect(
      paths(
        createUserSchema.safeParse({
          username: 'dj',
          displayName: 'DJ',
          role: 'staff',
          password: 'short',
        }),
      ),
    ).toContain('password');
    expect(
      paths(
        createUserSchema.safeParse({
          username: 'dj',
          displayName: 'DJ',
          role: 'owner',
          password: 'long-enough-pass',
        }),
      ),
    ).toContain('role');
  });
  it('settings bound deposit percentage', () => {
    const r = settingsSchema.safeParse({
      businessName: 'UDP',
      timeZone: 'America/Chicago',
      rentalDepositBps: 20_001,
      bufferDays: 1,
      rentalBalanceDueDays: 7,
      fullServiceInvoiceDueOffsetDays: 0,
      deliveryFeeCents: 7500,
      quoteValidityDays: 14,
      rentalTerms: '',
      fullServiceTerms: '',
    });
    expect(paths(r)).toContain('rentalDepositBps');
  });
});
