import { eq } from 'drizzle-orm';
import type { Db } from '../db/index.js';
import { TenantScope } from '../db/repository.js';
import {
  equipmentType,
  equipmentUnit,
  staffMember,
  tenant,
  tenantSettings,
  user,
} from '../db/schema.js';
import { hashPassword } from '../auth/passwords.js';
import { uuidv7 } from '../lib/id.js';

export const SEED_TENANT = { name: 'Undercover Dance Party', slug: 'undercover-dance-party' };
export const SEED_ADMIN = 'kali';

export const DEFAULT_RENTAL_TERMS = `EQUIPMENT RENTAL TERMS

1. Holding deposit. A non-refundable holding deposit of the stated percentage of the rental total is due to reserve your date. Your rental is not confirmed until the deposit is paid.
2. Balance. The remaining balance is due before the equipment is dispatched or picked up.
3. Card on file. You authorize us to keep a card on file for loss and damage charges.
4. Care of equipment. You are responsible for the equipment from pickup or delivery until it is returned. Keep it dry and secure.
5. Loss and damage. Missing items are charged at the replacement fee listed in your quote (headphones are typically $60 each). Damaged items may be charged up to the replacement fee.
6. Returns. Equipment must be returned by the agreed return date and time. Late returns may be charged an extra day.
7. Delivery. A delivery fee applies outside the Milwaukee and Madison metro areas.`;

export const DEFAULT_FULL_SERVICE_TERMS = `FULL-SERVICE EVENT TERMS

1. Services. We provide silent disco equipment and DJ(s) to run your event as described in this quote.
2. Payment. Flat-fee events are invoiced for the full amount, due on the event date unless otherwise stated. Door-split events are settled after the event based on door revenue collected by the venue; the amount owed is the agreed percentage of door revenue, or the guarantee if one applies and is greater.
3. Door reporting. The venue agrees to report total door revenue promptly after the event.
4. Venue. The venue provides power, a table near the entrance for headphone distribution, and reasonable access for load-in.
5. Cancellation. Please give us as much notice as possible if the event is cancelled.`;

export const DEFAULT_USAGE_INSTRUCTIONS = `Charge headphones fully before the event (about 4 hours). Turn on the transmitter, connect your audio source, and set each headphone to the matching channel colour. Collect headphones at the door in exchange for an ID or deposit, and keep all equipment dry. Pack everything back into its cases for return.`;

export interface SeedResult {
  tenantId: string;
  created: boolean;
  setupRequired: boolean;
}

/** Idempotent first-run seeding of the initial tenant, admin, inventory, and DJs. */
export async function seed(db: Db, opts: { initialAdminPassword?: string }): Promise<SeedResult> {
  const existing = db.select().from(tenant).where(eq(tenant.slug, SEED_TENANT.slug)).get();
  if (existing) {
    const admin = db.select().from(user).where(eq(user.username, SEED_ADMIN)).get();
    return {
      tenantId: existing.id,
      created: false,
      setupRequired: existing.setupRequired && !admin?.passwordHash,
    };
  }
  // Only seed into an empty database.
  if (db.select({ id: tenant.id }).from(tenant).limit(1).get()) {
    return { tenantId: '', created: false, setupRequired: false };
  }

  const passwordHash = opts.initialAdminPassword
    ? await hashPassword(opts.initialAdminPassword)
    : null;
  const tenantId = uuidv7();
  db.transaction((tx) => {
    tx.insert(tenant)
      .values({
        id: tenantId,
        name: SEED_TENANT.name,
        slug: SEED_TENANT.slug,
        timeZone: 'America/Chicago',
        setupRequired: !passwordHash,
      })
      .run();
    tx.insert(tenantSettings)
      .values({
        tenantId,
        rentalTerms: DEFAULT_RENTAL_TERMS,
        fullServiceTerms: DEFAULT_FULL_SERVICE_TERMS,
        rentalUsageInstructions: DEFAULT_USAGE_INSTRUCTIONS,
      })
      .run();
    const scope = new TenantScope(tx as unknown as Db, tenantId);
    scope.insert(user, { username: SEED_ADMIN, displayName: 'Kali', role: 'admin', passwordHash });
    scope.insert(equipmentType, {
      name: 'Headphones',
      trackingMode: 'pooled',
      ownedQuantity: 100,
      lossFeeCents: 6_000,
      sortOrder: 0,
    });
    const tx3 = scope.insert(equipmentType, {
      name: 'Transmitters',
      trackingMode: 'serialized',
      lossFeeCents: 30_000,
      sortOrder: 1,
    });
    for (const label of ['TX-1', 'TX-2', 'TX-3'])
      scope.insert(equipmentUnit, { equipmentTypeId: tx3.id, label });
    scope.insert(staffMember, { name: 'DJ 1' });
    scope.insert(staffMember, { name: 'DJ 2' });
  });
  return { tenantId, created: true, setupRequired: !passwordHash };
}
