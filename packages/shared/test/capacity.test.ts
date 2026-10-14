import { describe, expect, it } from 'vitest';
import {
  checkCommitment,
  computeCapacity,
  holdStrengthForBooking,
  holdWindow,
  type CapacityHold,
} from '../src/index.js';

const base = {
  bufferDays: 1,
  equipment: [
    { equipmentTypeId: 'hp', owned: 100, outOfService: 0 },
    { equipmentTypeId: 'tx', owned: 3, outOfService: 0 },
  ],
  staffMemberIds: ['dj1', 'dj2'],
  staffUnavailability: [],
};

function hold(
  p: Partial<CapacityHold> & Pick<CapacityHold, 'id' | 'startDate' | 'endDate'>,
): CapacityHold {
  return {
    source: 'booking',
    label: p.id,
    bookingType: 'equipment_rental',
    strength: 'confirmed',
    requirements: {},
    staffRequired: 0,
    assignedStaffIds: [],
    ...p,
  };
}

// 2026-06-05 is a Friday.
const FRI = '2026-06-05',
  SAT = '2026-06-06',
  SUN = '2026-06-07',
  MON = '2026-06-08',
  TUE = '2026-06-09';

describe('capacity folding', () => {
  it('Friday-to-Sunday rental with 1-day buffer commits Friday through Monday', () => {
    expect(holdWindow({ startDate: FRI, endDate: SUN }, 1)).toEqual({ from: FRI, to: MON });
    const days = computeCapacity({
      ...base,
      from: '2026-06-04',
      to: TUE,
      holds: [hold({ id: 'r', startDate: FRI, endDate: SUN, requirements: { hp: 50, tx: 1 } })],
    });
    const committed = Object.fromEntries(days.map((d) => [d.date, d.equipment.hp!.committed]));
    expect(committed).toEqual({
      '2026-06-04': 0,
      [FRI]: 50,
      [SAT]: 50,
      [SUN]: 50,
      [MON]: 50,
      [TUE]: 0,
    });
    expect(days.find((d) => d.date === MON)!.equipment.hp!.available).toBe(50);
  });

  it('full-service Saturday with 100 headphones, 2 transmitters, one DJ', () => {
    const [sat] = computeCapacity({
      ...base,
      from: SAT,
      to: SAT,
      holds: [
        hold({
          id: 'fs',
          bookingType: 'full_service',
          startDate: SAT,
          endDate: SAT,
          requirements: { hp: 100, tx: 2 },
          assignedStaffIds: ['dj1'],
          staffRequired: 1,
        }),
      ],
    });
    expect(sat!.equipment.hp!.available).toBe(0);
    expect(sat!.equipment.tx!.available).toBe(1);
    expect(sat!.staff.available).toBe(1);
    expect(sat!.holds.map((h) => h.id)).toEqual(['fs']);
    expect(sat!.conflict).toBe(false);
  });

  it('tentative and confirmed both reduce capacity; quotes are soft', () => {
    const [sat] = computeCapacity({
      ...base,
      from: SAT,
      to: SAT,
      holds: [
        hold({
          id: 'rent',
          strength: 'tentative',
          startDate: SAT,
          endDate: SAT,
          requirements: { hp: 30 },
        }),
        hold({
          id: 'fs',
          bookingType: 'full_service',
          startDate: SAT,
          endDate: SAT,
          requirements: { hp: 40 },
        }),
        hold({
          id: 'q',
          source: 'quote',
          strength: 'soft',
          startDate: SAT,
          endDate: SAT,
          requirements: { hp: 60 },
        }),
      ],
    });
    expect(sat!.equipment.hp).toMatchObject({
      committed: 70,
      tentative: 30,
      softDemand: 60,
      available: 30,
    });
    expect(sat!.holds.map((h) => h.strength)).toEqual(['tentative', 'confirmed', 'soft']);
  });

  it('a sent quote alone leaves 100 headphones available', () => {
    const [d] = computeCapacity({
      ...base,
      from: SAT,
      to: SAT,
      holds: [
        hold({
          id: 'q',
          source: 'quote',
          strength: 'soft',
          startDate: SAT,
          endDate: SAT,
          requirements: { hp: 60 },
        }),
      ],
    });
    expect(d!.equipment.hp!.available).toBe(100);
    expect(d!.holds).toHaveLength(1);
  });

  it('cancelled bookings hold nothing; awaiting deposit is tentative', () => {
    expect(holdStrengthForBooking('cancelled')).toBeNull();
    expect(holdStrengthForBooking('awaiting_deposit')).toBe('tentative');
    expect(holdStrengthForBooking('out')).toBe('confirmed');
  });

  it('overbooking 130 headphones on 100 owned reports a 30 shortfall', () => {
    const existing = [hold({ id: 'a', startDate: SAT, endDate: SAT, requirements: { hp: 80 } })];
    const candidate = hold({ id: 'b', startDate: SAT, endDate: SAT, requirements: { hp: 50 } });
    const shortfalls = checkCommitment({ ...base, bufferDays: 0, holds: existing }, candidate);
    expect(shortfalls).toEqual([{ date: SAT, resource: 'hp', shortfall: 30 }]);
    expect(checkCommitment({ ...base, bufferDays: 0, holds: [] }, candidate)).toEqual([]);
  });

  it('split fleet: two full-service events sharing a night flag fleet split and conflict on shortfall', () => {
    const [d] = computeCapacity({
      ...base,
      from: SAT,
      to: SAT,
      holds: [
        hold({
          id: 'bar1',
          bookingType: 'full_service',
          startDate: SAT,
          endDate: SAT,
          requirements: { hp: 60, tx: 2 },
          assignedStaffIds: ['dj1'],
          staffRequired: 1,
        }),
        hold({
          id: 'bar2',
          bookingType: 'full_service',
          startDate: SAT,
          endDate: SAT,
          requirements: { hp: 60, tx: 2 },
          assignedStaffIds: ['dj2'],
          staffRequired: 1,
        }),
      ],
    });
    expect(d!.fleetSplit).toBe(true);
    expect(d!.equipment.hp!.shortfall).toBe(20);
    expect(d!.equipment.tx!.shortfall).toBe(1);
    expect(d!.staff.available).toBe(0);
    expect(d!.conflict).toBe(true);
  });

  it('split fleet that fits is flagged but not a conflict', () => {
    const [d] = computeCapacity({
      ...base,
      from: SAT,
      to: SAT,
      holds: [
        hold({
          id: 'a',
          bookingType: 'full_service',
          startDate: SAT,
          endDate: SAT,
          requirements: { hp: 50, tx: 1 },
          staffRequired: 1,
        }),
        hold({
          id: 'b',
          bookingType: 'full_service',
          startDate: SAT,
          endDate: SAT,
          requirements: { hp: 50, tx: 2 },
          staffRequired: 1,
        }),
      ],
    });
    expect(d!.fleetSplit).toBe(true);
    expect(d!.conflict).toBe(false);
  });

  it('DJ unavailable leaves at most one DJ; staff shortfall and double booking are conflicts', () => {
    const unavail = [{ staffMemberId: 'dj2', date: SAT }];
    const [d] = computeCapacity({
      ...base,
      staffUnavailability: unavail,
      from: SAT,
      to: SAT,
      holds: [],
    });
    expect(d!.staff.available).toBe(1);

    const [d2] = computeCapacity({
      ...base,
      staffUnavailability: unavail,
      from: SAT,
      to: SAT,
      holds: [
        hold({
          id: 'a',
          bookingType: 'full_service',
          startDate: SAT,
          endDate: SAT,
          staffRequired: 1,
        }),
        hold({
          id: 'b',
          bookingType: 'full_service',
          startDate: SAT,
          endDate: SAT,
          staffRequired: 1,
        }),
      ],
    });
    expect(d2!.staff.shortfall).toBe(1);
    expect(d2!.conflict).toBe(true);

    const [d3] = computeCapacity({
      ...base,
      from: SAT,
      to: SAT,
      holds: [
        hold({
          id: 'a',
          bookingType: 'full_service',
          startDate: SAT,
          endDate: SAT,
          assignedStaffIds: ['dj1'],
          staffRequired: 1,
        }),
        hold({
          id: 'b',
          bookingType: 'full_service',
          startDate: SAT,
          endDate: SAT,
          assignedStaffIds: ['dj1'],
          staffRequired: 1,
        }),
      ],
    });
    expect(d3!.staff.doubleBookedStaffIds).toEqual(['dj1']);
    expect(d3!.conflict).toBe(true);
  });

  it('staff are only committed on the event day, not buffer days', () => {
    const days = computeCapacity({
      ...base,
      from: SAT,
      to: SUN,
      holds: [
        hold({
          id: 'fs',
          bookingType: 'full_service',
          startDate: SAT,
          endDate: SAT,
          staffRequired: 1,
          requirements: { hp: 10 },
        }),
      ],
    });
    expect(days[0]!.staff.committed).toBe(1);
    expect(days[1]!.staff.committed).toBe(0);
    expect(days[1]!.equipment.hp!.committed).toBe(10);
  });

  it('out-of-service units reduce usable capacity', () => {
    const [d] = computeCapacity({
      ...base,
      equipment: [{ equipmentTypeId: 'hp', owned: 100, outOfService: 5 }],
      from: SAT,
      to: SAT,
      holds: [],
    });
    expect(d!.equipment.hp!.available).toBe(95);
  });
});
