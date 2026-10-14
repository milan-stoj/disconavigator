import { describe, expect, it } from 'vitest';
import { applyFound, computeLosses, lossCharge } from '../src/index.js';

describe('loss charges', () => {
  it('rental: 50 out, 47 back at $60 → 3 missing, $180 charge', () => {
    const [loss] = computeLosses([{ equipmentTypeId: 'hp', checkedOut: 50, returned: 47 }]);
    expect(loss!.missing).toBe(3);
    expect(
      lossCharge({ bookingType: 'equipment_rental', lines: [{ missing: 3, lossFeeCents: 6_000 }] }),
    ).toBe(18_000);
  });

  it('full-service: 100 out, 98 back → 2 missing, no customer charge', () => {
    const [loss] = computeLosses([{ equipmentTypeId: 'hp', checkedOut: 100, returned: 98 }]);
    expect(loss!.missing).toBe(2);
    expect(
      lossCharge({ bookingType: 'full_service', lines: [{ missing: 2, lossFeeCents: 6_000 }] }),
    ).toBe(0);
  });

  it('records damaged items', () => {
    const [loss] = computeLosses([
      { equipmentTypeId: 'hp', checkedOut: 50, returned: 50, damaged: 2 },
    ]);
    expect(loss).toEqual({ equipmentTypeId: 'hp', missing: 0, damaged: 2 });
    expect(() => computeLosses([{ equipmentTypeId: 'hp', checkedOut: 5, returned: 6 }])).toThrow();
    expect(() =>
      computeLosses([{ equipmentTypeId: 'hp', checkedOut: 5, returned: 2, damaged: 3 }]),
    ).toThrow();
  });

  it('2 of 3 missing found → 1 missing, charge reduced to $60', () => {
    const remaining = applyFound(3, 2);
    expect(remaining).toBe(1);
    expect(
      lossCharge({
        bookingType: 'equipment_rental',
        lines: [{ missing: remaining, lossFeeCents: 6_000 }],
      }),
    ).toBe(6_000);
    expect(() => applyFound(1, 2)).toThrow();
    expect(() => applyFound(1, 0)).toThrow();
  });
});
