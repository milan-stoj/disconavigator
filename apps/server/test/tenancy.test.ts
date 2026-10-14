import { describe, expect, it } from 'vitest';
import { contact, equipmentType, organization } from '../src/db/schema.js';
import { NotFoundError } from '../src/lib/errors.js';
import { createTenant, createTestDb } from './helpers.js';

describe('tenant isolation', () => {
  const { db } = createTestDb();
  const a = createTenant(db, 'Alpha');
  const b = createTenant(db, 'Bravo');
  const orgB = b.scope.insert(organization, { name: 'Bar B', type: 'bar' });
  a.scope.insert(organization, { name: 'Bar A', type: 'bar' });
  const contactB = b.scope.insert(contact, { name: 'Bee', organizationId: orgB.id });
  const eqB = b.scope.insert(equipmentType, {
    name: 'Headphones',
    trackingMode: 'pooled',
    ownedQuantity: 10,
  });

  it('lists only own records', () => {
    expect(a.scope.list(organization).map((o) => o.name)).toEqual(['Bar A']);
    expect(b.scope.list(organization).map((o) => o.name)).toEqual(['Bar B']);
    expect(a.scope.list(contact)).toEqual([]);
    expect(a.scope.list(equipmentType)).toEqual([]);
  });

  it("fetching another tenant's record by id returns not found", () => {
    expect(a.scope.find(organization, orgB.id)).toBeUndefined();
    expect(() => a.scope.get(organization, orgB.id)).toThrow(NotFoundError);
    expect(() => a.scope.get(contact, contactB.id)).toThrow(NotFoundError);
    expect(() => a.scope.get(equipmentType, eqB.id)).toThrow(NotFoundError);
  });

  it("cannot update or delete another tenant's record", () => {
    expect(() => a.scope.update(organization, orgB.id, { name: 'pwned' })).toThrow(NotFoundError);
    expect(() => a.scope.delete(organization, orgB.id)).toThrow(NotFoundError);
    expect(b.scope.get(organization, orgB.id).name).toBe('Bar B');
  });

  it('insert always stamps the scope tenant', () => {
    const row = a.scope.insert(organization, {
      name: 'Sneaky',
      type: 'bar',
      tenantId: b.tenantId,
    } as unknown as Parameters<typeof a.scope.insert<typeof organization>>[1]);
    expect(row.tenantId).toBe(a.tenantId);
  });

  it('transactions stay scoped and roll back on error', () => {
    expect(() =>
      a.scope.transaction((s) => {
        s.insert(organization, { name: 'Rolled back', type: 'bar' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(a.scope.list(organization).some((o) => o.name === 'Rolled back')).toBe(false);
  });
});
