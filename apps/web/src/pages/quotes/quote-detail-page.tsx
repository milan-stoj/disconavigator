import { useState } from 'react';
import {
  BOOKING_STATUS_LABELS,
  bookingPolicy,
  formatBookingNumber,
  formatCents,
  PRICING_TERM_LABELS,
  type BookingStatus,
} from '@disco/shared';
import { Copy, Pencil, Send, XCircle } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { DetailList } from '@/components/crm/shared';
import { FormDialog } from '@/components/form-dialog';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/crm';
import { formatDateTime, useEquipment } from '@/lib/inventory';
import { shortDate, useDeclineQuote, useQuote, useSendQuote, type Quote } from '@/lib/quotes';
import { NotFoundPage } from '@/pages/not-found';
import { AvailabilityWarnings, FinancialSummary, QuoteStatusBadge } from './quote-shared';

export function QuoteDetailPage() {
  const { id = '' } = useParams();
  const quote = useQuote(id);
  const send = useSendQuote();
  const [declining, setDeclining] = useState(false);

  if (quote.error instanceof ApiError && quote.error.status === 404) return <NotFoundPage />;
  if (!quote.data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  const q = quote.data;
  const r = q.current;
  const policy = bookingPolicy(q.bookingType);
  const isRental = q.bookingType === 'equipment_rental';
  const canSend = q.status === 'draft' || q.status === 'sent' || q.status === 'expired';
  const canEdit = q.status !== 'accepted';
  const canDecline = q.status === 'draft' || q.status === 'sent' || q.status === 'expired';
  const noEmail = !q.contact?.email;
  const linkActive = q.status === 'sent' && r.publicUrl && !r.tokenRevokedAt;

  const doSend = () =>
    send.mutate(q.id, {
      onSuccess: (sent) =>
        toast.success(`Quote ${sent.displayNumber} sent to ${sent.contact?.email ?? 'customer'}`),
      onError: (err) => toast.error(errorMessage(err)),
    });
  const copyLink = async () => {
    if (!r.publicUrl) return;
    try {
      await navigator.clipboard.writeText(r.publicUrl);
      toast.success('Quote link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Quote {q.displayNumber}
            <QuoteStatusBadge status={q.status} />
            <Badge variant="outline">{policy.label}</Badge>
          </span>
        }
        description={
          <>
            <Link to={`/pipeline/${q.opportunity.id}`} className="underline">
              {q.opportunity.title}
            </Link>
            {q.organization && ` · ${q.organization.name}`}
            {` · Revision ${r.revisionNumber}`}
          </>
        }
        actions={
          <>
            {canDecline && (
              <Button variant="outline" onClick={() => setDeclining(true)}>
                <XCircle /> Mark declined
              </Button>
            )}
            {canEdit && (
              <Button variant="outline" asChild>
                <Link to={`/quotes/${q.id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            )}
            {linkActive && (
              <Button variant="outline" onClick={() => void copyLink()}>
                <Copy /> Copy link
              </Button>
            )}
            {canSend && (
              <Button onClick={doSend} disabled={send.isPending || noEmail}>
                {send.isPending ? <Spinner /> : <Send />}
                {q.status === 'sent' && !r.tokenRevokedAt ? 'Resend' : 'Send quote'}
              </Button>
            )}
          </>
        }
      />
      {canSend && noEmail && (
        <Alert>
          <AlertTitle>Add a contact email to send this quote</AlertTitle>
          <AlertDescription>
            {q.contact ? (
              <Link to={`/contacts/${q.contact.id}`} className="underline">
                Edit {q.contact.name}
              </Link>
            ) : (
              <Link to={`/pipeline/${q.opportunity.id}`} className="underline">
                Add a contact to the opportunity
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
      {q.status === 'sent' && r.expiresOn && (
        <p className="text-muted-foreground text-sm">
          Sent {r.sentAt && formatDateTime(r.sentAt)} · link expires {shortDate(r.expiresOn)}
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Details</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <QuoteDetails quote={q} />
            </CardContent>
          </Card>
          {r.lines.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Line items</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {r.lines.map((l) => (
                      <TableRow key={l.id}>
                        <TableCell className="whitespace-normal">{l.description}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCents(l.unitPriceCents)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatCents(l.quantity * l.unitPriceCents)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Revisions</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm" aria-label="Revisions">
                {q.revisions.map((rev) => (
                  <li
                    key={rev.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                  >
                    <span className="font-medium">Revision {rev.revisionNumber}</span>
                    <span className="text-muted-foreground">
                      {[
                        rev.totalCents !== null
                          ? formatCents(rev.totalCents)
                          : PRICING_TERM_LABELS[rev.pricingTerm],
                        rev.sentAt ? `sent ${formatDateTime(rev.sentAt)}` : 'not sent',
                        rev.tokenRevokedAt && 'link replaced',
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Pricing</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FinancialSummary
                financials={r.financials}
                splitBps={r.splitBps}
                showDeposit={policy.requiresDeposit}
                depositBps={r.depositBps}
              />
            </CardContent>
          </Card>
          {q.status !== 'accepted' && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Availability</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <AvailabilityWarnings availability={q.availability} showAllDates />
              </CardContent>
            </Card>
          )}
          {q.acceptance && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Accepted</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                <p>
                  {q.acceptance.fullName} on {formatDateTime(q.acceptance.acceptedAt)}
                </p>
                {q.acceptance.ip && (
                  <p className="text-muted-foreground text-xs">From {q.acceptance.ip}</p>
                )}
                {isRental && (
                  <p className="text-muted-foreground text-xs">
                    Equipment is held once the deposit is paid.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {q.status === 'declined' && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Declined</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm">
                {q.declinedAt && <p>{formatDateTime(q.declinedAt)}</p>}
                {q.declineReason && (
                  <p className="text-muted-foreground mt-1 whitespace-pre-wrap">
                    {q.declineReason}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {q.bookings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>Bookings</h2>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2 text-sm" aria-label="Bookings">
                  {q.bookings.map((b) => (
                    <li key={b.id} className="flex items-center justify-between gap-2">
                      <Link to={`/bookings/${b.id}`} className="font-medium hover:underline">
                        {formatBookingNumber(b.number)} · {shortDate(b.startDate)}
                      </Link>
                      <Badge variant="outline">
                        {BOOKING_STATUS_LABELS[b.status as BookingStatus] ?? b.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {declining && <DeclineDialog quote={q} onClose={() => setDeclining(false)} />}
    </>
  );
}

function QuoteDetails({ quote: q }: { quote: Quote }) {
  const equipment = useEquipment().data ?? [];
  const r = q.current;
  const isRental = q.bookingType === 'equipment_rental';
  const dates = r.occurrenceDates;
  const required = Object.entries(r.requirements)
    .map(([id, n]) => `${n} ${equipment.find((e) => e.id === id)?.name.toLowerCase() ?? 'items'}`)
    .join(', ');
  const time = [r.startTime, r.endTime].filter(Boolean).join(' – ');
  return (
    <DetailList
      items={[
        [
          'Customer',
          q.contact && `${q.contact.name}${q.contact.email ? ` (${q.contact.email})` : ''}`,
        ],
        [
          isRental ? 'Rental' : dates && dates.length > 1 ? 'Series' : 'Event date',
          isRental
            ? `${formatDate(r.startDate)} to ${formatDate(r.endDate)}`
            : dates && dates.length > 1
              ? `${dates.length} events: ${dates.map(shortDate).join(', ')}`
              : formatDate(r.startDate),
        ],
        ['Time', time],
        ['Location', r.location],
        [
          'Delivery',
          isRental && (r.insideServiceArea ? 'Inside service area' : 'Outside service area'),
        ],
        ['Attendance', r.expectedAttendance?.toLocaleString()],
        ['Pricing', PRICING_TERM_LABELS[r.pricingTerm]],
        ['Equipment', required],
        ['DJs', !isRental && String(r.staffRequired)],
        ['Notes', r.notes],
      ]}
    />
  );
}

function DeclineDialog({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const decline = useDeclineQuote();
  const [reason, setReason] = useState('');
  return (
    <FormDialog
      title={`Mark quote ${quote.displayNumber} declined`}
      description="The customer said no. You'll be asked for a loss reason on the opportunity."
      onClose={onClose}
      pending={decline.isPending}
      submitLabel="Mark declined"
      destructive
      onSubmit={(e) => {
        e.preventDefault();
        decline.mutate(
          { id: quote.id, reason: reason.trim() || null },
          {
            onSuccess: () => {
              toast.success(`Quote ${quote.displayNumber} declined`);
              onClose();
            },
            onError: (err) => toast.error(errorMessage(err)),
          },
        );
      }}
    >
      <Field>
        <FieldLabel htmlFor="decline-reason">What did they say?</FieldLabel>
        <Textarea
          id="decline-reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional"
        />
      </Field>
    </FormDialog>
  );
}
