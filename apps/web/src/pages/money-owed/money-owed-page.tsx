import { bookingPolicy, BOOKING_TYPES, formatCents } from '@disco/shared';
import { ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router';
import { DataTable, columnHelper } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { useMoneyOwed, type MoneyOwedRow } from '@/lib/bookings';
import { shortDate } from '@/lib/quotes';
import { BookingStatusBadge } from '@/pages/bookings/booking-shared';

const h = columnHelper<MoneyOwedRow>();
const columns = [
  h.accessor('numberLabel', {
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
  h.accessor((r) => r.customerName ?? '', {
    id: 'customer',
    header: 'Customer',
    cell: (info) => info.getValue() || '—',
  }),
  h.accessor('bookingType', {
    header: 'Type',
    filterFn: 'equalsString',
    cell: (info) => <Badge variant="outline">{bookingPolicy(info.getValue()).label}</Badge>,
  }),
  h.accessor('status', {
    header: 'Status',
    cell: (info) => <BookingStatusBadge status={info.getValue()} />,
  }),
  h.accessor('dueDate', {
    header: 'Due',
    sortFn: 'text',
    cell: ({ row }) => (
      <div className="flex flex-wrap items-center gap-2">
        <span>{shortDate(row.original.dueDate)}</span>
        {row.original.overdue && <Badge variant="destructive">Overdue</Badge>}
      </div>
    ),
  }),
  h.accessor('balanceCents', {
    header: 'Balance',
    sortFn: 'basic',
    cell: ({ row }) => (
      <div className="text-right">
        <div className="font-medium tabular-nums">{formatCents(row.original.balanceCents)}</div>
        <div className="text-muted-foreground text-xs tabular-nums">
          of {formatCents(row.original.owedCents)}
        </div>
      </div>
    ),
  }),
  h.display({
    id: 'invoice',
    header: 'Invoice',
    cell: ({ row }) => {
      const r = row.original;
      if (r.invoiceUrl) {
        return (
          <a
            href={r.invoiceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline"
            onClick={(e) => e.stopPropagation()}
          >
            Open in Square <ExternalLink className="size-3" aria-hidden />
          </a>
        );
      }
      if (r.invoiceError) return <Badge variant="destructive">Invoice failed</Badge>;
      if (r.needsInvoice) return <span className="text-muted-foreground">Pending</span>;
      return <span className="text-muted-foreground">—</span>;
    },
  }),
];

export function MoneyOwedPage() {
  const owed = useMoneyOwed();
  const navigate = useNavigate();
  const rows = owed.data ?? [];
  const total = rows.reduce((s, r) => s + r.balanceCents, 0);
  const overdue = rows.filter((r) => r.overdue).reduce((s, r) => s + r.balanceCents, 0);
  return (
    <>
      <PageHeader
        title="Money Owed"
        description={
          owed.data
            ? `${formatCents(total)} outstanding${overdue ? `, ${formatCents(overdue)} overdue` : ''}.`
            : 'Deposits, balances, settlements, and charges still to collect.'
        }
      />
      <DataTable
        label="Money owed"
        columns={columns}
        data={owed.data}
        isLoading={owed.isPending}
        searchPlaceholder="Search bookings or customers…"
        emptyMessage="Nothing owed. Every booking is paid up."
        getRowId={(r) => r.id}
        initialColumnVisibility={{ title: false }}
        onRowClick={(r) => void navigate(`/bookings/${r.id}?tab=payments`)}
        filters={[
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
