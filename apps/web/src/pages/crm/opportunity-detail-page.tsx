import { useEffect, useState } from 'react';
import {
  bookingPolicy,
  formatCents,
  LOSS_REASON_LABELS,
  OPPORTUNITY_STAGES,
  STAGE_LABELS,
  type OpportunityStage,
} from '@disco/shared';
import { AlertTriangle, FileText, Pencil } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ActivityTimeline } from '@/components/crm/activity-timeline';
import { LossReasonDialog } from '@/components/crm/loss-reason-dialog';
import { OpportunityFormDialog } from '@/components/crm/opportunity-form';
import { DetailList, StageBadge } from '@/components/crm/shared';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { formatDate, SOURCE_LABELS, useChangeStage, useOpportunity } from '@/lib/crm';
import { useMarkQuoteRequestsSeen, useNewQuoteRequests } from '@/lib/quote-requests';
import { useQuotes } from '@/lib/quotes';
import { QuoteStatusBadge } from '@/pages/quotes/quote-shared';
import { NotFoundPage } from '@/pages/not-found';

export function OpportunityDetailPage() {
  const { id = '' } = useParams();
  const opportunity = useOpportunity(id);
  const changeStage = useChangeStage();
  const [editing, setEditing] = useState(false);
  const [losing, setLosing] = useState(false);
  useMarkRequestSeen(id);

  if (opportunity.error instanceof ApiError && opportunity.error.status === 404) {
    return <NotFoundPage />;
  }
  if (!opportunity.data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  const o = opportunity.data;
  const move = (stage: OpportunityStage) => {
    if (stage === 'lost') setLosing(true);
    else changeStage.mutate({ id, change: { stage } });
  };

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {o.title}
            <StageBadge stage={o.stage} />
          </span>
        }
        description={o.organizationName ?? o.contactName ?? undefined}
        actions={
          <>
            <Select value={o.stage} onValueChange={(s) => move(s as OpportunityStage)}>
              <SelectTrigger aria-label="Stage" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPPORTUNITY_STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <Button asChild>
              <Link to={`/quotes/new?opportunityId=${id}`}>
                <FileText /> New quote
              </Link>
            </Button>
          </>
        }
      />
      {o.needsLossReason && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Why was this lost?</AlertTitle>
          <AlertDescription>
            <p>Add a loss reason so the dashboard can show what to fix.</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => setLosing(true)}>
              Add loss reason
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Details</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  [
                    'Organization',
                    o.organizationId && o.organizationName && (
                      <Link to={`/organizations/${o.organizationId}`} className="underline">
                        {o.organizationName}
                      </Link>
                    ),
                  ],
                  [
                    'Contact',
                    o.contactId && o.contactName && (
                      <Link to={`/contacts/${o.contactId}`} className="underline">
                        {o.contactName}
                      </Link>
                    ),
                  ],
                  ['Interested in', o.serviceInterest && bookingPolicy(o.serviceInterest).label],
                  ['Event date', o.eventDate && formatDate(o.eventDate)],
                  ['Attendance', o.expectedAttendance?.toLocaleString()],
                  [
                    'Estimated value',
                    o.estimatedValueCents !== null && formatCents(o.estimatedValueCents),
                  ],
                  ['Source', SOURCE_LABELS[o.source] ?? o.source],
                  ['Loss reason', o.lossReason && LOSS_REASON_LABELS[o.lossReason]],
                  ['Loss note', o.lossNote],
                  ['Notes', o.notes],
                ]}
              />
            </CardContent>
          </Card>
          <OpportunityQuotes opportunityId={id} />
        </div>
        <ActivityTimeline subject="opportunity" id={id} />
      </div>
      {editing && <OpportunityFormDialog opportunity={o} onClose={() => setEditing(false)} />}
      {losing && (
        <LossReasonDialog
          title={o.title}
          pending={changeStage.isPending}
          onClose={() => setLosing(false)}
          onConfirm={(change) =>
            changeStage.mutate({ id, change }, { onSuccess: () => setLosing(false) })
          }
        />
      )}
    </>
  );
}

function OpportunityQuotes({ opportunityId }: { opportunityId: string }) {
  const quotes = useQuotes(opportunityId);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Quotes</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!quotes.data ? (
          <Skeleton className="h-10" />
        ) : quotes.data.length === 0 ? (
          <p className="text-muted-foreground text-sm">No quotes yet.</p>
        ) : (
          <ul className="divide-y" aria-label="Quotes">
            {quotes.data.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-3 py-2 first:pt-0">
                <div className="min-w-0">
                  <Link to={`/quotes/${q.id}`} className="font-medium hover:underline">
                    Quote {q.displayNumber}
                  </Link>
                  <div className="text-muted-foreground text-xs">
                    {[
                      bookingPolicy(q.bookingType).label,
                      q.startDate && formatDate(q.startDate),
                      q.totalCents !== null && formatCents(q.totalCents),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <QuoteStatusBadge status={q.status} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Opening an opportunity clears the "new" indicator for the quote request behind it. */
function useMarkRequestSeen(opportunityId: string) {
  const requests = useNewQuoteRequests();
  const { mutate } = useMarkQuoteRequestsSeen();
  const ids = (requests.data?.items ?? [])
    .filter((r) => r.opportunityId === opportunityId)
    .map((r) => r.id);
  const key = ids.join(',');
  useEffect(() => {
    if (key) mutate(key.split(','));
  }, [key, mutate]);
}
