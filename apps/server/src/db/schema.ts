import { sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const pk = () => text('id').primaryKey();
const tenantId = () =>
  text('tenant_id')
    .notNull()
    .references(() => tenant.id, { onDelete: 'cascade' });
const createdAt = () => text('created_at').notNull().default(now);
const updatedAt = () => text('updated_at').notNull().default(now);
const bool = (name: string) => integer(name, { mode: 'boolean' });
const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();

// ---------- Tenancy & access ----------
export const tenant = sqliteTable('tenant', {
  id: pk(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  timeZone: text('time_zone').notNull().default('America/Chicago'),
  setupRequired: bool('setup_required').notNull().default(false),
  createdAt: createdAt(),
});

export const tenantSettings = sqliteTable('tenant_settings', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenant.id, { onDelete: 'cascade' }),
  notificationEmail: text('notification_email'),
  rentalDepositBps: integer('rental_deposit_bps').notNull().default(2000),
  bufferDays: integer('buffer_days').notNull().default(1),
  rentalBalanceDueDays: integer('rental_balance_due_days').notNull().default(7),
  fullServiceInvoiceDueOffsetDays: integer('full_service_invoice_due_offset_days')
    .notNull()
    .default(0),
  deliveryFeeCents: integer('delivery_fee_cents').notNull().default(7500),
  serviceAreas: json<string[]>('service_areas')
    .notNull()
    .default(['Milwaukee metro', 'Madison metro']),
  quoteValidityDays: integer('quote_validity_days').notNull().default(14),
  rentalTerms: text('rental_terms').notNull().default(''),
  fullServiceTerms: text('full_service_terms').notNull().default(''),
  rentalUsageInstructions: text('rental_usage_instructions').notNull().default(''),
  squareEnvironment: text('square_environment', { enum: ['sandbox', 'production'] }),
  squareAccessTokenEnc: text('square_access_token_enc'),
  squareLocationId: text('square_location_id'),
  squareLocationName: text('square_location_name'),
  squareWebhookSignatureKeyEnc: text('square_webhook_signature_key_enc'),
  squareConnectedAt: text('square_connected_at'),
  updatedAt: updatedAt(),
});

export const user = sqliteTable(
  'user',
  {
    id: pk(),
    tenantId: tenantId(),
    username: text('username').notNull(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash'),
    role: text('role', { enum: ['admin', 'staff'] }).notNull(),
    active: bool('active').notNull().default(true),
    lastLoginAt: text('last_login_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  // Usernames are globally unique so sign-in needs no tenant selector.
  (t) => [uniqueIndex('user_username_uq').on(t.username), index('user_tenant_idx').on(t.tenantId)],
);

export const session = sqliteTable(
  'session',
  {
    /** SHA-256 of the opaque cookie token. */
    id: text('id').primaryKey(),
    tenantId: tenantId(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    lastSeenAt: text('last_seen_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

// ---------- CRM ----------
export const organization = sqliteTable(
  'organization',
  {
    id: pk(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    type: text('type').notNull(),
    city: text('city'),
    address: text('address'),
    website: text('website'),
    phone: text('phone'),
    notes: text('notes'),
    /** What we know about competitors serving this customer (who, pricing, satisfaction). */
    competitorNote: text('competitor_note'),
    archivedAt: text('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('organization_tenant_idx').on(t.tenantId, t.name)],
);

export const contact = sqliteTable(
  'contact',
  {
    id: pk(),
    tenantId: tenantId(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    role: text('role'),
    email: text('email'),
    phone: text('phone'),
    notes: text('notes'),
    squareCustomerId: text('square_customer_id'),
    archivedAt: text('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('contact_tenant_idx').on(t.tenantId, t.name),
    index('contact_email_idx').on(t.tenantId, t.email),
    index('contact_org_idx').on(t.organizationId),
  ],
);

export const opportunity = sqliteTable(
  'opportunity',
  {
    id: pk(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    stage: text('stage', {
      enum: ['new', 'contacted', 'quote_requested', 'quoted', 'won', 'lost'],
    }).notNull(),
    serviceInterest: text('service_interest', { enum: ['equipment_rental', 'full_service'] }),
    eventDate: text('event_date'),
    expectedAttendance: integer('expected_attendance'),
    estimatedValueCents: integer('estimated_value_cents'),
    source: text('source').notNull().default('manual'),
    lossReason: text('loss_reason'),
    lossNote: text('loss_note'),
    needsLossReason: bool('needs_loss_reason').notNull().default(false),
    notes: text('notes'),
    stageChangedAt: text('stage_changed_at').notNull().default(now),
    closedAt: text('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('opportunity_tenant_stage_idx').on(t.tenantId, t.stage),
    index('opportunity_org_idx').on(t.organizationId),
    index('opportunity_contact_idx').on(t.contactId),
  ],
);

export const quoteRequest = sqliteTable(
  'quote_request',
  {
    id: pk(),
    tenantId: tenantId(),
    opportunityId: text('opportunity_id').references(() => opportunity.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    email: text('email').notNull(),
    phone: text('phone'),
    organization: text('organization'),
    serviceInterest: text('service_interest', {
      enum: ['equipment_rental', 'full_service'],
    }).notNull(),
    eventDate: text('event_date').notNull(),
    expectedAttendance: integer('expected_attendance').notNull(),
    location: text('location').notNull(),
    message: text('message'),
    ip: text('ip'),
    seenAt: text('seen_at'),
    createdAt: createdAt(),
  },
  (t) => [index('quote_request_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const activity = sqliteTable(
  'activity',
  {
    id: pk(),
    tenantId: tenantId(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    organizationId: text('organization_id'),
    opportunityId: text('opportunity_id'),
    bookingId: text('booking_id'),
    kind: text('kind').notNull(),
    body: text('body'),
    data: json<Record<string, unknown>>('data'),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('activity_subject_idx').on(t.tenantId, t.subjectType, t.subjectId),
    index('activity_org_idx').on(t.tenantId, t.organizationId),
    index('activity_opp_idx').on(t.tenantId, t.opportunityId),
    index('activity_booking_idx').on(t.tenantId, t.bookingId),
  ],
);

// ---------- Inventory ----------
export const equipmentType = sqliteTable('equipment_type', {
  id: pk(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  trackingMode: text('tracking_mode', { enum: ['pooled', 'serialized'] }).notNull(),
  /** Pooled types only; serialized counts come from equipment_unit. */
  ownedQuantity: integer('owned_quantity').notNull().default(0),
  outOfServiceQuantity: integer('out_of_service_quantity').notNull().default(0),
  lossFeeCents: integer('loss_fee_cents').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const equipmentUnit = sqliteTable(
  'equipment_unit',
  {
    id: pk(),
    tenantId: tenantId(),
    equipmentTypeId: text('equipment_type_id')
      .notNull()
      .references(() => equipmentType.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    status: text('status', { enum: ['in_service', 'out_of_service', 'retired', 'lost'] })
      .notNull()
      .default('in_service'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('equipment_unit_label_uq').on(t.tenantId, t.equipmentTypeId, t.label)],
);

export const inventoryAdjustment = sqliteTable(
  'inventory_adjustment',
  {
    id: pk(),
    tenantId: tenantId(),
    equipmentTypeId: text('equipment_type_id')
      .notNull()
      .references(() => equipmentType.id, { onDelete: 'cascade' }),
    unitId: text('unit_id').references(() => equipmentUnit.id, { onDelete: 'set null' }),
    delta: integer('delta').notNull(),
    reason: text('reason').notNull(),
    note: text('note'),
    bookingId: text('booking_id').references((): AnySQLiteColumn => booking.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('inventory_adjustment_type_idx').on(t.tenantId, t.equipmentTypeId)],
);

export const rentalPackage = sqliteTable('rental_package', {
  id: pk(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  description: text('description'),
  priceCents: integer('price_cents').notNull(),
  includedDays: integer('included_days').notNull().default(1),
  extraDayPriceCents: integer('extra_day_price_cents').notNull().default(0),
  active: bool('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const packageItem = sqliteTable(
  'package_item',
  {
    tenantId: tenantId(),
    packageId: text('package_id')
      .notNull()
      .references(() => rentalPackage.id, { onDelete: 'cascade' }),
    equipmentTypeId: text('equipment_type_id')
      .notNull()
      .references(() => equipmentType.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    lossFeeCents: integer('loss_fee_cents'),
  },
  (t) => [primaryKey({ columns: [t.packageId, t.equipmentTypeId] })],
);

// ---------- Quotes ----------
export const quote = sqliteTable(
  'quote',
  {
    id: pk(),
    tenantId: tenantId(),
    number: integer('number').notNull(),
    opportunityId: text('opportunity_id')
      .notNull()
      .references(() => opportunity.id, { onDelete: 'cascade' }),
    bookingType: text('booking_type', { enum: ['equipment_rental', 'full_service'] }).notNull(),
    status: text('status', {
      enum: ['draft', 'sent', 'accepted', 'declined', 'expired'],
    }).notNull(),
    currentRevisionId: text('current_revision_id'),
    sentAt: text('sent_at'),
    acceptedAt: text('accepted_at'),
    declinedAt: text('declined_at'),
    declineReason: text('decline_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('quote_number_uq').on(t.tenantId, t.number),
    index('quote_opp_idx').on(t.opportunityId),
  ],
);

export const quoteRevision = sqliteTable(
  'quote_revision',
  {
    id: pk(),
    tenantId: tenantId(),
    quoteId: text('quote_id')
      .notNull()
      .references(() => quote.id, { onDelete: 'cascade' }),
    revisionNumber: integer('revision_number').notNull(),
    bookingType: text('booking_type', { enum: ['equipment_rental', 'full_service'] }).notNull(),
    pricingTerm: text('pricing_term', {
      enum: ['flat_fee', 'door_split', 'guarantee_plus_split'],
    }).notNull(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date').notNull(),
    startTime: text('start_time'),
    endTime: text('end_time'),
    location: text('location'),
    insideServiceArea: bool('inside_service_area').notNull().default(true),
    expectedAttendance: integer('expected_attendance'),
    splitBps: integer('split_bps'),
    guaranteeCents: integer('guarantee_cents'),
    depositBps: integer('deposit_bps').notNull().default(0),
    totalCents: integer('total_cents'),
    depositCents: integer('deposit_cents').notNull().default(0),
    requirements: json<Record<string, number>>('requirements').notNull().default({}),
    staffRequired: integer('staff_required').notNull().default(0),
    occurrenceDates: json<string[]>('occurrence_dates'),
    notes: text('notes'),
    termsText: text('terms_text'),
    publicToken: text('public_token'),
    tokenRevokedAt: text('token_revoked_at'),
    expiresOn: text('expires_on'),
    sentAt: text('sent_at'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('quote_revision_number_uq').on(t.quoteId, t.revisionNumber),
    uniqueIndex('quote_revision_token_uq').on(t.publicToken),
  ],
);

export const quoteLine = sqliteTable(
  'quote_line',
  {
    id: pk(),
    tenantId: tenantId(),
    revisionId: text('revision_id')
      .notNull()
      .references(() => quoteRevision.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind', { enum: ['package', 'addon', 'delivery', 'custom'] }).notNull(),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    packageId: text('package_id').references(() => rentalPackage.id, { onDelete: 'set null' }),
  },
  (t) => [index('quote_line_rev_idx').on(t.revisionId)],
);

export const acceptance = sqliteTable('acceptance', {
  id: pk(),
  tenantId: tenantId(),
  quoteId: text('quote_id')
    .notNull()
    .references(() => quote.id, { onDelete: 'cascade' }),
  revisionId: text('revision_id')
    .notNull()
    .unique()
    .references(() => quoteRevision.id, { onDelete: 'cascade' }),
  fullName: text('full_name').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
  acceptedAt: createdAt(),
});

// ---------- Staff ----------
export const staffMember = sqliteTable('staff_member', {
  id: pk(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  active: bool('active').notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const staffUnavailability = sqliteTable(
  'staff_unavailability',
  {
    id: pk(),
    tenantId: tenantId(),
    staffMemberId: text('staff_member_id')
      .notNull()
      .references(() => staffMember.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('staff_unavailability_uq').on(t.staffMemberId, t.date)],
);

// ---------- Bookings ----------
export const booking = sqliteTable(
  'booking',
  {
    id: pk(),
    tenantId: tenantId(),
    number: integer('number').notNull(),
    opportunityId: text('opportunity_id').references(() => opportunity.id, {
      onDelete: 'set null',
    }),
    contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    quoteId: text('quote_id').references(() => quote.id, { onDelete: 'set null' }),
    revisionId: text('revision_id').references(() => quoteRevision.id, { onDelete: 'set null' }),
    seriesId: text('series_id'),
    bookingType: text('booking_type', { enum: ['equipment_rental', 'full_service'] }).notNull(),
    status: text('status', {
      enum: ['awaiting_deposit', 'confirmed', 'out', 'returned', 'closed', 'cancelled'],
    }).notNull(),
    pricingTerm: text('pricing_term', {
      enum: ['flat_fee', 'door_split', 'guarantee_plus_split'],
    }).notNull(),
    title: text('title').notNull(),
    /** Event date (full-service) or dispatch date (rental) — first day of the hold. */
    startDate: text('start_date').notNull(),
    /** Event date (full-service) or return date (rental) — last day of use. */
    endDate: text('end_date').notNull(),
    startTime: text('start_time'),
    endTime: text('end_time'),
    location: text('location'),
    expectedAttendance: integer('expected_attendance'),
    totalCents: integer('total_cents'),
    depositCents: integer('deposit_cents').notNull().default(0),
    splitBps: integer('split_bps'),
    guaranteeCents: integer('guarantee_cents'),
    staffRequired: integer('staff_required').notNull().default(0),
    // Rental logistics
    fulfillment: text('fulfillment', { enum: ['pickup', 'delivery'] }),
    dispatchTime: text('dispatch_time'),
    returnTime: text('return_time'),
    deliveryAddress: text('delivery_address'),
    customerInstructions: text('customer_instructions'),
    confirmationSentAt: text('confirmation_sent_at'),
    // Full-service details
    venueContact: text('venue_contact'),
    loadInTime: text('load_in_time'),
    channels: integer('channels'),
    runOfShow: text('run_of_show'),
    // Lifecycle
    needsInvoice: bool('needs_invoice').notNull().default(false),
    invoiceError: text('invoice_error'),
    confirmedAt: text('confirmed_at'),
    confirmOverrideReason: text('confirm_override_reason'),
    overbookingAcknowledged: bool('overbooking_acknowledged').notNull().default(false),
    cancelledAt: text('cancelled_at'),
    cancelReason: text('cancel_reason'),
    closedAt: text('closed_at'),
    /** Set by the overdue job when an Out booking passes its return time; cleared on check-in. */
    overdueAt: text('overdue_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('booking_number_uq').on(t.tenantId, t.number),
    index('booking_dates_idx').on(t.tenantId, t.startDate, t.endDate),
    index('booking_status_idx').on(t.tenantId, t.status),
    index('booking_series_idx').on(t.seriesId),
  ],
);

export const bookingStaff = sqliteTable(
  'booking_staff',
  {
    tenantId: tenantId(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    staffMemberId: text('staff_member_id')
      .notNull()
      .references(() => staffMember.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.bookingId, t.staffMemberId] })],
);

export const equipmentRequirement = sqliteTable(
  'equipment_requirement',
  {
    tenantId: tenantId(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    equipmentTypeId: text('equipment_type_id')
      .notNull()
      .references(() => equipmentType.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    lossFeeCents: integer('loss_fee_cents'),
  },
  (t) => [primaryKey({ columns: [t.bookingId, t.equipmentTypeId] })],
);

export const checkoutRecord = sqliteTable(
  'checkout_record',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['checkout', 'checkin', 'correction'] }).notNull(),
    note: text('note'),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('checkout_record_booking_idx').on(t.bookingId)],
);

export const checkoutItem = sqliteTable(
  'checkout_item',
  {
    id: pk(),
    tenantId: tenantId(),
    recordId: text('record_id')
      .notNull()
      .references(() => checkoutRecord.id, { onDelete: 'cascade' }),
    equipmentTypeId: text('equipment_type_id')
      .notNull()
      .references(() => equipmentType.id, { onDelete: 'cascade' }),
    unitId: text('unit_id').references(() => equipmentUnit.id, { onDelete: 'set null' }),
    /** checkout: quantity out; checkin: quantity returned; correction: quantity found. */
    quantity: integer('quantity').notNull(),
    damaged: integer('damaged').notNull().default(0),
    missing: integer('missing').notNull().default(0),
  },
  (t) => [index('checkout_item_record_idx').on(t.recordId)],
);

// ---------- Money ----------
export const settlement = sqliteTable('settlement', {
  id: pk(),
  tenantId: tenantId(),
  bookingId: text('booking_id')
    .notNull()
    .references(() => booking.id, { onDelete: 'cascade' }),
  doorRevenueCents: integer('door_revenue_cents').notNull(),
  splitBps: integer('split_bps').notNull(),
  guaranteeCents: integer('guarantee_cents'),
  amountCents: integer('amount_cents').notNull(),
  note: text('note'),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

export const invoice = sqliteTable(
  'invoice',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    chargeId: text('charge_id'),
    kind: text('kind', { enum: ['rental', 'full_service', 'settlement', 'loss'] }).notNull(),
    status: text('status', {
      enum: ['pending', 'published', 'partially_paid', 'paid', 'cancelled', 'failed'],
    }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    depositCents: integer('deposit_cents').notNull().default(0),
    depositDueDate: text('deposit_due_date'),
    dueDate: text('due_date').notNull(),
    paidCents: integer('paid_cents').notNull().default(0),
    squareInvoiceId: text('square_invoice_id'),
    squareOrderId: text('square_order_id'),
    squareVersion: integer('square_version'),
    publicUrl: text('public_url'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('invoice_booking_idx').on(t.bookingId),
    uniqueIndex('invoice_square_uq').on(t.squareInvoiceId),
  ],
);

export const payment = sqliteTable(
  'payment',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    invoiceId: text('invoice_id').references(() => invoice.id, { onDelete: 'set null' }),
    source: text('source', { enum: ['square', 'external'] }).notNull(),
    method: text('method'),
    amountCents: integer('amount_cents').notNull(),
    receivedOn: text('received_on').notNull(),
    squarePaymentId: text('square_payment_id'),
    note: text('note'),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('payment_booking_idx').on(t.bookingId),
    uniqueIndex('payment_square_uq').on(t.squarePaymentId),
  ],
);

export const charge = sqliteTable(
  'charge',
  {
    id: pk(),
    tenantId: tenantId(),
    bookingId: text('booking_id')
      .notNull()
      .references(() => booking.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['loss', 'damage'] }).notNull(),
    proposedCents: integer('proposed_cents').notNull(),
    amountCents: integer('amount_cents'),
    status: text('status', {
      enum: ['proposed', 'approved', 'charged', 'invoiced', 'waived', 'failed'],
    }).notNull(),
    reason: text('reason'),
    squarePaymentId: text('square_payment_id'),
    invoiceId: text('invoice_id'),
    decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
    decidedAt: text('decided_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('charge_booking_idx').on(t.bookingId)],
);

// ---------- Infrastructure ----------
export const job = sqliteTable(
  'job',
  {
    id: pk(),
    tenantId: text('tenant_id').references(() => tenant.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: json<Record<string, unknown>>('payload').notNull().default({}),
    status: text('status', { enum: ['pending', 'running', 'done', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(8),
    runAt: text('run_at').notNull(),
    lockedAt: text('locked_at'),
    lastError: text('last_error'),
    idempotencyKey: text('idempotency_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('job_due_idx').on(t.status, t.runAt),
    uniqueIndex('job_idempotency_uq').on(t.idempotencyKey),
  ],
);

export const outboundEmail = sqliteTable(
  'outbound_email',
  {
    id: pk(),
    tenantId: tenantId(),
    to: text('to').notNull(),
    subject: text('subject').notNull(),
    text: text('text').notNull(),
    html: text('html'),
    status: text('status', { enum: ['queued', 'sent', 'logged', 'failed'] }).notNull(),
    error: text('error'),
    relatedType: text('related_type'),
    relatedId: text('related_id'),
    sentAt: text('sent_at'),
    createdAt: createdAt(),
  },
  (t) => [index('outbound_email_tenant_idx').on(t.tenantId, t.createdAt)],
);

export const webhookEvent = sqliteTable('webhook_event', {
  id: pk(),
  tenantId: text('tenant_id').references(() => tenant.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  eventId: text('event_id').notNull().unique(),
  type: text('type').notNull(),
  payload: json<Record<string, unknown>>('payload').notNull(),
  processedAt: text('processed_at'),
  receivedAt: createdAt(),
});

/** Per-tenant counters for human-friendly quote and booking numbers. */
export const counter = sqliteTable(
  'counter',
  {
    tenantId: tenantId(),
    name: text('name').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.name] })],
);
