import { useMemo, useState } from 'react';
import {
  bookingPolicy,
  BOOKING_TYPES,
  formatCents,
  OPEN_STAGES,
  PRICING_TERM_LABELS,
} from '@disco/shared';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { RecordPicker } from '@/components/crm/record-picker';
import { DataTable, columnHelper } from '@/components/data-table';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { formatDate, useOpportunities } from '@/lib/crm';
import { QUOTE_STATUS_LABELS, useQuotes, type QuoteListItem, type QuoteStatus } from '@/lib/quotes';
import { QuoteStatusBadge } from './quote-shared';

const h = columnHelper<QuoteListItem>();
const columns = [
  h.accessor('number', {
    header: 'Quote',
    enableHiding: false,
    cell: ({ row }) => (
      <div className="min-w-40">
        <div className="font-medium">{row.original.displayNumber}</div>
        <div className="text-muted-foreground text-xs">{row.original.opportunityTitle}</div>
      </div>
    ),
  }),
  h.accessor('opportunityTitle', { header: 'Opportunity', enableHiding: true }),
  h.accessor('bookingType', {
    header: 'Type',
    filterFn: 'equalsString',
    cell: (info) => <Badge variant="outline">{bookingPolicy(info.getValue()).label}</Badge>,
  }),
  h.accessor('startDate', {
    header: 'Date',
    sortFn: 'text',
    cell: ({ row }) => {
      const q = row.original;
      if (!q.startDate) return '—';
      if (q.occurrenceCount > 1)
        return `${formatDate(q.startDate)} + ${q.occurrenceCount - 1} more`;
      return q.endDate && q.endDate !== q.startDate
        ? `${formatDate(q.startDate)} – ${formatDate(q.endDate)}`
        : formatDate(q.startDate);
    },
  }),
  h.accessor('totalCents', {
    header: 'Total',
    cell: ({ row }) => (
      <span className="tabular-nums">
        {row.original.totalCents !== null
          ? formatCents(row.original.totalCents)
          : PRICING_TERM_LABELS[row.original.pricingTerm]}
      </span>
    ),
  }),
  h.accessor('status', {
    header: 'Status',
    filterFn: 'equalsString',
    cell: (info) => <QuoteStatusBadge status={info.getValue()} />,
  }),
];

export function QuotesPage() {
  const quotes = useQuotes();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader title="Quotes" description="Build, send, and track quotes." />
      <DataTable
        label="Quotes"
        columns={columns}
        data={quotes.data}
        isLoading={quotes.isPending}
        searchPlaceholder="Search quotes…"
        emptyMessage="No quotes yet. Start one from an opportunity."
        getRowId={(q) => q.id}
        initialSorting={[{ id: 'number', desc: true }]}
        initialColumnVisibility={{ opportunityTitle: false }}
        onRowClick={(q) => void navigate(`/quotes/${q.id}`)}
        filters={[
          {
            columnId: 'status',
            title: 'Statuses',
            options: (Object.keys(QUOTE_STATUS_LABELS) as QuoteStatus[]).map((s) => ({
              value: s,
              label: QUOTE_STATUS_LABELS[s],
            })),
          },
          {
            columnId: 'bookingType',
            title: 'Types',
            options: BOOKING_TYPES.map((t) => ({ value: t, label: bookingPolicy(t).label })),
          },
        ]}
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> New quote
          </Button>
        }
      />
      {creating && <NewQuoteDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function NewQuoteDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const opportunities = useOpportunities();
  const [opportunityId, setOpportunityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const records = useMemo(
    () =>
      (opportunities.data ?? [])
        .filter((o) => OPEN_STAGES.includes(o.stage))
        .map((o) => ({
          id: o.id,
          name: o.title,
          detail: o.organizationName ?? o.contactName,
        })),
    [opportunities.data],
  );
  return (
    <FormDialog
      title="New quote"
      description="Every quote belongs to an opportunity in the pipeline."
      onClose={onClose}
      pending={false}
      submitLabel="Continue"
      onSubmit={(e) => {
        e.preventDefault();
        if (!opportunityId) setError('Choose an opportunity');
        else void navigate(`/quotes/new?opportunityId=${opportunityId}`);
      }}
    >
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor="new-quote-opportunity">Opportunity</FieldLabel>
        <RecordPicker
          id="new-quote-opportunity"
          value={opportunityId}
          onChange={(id) => {
            setOpportunityId(id);
            setError(null);
          }}
          invalid={!!error}
          placeholder="Choose an opportunity"
          searchPlaceholder="Search opportunities…"
          emptyMessage="No open opportunities."
          records={records}
        />
        <FieldError errors={error ? [{ message: error }] : []} />
      </Field>
    </FormDialog>
  );
}
