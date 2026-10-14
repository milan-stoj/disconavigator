import { z } from 'zod';
import { isIsoDate, type IsoDate } from './dates.js';
import { BOOKING_TYPES, PRICING_TERMS } from './policy.js';
import { QUOTE_LINE_KINDS } from './quote.js';

const id = z.string().min(1).max(64);
const trimmed = (max = 200) => z.string().trim().max(max);
const required = (label: string, max = 200) => trimmed(max).min(1, `${label} is required`);
const optionalText = (max = 2000) =>
  trimmed(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const optionalEmail = z
  .union([z.literal(''), z.email('Enter a valid email')])
  .optional()
  .nullable()
  .transform((v) => (v ? v.toLowerCase() : null));
const phone = trimmed(40)
  .optional()
  .nullable()
  .refine((v) => !v || /^[+()\-.\s\d]{7,}$/.test(v), 'Enter a valid phone number')
  .transform((v) => (v ? v : null));
export const isoDate = z.string().refine(isIsoDate, 'Enter a valid date (YYYY-MM-DD)');
export const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Enter a time as HH:MM');
const cents = z.number().int('Amount must be whole cents').min(0, 'Amount cannot be negative');
const bps = z.number().int().min(0).max(10_000);
const qty = z.number().int('Quantity must be a whole number');

// ---------- Auth & users ----------
export const signInSchema = z.object({
  username: required('Username', 64),
  password: z.string().min(1, 'Password is required').max(256),
});
export const USER_ROLES = ['admin', 'staff'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const passwordSchema = z.string().min(10, 'Use at least 10 characters').max(256);
export const setupSchema = z.object({ password: passwordSchema });
export const createUserSchema = z.object({
  username: required('Username', 64).regex(
    /^[a-z0-9._-]+$/i,
    'Letters, numbers, dot, dash, underscore only',
  ),
  displayName: required('Name', 100),
  role: z.enum(USER_ROLES),
  password: passwordSchema,
});
export const updateUserSchema = z.object({
  displayName: required('Name', 100).optional(),
  role: z.enum(USER_ROLES).optional(),
  active: z.boolean().optional(),
  password: passwordSchema.optional(),
});

// ---------- CRM ----------
export const ORGANIZATION_TYPES = [
  'bar',
  'venue',
  'municipality',
  'business',
  'school',
  'nonprofit',
  'festival',
  'private',
  'other',
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];
export const ORGANIZATION_TYPE_LABELS: Record<OrganizationType, string> = {
  bar: 'Bar',
  venue: 'Venue',
  municipality: 'Town / city',
  business: 'Business',
  school: 'School',
  nonprofit: 'Nonprofit',
  festival: 'Festival',
  private: 'Private client',
  other: 'Other',
};
export const organizationSchema = z.object({
  name: required('Name'),
  type: z.enum(ORGANIZATION_TYPES),
  city: optionalText(100),
  address: optionalText(300),
  website: optionalText(300),
  phone,
  notes: optionalText(),
  competitorNote: optionalText(),
});
export const contactSchema = z.object({
  organizationId: id.optional().nullable(),
  name: required('Name'),
  role: optionalText(100),
  email: optionalEmail,
  phone,
  notes: optionalText(),
});

export const OPPORTUNITY_STAGES = [
  'new',
  'contacted',
  'quote_requested',
  'quoted',
  'won',
  'lost',
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];
export const OPEN_STAGES: readonly OpportunityStage[] = [
  'new',
  'contacted',
  'quote_requested',
  'quoted',
];
export const STAGE_LABELS: Record<OpportunityStage, string> = {
  new: 'New',
  contacted: 'Contacted',
  quote_requested: 'Quote Requested',
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
};
export const LOSS_REASONS = [
  'price',
  'capacity',
  'competitor',
  'event_cancelled',
  'no_response',
  'other',
] as const;
export type LossReason = (typeof LOSS_REASONS)[number];
export const LOSS_REASON_LABELS: Record<LossReason, string> = {
  price: 'Price',
  capacity: 'Date unavailable (capacity)',
  competitor: 'Went with a competitor',
  event_cancelled: 'Event cancelled',
  no_response: 'No response',
  other: 'Other',
};

export const opportunitySchema = z.object({
  title: required('Title'),
  organizationId: id.optional().nullable(),
  contactId: id.optional().nullable(),
  serviceInterest: z.enum(BOOKING_TYPES).optional().nullable(),
  eventDate: isoDate.optional().nullable(),
  expectedAttendance: qty.min(0).optional().nullable(),
  estimatedValueCents: cents.optional().nullable(),
  notes: optionalText(),
});

export const stageChangeSchema = z
  .object({
    stage: z.enum(OPPORTUNITY_STAGES),
    lossReason: z.enum(LOSS_REASONS).optional().nullable(),
    lossNote: optionalText(),
  })
  .superRefine((v, ctx) => {
    if (v.stage !== 'lost') return;
    if (!v.lossReason) {
      ctx.addIssue({ code: 'custom', path: ['lossReason'], message: 'Choose a loss reason' });
    } else if (v.lossReason === 'other' && !v.lossNote) {
      ctx.addIssue({ code: 'custom', path: ['lossNote'], message: 'Add a note for "other"' });
    }
  });

export const ACTIVITY_KINDS = ['note', 'call', 'email', 'meeting'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const activityNoteSchema = z.object({
  kind: z.enum(ACTIVITY_KINDS),
  body: required('Note', 5000),
});

// ---------- Public quote request ----------
export function makeQuoteRequestSchema(today: () => IsoDate) {
  return z.object({
    name: required('Name'),
    email: z.email('Enter a valid email').transform((v) => v.toLowerCase()),
    phone,
    organization: optionalText(200),
    serviceInterest: z.enum(BOOKING_TYPES, 'Choose a service'),
    eventDate: isoDate.refine((d) => d >= today(), 'Event date cannot be in the past'),
    expectedAttendance: qty.min(1, 'Enter expected attendance').max(100_000),
    location: required('Event location', 300),
    message: optionalText(5000),
    /** Honeypot: humans leave this empty. */
    website: z.string().max(500).optional(),
  });
}

// ---------- Inventory ----------
export const TRACKING_MODES = ['pooled', 'serialized'] as const;
export const equipmentTypeSchema = z.object({
  name: required('Name', 100),
  trackingMode: z.enum(TRACKING_MODES),
  lossFeeCents: cents,
});
export const ADJUSTMENT_REASONS = ['purchase', 'retired', 'lost', 'damaged', 'found'] as const;
export const inventoryAdjustmentSchema = z
  .object({
    delta: qty.refine((n) => n !== 0, 'Quantity change cannot be zero'),
    reason: z.enum(ADJUSTMENT_REASONS),
    note: optionalText(),
  })
  .superRefine((v, ctx) => {
    const adds = v.reason === 'purchase' || v.reason === 'found';
    if (adds !== v.delta > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['delta'],
        message: adds ? 'This reason adds equipment' : 'This reason removes equipment',
      });
    }
  });
export const outOfServiceSchema = z.object({
  quantity: qty.min(0),
  note: optionalText(),
});
export const equipmentUnitSchema = z.object({
  label: required('Label', 50),
  notes: optionalText(),
});
export const UNIT_STATUSES = ['in_service', 'out_of_service', 'retired', 'lost'] as const;
export const unitStatusSchema = z.object({ status: z.enum(UNIT_STATUSES), note: optionalText() });
export const rentalPackageSchema = z.object({
  name: required('Name', 100),
  description: optionalText(),
  priceCents: cents,
  includedDays: qty.min(1),
  extraDayPriceCents: cents,
  active: z.boolean().default(true),
  items: z
    .array(
      z.object({
        equipmentTypeId: id,
        quantity: qty.min(1),
        lossFeeCents: cents.optional().nullable(),
      }),
    )
    .min(1, 'Add at least one item'),
});

// ---------- Quotes ----------
export const quoteLineSchema = z.object({
  kind: z.enum(QUOTE_LINE_KINDS),
  description: required('Description', 300),
  quantity: qty.min(1),
  unitPriceCents: cents,
  packageId: id.optional().nullable(),
});

export const seriesSchema = z.object({
  pattern: z.enum(['monthly_nth_weekday', 'weekly']),
  from: isoDate,
  to: isoDate,
  weekday: z.number().int().min(0).max(6).optional(),
  nth: z.union([z.literal(-1), z.number().int().min(1).max(5)]).optional(),
  intervalWeeks: z.number().int().min(1).max(8).optional(),
});

export const quoteSchema = z
  .object({
    opportunityId: id,
    bookingType: z.enum(BOOKING_TYPES),
    pricingTerm: z.enum(PRICING_TERMS),
    startDate: isoDate,
    endDate: isoDate,
    startTime: timeOfDay.optional().nullable(),
    endTime: timeOfDay.optional().nullable(),
    location: optionalText(300),
    insideServiceArea: z.boolean().default(true),
    expectedAttendance: qty.min(0).optional().nullable(),
    lines: z.array(quoteLineSchema).default([]),
    splitBps: bps.optional().nullable(),
    guaranteeCents: cents.optional().nullable(),
    requirements: z.record(z.string(), qty.min(0)).default({}),
    staffRequired: qty.min(0).optional(),
    occurrenceDates: z.array(isoDate).optional().nullable(),
    notes: optionalText(),
    expiresOn: isoDate.optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.endDate < v.startDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date must be on or after start date',
      });
    }
    if (v.bookingType === 'equipment_rental' && v.pricingTerm !== 'flat_fee') {
      ctx.addIssue({
        code: 'custom',
        path: ['pricingTerm'],
        message: 'Equipment rentals use fixed pricing only',
      });
    }
    if (v.pricingTerm === 'flat_fee' && v.lines.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Add at least one line item' });
    }
    if (v.pricingTerm !== 'flat_fee' && (v.splitBps == null || v.splitBps <= 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['splitBps'],
        message: 'Enter the door split percentage',
      });
    }
    if (
      v.pricingTerm === 'guarantee_plus_split' &&
      (v.guaranteeCents == null || v.guaranteeCents <= 0)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['guaranteeCents'],
        message: 'Enter the guarantee amount',
      });
    }
    if (v.occurrenceDates && v.occurrenceDates.length > 0 && v.bookingType !== 'full_service') {
      ctx.addIssue({
        code: 'custom',
        path: ['occurrenceDates'],
        message: 'Recurring series are only for full-service events',
      });
    }
  });

export const acceptQuoteSchema = z.object({
  fullName: required('Full name', 200),
  agreeToTerms: z.literal(true, 'You must agree to the terms'),
});
export const declineQuoteSchema = z.object({ reason: optionalText(1000) });

// ---------- Bookings ----------
export const cancelBookingSchema = z.object({ reason: required('Reason', 1000) });
export const confirmOverrideSchema = z.object({ reason: required('Reason', 1000) });
export const FULFILLMENT_METHODS = ['pickup', 'delivery'] as const;
export const rentalLogisticsSchema = z
  .object({
    fulfillment: z.enum(FULFILLMENT_METHODS),
    dispatchDate: isoDate,
    dispatchTime: timeOfDay.optional().nullable(),
    returnDate: isoDate,
    returnTime: timeOfDay.optional().nullable(),
    deliveryAddress: optionalText(300),
    customerInstructions: optionalText(),
  })
  .superRefine((v, ctx) => {
    if (v.returnDate < v.dispatchDate) {
      ctx.addIssue({
        code: 'custom',
        path: ['returnDate'],
        message: 'Return must be on or after dispatch',
      });
    }
    if (v.fulfillment === 'delivery' && !v.deliveryAddress) {
      ctx.addIssue({
        code: 'custom',
        path: ['deliveryAddress'],
        message: 'Enter a delivery address',
      });
    }
  });
export const eventDetailsSchema = z.object({
  venueContact: optionalText(200),
  loadInTime: timeOfDay.optional().nullable(),
  startTime: timeOfDay.optional().nullable(),
  endTime: timeOfDay.optional().nullable(),
  channels: z.number().int().min(1).max(3).optional().nullable(),
  runOfShow: optionalText(10_000),
});
export const assignStaffSchema = z.object({ staffMemberIds: z.array(id) });
export const overbookingConfirmation = z.object({ confirmOverbooking: z.boolean().default(false) });

// ---------- Staff ----------
export const staffMemberSchema = z.object({
  name: required('Name', 100),
  email: optionalEmail,
  phone,
  active: z.boolean().default(true),
});
export const staffUnavailabilitySchema = z.object({
  date: isoDate,
  note: optionalText(500),
});

// ---------- Check-out / check-in ----------
export const checkoutSchema = z.object({
  pooled: z.array(z.object({ equipmentTypeId: id, quantity: qty.min(0) })),
  unitIds: z.array(id).default([]),
  note: optionalText(),
  acknowledgeDifference: z.boolean().default(false),
});
export const checkinSchema = z.object({
  pooled: z.array(
    z
      .object({ equipmentTypeId: id, returned: qty.min(0), damaged: qty.min(0).default(0) })
      .refine((v) => v.damaged <= v.returned, {
        path: ['damaged'],
        message: 'Damaged cannot exceed returned',
      }),
  ),
  returnedUnitIds: z.array(id).default([]),
  damagedUnitIds: z.array(id).default([]),
  note: optionalText(),
});
export const foundCorrectionSchema = z.object({
  equipmentTypeId: id,
  quantity: qty.min(1),
  unitIds: z.array(id).default([]),
  note: optionalText(),
});

// ---------- Payments ----------
export const settlementSchema = z.object({
  doorRevenueCents: cents,
  note: optionalText(),
});
export const PAYMENT_METHODS = ['cash', 'check', 'other'] as const;
export const externalPaymentSchema = z.object({
  amountCents: cents.refine((n) => n > 0, 'Amount must be greater than zero'),
  receivedOn: isoDate,
  method: z.enum(PAYMENT_METHODS),
  note: optionalText(),
});
export const lossChargeDecisionSchema = z
  .object({
    action: z.enum(['approve', 'waive']),
    amountCents: cents.optional(),
    reason: optionalText(1000),
  })
  .superRefine((v, ctx) => {
    if (v.action === 'waive' && !v.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Enter a reason for waiving' });
    }
  });
export const squareConnectionSchema = z.object({
  environment: z.enum(['sandbox', 'production']),
  accessToken: z.string().trim().min(10, 'Enter the access token').max(500).optional(),
  locationId: z.string().trim().max(100).optional().nullable(),
  webhookSignatureKey: z.string().trim().max(500).optional().nullable(),
});

// ---------- Settings ----------
export const settingsSchema = z.object({
  businessName: required('Business name'),
  timeZone: required('Time zone', 64),
  notificationEmail: optionalEmail,
  rentalDepositBps: bps,
  bufferDays: z.number().int().min(0).max(14),
  rentalBalanceDueDays: z.number().int().min(0).max(60),
  fullServiceInvoiceDueOffsetDays: z.number().int().min(-60).max(60),
  deliveryFeeCents: cents,
  serviceAreas: z.array(trimmed(100).min(1)).default([]),
  quoteValidityDays: z.number().int().min(1).max(365),
  rentalTerms: trimmed(20_000),
  fullServiceTerms: trimmed(20_000),
  rentalUsageInstructions: trimmed(20_000).default(''),
});
export type Settings = z.infer<typeof settingsSchema>;
