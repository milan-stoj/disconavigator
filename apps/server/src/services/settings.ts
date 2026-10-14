import { eq } from 'drizzle-orm';
import type { Settings } from '@disco/shared';
import type { Db } from '../db/index.js';
import { tenant, tenantSettings } from '../db/schema.js';
import { NotFoundError } from '../lib/errors.js';
import { nowIso } from '../lib/id.js';

export type SettingsView = Settings & {
  squareConnected: boolean;
  squareLocationName: string | null;
  squareEnvironment: 'sandbox' | 'production' | null;
  squareConnectedAt: string | null;
  squareWebhookConfigured: boolean;
  /** Where to point the Square webhook subscription. */
  squareWebhookUrl: string;
  squareMode: 'live' | 'mock';
};

export interface SettingsViewOptions {
  publicBaseUrl: string;
  squareMode: 'live' | 'mock';
}

/** The notification URL Square signs; it must match the webhook subscription exactly. */
export function squareWebhookUrl(publicBaseUrl: string, slug: string) {
  return `${publicBaseUrl.replace(/\/+$/, '')}/api/webhooks/square/${slug}`;
}

export function getSettingsRow(db: Db, tenantId: string) {
  const row = db.select().from(tenantSettings).where(eq(tenantSettings.tenantId, tenantId)).get();
  if (!row) throw new NotFoundError('Settings not found');
  return row;
}

export function getSettings(db: Db, tenantId: string, opts: SettingsViewOptions): SettingsView {
  const t = db.select().from(tenant).where(eq(tenant.id, tenantId)).get();
  if (!t) throw new NotFoundError('Tenant not found');
  const s = getSettingsRow(db, tenantId);
  return {
    businessName: t.name,
    timeZone: t.timeZone,
    notificationEmail: s.notificationEmail,
    rentalDepositBps: s.rentalDepositBps,
    bufferDays: s.bufferDays,
    rentalBalanceDueDays: s.rentalBalanceDueDays,
    fullServiceInvoiceDueOffsetDays: s.fullServiceInvoiceDueOffsetDays,
    deliveryFeeCents: s.deliveryFeeCents,
    serviceAreas: s.serviceAreas,
    quoteValidityDays: s.quoteValidityDays,
    rentalTerms: s.rentalTerms,
    fullServiceTerms: s.fullServiceTerms,
    rentalUsageInstructions: s.rentalUsageInstructions,
    squareConnected: !!s.squareAccessTokenEnc && !!s.squareLocationId,
    squareLocationName: s.squareLocationName,
    squareEnvironment: s.squareEnvironment,
    squareConnectedAt: s.squareConnectedAt,
    squareWebhookConfigured: !!s.squareWebhookSignatureKeyEnc,
    squareWebhookUrl: squareWebhookUrl(opts.publicBaseUrl, t.slug),
    squareMode: opts.squareMode,
  };
}

export function updateSettings(
  db: Db,
  tenantId: string,
  input: Settings,
  opts: SettingsViewOptions,
): SettingsView {
  db.transaction((tx) => {
    tx.update(tenant)
      .set({ name: input.businessName, timeZone: input.timeZone })
      .where(eq(tenant.id, tenantId))
      .run();
    tx.update(tenantSettings)
      .set({
        notificationEmail: input.notificationEmail || null,
        rentalDepositBps: input.rentalDepositBps,
        bufferDays: input.bufferDays,
        rentalBalanceDueDays: input.rentalBalanceDueDays,
        fullServiceInvoiceDueOffsetDays: input.fullServiceInvoiceDueOffsetDays,
        deliveryFeeCents: input.deliveryFeeCents,
        serviceAreas: input.serviceAreas,
        quoteValidityDays: input.quoteValidityDays,
        rentalTerms: input.rentalTerms,
        fullServiceTerms: input.fullServiceTerms,
        rentalUsageInstructions: input.rentalUsageInstructions,
        updatedAt: nowIso(),
      })
      .where(eq(tenantSettings.tenantId, tenantId))
      .run();
  });
  return getSettings(db, tenantId, opts);
}
