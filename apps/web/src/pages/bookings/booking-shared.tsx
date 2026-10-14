import { BOOKING_STATUS_LABELS, type BookingStatus } from '@disco/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { resourceLabel } from '@/lib/availability';
import type { OverbookingDetails } from '@/lib/bookings';
import { formatDate } from '@/lib/crm';
import { useEquipment } from '@/lib/inventory';
import { shortDate } from '@/lib/quotes';

const STATUS_VARIANTS: Record<BookingStatus, 'default' | 'secondary' | 'outline' | 'destructive'> =
  {
    awaiting_deposit: 'outline',
    confirmed: 'default',
    out: 'default',
    returned: 'secondary',
    closed: 'secondary',
    cancelled: 'destructive',
  };

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{BOOKING_STATUS_LABELS[status]}</Badge>;
}

export function bookingDates(b: { startDate: string; endDate: string }) {
  return b.startDate === b.endDate
    ? formatDate(b.startDate)
    : `${formatDate(b.startDate)} – ${formatDate(b.endDate)}`;
}

/** Lists what an action would overbook and asks whether to go ahead anyway. */
export function OverbookingDialog({
  details,
  action,
  onConfirm,
  onCancel,
}: {
  details: OverbookingDetails;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const types = useEquipment().data ?? [];
  const items = [
    ...details.shortfalls.map(
      (s) => `${shortDate(s.date)}: ${resourceLabel(s.resource, types)} short ${s.shortfall}`,
    ),
    ...(details.staffWarnings ?? []).map(
      (w) =>
        `${shortDate(w.date)}: ${w.name} ${w.reason === 'unavailable' ? 'is marked unavailable' : 'is already booked'}`,
    ),
  ];
  return (
    <AlertDialog open onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This would overbook</AlertDialogTitle>
          <AlertDialogDescription>
            Check the calendar before going ahead. You can still {action.toLowerCase()} if you have
            a plan to cover it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid list-disc gap-1 pl-5 text-sm" aria-label="Overbooking problems">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{action} anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
