export const BOOKING_TYPES = ['equipment_rental', 'full_service'] as const;
export type BookingType = (typeof BOOKING_TYPES)[number];

export const PRICING_TERMS = ['flat_fee', 'door_split', 'guarantee_plus_split'] as const;
export type PricingTerm = (typeof PRICING_TERMS)[number];

export const BOOKING_STATUSES = [
  'awaiting_deposit',
  'confirmed',
  'out',
  'returned',
  'closed',
  'cancelled',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** How a booking is invoiced in Square. */
export type InvoicePlan =
  | 'deposit_and_balance' // equipment rental: holding deposit now, balance before dispatch
  | 'single_full' // full-service flat fee: one request for the total, no deposit
  | 'after_settlement'; // full-service split: nothing until the door is settled

export interface BookingTypePolicy {
  type: BookingType;
  label: string;
  description: string;
  allowedPricingTerms: readonly PricingTerm[];
  requiresDeposit: boolean;
  initialStatus: BookingStatus;
  proposesLossCharges: boolean;
  supportsDelivery: boolean;
  supportsSeries: boolean;
  usesPackages: boolean;
  defaultStaffRequired: number;
  invoicePlan(term: PricingTerm): InvoicePlan;
}

const equipmentRental: BookingTypePolicy = {
  type: 'equipment_rental',
  label: 'Equipment rental',
  description: 'Customer rents our equipment and runs their own event.',
  allowedPricingTerms: ['flat_fee'],
  requiresDeposit: true,
  initialStatus: 'awaiting_deposit',
  proposesLossCharges: true,
  supportsDelivery: true,
  supportsSeries: false,
  usesPackages: true,
  defaultStaffRequired: 0,
  invoicePlan: () => 'deposit_and_balance',
};

const fullService: BookingTypePolicy = {
  type: 'full_service',
  label: 'Full-service event',
  description: 'We provide DJs and run the show.',
  allowedPricingTerms: ['flat_fee', 'door_split', 'guarantee_plus_split'],
  requiresDeposit: false,
  initialStatus: 'confirmed',
  proposesLossCharges: false,
  supportsDelivery: false,
  supportsSeries: true,
  usesPackages: false,
  defaultStaffRequired: 1,
  invoicePlan: (term) => (term === 'flat_fee' ? 'single_full' : 'after_settlement'),
};

const POLICIES: Record<BookingType, BookingTypePolicy> = {
  equipment_rental: equipmentRental,
  full_service: fullService,
};

export function bookingPolicy(type: BookingType): BookingTypePolicy {
  return POLICIES[type];
}

export function isPricingTermAllowed(type: BookingType, term: PricingTerm): boolean {
  return POLICIES[type].allowedPricingTerms.includes(term);
}

export const PRICING_TERM_LABELS: Record<PricingTerm, string> = {
  flat_fee: 'Flat fee',
  door_split: 'Door split',
  guarantee_plus_split: 'Guarantee + split',
};

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  awaiting_deposit: 'Awaiting deposit',
  confirmed: 'Confirmed',
  out: 'Out',
  returned: 'Returned',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  awaiting_deposit: ['confirmed', 'cancelled'],
  confirmed: ['out', 'returned', 'closed', 'cancelled'],
  out: ['returned'],
  returned: ['closed'],
  closed: [],
  cancelled: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
