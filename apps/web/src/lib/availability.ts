import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingStatus, BookingType, CapacityDay, HoldStrength } from '@disco/shared';
import { toast } from 'sonner';
import { api, ApiError } from '@/lib/api';

export interface AvailabilityBooking {
  id: string;
  number: number;
  title: string;
  bookingType: BookingType;
  status: BookingStatus;
  overdue: boolean;
  strength: Exclude<HoldStrength, 'soft'>;
  startDate: string;
  endDate: string;
  holdEndDate: string;
  staffRequired: number;
}

export interface AvailabilityConflict {
  date: string;
  fleetSplit: boolean;
  shortfalls: { resource: string; shortfall: number }[];
  holds: CapacityDay['holds'];
}

export interface Availability {
  from: string;
  to: string;
  bufferDays: number;
  equipmentTypes: { id: string; name: string }[];
  staff: { id: string; name: string; active: boolean }[];
  staffUnavailability: { staffMemberId: string; date: string }[];
  days: CapacityDay[];
  bookings: AvailabilityBooking[];
  conflicts: AvailabilityConflict[];
}

export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
  unavailable: { date: string; note: string | null }[];
}

export const availabilityKey = ['availability'] as const;
export const staffKey = ['staff'] as const;

export function useAvailability(from: string, to: string) {
  return useQuery({
    queryKey: [...availabilityKey, from, to],
    queryFn: () => api.get<Availability>(`/api/availability?from=${from}&to=${to}`),
    placeholderData: keepPreviousData,
  });
}

export function useStaff() {
  return useQuery({ queryKey: staffKey, queryFn: () => api.get<StaffMember[]>('/api/staff') });
}

/** Marks a staff member available or unavailable on one date. */
export function useSetStaffAvailability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      staffId,
      date,
      available,
    }: {
      staffId: string;
      date: string;
      available: boolean;
    }) =>
      available
        ? api.delete(`/api/staff/${staffId}/unavailability/${date}`)
        : api.post(`/api/staff/${staffId}/unavailability`, { date }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: availabilityKey });
      void qc.invalidateQueries({ queryKey: staffKey });
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not update'),
  });
}

/** Display name for a capacity resource (equipment type id or 'staff'). */
export function resourceLabel(resource: string, types: Availability['equipmentTypes']) {
  if (resource === 'staff') return 'DJs';
  return types.find((t) => t.id === resource)?.name ?? 'Equipment';
}
