import {
  applyFound,
  checkinSchema,
  checkoutSchema,
  computeLosses,
  formatBookingNumber,
  formatCents,
  foundCorrectionSchema,
  isReturnOverdue,
  lossCharge,
} from '@disco/shared';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/index.js';
import { TenantScope } from '../db/repository.js';
import {
  booking,
  charge,
  checkoutItem,
  checkoutRecord,
  equipmentRequirement,
  equipmentType,
  equipmentUnit,
  inventoryAdjustment,
  tenant,
  user,
} from '../db/schema.js';
import { AppError, ConflictError, ValidationError } from '../lib/errors.js';
import { nowIso } from '../lib/id.js';
import { activityFor, assertTransition } from './bookings.js';
import type { ServiceContext } from './context.js';

type BookingRow = typeof booking.$inferSelect;
type TypeRow = typeof equipmentType.$inferSelect;
type ItemRow = typeof checkoutItem.$inferSelect;
type RecordRow = typeof checkoutRecord.$inferSelect;

export interface QuantityDifference {
  equipmentTypeId: string;
  name: string;
  required: number;
  checkedOut: number;
}

export interface EquipmentLine {
  equipmentTypeId: string;
  name: string;
  trackingMode: TypeRow['trackingMode'];
  required: number;
  checkedOut: number;
  returned: number;
  damaged: number;
  /** Still missing after any found corrections. */
  missing: number;
  found: number;
  lossFeeCents: number;
  units: {
    id: string;
    label: string;
    returned: boolean;
    damaged: boolean;
    missing: boolean;
  }[];
}

const plural = (n: number, name: string) => `${n} ${name.toLowerCase()}`;

function requirementsOf(scope: TenantScope, bookingId: string) {
  return scope.db
    .select()
    .from(equipmentRequirement)
    .where(
      scope.ownedBy(equipmentRequirement.tenantId, eq(equipmentRequirement.bookingId, bookingId)),
    )
    .all();
}

function typesById(scope: TenantScope) {
  return new Map(scope.list(equipmentType).map((t) => [t.id, t]));
}

function userNames(scope: TenantScope, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  if (wanted.length === 0) return new Map<string, string>();
  return new Map(
    scope.db
      .select({ id: user.id, name: user.displayName })
      .from(user)
      .where(scope.ownedBy(user.tenantId, inArray(user.id, wanted)))
      .all()
      .map((u) => [u.id, u.name]),
  );
}

function recordsOf(scope: TenantScope, bookingId: string) {
  const records = scope.list(checkoutRecord, {
    where: eq(checkoutRecord.bookingId, bookingId),
    orderBy: [{ column: checkoutRecord.createdAt }, { column: checkoutRecord.id }],
  });
  const items = records.length
    ? scope.list(checkoutItem, {
        where: inArray(
          checkoutItem.recordId,
          records.map((r) => r.id),
        ),
      })
    : [];
  const itemsOf = (r: RecordRow | undefined) => (r ? items.filter((i) => i.recordId === r.id) : []);
  return {
    records,
    checkout: records.find((r) => r.kind === 'checkout'),
    checkin: records.find((r) => r.kind === 'checkin'),
    corrections: records.filter((r) => r.kind === 'correction'),
    itemsOf,
  };
}

/** What went out, what came back, and what is still missing for a booking. */
export function equipmentStatus(scope: TenantScope, b: BookingRow) {
  const types = typesById(scope);
  const reqs = requirementsOf(scope, b.id);
  const { checkout, checkin, corrections, itemsOf } = recordsOf(scope, b.id);
  const outItems = itemsOf(checkout);
  const inItems = itemsOf(checkin);
  const foundItems = corrections.flatMap((c) => itemsOf(c));
  const unitIds = outItems.map((i) => i.unitId).filter((x): x is string => !!x);
  const units = new Map(
    (unitIds.length
      ? scope.list(equipmentUnit, { where: inArray(equipmentUnit.id, unitIds) })
      : []
    ).map((u) => [u.id, u]),
  );
  const typeIds = [
    ...new Set([...reqs.map((r) => r.equipmentTypeId), ...outItems.map((i) => i.equipmentTypeId)]),
  ];
  const sum = (items: ItemRow[], typeId: string, f: (i: ItemRow) => number) =>
    items.filter((i) => i.equipmentTypeId === typeId).reduce((n, i) => n + f(i), 0);
  const lines: EquipmentLine[] = typeIds
    .map((typeId) => {
      const type = types.get(typeId)!;
      const req = reqs.find((r) => r.equipmentTypeId === typeId);
      const found = sum(foundItems, typeId, (i) => i.quantity);
      return {
        equipmentTypeId: typeId,
        name: type.name,
        trackingMode: type.trackingMode,
        required: req?.quantity ?? 0,
        checkedOut: sum(outItems, typeId, (i) => i.quantity),
        returned: sum(inItems, typeId, (i) => i.quantity),
        damaged: sum(inItems, typeId, (i) => i.damaged),
        missing: sum(inItems, typeId, (i) => i.missing) - found,
        found,
        lossFeeCents: req?.lossFeeCents ?? type.lossFeeCents,
        units: outItems
          .filter((i) => i.equipmentTypeId === typeId && i.unitId)
          .map((i) => {
            const back = inItems.find((x) => x.unitId === i.unitId);
            const foundLater = foundItems.some((x) => x.unitId === i.unitId);
            return {
              id: i.unitId!,
              label: units.get(i.unitId!)?.label ?? 'Unknown unit',
              returned: back ? back.quantity > 0 : false,
              damaged: back ? back.damaged > 0 : false,
              missing: back ? back.missing > 0 && !foundLater : false,
            };
          })
          .sort((x, y) => x.label.localeCompare(y.label, undefined, { numeric: true })),
      };
    })
    .sort(
      (x, y) => types.get(x.equipmentTypeId)!.sortOrder - types.get(y.equipmentTypeId)!.sortOrder,
    );
  const names = userNames(
    scope,
    [checkout, checkin, ...corrections].map((r) => r?.userId ?? null),
  );
  const view = (r: RecordRow | undefined) =>
    r
      ? { at: r.createdAt, by: r.userId ? (names.get(r.userId) ?? null) : null, note: r.note }
      : null;
  return {
    checkedOut: view(checkout),
    checkedIn: view(checkin),
    corrections: corrections.map((c) => ({
      ...view(c)!,
      items: itemsOf(c).map((i) => ({
        equipmentTypeId: i.equipmentTypeId,
        name: types.get(i.equipmentTypeId)?.name ?? '',
        quantity: i.quantity,
        unitLabel: i.unitId ? (units.get(i.unitId)?.label ?? null) : null,
      })),
    })),
    lines,
    busyUnits: b.status === 'confirmed' ? busyUnits(scope, b.id) : [],
  };
}

/** Serialized units currently out on another booking, so they can't be checked out twice. */
function busyUnits(scope: TenantScope, exceptBookingId: string) {
  return scope.db
    .select({ unitId: checkoutItem.unitId, bookingId: booking.id, number: booking.number })
    .from(checkoutItem)
    .innerJoin(checkoutRecord, eq(checkoutRecord.id, checkoutItem.recordId))
    .innerJoin(booking, eq(booking.id, checkoutRecord.bookingId))
    .where(
      scope.ownedBy(
        checkoutItem.tenantId,
        and(
          isNotNull(checkoutItem.unitId),
          eq(checkoutRecord.kind, 'checkout'),
          eq(booking.status, 'out'),
        ),
      ),
    )
    .all()
    .filter((r) => r.bookingId !== exceptBookingId)
    .map((r) => ({
      unitId: r.unitId!,
      bookingId: r.bookingId,
      numberLabel: formatBookingNumber(r.number),
    }));
}

function describe(items: { name: string; quantity: number }[]) {
  return items.map((i) => plural(i.quantity, i.name)).join(', ');
}

// ---------- Check-out ----------

export function checkOut(ctx: ServiceContext, id: string, input: z.output<typeof checkoutSchema>) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, id, 'Booking');
    if (b.status !== 'confirmed') {
      assertTransition(b, 'out');
      throw new ConflictError('Only a confirmed booking can be checked out');
    }
    const types = typesById(scope);
    const counts = new Map<string, number>();
    const fieldErrors: Record<string, string> = {};
    input.pooled.forEach((p, i) => {
      const type = types.get(p.equipmentTypeId);
      if (!type || type.trackingMode !== 'pooled') {
        fieldErrors[`pooled.${i}.equipmentTypeId`] = 'Unknown pooled equipment';
        return;
      }
      if (counts.has(type.id)) fieldErrors[`pooled.${i}.equipmentTypeId`] = 'Listed twice';
      const inService = type.ownedQuantity - type.outOfServiceQuantity;
      if (p.quantity > inService) {
        fieldErrors[`pooled.${i}.quantity`] =
          `Only ${inService} ${type.name.toLowerCase()} are in service`;
      }
      counts.set(type.id, p.quantity);
    });
    const busy = new Map(busyUnits(scope, b.id).map((u) => [u.unitId, u.numberLabel]));
    const unitIds = [...new Set(input.unitIds)];
    const units = unitIds.map((unitId) => {
      const unit = scope.find(equipmentUnit, unitId);
      if (!unit)
        throw new ValidationError('Unknown unit', { fieldErrors: { unitIds: 'Unknown unit' } });
      if (unit.status !== 'in_service') fieldErrors.unitIds = `${unit.label} is not in service`;
      const elsewhere = busy.get(unit.id);
      if (elsewhere) fieldErrors.unitIds = `${unit.label} is already out on ${elsewhere}`;
      counts.set(unit.equipmentTypeId, (counts.get(unit.equipmentTypeId) ?? 0) + 1);
      return unit;
    });
    if (Object.keys(fieldErrors).length) {
      throw new ValidationError(Object.values(fieldErrors)[0]!, { fieldErrors });
    }
    const total = [...counts.values()].reduce((a, n) => a + n, 0);
    if (total === 0) throw new ValidationError('Check out at least one item');

    const reqs = requirementsOf(scope, b.id);
    const typeIds = new Set([...reqs.map((r) => r.equipmentTypeId), ...counts.keys()]);
    const differences: QuantityDifference[] = [...typeIds]
      .map((typeId) => ({
        equipmentTypeId: typeId,
        name: types.get(typeId)!.name,
        required: reqs.find((r) => r.equipmentTypeId === typeId)?.quantity ?? 0,
        checkedOut: counts.get(typeId) ?? 0,
      }))
      .filter((d) => d.required !== d.checkedOut);
    if (differences.length > 0 && !input.acknowledgeDifference) {
      throw new AppError(
        409,
        'quantity_mismatch',
        'What is going out differs from the booking. Confirm to check out anyway.',
        { differences },
      );
    }

    const record = scope.insert(checkoutRecord, {
      bookingId: b.id,
      kind: 'checkout',
      note: input.note ?? null,
      userId: ctx.userId,
    });
    for (const p of input.pooled) {
      if (p.quantity === 0) continue;
      scope.insert(checkoutItem, {
        recordId: record.id,
        equipmentTypeId: p.equipmentTypeId,
        quantity: p.quantity,
      });
    }
    for (const u of units) {
      scope.insert(checkoutItem, {
        recordId: record.id,
        equipmentTypeId: u.equipmentTypeId,
        unitId: u.id,
        quantity: 1,
      });
    }
    scope.update(booking, b.id, { status: 'out', overdueAt: null });
    const summary = [
      describe(
        input.pooled
          .filter((p) => p.quantity > 0)
          .map((p) => ({ name: types.get(p.equipmentTypeId)!.name, quantity: p.quantity })),
      ),
      units
        .map((u) => u.label)
        .sort((x, y) => x.localeCompare(y, undefined, { numeric: true }))
        .join(', '),
    ]
      .filter(Boolean)
      .join(', ');
    activityFor(scope, b, ctx.userId)(
      'checked_out',
      `Checked out ${summary}${
        differences.length
          ? ` (booking called for ${differences.map((d) => plural(d.required, d.name)).join(', ')})`
          : ''
      }`,
      { recordId: record.id, differences },
    );
    return record;
  });
}

// ---------- Check-in ----------

export function checkIn(ctx: ServiceContext, id: string, input: z.output<typeof checkinSchema>) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, id, 'Booking');
    if (b.status !== 'out') throw new ConflictError('Only equipment that is out can be checked in');
    const { checkout, itemsOf } = recordsOf(scope, b.id);
    if (!checkout) throw new ConflictError('Nothing was checked out for this booking');
    const types = typesById(scope);
    const outItems = itemsOf(checkout);
    const pooledOut = outItems.filter((i) => !i.unitId);
    const unitsOut = outItems.filter((i) => i.unitId);

    const counted = new Map(input.pooled.map((p) => [p.equipmentTypeId, p]));
    const fieldErrors: Record<string, string> = {};
    for (const o of pooledOut) {
      if (!counted.has(o.equipmentTypeId)) {
        fieldErrors.pooled = `Count the ${types.get(o.equipmentTypeId)!.name.toLowerCase()} that came back`;
      }
    }
    input.pooled.forEach((p, i) => {
      if (!pooledOut.some((o) => o.equipmentTypeId === p.equipmentTypeId)) {
        fieldErrors[`pooled.${i}.equipmentTypeId`] = 'This equipment was not checked out';
      }
    });
    const outUnitIds = new Set(unitsOut.map((u) => u.unitId!));
    const returnedUnits = new Set(input.returnedUnitIds);
    const damagedUnits = new Set(input.damagedUnitIds);
    if ([...returnedUnits].some((u) => !outUnitIds.has(u))) {
      fieldErrors.returnedUnitIds = 'A unit that was not checked out was marked returned';
    }
    if ([...damagedUnits].some((u) => !returnedUnits.has(u))) {
      fieldErrors.damagedUnitIds = 'Only returned units can be marked damaged';
    }
    if (Object.keys(fieldErrors).length) {
      throw new ValidationError(Object.values(fieldErrors)[0]!, { fieldErrors });
    }

    let losses: ReturnType<typeof computeLosses>;
    try {
      losses = computeLosses(
        pooledOut.map((o) => ({
          equipmentTypeId: o.equipmentTypeId,
          checkedOut: o.quantity,
          returned: counted.get(o.equipmentTypeId)!.returned,
          damaged: counted.get(o.equipmentTypeId)!.damaged,
        })),
      );
    } catch (err) {
      throw new ValidationError(err instanceof Error ? err.message : 'Invalid counts');
    }

    const record = scope.insert(checkoutRecord, {
      bookingId: b.id,
      kind: 'checkin',
      note: input.note ?? null,
      userId: ctx.userId,
    });
    const label = formatBookingNumber(b.number);
    const adjust = (
      typeId: string,
      delta: number,
      reason: string,
      note: string,
      unitId: string | null = null,
    ) =>
      scope.insert(inventoryAdjustment, {
        equipmentTypeId: typeId,
        unitId,
        delta,
        reason,
        note,
        bookingId: b.id,
        userId: ctx.userId,
      });

    const missingByType = new Map<string, number>();
    const damagedByType = new Map<string, number>();
    for (const l of losses) {
      const returned = counted.get(l.equipmentTypeId)!.returned;
      scope.insert(checkoutItem, {
        recordId: record.id,
        equipmentTypeId: l.equipmentTypeId,
        quantity: returned,
        damaged: l.damaged,
        missing: l.missing,
      });
      const type = types.get(l.equipmentTypeId)!;
      const owned = type.ownedQuantity - l.missing;
      const outOfService = Math.min(owned, type.outOfServiceQuantity + l.damaged);
      if (l.missing || l.damaged) {
        scope.update(equipmentType, type.id, {
          ownedQuantity: owned,
          outOfServiceQuantity: outOfService,
        });
      }
      if (l.missing) adjust(type.id, -l.missing, 'lost', `Missing after ${label}`);
      if (l.damaged) adjust(type.id, l.damaged, 'out_of_service', `Damaged on ${label}`);
      missingByType.set(type.id, l.missing);
      damagedByType.set(type.id, l.damaged);
    }
    const missingUnits: string[] = [];
    const damagedUnitLabels: string[] = [];
    for (const o of unitsOut) {
      const unit = scope.get(equipmentUnit, o.unitId!, 'Unit');
      const back = returnedUnits.has(unit.id);
      const damaged = damagedUnits.has(unit.id);
      scope.insert(checkoutItem, {
        recordId: record.id,
        equipmentTypeId: unit.equipmentTypeId,
        unitId: unit.id,
        quantity: back ? 1 : 0,
        damaged: damaged ? 1 : 0,
        missing: back ? 0 : 1,
      });
      if (!back) {
        scope.update(equipmentUnit, unit.id, { status: 'lost' });
        adjust(unit.equipmentTypeId, -1, 'lost', `Missing after ${label}`, unit.id);
        missingByType.set(unit.equipmentTypeId, (missingByType.get(unit.equipmentTypeId) ?? 0) + 1);
        missingUnits.push(unit.label);
      } else if (damaged) {
        scope.update(equipmentUnit, unit.id, { status: 'out_of_service' });
        adjust(unit.equipmentTypeId, 0, 'out_of_service', `Damaged on ${label}`, unit.id);
        damagedByType.set(unit.equipmentTypeId, (damagedByType.get(unit.equipmentTypeId) ?? 0) + 1);
        damagedUnitLabels.push(unit.label);
      }
    }

    const reqs = requirementsOf(scope, b.id);
    const feeOf = (typeId: string) =>
      reqs.find((r) => r.equipmentTypeId === typeId)?.lossFeeCents ??
      types.get(typeId)!.lossFeeCents;
    const missingSummary = [...missingByType]
      .filter(([, n]) => n > 0)
      .map(([typeId, n]) => plural(n, types.get(typeId)!.name))
      .join(', ');
    const proposed = lossCharge({
      bookingType: b.bookingType,
      lines: [...missingByType].map(([typeId, missing]) => ({
        missing,
        lossFeeCents: feeOf(typeId),
      })),
    });
    if (proposed > 0) {
      scope.insert(charge, {
        bookingId: b.id,
        kind: 'loss',
        proposedCents: proposed,
        status: 'proposed',
        reason: `Missing: ${missingSummary}`,
      });
    }
    scope.update(booking, b.id, { status: 'returned', overdueAt: null });

    const damagedSummary = [...damagedByType]
      .filter(([, n]) => n > 0)
      .map(([typeId, n]) => plural(n, types.get(typeId)!.name))
      .join(', ');
    const body = [
      'Checked in',
      missingSummary
        ? `Missing: ${missingSummary}${missingUnits.length ? ` (${missingUnits.join(', ')})` : ''}`
        : 'Nothing missing',
      damagedSummary &&
        `Damaged: ${damagedSummary}${damagedUnitLabels.length ? ` (${damagedUnitLabels.join(', ')})` : ''}`,
      proposed > 0 && `Proposed loss charge ${formatCents(proposed)}`,
    ]
      .filter(Boolean)
      .join('. ');
    activityFor(scope, b, ctx.userId)('checked_in', body, {
      recordId: record.id,
      missing: Object.fromEntries(missingByType),
      damaged: Object.fromEntries(damagedByType),
      proposedChargeCents: proposed,
    });
    return record;
  });
}

// ---------- Found after check-in ----------

export function recordFound(
  ctx: ServiceContext,
  id: string,
  input: z.output<typeof foundCorrectionSchema>,
) {
  return ctx.scope.transaction((scope) => {
    const b = scope.get(booking, id, 'Booking');
    const { checkin } = recordsOf(scope, b.id);
    if (!checkin) throw new ConflictError('Check the equipment in before recording found items');
    const status = equipmentStatus(scope, b);
    const line = status.lines.find((l) => l.equipmentTypeId === input.equipmentTypeId);
    if (!line || line.missing === 0) {
      throw new ValidationError('None of that equipment is missing', {
        fieldErrors: { equipmentTypeId: 'None of that equipment is missing' },
      });
    }
    let remaining: number;
    try {
      remaining = applyFound(line.missing, input.quantity);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid quantity';
      throw new ValidationError(msg, { fieldErrors: { quantity: msg } });
    }
    const unitIds = [...new Set(input.unitIds)];
    if (line.trackingMode === 'serialized') {
      const missingUnits = new Set(line.units.filter((u) => u.missing).map((u) => u.id));
      if (unitIds.length !== input.quantity || unitIds.some((u) => !missingUnits.has(u))) {
        throw new ValidationError('Choose which missing units were found', {
          fieldErrors: { unitIds: 'Choose which missing units were found' },
        });
      }
    } else if (unitIds.length) {
      throw new ValidationError('Pooled equipment has no units');
    }

    const record = scope.insert(checkoutRecord, {
      bookingId: b.id,
      kind: 'correction',
      note: input.note ?? null,
      userId: ctx.userId,
    });
    const label = formatBookingNumber(b.number);
    const note = `Found after ${label}${input.note ? `: ${input.note}` : ''}`;
    if (line.trackingMode === 'pooled') {
      scope.insert(checkoutItem, {
        recordId: record.id,
        equipmentTypeId: line.equipmentTypeId,
        quantity: input.quantity,
        missing: remaining,
      });
      const type = scope.get(equipmentType, line.equipmentTypeId);
      scope.update(equipmentType, type.id, { ownedQuantity: type.ownedQuantity + input.quantity });
      scope.insert(inventoryAdjustment, {
        equipmentTypeId: type.id,
        delta: input.quantity,
        reason: 'found',
        note,
        bookingId: b.id,
        userId: ctx.userId,
      });
    } else {
      for (const unitId of unitIds) {
        scope.insert(checkoutItem, {
          recordId: record.id,
          equipmentTypeId: line.equipmentTypeId,
          unitId,
          quantity: 1,
        });
        scope.update(equipmentUnit, unitId, { status: 'in_service' });
        scope.insert(inventoryAdjustment, {
          equipmentTypeId: line.equipmentTypeId,
          unitId,
          delta: 1,
          reason: 'found',
          note,
          bookingId: b.id,
          userId: ctx.userId,
        });
      }
    }

    // Re-price the still-proposed loss charge from what is missing now.
    const after = equipmentStatus(scope, b).lines;
    const proposed = lossCharge({
      bookingType: b.bookingType,
      lines: after.map((l) => ({ missing: l.missing, lossFeeCents: l.lossFeeCents })),
    });
    const pending = scope.list(charge, {
      where: and(
        eq(charge.bookingId, b.id),
        eq(charge.kind, 'loss'),
        eq(charge.status, 'proposed'),
      ),
      orderBy: [{ column: charge.createdAt, direction: 'desc' }],
      limit: 1,
    })[0];
    let chargeNote = '';
    if (pending) {
      const stillMissing = after
        .filter((l) => l.missing > 0)
        .map((l) => plural(l.missing, l.name))
        .join(', ');
      if (proposed === 0) {
        scope.update(charge, pending.id, {
          proposedCents: 0,
          status: 'waived',
          reason: 'All missing equipment was found',
          decidedAt: nowIso(),
          decidedBy: ctx.userId,
        });
        chargeNote = 'Proposed loss charge withdrawn';
      } else {
        scope.update(charge, pending.id, {
          proposedCents: proposed,
          reason: `Missing: ${stillMissing}`,
        });
        chargeNote = `Proposed loss charge reduced to ${formatCents(proposed)}`;
      }
    } else if (
      scope
        .list(charge, { where: and(eq(charge.bookingId, b.id), eq(charge.kind, 'loss')) })
        .some((c) => c.status !== 'waived')
    ) {
      chargeNote = 'The loss charge was already decided; adjust it on the Payments tab';
    }
    const units = line.units.filter((u) => unitIds.includes(u.id)).map((u) => u.label);
    activityFor(scope, b, ctx.userId)(
      'equipment_found',
      [
        `Found ${plural(input.quantity, line.name)}${units.length ? ` (${units.join(', ')})` : ''}`,
        remaining > 0 ? `${remaining} still missing` : 'Nothing still missing',
        chargeNote,
      ]
        .filter(Boolean)
        .join('. '),
      {
        recordId: record.id,
        equipmentTypeId: line.equipmentTypeId,
        found: input.quantity,
        remaining,
      },
    );
    return record;
  });
}

// ---------- Overdue returns ----------

/**
 * Flags Out bookings whose return time has passed (and clears the flag when the return date
 * moves later). Runs from the scheduler; returns the bookings newly flagged.
 */
export function markOverdueBookings(db: Db, now: Date = new Date()) {
  const flagged: string[] = [];
  for (const t of db.select().from(tenant).all()) {
    const scope = new TenantScope(db, t.id);
    for (const b of scope.list(booking, { where: eq(booking.status, 'out') })) {
      const overdue = isReturnOverdue(b, t.timeZone, now);
      if (overdue && !b.overdueAt) {
        scope.update(booking, b.id, { overdueAt: nowIso(now) });
        activityFor(scope, b, null)('return_overdue', 'Equipment is overdue for return', {
          endDate: b.endDate,
          returnTime: b.returnTime,
        });
        flagged.push(b.id);
      } else if (!overdue && b.overdueAt) {
        scope.update(booking, b.id, { overdueAt: null });
      }
    }
  }
  return flagged;
}

export const OVERDUE_INTERVAL_MS = 15 * 60_000;
