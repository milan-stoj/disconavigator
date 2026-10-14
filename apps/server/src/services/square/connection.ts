import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import type { z } from 'zod';
import type { squareConnectionSchema } from '@disco/shared';
import type { AppConfig } from '../../config.js';
import type { Db } from '../../db/index.js';
import { booking, charge, contact, tenant, tenantSettings } from '../../db/schema.js';
import { decryptSecret, encryptSecret } from '../../lib/crypto.js';
import { AppError, ValidationError } from '../../lib/errors.js';
import { nowIso } from '../../lib/id.js';
import { enqueueJob } from '../jobs.js';
import { CREATE_INVOICE_JOB } from '../quotes.js';
import { getSettingsRow } from '../settings.js';
import {
  SquareAuthError,
  type SquareConnector,
  type SquareEnvironmentName,
  type SquareGateway,
} from './gateway.js';

export const COLLECT_CHARGE_JOB = 'charge.collect';
export const SYNC_INVOICE_JOB = 'square.sync-invoice';

export interface SquareDeps {
  db: Db;
  config: AppConfig;
  square: SquareConnector;
}

export interface SquareSession {
  gateway: SquareGateway;
  locationId: string;
  environment: SquareEnvironmentName;
}

/** The tenant's Square connection, or null when Square is not connected. */
export function squareSession(deps: SquareDeps, tenantId: string): SquareSession | null {
  const s = getSettingsRow(deps.db, tenantId);
  if (!s.squareAccessTokenEnc || !s.squareLocationId || !s.squareEnvironment) return null;
  return {
    gateway: deps.square.connect({
      environment: s.squareEnvironment,
      accessToken: decryptSecret(s.squareAccessTokenEnc, deps.config.appSecret),
    }),
    locationId: s.squareLocationId,
    environment: s.squareEnvironment,
  };
}

export function squareWebhookSignatureKey(deps: SquareDeps, tenantId: string): string | null {
  const enc = getSettingsRow(deps.db, tenantId).squareWebhookSignatureKeyEnc;
  return enc ? decryptSecret(enc, deps.config.appSecret) : null;
}

type ConnectionInput = z.output<typeof squareConnectionSchema>;

/** Uses the token typed in, or the stored one when the environment is unchanged. */
function resolveToken(
  deps: SquareDeps,
  tenantId: string,
  input: Pick<ConnectionInput, 'environment' | 'accessToken'>,
) {
  if (input.accessToken) return input.accessToken;
  const s = getSettingsRow(deps.db, tenantId);
  if (s.squareAccessTokenEnc && s.squareEnvironment === input.environment) {
    return decryptSecret(s.squareAccessTokenEnc, deps.config.appSecret);
  }
  throw new ValidationError('Enter the Square access token', {
    fieldErrors: { accessToken: 'Enter the access token' },
  });
}

/** Test call: lists the account's locations, translating failures into form errors. */
export async function listSquareLocations(
  deps: SquareDeps,
  tenantId: string,
  input: Pick<ConnectionInput, 'environment' | 'accessToken'>,
) {
  const token = resolveToken(deps, tenantId, input);
  try {
    return await deps.square
      .connect({ environment: input.environment, accessToken: token })
      .listLocations();
  } catch (err) {
    if (err instanceof SquareAuthError) {
      throw new ValidationError(`Square rejected this access token for ${input.environment}`, {
        fieldErrors: { accessToken: 'Square rejected this access token' },
      });
    }
    throw new AppError(
      502,
      'square_unavailable',
      `Could not reach Square: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Verifies the credentials with a test call and stores them encrypted. Nothing is saved
 * when Square rejects the token. Bookings still waiting for an invoice are retried.
 */
export async function saveSquareConnection(
  deps: SquareDeps,
  tenantId: string,
  input: ConnectionInput,
) {
  const locations = await listSquareLocations(deps, tenantId, input);
  const location =
    locations.find((l) => l.id === input.locationId) ??
    (!input.locationId && locations.length === 1 ? locations[0] : undefined);
  if (!location) {
    throw new ValidationError('Choose a Square location', {
      fieldErrors: { locationId: 'Choose a location' },
      locations,
    });
  }
  const token = resolveToken(deps, tenantId, input);
  const previous = getSettingsRow(deps.db, tenantId);
  const signatureKey =
    input.webhookSignatureKey === undefined
      ? undefined
      : input.webhookSignatureKey
        ? encryptSecret(input.webhookSignatureKey, deps.config.appSecret)
        : null;
  deps.db.transaction((tx) => {
    tx.update(tenantSettings)
      .set({
        squareEnvironment: input.environment,
        squareAccessTokenEnc: encryptSecret(token, deps.config.appSecret),
        squareLocationId: location.id,
        squareLocationName: location.name,
        ...(signatureKey !== undefined ? { squareWebhookSignatureKeyEnc: signatureKey } : {}),
        squareConnectedAt: nowIso(),
        updatedAt: nowIso(),
      })
      .where(eq(tenantSettings.tenantId, tenantId))
      .run();
    // Square customer IDs belong to one environment; relink when switching.
    if (previous.squareEnvironment && previous.squareEnvironment !== input.environment) {
      tx.update(contact)
        .set({ squareCustomerId: null })
        .where(and(eq(contact.tenantId, tenantId), isNotNull(contact.squareCustomerId)))
        .run();
    }
  });
  retryPendingInvoices(deps.db, tenantId);
  const approved = deps.db
    .select({ id: charge.id, bookingId: charge.bookingId })
    .from(charge)
    .where(and(eq(charge.tenantId, tenantId), eq(charge.status, 'approved')))
    .all();
  for (const c of approved) enqueueChargeCollection(deps.db, tenantId, c.bookingId, c.id);
}

export function enqueueChargeCollection(
  db: Db,
  tenantId: string,
  bookingId: string,
  chargeId: string,
) {
  return enqueueJob(db, {
    type: COLLECT_CHARGE_JOB,
    tenantId,
    payload: { bookingId, chargeId },
    idempotencyKey: `charge:${chargeId}:${nowIso()}`,
  });
}

export function disconnectSquare(db: Db, tenantId: string) {
  db.update(tenantSettings)
    .set({
      squareAccessTokenEnc: null,
      squareLocationId: null,
      squareLocationName: null,
      squareWebhookSignatureKeyEnc: null,
      squareConnectedAt: null,
      updatedAt: nowIso(),
    })
    .where(eq(tenantSettings.tenantId, tenantId))
    .run();
}

/** Re-enqueues invoice creation for every booking still marked as needing an invoice. */
export function retryPendingInvoices(db: Db, tenantId: string, bookingIds?: string[]) {
  const rows = db
    .select({ id: booking.id })
    .from(booking)
    .where(
      and(
        eq(booking.tenantId, tenantId),
        eq(booking.needsInvoice, true),
        ne(booking.status, 'cancelled'),
        bookingIds ? inArray(booking.id, bookingIds) : undefined,
      ),
    )
    .all();
  const stamp = nowIso();
  for (const r of rows) {
    enqueueJob(db, {
      type: CREATE_INVOICE_JOB,
      tenantId,
      payload: { bookingId: r.id, retry: true },
      idempotencyKey: `invoice:${r.id}:retry:${stamp}`,
    });
  }
  return rows.length;
}

export function tenantBySlug(db: Db, slug: string) {
  return db.select().from(tenant).where(eq(tenant.slug, slug)).get() ?? null;
}
