import type { ReactNode } from 'react';
import { formatCents, STAGE_LABELS, type OpportunityStage } from '@disco/shared';
import { Link, useSearchParams } from 'react-router';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDate, type ArchiveFilter, type Opportunity } from '@/lib/crm';

/** The archived filter, kept in the `?show=` search param. */
export function useArchiveFilter(): [ArchiveFilter, (f: ArchiveFilter) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('show');
  const value: ArchiveFilter = raw === 'archived' || raw === 'all' ? raw : 'active';
  return [value, (f) => setParams(f === 'active' ? {} : { show: f }, { replace: true })];
}

export function ArchiveFilterSelect({
  value,
  onChange,
}: {
  value: ArchiveFilter;
  onChange: (f: ArchiveFilter) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ArchiveFilter)}>
      <SelectTrigger size="sm" aria-label="Show" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">Active</SelectItem>
        <SelectItem value="archived">Archived</SelectItem>
        <SelectItem value="all">All</SelectItem>
      </SelectContent>
    </Select>
  );
}

const STAGE_VARIANTS: Partial<Record<OpportunityStage, 'default' | 'secondary' | 'outline'>> = {
  won: 'default',
  lost: 'secondary',
};

export function StageBadge({ stage }: { stage: OpportunityStage }) {
  return <Badge variant={STAGE_VARIANTS[stage] ?? 'outline'}>{STAGE_LABELS[stage]}</Badge>;
}

export function OpportunityList({ opportunities }: { opportunities: Opportunity[] }) {
  if (!opportunities.length) {
    return <p className="text-muted-foreground text-sm">No opportunities yet.</p>;
  }
  return (
    <ul className="divide-y" aria-label="Opportunities">
      {opportunities.map((o) => (
        <li key={o.id} className="flex items-center justify-between gap-3 py-2 first:pt-0">
          <div className="min-w-0">
            <Link to={`/pipeline/${o.id}`} className="font-medium hover:underline">
              {o.title}
            </Link>
            <div className="text-muted-foreground text-xs">
              {[
                o.eventDate && formatDate(o.eventDate),
                o.estimatedValueCents !== null && formatCents(o.estimatedValueCents),
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
          <StageBadge stage={o.stage} />
        </li>
      ))}
    </ul>
  );
}

/** A two-column list of labelled details; empty values are skipped. */
export function DetailList({ items }: { items: [string, ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!shown.length) return <p className="text-muted-foreground text-sm">No details yet.</p>;
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
      {shown.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words whitespace-pre-wrap">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
