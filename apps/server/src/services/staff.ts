import {
  addDays,
  type IsoDate,
  type staffMemberSchema,
  type staffUnavailabilitySchema,
} from '@disco/shared';
import { and, eq, gte, lte } from 'drizzle-orm';
import type { z } from 'zod';
import type { TenantScope } from '../db/repository.js';
import { staffMember, staffUnavailability } from '../db/schema.js';
import { ConflictError, NotFoundError } from '../lib/errors.js';

type StaffInput = z.output<typeof staffMemberSchema>;
type UnavailabilityInput = z.output<typeof staffUnavailabilitySchema>;

const UNAVAILABILITY_LOOKAHEAD_DAYS = 365;

export function listStaff(scope: TenantScope, today: IsoDate) {
  const members = scope.list(staffMember, { orderBy: [{ column: staffMember.name }] });
  const upcoming = scope.list(staffUnavailability, {
    where: and(
      gte(staffUnavailability.date, today),
      lte(staffUnavailability.date, addDays(today, UNAVAILABILITY_LOOKAHEAD_DAYS)),
    ),
    orderBy: [{ column: staffUnavailability.date }],
  });
  return members.map((m) => ({
    ...view(m),
    unavailable: upcoming
      .filter((u) => u.staffMemberId === m.id)
      .map((u) => ({ date: u.date, note: u.note })),
  }));
}

function view(m: typeof staffMember.$inferSelect) {
  return {
    id: m.id,
    name: m.name,
    email: m.email,
    phone: m.phone,
    active: m.active,
    userId: m.userId,
  };
}

export function createStaff(scope: TenantScope, input: StaffInput) {
  return view(
    scope.insert(staffMember, {
      name: input.name,
      email: input.email ?? null,
      phone: input.phone ?? null,
      active: input.active,
    }),
  );
}

export function updateStaff(scope: TenantScope, id: string, input: Partial<StaffInput>) {
  return view(scope.update(staffMember, id, input, 'Staff member'));
}

export function listUnavailability(
  scope: TenantScope,
  staffMemberId: string,
  from: IsoDate,
  to: IsoDate,
) {
  scope.get(staffMember, staffMemberId, 'Staff member');
  return scope
    .list(staffUnavailability, {
      where: and(
        eq(staffUnavailability.staffMemberId, staffMemberId),
        gte(staffUnavailability.date, from),
        lte(staffUnavailability.date, to),
      ),
      orderBy: [{ column: staffUnavailability.date }],
    })
    .map((u) => ({ date: u.date, note: u.note }));
}

export function addUnavailability(
  scope: TenantScope,
  staffMemberId: string,
  input: UnavailabilityInput,
) {
  const member = scope.get(staffMember, staffMemberId, 'Staff member');
  const existing = scope.first(
    staffUnavailability,
    and(
      eq(staffUnavailability.staffMemberId, staffMemberId),
      eq(staffUnavailability.date, input.date),
    ),
  );
  if (existing) throw new ConflictError(`${member.name} is already marked unavailable that day`);
  const row = scope.insert(staffUnavailability, {
    staffMemberId,
    date: input.date,
    note: input.note ?? null,
  });
  return { date: row.date, note: row.note };
}

export function removeUnavailability(scope: TenantScope, staffMemberId: string, date: IsoDate) {
  scope.get(staffMember, staffMemberId, 'Staff member');
  const row = scope.first(
    staffUnavailability,
    and(eq(staffUnavailability.staffMemberId, staffMemberId), eq(staffUnavailability.date, date)),
  );
  if (!row) throw new NotFoundError('Unavailable day');
  scope.delete(staffUnavailability, row.id);
}
