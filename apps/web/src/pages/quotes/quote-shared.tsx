import { bpsToPercent, formatCents } from '@disco/shared';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { useEquipment } from '@/lib/inventory';
import {
  QUOTE_STATUS_LABELS,
  shortDate,
  type OccurrenceAvailability,
  type QuoteStatus,
} from '@/lib/quotes';

const STATUS_VARIANTS: Record<QuoteStatus, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  draft: 'secondary',
  sent: 'outline',
  accepted: 'default',
  declined: 'destructive',
  expired: 'secondary',
};

export function QuoteStatusBadge({ status }: { status: QuoteStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{QUOTE_STATUS_LABELS[status]}</Badge>;
}

export interface FinancialsLike {
  totalCents: number | null;
  depositCents: number;
  balanceCents: number | null;
  minimumCents: number | null;
  finalDeterminedAfterEvent: boolean;
}

/** Totals block shared by the builder, detail and public pages. */
export function FinancialSummary({
  financials,
  splitBps,
  showDeposit,
  depositBps,
}: {
  financials: FinancialsLike | null;
  splitBps: number | null;
  showDeposit: boolean;
  depositBps: number;
}) {
  if (!financials) {
    return <p className="text-muted-foreground text-sm">Complete the pricing to see totals.</p>;
  }
  const split = splitBps == null ? null : `${bpsToPercent(splitBps)}%`;
  return (
    <div role="group" className="grid gap-2 text-sm" aria-label="Quote totals">
      <dl className="grid gap-2">
        {financials.totalCents !== null && (
          <Row label="Total" value={formatCents(financials.totalCents)} strong />
        )}
        {financials.minimumCents !== null && (
          <Row label="Guaranteed minimum" value={formatCents(financials.minimumCents)} strong />
        )}
        {split && <Row label="Door split" value={`${split} of door revenue`} />}
        {showDeposit && (
          <>
            <Row
              label={`Holding deposit (${bpsToPercent(depositBps)}%)`}
              value={formatCents(financials.depositCents)}
            />
            {financials.balanceCents !== null && (
              <Row label="Balance" value={formatCents(financials.balanceCents)} />
            )}
          </>
        )}
      </dl>
      {financials.finalDeterminedAfterEvent && (
        <p className="text-muted-foreground text-xs">
          {financials.minimumCents !== null
            ? `The final amount is the greater of ${formatCents(financials.minimumCents)} and ${split} of the door, determined after the event.`
            : `The final amount is ${split} of the door, determined after the event.`}
        </p>
      )}
      {!showDeposit && <p className="text-muted-foreground text-xs">No holding deposit.</p>}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? 'text-base font-semibold tabular-nums' : 'tabular-nums'}>{value}</dd>
    </div>
  );
}

/** Maps a shortfall resource (equipment type id or "staff") to a readable name. */
export function useResourceName() {
  const equipment = useEquipment().data ?? [];
  return (resource: string) =>
    resource === 'staff' ? 'DJs' : (equipment.find((e) => e.id === resource)?.name ?? resource);
}

const dateRange = (o: OccurrenceAvailability) =>
  o.startDate === o.endDate
    ? shortDate(o.startDate)
    : `${shortDate(o.startDate)} – ${shortDate(o.endDate)}`;

/** Capacity warnings; they never block saving or sending. */
export function AvailabilityWarnings({
  availability,
  showAllDates,
}: {
  availability: OccurrenceAvailability[] | undefined;
  showAllDates?: boolean;
}) {
  const resourceName = useResourceName();
  if (!availability?.length) return null;
  const short = availability.filter((o) => !o.available);
  return (
    <div className="grid gap-3">
      {short.length > 0 ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Capacity warning</AlertTitle>
          <AlertDescription>
            <ul className="grid gap-1" aria-label="Capacity warnings">
              {short.map((o) => {
                const byResource = new Map<string, number>();
                for (const s of o.shortfalls) {
                  byResource.set(
                    s.resource,
                    Math.max(byResource.get(s.resource) ?? 0, s.shortfall),
                  );
                }
                return (
                  <li key={`${o.startDate}-${o.endDate}`}>
                    <span className="font-medium">{dateRange(o)}:</span>{' '}
                    {[...byResource]
                      .map(([r, n]) => `short ${n} ${resourceName(r).toLowerCase()}`)
                      .join(', ')}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1">You can still save and send this quote.</p>
          </AlertDescription>
        </Alert>
      ) : (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
          Equipment and DJs are available {availability.length > 1 ? 'on every date' : ''}
        </p>
      )}
      {showAllDates && availability.length > 1 && (
        <ul className="grid gap-1 text-sm" aria-label="Occurrence dates">
          {availability.map((o) => (
            <li key={o.startDate} className="flex items-center justify-between gap-2">
              <span>{dateRange(o)}</span>
              {o.available ? (
                <Badge variant="outline">Available</Badge>
              ) : (
                <Badge variant="destructive">Short</Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
