import { describe, expect, it } from 'vitest';
import {
  addDays,
  isIsoDate,
  isReturnOverdue,
  monthlyNthWeekday,
  todayIn,
  weeklyDates,
} from '../src/index.js';

describe('dates', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-2-3')).toBe(false);
  });
  it('adds days across months', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });
  it('first Friday of each month Jan–Jun gives six dates', () => {
    expect(monthlyNthWeekday('2026-01-01', '2026-06-30', 5, 1)).toEqual([
      '2026-01-02',
      '2026-02-06',
      '2026-03-06',
      '2026-04-03',
      '2026-05-01',
      '2026-06-05',
    ]);
    expect(monthlyNthWeekday('2026-01-01', '2026-01-31', 5, -1)).toEqual(['2026-01-30']);
  });
  it('weekly dates', () => {
    expect(weeklyDates('2026-01-02', '2026-01-20')).toEqual([
      '2026-01-02',
      '2026-01-09',
      '2026-01-16',
    ]);
  });
  it('today in Chicago', () => {
    expect(todayIn('America/Chicago', new Date('2026-01-01T03:00:00Z'))).toBe('2025-12-31');
  });

  it('flags a rental overdue once its return time passes in the tenant time zone', () => {
    const rental = {
      bookingType: 'equipment_rental' as const,
      endDate: '2099-07-12',
      returnTime: '10:00',
    };
    const tz = 'America/Chicago';
    // 9:59 and 10:00 CDT (UTC-5).
    expect(isReturnOverdue(rental, tz, new Date('2099-07-12T14:59:00Z'))).toBe(false);
    expect(isReturnOverdue(rental, tz, new Date('2099-07-12T15:00:00Z'))).toBe(true);
    expect(
      isReturnOverdue({ ...rental, returnTime: null }, tz, new Date('2099-07-13T04:59:00Z')),
    ).toBe(false);
    expect(
      isReturnOverdue({ ...rental, returnTime: null }, tz, new Date('2099-07-13T05:00:00Z')),
    ).toBe(true);
    const event = { bookingType: 'full_service' as const, endDate: '2099-07-12', returnTime: null };
    expect(isReturnOverdue(event, tz, new Date('2099-07-14T04:59:00Z'))).toBe(false);
    expect(isReturnOverdue(event, tz, new Date('2099-07-14T05:00:00Z'))).toBe(true);
  });
});
