import { describe, expect, it } from 'vitest';
import type { Quote } from '@/lib/quotes';
import {
  emptyQuoteForm,
  liveFinancials,
  quoteToForm,
  seriesDates,
  seriesPatternLabel,
  toQuoteBody,
} from './quote-form';

describe('series dates', () => {
  it('lists the first Friday of each month from January to June', () => {
    const v = {
      startDate: '2099-01-02',
      seriesUntil: '2099-06-30',
      seriesPattern: 'monthly' as const,
    };
    expect(seriesPatternLabel('monthly', v.startDate)).toBe('The first Friday of each month');
    expect(seriesDates(v)).toEqual([
      '2099-01-02',
      '2099-02-06',
      '2099-03-06',
      '2099-04-03',
      '2099-05-01',
      '2099-06-05',
    ]);
  });

  it('supports weekly and every-other-week series', () => {
    const base = { startDate: '2099-01-02', seriesUntil: '2099-01-31' };
    expect(seriesDates({ ...base, seriesPattern: 'weekly' })).toHaveLength(5);
    expect(seriesDates({ ...base, seriesPattern: 'biweekly' })).toEqual([
      '2099-01-02',
      '2099-01-16',
      '2099-01-30',
    ]);
  });
});

describe('quote form mapping', () => {
  it('computes rental totals with the deposit and no deposit for full-service', () => {
    const rental = {
      ...emptyQuoteForm('equipment_rental', { startDate: '2099-03-06' }),
      lines: [
        {
          kind: 'package' as const,
          description: 'Party 50',
          quantity: 1,
          unitPrice: 1000,
          packageId: 'p1',
        },
      ],
    };
    expect(liveFinancials(rental, 2000)).toMatchObject({
      totalCents: 100_000,
      depositCents: 20_000,
      balanceCents: 80_000,
    });
    const full = {
      ...rental,
      bookingType: 'full_service' as const,
      lines: [{ ...rental.lines[0]!, kind: 'custom' as const, packageId: null }],
    };
    expect(liveFinancials(full, 2000)).toMatchObject({ totalCents: 100_000, depositCents: 0 });
  });

  it('sends a full-service split quote without line items or a deposit field', () => {
    const v = {
      ...emptyQuoteForm('full_service', { startDate: '2099-01-02' }),
      pricingTerm: 'guarantee_plus_split' as const,
      splitPercent: 40,
      guarantee: 500,
      lines: [
        { kind: 'custom' as const, description: 'old', quantity: 1, unitPrice: 1, packageId: null },
      ],
      seriesEnabled: true,
      seriesUntil: '2099-03-31',
    };
    const body = toQuoteBody(v, 'opp');
    expect(body).toMatchObject({
      splitBps: 4000,
      guaranteeCents: 50_000,
      lines: [],
      endDate: '2099-01-02',
      occurrenceDates: ['2099-01-02', '2099-02-06', '2099-03-06'],
    });
  });

  it('edits only the extra equipment beyond what packages include', () => {
    const quote = {
      current: {
        bookingType: 'equipment_rental',
        pricingTerm: 'flat_fee',
        startDate: '2099-03-06',
        endDate: '2099-03-08',
        startTime: null,
        endTime: null,
        location: null,
        insideServiceArea: true,
        expectedAttendance: null,
        splitBps: null,
        guaranteeCents: null,
        requirements: { hp: 60, tx: 1 },
        staffRequired: 0,
        occurrenceDates: null,
        notes: null,
        lines: [
          {
            id: 'l1',
            position: 0,
            kind: 'package',
            description: 'Party 50',
            quantity: 1,
            unitPriceCents: 30_000,
            packageId: 'p1',
          },
        ],
      },
    } as unknown as Quote;
    const form = quoteToForm(quote, [
      {
        id: 'p1',
        items: [
          { equipmentTypeId: 'hp', quantity: 50 },
          { equipmentTypeId: 'tx', quantity: 1 },
        ],
      },
    ]);
    expect(form.requirements).toEqual({ hp: 10 });
    expect(form.lines[0]).toMatchObject({ unitPrice: 300, packageId: 'p1' });
  });
});
