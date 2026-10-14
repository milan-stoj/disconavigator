import { useBooking } from '@/lib/bookings';

export function BookingCrumb({ id }: { id: string }) {
  return <>{useBooking(id).data?.numberLabel ?? 'Booking'}</>;
}
