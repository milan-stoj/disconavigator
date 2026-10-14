import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUSES,
  BOOKING_TYPES,
  bookingPolicy,
} from '@disco/shared';
import { useNavigate } from 'react-router';
import { DataTable, columnHelper } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { useBookings, type BookingListItem } from '@/lib/bookings';
import { BookingStatusBadge, bookingDates } from './booking-shared';

const h = columnHelper<BookingListItem>();
const columns = [
  h.accessor('number', {
    header: 'Booking',
    enableHiding: false,
    cell: ({ row }) => (
      <div className="min-w-40">
        <div className="font-medium">{row.original.numberLabel}</div>
        <div className="text-muted-foreground text-xs">{row.original.title}</div>
      </div>
    ),
  }),
  h.accessor('title', { header: 'Title', enableHiding: true }),
  h.accessor((b) => b.organizationName ?? b.contactName ?? '', {
    id: 'customer',
    header: 'Customer',
    cell: (info) => info.getValue() || '—',
  }),
  h.accessor('bookingType', {
    header: 'Type',
    filterFn: 'equalsString',
    cell: (info) => <Badge variant="outline">{bookingPolicy(info.getValue()).label}</Badge>,
  }),
  h.accessor('startDate', {
    header: 'Dates',
    sortFn: 'text',
    cell: ({ row }) => bookingDates(row.original),
  }),
  h.accessor('status', {
    header: 'Status',
    filterFn: 'equalsString',
    cell: (info) => <BookingStatusBadge status={info.getValue()} />,
  }),
];

export function BookingsPage() {
  const bookings = useBookings();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        title="Bookings"
        description="Rentals and full-service events, created when a customer accepts a quote."
      />
      <DataTable
        label="Bookings"
        columns={columns}
        data={bookings.data}
        isLoading={bookings.isPending}
        searchPlaceholder="Search bookings…"
        emptyMessage="No bookings yet. They appear when a customer accepts a quote."
        getRowId={(b) => b.id}
        initialSorting={[{ id: 'startDate', desc: false }]}
        initialColumnVisibility={{ title: false }}
        onRowClick={(b) => void navigate(`/bookings/${b.id}`)}
        filters={[
          {
            columnId: 'status',
            title: 'Statuses',
            options: BOOKING_STATUSES.map((s) => ({ value: s, label: BOOKING_STATUS_LABELS[s] })),
          },
          {
            columnId: 'bookingType',
            title: 'Types',
            options: BOOKING_TYPES.map((t) => ({ value: t, label: bookingPolicy(t).label })),
          },
        ]}
      />
    </>
  );
}
