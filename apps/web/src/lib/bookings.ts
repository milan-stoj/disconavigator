import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookingStatus,
  BookingType,
  PricingTerm,
  Shortfall,
  checkinSchema,
  checkoutSchema,
  eventDetailsSchema,
  externalPaymentSchema,
  foundCorrectionSchema,
  lossChargeDecisionSchema,
  rentalLogisticsSchema,
} from '@disco/shared';
import type { z } from 'zod';
import { ApiError, api } from '@/lib/api';
import { availabilityKey } from '@/lib/availability';
import { crmKeys, type ActivityEntry } from '@/lib/crm';
import { dashboardKey } from '@/lib/dashboard';
import { equipmentKey } from '@/lib/inventory';

export interface BookingRecord {
  id: string;
  number: number;
  numberLabel: string;
  opportunityId: string | null;
  contactId: string | null;
  organizationId: string | null;
  quoteId: string | null;
  seriesId: string | null;
  bookingType: BookingType;
  status: BookingStatus;
  pricingTerm: PricingTerm;
  title: string;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  expectedAttendance: number | null;
  totalCents: number | null;
  depositCents: number;
  splitBps: number | null;
  guaranteeCents: number | null;
  staffRequired: number;
  fulfillment: 'pickup' | 'delivery' | null;
  dispatchTime: string | null;
  returnTime: string | null;
  deliveryAddress: string | null;
  customerInstructions: string | null;
  confirmationSentAt: string | null;
  venueContact: string | null;
  loadInTime: string | null;
  channels: number | null;
  runOfShow: string | null;
  confirmedAt: string | null;
  confirmOverrideReason: string | null;
  overbookingAcknowledged: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
  closedAt: string | null;
  needsInvoice: boolean;
  invoiceError: string | null;
}

export interface BookingListItem extends BookingRecord {
  organizationName: string | null;
  contactName: string | null;
}

export interface BookingMoney {
  owedCents: number | null;
  chargesCents: number;
  paidCents: number;
  balanceCents: number | null;
  settlementRequired: boolean;
  settled: boolean;
}

export interface Booking extends BookingRecord {
  policy: { label: string };
  organization: { id: string; name: string } | null;
  contact: { id: string; name: string; email: string | null; phone: string | null } | null;
  quote: { id: string; eventDate: string } | null;
  requirements: { equipmentTypeId: string; name: string; quantity: number }[];
  staff: { id: string; name: string; phone: string | null }[];
  settlement: {
    id: string;
    doorRevenueCents: number;
    splitBps: number;
    guaranteeCents: number | null;
    amountCents: number;
    note: string | null;
    createdAt: string;
  } | null;
  payments: {
    id: string;
    source: 'square' | 'external';
    method: string | null;
    amountCents: number;
    receivedOn: string;
    note: string | null;
  }[];
  charges: {
    id: string;
    kind: 'loss' | 'damage';
    proposedCents: number;
    amountCents: number | null;
    status: string;
    reason: string | null;
  }[];
  invoices: {
    id: string;
    kind: string;
    status: string;
    amountCents: number;
    depositCents: number;
    dueDate: string;
    paidCents: number;
    publicUrl: string | null;
    lastError: string | null;
  }[];
  money: BookingMoney;
  closeBlockers: { code: string; message: string }[];
  overdue: boolean;
  equipment: EquipmentStatus;
  series: { id: string; numberLabel: string; startDate: string; status: BookingStatus }[];
  activity: (ActivityEntry & { userId: string | null })[];
}

export interface EquipmentLine {
  equipmentTypeId: string;
  name: string;
  trackingMode: 'pooled' | 'serialized';
  required: number;
  checkedOut: number;
  returned: number;
  damaged: number;
  /** Still missing after any found corrections. */
  missing: number;
  found: number;
  lossFeeCents: number;
  units: { id: string; label: string; returned: boolean; damaged: boolean; missing: boolean }[];
}

export interface EquipmentRecord {
  at: string;
  by: string | null;
  note: string | null;
}

export interface EquipmentStatus {
  checkedOut: EquipmentRecord | null;
  checkedIn: EquipmentRecord | null;
  corrections: (EquipmentRecord & {
    items: { equipmentTypeId: string; name: string; quantity: number; unitLabel: string | null }[];
  })[];
  lines: EquipmentLine[];
  busyUnits: { unitId: string; bookingId: string; numberLabel: string }[];
}

export interface QuantityDifference {
  equipmentTypeId: string;
  name: string;
  required: number;
  checkedOut: number;
}

/** The differences in a 409 quantity-mismatch response, or null for any other error. */
export function quantityMismatchFrom(err: unknown): QuantityDifference[] | null {
  if (err instanceof ApiError && err.code === 'quantity_mismatch' && err.details) {
    return (err.details as unknown as { differences: QuantityDifference[] }).differences;
  }
  return null;
}

export interface StaffWarning {
  date: string;
  staffMemberId: string;
  name: string;
  reason: 'unavailable' | 'double_booked';
}

export interface OverbookingDetails {
  shortfalls: Shortfall[];
  staffWarnings?: StaffWarning[];
}

/** The details of a 409 overbooking response, or null for any other error. */
export function overbookingFrom(err: unknown): OverbookingDetails | null {
  if (err instanceof ApiError && err.code === 'overbooking' && err.details) {
    return err.details as unknown as OverbookingDetails;
  }
  return null;
}

export const bookingKeys = {
  list: ['bookings', 'list'] as const,
  detail: (id: string) => ['bookings', id] as const,
};

export function useBookings() {
  return useQuery({
    queryKey: bookingKeys.list,
    queryFn: () => api.get<BookingListItem[]>('/api/bookings'),
  });
}

export function useBooking(id: string) {
  return useQuery({
    queryKey: bookingKeys.detail(id),
    queryFn: () => api.get<Booking>(`/api/bookings/${id}`),
    enabled: !!id,
  });
}

/** Every booking change can move holds, money, and the opportunity, so refresh all of them. */
function useBookingMutation<V>(fn: (v: V) => Promise<Booking>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (b) => {
      qc.setQueryData(bookingKeys.detail(b.id), b);
      void qc.invalidateQueries({ queryKey: bookingKeys.list });
      void qc.invalidateQueries({ queryKey: availabilityKey });
      void qc.invalidateQueries({ queryKey: crmKeys.opportunities });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      void qc.invalidateQueries({ queryKey: equipmentKey });
      void qc.invalidateQueries({ queryKey: moneyOwedKey });
      void qc.invalidateQueries({ queryKey: dashboardKey });
    },
  });
}

export function useConfirmBooking(id: string) {
  return useBookingMutation((body: { reason: string; confirmOverbooking?: boolean }) =>
    api.post<Booking>(`/api/bookings/${id}/confirm`, body),
  );
}

export function useCancelBooking(id: string) {
  return useBookingMutation((body: { reason: string }) =>
    api.post<Booking>(`/api/bookings/${id}/cancel`, body),
  );
}

export function useCloseBooking(id: string) {
  return useBookingMutation((body: { overrideReason?: string | null }) =>
    api.post<Booking>(`/api/bookings/${id}/close`, body),
  );
}

export function useRecordSettlement(id: string) {
  return useBookingMutation((body: { doorRevenueCents: number; note?: string | null }) =>
    api.post<Booking>(`/api/bookings/${id}/settlement`, body),
  );
}

export function useRecordPayment(id: string) {
  return useBookingMutation((body: z.input<typeof externalPaymentSchema>) =>
    api.post<Booking>(`/api/bookings/${id}/payments`, body),
  );
}

export function useDecideCharge(id: string) {
  return useBookingMutation(
    ({ chargeId, ...body }: { chargeId: string } & z.input<typeof lossChargeDecisionSchema>) =>
      api.post<Booking>(`/api/bookings/${id}/charges/${chargeId}/decision`, body),
  );
}

export function useRetryInvoice(id: string) {
  return useBookingMutation(() => api.post<Booking>(`/api/bookings/${id}/invoice/retry`));
}

export interface MoneyOwedRow {
  id: string;
  numberLabel: string;
  title: string;
  bookingType: BookingType;
  status: BookingStatus;
  startDate: string;
  customerName: string | null;
  owedCents: number;
  paidCents: number;
  balanceCents: number;
  dueDate: string;
  overdue: boolean;
  invoiceUrl: string | null;
  needsInvoice: boolean;
  invoiceError: string | null;
}

export const moneyOwedKey = ['money-owed'] as const;
export function useMoneyOwed() {
  return useQuery({
    queryKey: moneyOwedKey,
    queryFn: () => api.get<MoneyOwedRow[]>('/api/money-owed'),
  });
}

export type EventDetailsBody = z.input<typeof eventDetailsSchema>;
export function useSaveEventDetails(id: string) {
  return useBookingMutation((body: EventDetailsBody) =>
    api.patch<Booking>(`/api/bookings/${id}/event-details`, body),
  );
}

export function useAssignStaff(id: string) {
  return useBookingMutation((body: { staffMemberIds: string[]; confirmOverbooking?: boolean }) =>
    api.put<Booking>(`/api/bookings/${id}/staff`, body),
  );
}

export type LogisticsBody = z.input<typeof rentalLogisticsSchema> & {
  confirmOverbooking?: boolean;
};
export function useSaveLogistics(id: string) {
  return useBookingMutation((body: LogisticsBody) =>
    api.patch<Booking>(`/api/bookings/${id}/logistics`, body),
  );
}

export function useSendRentalConfirmation(id: string) {
  return useBookingMutation(() => api.post<Booking>(`/api/bookings/${id}/send-confirmation`));
}

export type CheckOutBody = z.input<typeof checkoutSchema>;
export function useCheckOut(id: string) {
  return useBookingMutation((body: CheckOutBody) =>
    api.post<Booking>(`/api/bookings/${id}/check-out`, body),
  );
}

export type CheckInBody = z.input<typeof checkinSchema>;
export function useCheckIn(id: string) {
  return useBookingMutation((body: CheckInBody) =>
    api.post<Booking>(`/api/bookings/${id}/check-in`, body),
  );
}

export type FoundBody = z.input<typeof foundCorrectionSchema>;
export function useRecordFound(id: string) {
  return useBookingMutation((body: FoundBody) =>
    api.post<Booking>(`/api/bookings/${id}/found`, body),
  );
}

/** Formats HH:MM as e.g. "3:30 PM". */
export const formatTime = (time: string | null) => {
  if (!time) return null;
  const [h = 0, m = 0] = time.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
