import {
  equipmentTypeSchema,
  equipmentUnitSchema,
  inventoryAdjustmentSchema,
  outOfServiceSchema,
  rentalPackageSchema,
  unitStatusSchema,
  type EquipmentCapacity,
} from '@disco/shared';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import type { TenantScope } from '../db/repository.js';
import {
  equipmentType,
  equipmentUnit,
  inventoryAdjustment,
  packageItem,
  rentalPackage,
  user,
} from '../db/schema.js';
import { ConflictError, ValidationError } from '../lib/errors.js';
import type { ServiceContext } from './context.js';

type TypeRow = typeof equipmentType.$inferSelect;
type UnitRow = typeof equipmentUnit.$inferSelect;
type PackageRow = typeof rentalPackage.$inferSelect;

/** Units that are still owned (retired and lost units are kept only for history). */
const OWNED_UNIT_STATUSES: UnitRow['status'][] = ['in_service', 'out_of_service'];

export interface EquipmentTypeView {
  id: string;
  name: string;
  trackingMode: TypeRow['trackingMode'];
  lossFeeCents: number;
  owned: number;
  outOfService: number;
  inService: number;
  units: UnitRow[];
}

function toView(type: TypeRow, units: UnitRow[]): EquipmentTypeView {
  if (type.trackingMode === 'pooled') {
    return {
      id: type.id,
      name: type.name,
      trackingMode: type.trackingMode,
      lossFeeCents: type.lossFeeCents,
      owned: type.ownedQuantity,
      outOfService: type.outOfServiceQuantity,
      inService: type.ownedQuantity - type.outOfServiceQuantity,
      units: [],
    };
  }
  const owned = units.filter((u) => OWNED_UNIT_STATUSES.includes(u.status));
  const outOfService = owned.filter((u) => u.status === 'out_of_service').length;
  return {
    id: type.id,
    name: type.name,
    trackingMode: type.trackingMode,
    lossFeeCents: type.lossFeeCents,
    owned: owned.length,
    outOfService,
    inService: owned.length - outOfService,
    units,
  };
}

export function listEquipment(scope: TenantScope): EquipmentTypeView[] {
  const types = scope.list(equipmentType, {
    orderBy: [{ column: equipmentType.sortOrder }, { column: equipmentType.name }],
  });
  const units = scope.list(equipmentUnit, { orderBy: [{ column: equipmentUnit.label }] });
  return types.map((t) =>
    toView(
      t,
      units.filter((u) => u.equipmentTypeId === t.id),
    ),
  );
}

export function getEquipment(scope: TenantScope, id: string): EquipmentTypeView {
  const type = scope.get(equipmentType, id, 'Equipment type');
  const units = scope.list(equipmentUnit, {
    where: eq(equipmentUnit.equipmentTypeId, id),
    orderBy: [{ column: equipmentUnit.label }],
  });
  return toView(type, units);
}

/** Owned and out-of-service counts per type, the input to availability calculations. */
export function equipmentCapacity(scope: TenantScope): EquipmentCapacity[] {
  return listEquipment(scope).map((t) => ({
    equipmentTypeId: t.id,
    owned: t.owned,
    outOfService: t.outOfService,
  }));
}

function assertUniqueName(scope: TenantScope, name: string, exceptId?: string) {
  const clash = scope
    .list(equipmentType)
    .find((t) => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase());
  if (clash) {
    throw new ConflictError('An equipment type with that name already exists', {
      fieldErrors: { name: 'An equipment type with that name already exists' },
    });
  }
}

export function createEquipmentType(
  ctx: ServiceContext,
  input: z.output<typeof equipmentTypeSchema>,
) {
  assertUniqueName(ctx.scope, input.name);
  const sortOrder = ctx.scope.list(equipmentType).length;
  const created = ctx.scope.insert(equipmentType, { ...input, sortOrder });
  return getEquipment(ctx.scope, created.id);
}

export function updateEquipmentType(
  ctx: ServiceContext,
  id: string,
  input: Pick<z.output<typeof equipmentTypeSchema>, 'name' | 'lossFeeCents'>,
) {
  ctx.scope.get(equipmentType, id, 'Equipment type');
  assertUniqueName(ctx.scope, input.name, id);
  ctx.scope.update(equipmentType, id, { name: input.name, lossFeeCents: input.lossFeeCents });
  return getEquipment(ctx.scope, id);
}

/** Adds or removes pooled quantity (purchase, retired, lost, damaged, found). */
export function adjustPooledQuantity(
  ctx: ServiceContext,
  id: string,
  input: z.output<typeof inventoryAdjustmentSchema>,
) {
  return ctx.scope.transaction((scope) => {
    const type = scope.get(equipmentType, id, 'Equipment type');
    if (type.trackingMode !== 'pooled') {
      throw new ValidationError('Add or retire individual units for serialized equipment');
    }
    const owned = type.ownedQuantity + input.delta;
    if (owned < 0) {
      throw new ValidationError(`Only ${type.ownedQuantity} are owned`, {
        fieldErrors: { delta: `Only ${type.ownedQuantity} are owned` },
      });
    }
    if (owned < type.outOfServiceQuantity) {
      const msg = `${type.outOfServiceQuantity} are out of service; return some to service first`;
      throw new ValidationError(msg, { fieldErrors: { delta: msg } });
    }
    scope.update(equipmentType, id, { ownedQuantity: owned });
    scope.insert(inventoryAdjustment, {
      equipmentTypeId: id,
      delta: input.delta,
      reason: input.reason,
      note: input.note ?? null,
      userId: ctx.userId,
    });
    return getEquipment(scope, id);
  });
}

/** Sets how many pooled items are out of service (for example, charging failure or repair). */
export function setPooledOutOfService(
  ctx: ServiceContext,
  id: string,
  input: z.output<typeof outOfServiceSchema>,
) {
  return ctx.scope.transaction((scope) => {
    const type = scope.get(equipmentType, id, 'Equipment type');
    if (type.trackingMode !== 'pooled') {
      throw new ValidationError('Change the status of individual units for serialized equipment');
    }
    if (input.quantity > type.ownedQuantity) {
      const msg = `Only ${type.ownedQuantity} are owned`;
      throw new ValidationError(msg, { fieldErrors: { quantity: msg } });
    }
    const change = input.quantity - type.outOfServiceQuantity;
    if (change === 0) return getEquipment(scope, id);
    scope.update(equipmentType, id, { outOfServiceQuantity: input.quantity });
    scope.insert(inventoryAdjustment, {
      equipmentTypeId: id,
      delta: Math.abs(change),
      reason: change > 0 ? 'out_of_service' : 'returned_to_service',
      note: input.note ?? null,
      userId: ctx.userId,
    });
    return getEquipment(scope, id);
  });
}

export function addUnit(
  ctx: ServiceContext,
  typeId: string,
  input: z.output<typeof equipmentUnitSchema>,
) {
  return ctx.scope.transaction((scope) => {
    const type = scope.get(equipmentType, typeId, 'Equipment type');
    if (type.trackingMode !== 'serialized') {
      throw new ValidationError('Adjust the quantity for pooled equipment');
    }
    const clash = scope.first(
      equipmentUnit,
      and(eq(equipmentUnit.equipmentTypeId, typeId), eq(equipmentUnit.label, input.label)),
    );
    if (clash) {
      throw new ConflictError('A unit with that label already exists', {
        fieldErrors: { label: 'A unit with that label already exists' },
      });
    }
    const unit = scope.insert(equipmentUnit, {
      equipmentTypeId: typeId,
      label: input.label,
      notes: input.notes ?? null,
    });
    scope.insert(inventoryAdjustment, {
      equipmentTypeId: typeId,
      unitId: unit.id,
      delta: 1,
      reason: 'purchase',
      userId: ctx.userId,
    });
    return getEquipment(scope, typeId);
  });
}

const UNIT_STATUS_REASON: Record<UnitRow['status'], string> = {
  in_service: 'returned_to_service',
  out_of_service: 'out_of_service',
  retired: 'retired',
  lost: 'lost',
};

/** True when the change needs an admin: retiring, losing, or restoring a removed unit. */
export function unitStatusNeedsAdmin(from: UnitRow['status'], to: UnitRow['status']) {
  const owned = (s: UnitRow['status']) => OWNED_UNIT_STATUSES.includes(s);
  return !owned(from) || !owned(to);
}

export function getUnit(scope: TenantScope, unitId: string) {
  return scope.get(equipmentUnit, unitId, 'Unit');
}

export function setUnitStatus(
  ctx: ServiceContext,
  unitId: string,
  input: z.output<typeof unitStatusSchema>,
) {
  return ctx.scope.transaction((scope) => {
    const unit = scope.get(equipmentUnit, unitId, 'Unit');
    if (unit.status === input.status) return getEquipment(scope, unit.equipmentTypeId);
    const wasOwned = OWNED_UNIT_STATUSES.includes(unit.status);
    const isOwned = OWNED_UNIT_STATUSES.includes(input.status);
    scope.update(equipmentUnit, unitId, { status: input.status });
    scope.insert(inventoryAdjustment, {
      equipmentTypeId: unit.equipmentTypeId,
      unitId,
      delta: wasOwned === isOwned ? 0 : isOwned ? 1 : -1,
      reason: !wasOwned && isOwned ? 'found' : UNIT_STATUS_REASON[input.status],
      note: input.note ?? null,
      userId: ctx.userId,
    });
    return getEquipment(scope, unit.equipmentTypeId);
  });
}

export function listAdjustments(scope: TenantScope, typeId: string) {
  scope.get(equipmentType, typeId, 'Equipment type');
  return scope.db
    .select({
      id: inventoryAdjustment.id,
      delta: inventoryAdjustment.delta,
      reason: inventoryAdjustment.reason,
      note: inventoryAdjustment.note,
      unitId: inventoryAdjustment.unitId,
      unitLabel: equipmentUnit.label,
      bookingId: inventoryAdjustment.bookingId,
      userName: user.displayName,
      createdAt: inventoryAdjustment.createdAt,
    })
    .from(inventoryAdjustment)
    .leftJoin(equipmentUnit, eq(equipmentUnit.id, inventoryAdjustment.unitId))
    .leftJoin(user, eq(user.id, inventoryAdjustment.userId))
    .where(
      scope.ownedBy(inventoryAdjustment.tenantId, eq(inventoryAdjustment.equipmentTypeId, typeId)),
    )
    .orderBy(desc(inventoryAdjustment.createdAt), desc(inventoryAdjustment.id))
    .all();
}

// ---------- Rental packages ----------

export interface PackageItemView {
  equipmentTypeId: string;
  equipmentName: string;
  quantity: number;
  /** Package-specific loss fee, or null to use the equipment type's default. */
  lossFeeCents: number | null;
  effectiveLossFeeCents: number;
}

export interface PackageView extends PackageRow {
  items: PackageItemView[];
}

function packageItems(scope: TenantScope, packageIds: string[]) {
  if (packageIds.length === 0) return [];
  return scope.db
    .select({
      packageId: packageItem.packageId,
      equipmentTypeId: packageItem.equipmentTypeId,
      equipmentName: equipmentType.name,
      quantity: packageItem.quantity,
      lossFeeCents: packageItem.lossFeeCents,
      defaultLossFeeCents: equipmentType.lossFeeCents,
    })
    .from(packageItem)
    .innerJoin(equipmentType, eq(equipmentType.id, packageItem.equipmentTypeId))
    .where(scope.ownedBy(packageItem.tenantId, inArray(packageItem.packageId, packageIds)))
    .orderBy(asc(equipmentType.sortOrder), asc(equipmentType.name))
    .all();
}

function withItems(scope: TenantScope, rows: PackageRow[]): PackageView[] {
  const items = packageItems(
    scope,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    ...r,
    items: items
      .filter((i) => i.packageId === r.id)
      .map((i) => ({
        equipmentTypeId: i.equipmentTypeId,
        equipmentName: i.equipmentName,
        quantity: i.quantity,
        lossFeeCents: i.lossFeeCents,
        effectiveLossFeeCents: i.lossFeeCents ?? i.defaultLossFeeCents,
      })),
  }));
}

export function listPackages(scope: TenantScope, opts: { activeOnly?: boolean } = {}) {
  const rows = scope.list(rentalPackage, {
    where: opts.activeOnly ? eq(rentalPackage.active, true) : undefined,
    orderBy: [{ column: rentalPackage.priceCents }, { column: rentalPackage.name }],
  });
  return withItems(scope, rows);
}

export function getPackage(scope: TenantScope, id: string): PackageView {
  return withItems(scope, [scope.get(rentalPackage, id, 'Package')])[0]!;
}

/** Loads a package that may be added to a new quote; deactivated packages are refused. */
export function requireQuotablePackage(scope: TenantScope, id: string): PackageView {
  const pkg = getPackage(scope, id);
  if (!pkg.active) {
    throw new ValidationError(`"${pkg.name}" is no longer offered and cannot be added to quotes`, {
      fieldErrors: { packageId: 'This package is no longer offered' },
    });
  }
  return pkg;
}

type PackageInput = z.output<typeof rentalPackageSchema>;

function validatePackage(scope: TenantScope, input: PackageInput, exceptId?: string) {
  const fieldErrors: Record<string, string> = {};
  const clash = scope
    .list(rentalPackage)
    .find((p) => p.id !== exceptId && p.name.toLowerCase() === input.name.toLowerCase());
  if (clash) fieldErrors.name = 'A package with that name already exists';
  const typeIds = new Set(scope.list(equipmentType).map((t) => t.id));
  const seen = new Set<string>();
  input.items.forEach((item, i) => {
    if (!typeIds.has(item.equipmentTypeId)) {
      fieldErrors[`items.${i}.equipmentTypeId`] = 'Choose equipment';
    } else if (seen.has(item.equipmentTypeId)) {
      fieldErrors[`items.${i}.equipmentTypeId`] = 'This equipment is already in the package';
    }
    seen.add(item.equipmentTypeId);
  });
  if (Object.keys(fieldErrors).length > 0) {
    throw new ValidationError('Please correct the highlighted fields', { fieldErrors });
  }
}

function replaceItems(scope: TenantScope, packageId: string, items: PackageInput['items']) {
  scope.db
    .delete(packageItem)
    .where(scope.ownedBy(packageItem.tenantId, eq(packageItem.packageId, packageId)))
    .run();
  scope.db
    .insert(packageItem)
    .values(
      items.map((i) => ({
        tenantId: scope.tenantId,
        packageId,
        equipmentTypeId: i.equipmentTypeId,
        quantity: i.quantity,
        lossFeeCents: i.lossFeeCents ?? null,
      })),
    )
    .run();
}

export function createPackage(ctx: ServiceContext, input: PackageInput) {
  return ctx.scope.transaction((scope) => {
    validatePackage(scope, input);
    const { items, ...fields } = input;
    const created = scope.insert(rentalPackage, fields);
    replaceItems(scope, created.id, items);
    return getPackage(scope, created.id);
  });
}

export function updatePackage(ctx: ServiceContext, id: string, input: PackageInput) {
  return ctx.scope.transaction((scope) => {
    scope.get(rentalPackage, id, 'Package');
    validatePackage(scope, input, id);
    const { items, ...fields } = input;
    scope.update(rentalPackage, id, fields);
    replaceItems(scope, id, items);
    return getPackage(scope, id);
  });
}

export function setPackageActive(ctx: ServiceContext, id: string, active: boolean) {
  ctx.scope.get(rentalPackage, id, 'Package');
  ctx.scope.update(rentalPackage, id, { active });
  return getPackage(ctx.scope, id);
}
