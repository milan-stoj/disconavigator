import { useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { acceptQuoteSchema, formatCents } from '@disco/shared';
import { CircleCheck, Headphones } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router';
import type { z } from 'zod';
import { ModeToggle } from '@/components/app/mode-toggle';
import { applyServerErrors, FormField } from '@/components/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import {
  shortDate,
  useAcceptPublicQuote,
  useDeclinePublicQuote,
  usePublicQuote,
  type PublicQuote,
} from '@/lib/quotes';
import { NotFoundPage } from '@/pages/not-found';
import { FinancialSummary } from '@/pages/quotes/quote-shared';

/** Public page where the customer reviews, accepts, or declines a sent quote. */
export function PublicQuotePage() {
  const { token = '' } = useParams();
  const data = usePublicQuote(token);

  if (data.error instanceof ApiError && data.error.status === 404) return <NotFoundPage />;
  const p = data.data;

  return (
    <div className="bg-muted/40 min-h-svh">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4">
        <div className="flex items-center gap-2 font-semibold">
          <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Headphones className="size-4" aria-hidden />
          </div>
          {p ? p.tenant.name : <Skeleton className="h-5 w-48" />}
        </div>
        <ModeToggle />
      </header>
      <main className="mx-auto grid max-w-3xl gap-4 px-4 pb-12">
        {p ? (
          <QuoteView token={token} data={p} />
        ) : data.error ? (
          <Alert variant="destructive">
            <AlertTitle>We couldn't load this quote</AlertTitle>
            <AlertDescription>Please refresh the page or try again later.</AlertDescription>
          </Alert>
        ) : (
          <Skeleton className="h-[32rem]" />
        )}
      </main>
    </div>
  );
}

function QuoteView({ token, data }: { token: string; data: PublicQuote }) {
  const q = data.quote;
  if (data.state === 'revoked' || !q) {
    return (
      <StateCard title="This quote has been updated">
        {data.tenant.name} revised quote {data.number}. Check your email for the latest link, or
        contact them for a new one.
      </StateCard>
    );
  }
  const isRental = q.bookingType === 'equipment_rental';
  const series = q.occurrenceDates && q.occurrenceDates.length > 1 ? q.occurrenceDates : null;
  const time = [q.startTime, q.endTime].filter(Boolean).join(' – ');

  return (
    <>
      {data.state === 'accepted' && q.acceptedBy && (
        <StateCard title="Quote accepted" success>
          Accepted by {q.acceptedBy.fullName} on{' '}
          {new Date(q.acceptedBy.acceptedAt).toLocaleDateString()}.{' '}
          {isRental
            ? `${data.tenant.name} will send an invoice for the holding deposit. Your equipment is reserved once it's paid.`
            : `${data.tenant.name} will be in touch with the details.`}
        </StateCard>
      )}
      {data.state === 'declined' && (
        <StateCard title="Quote declined">
          You declined this quote. Contact {data.tenant.name} if you change your mind.
        </StateCard>
      )}
      {data.state === 'expired' && (
        <StateCard title="This quote has expired">
          Quote {data.number} expired{q.expiresOn ? ` on ${shortDate(q.expiresOn)}` : ''}. Contact{' '}
          {data.tenant.name} for an updated quote.
        </StateCard>
      )}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{q.bookingTypeLabel}</Badge>
            <span className="text-muted-foreground text-sm">Quote {data.number}</span>
          </div>
          <CardTitle>
            <h1 className="text-xl">{q.title}</h1>
          </CardTitle>
          <CardDescription>
            {[q.customerName, q.organizationName].filter(Boolean).join(' · ')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <dl className="grid gap-3 text-sm sm:grid-cols-[9rem_1fr]">
            <dt className="text-muted-foreground">
              {isRental ? 'Rental dates' : series ? 'Event dates' : 'Event date'}
            </dt>
            <dd>
              {isRental ? (
                `${shortDate(q.startDate)} to ${shortDate(q.endDate)}`
              ) : series ? (
                <ul aria-label="Event dates">
                  {series.map((d) => (
                    <li key={d}>{shortDate(d)}</li>
                  ))}
                </ul>
              ) : (
                shortDate(q.startDate)
              )}
            </dd>
            {time && (
              <>
                <dt className="text-muted-foreground">Time</dt>
                <dd>{time}</dd>
              </>
            )}
            {q.location && (
              <>
                <dt className="text-muted-foreground">Location</dt>
                <dd>{q.location}</dd>
              </>
            )}
            {q.expectedAttendance != null && (
              <>
                <dt className="text-muted-foreground">Expected guests</dt>
                <dd>{q.expectedAttendance.toLocaleString()}</dd>
              </>
            )}
            {data.state === 'open' && q.expiresOn && (
              <>
                <dt className="text-muted-foreground">Valid until</dt>
                <dd>{shortDate(q.expiresOn)}</dd>
              </>
            )}
          </dl>

          {q.lines.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.lines.map((l, i) => (
                  <TableRow key={i}>
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
          )}

          <div className="sm:ml-auto sm:w-80">
            <FinancialSummary
              financials={q.financials}
              splitBps={q.splitBps}
              showDeposit={isRental}
              depositBps={q.depositBps}
            />
            {series && q.financials.totalCents !== null && (
              <p className="text-muted-foreground mt-2 text-xs">Per event.</p>
            )}
          </div>

          {q.notes && (
            <div className="grid gap-1 text-sm">
              <h2 className="font-medium">Notes</h2>
              <p className="whitespace-pre-wrap">{q.notes}</p>
            </div>
          )}

          <section className="grid gap-2" aria-labelledby="terms-heading">
            <h2 id="terms-heading" className="text-sm font-medium">
              {isRental ? 'Rental terms' : 'Event terms'}
            </h2>
            <div
              tabIndex={0}
              role="region"
              aria-labelledby="terms-heading"
              className="bg-muted/50 focus-visible:ring-ring/50 max-h-64 overflow-y-auto rounded-md border p-3 text-sm whitespace-pre-wrap outline-none focus-visible:ring-[3px]"
            >
              {q.termsText || 'No additional terms.'}
            </div>
          </section>
        </CardContent>
      </Card>
      {data.state === 'open' && <Respond token={token} isRental={isRental} />}
    </>
  );
}

type AcceptValues = z.input<typeof acceptQuoteSchema>;

function Respond({ token, isRental }: { token: string; isRental: boolean }) {
  const accept = useAcceptPublicQuote(token);
  const decline = useDeclinePublicQuote(token);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const form = useForm<AcceptValues>({
    resolver: zodResolver(acceptQuoteSchema),
    defaultValues: { fullName: '', agreeToTerms: false as unknown as true },
  });

  if (declining) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Decline this quote</h2>
          </CardTitle>
          <CardDescription>Let us know why, so we can do better next time.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              decline.mutate({ reason: reason.trim() || null });
            }}
          >
            <Field>
              <FieldLabel htmlFor="decline-reason">Reason (optional)</FieldLabel>
              <Textarea
                id="decline-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
            {decline.error && (
              <p role="alert" className="text-destructive text-sm">
                {errorMessage(decline.error)}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive" disabled={decline.isPending}>
                {decline.isPending && <Spinner />} Decline quote
              </Button>
              <Button type="button" variant="outline" onClick={() => setDeclining(false)}>
                Back
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Accept this quote</h2>
        </CardTitle>
        <CardDescription>
          {isRental
            ? "Accepting books your rental. We'll send an invoice for the holding deposit."
            : 'Accepting confirms your event.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={form.handleSubmit((v) =>
            accept.mutate(v as z.output<typeof acceptQuoteSchema>, {
              onError: (err) => applyServerErrors(form.setError, err),
            }),
          )}
        >
          <FieldGroup>
            <FormField
              control={form.control}
              name="agreeToTerms"
              label={`I agree to the ${isRental ? 'rental' : 'event'} terms above`}
              orientation="horizontal"
              render={({ field }) => (
                <Checkbox
                  id={field.id}
                  checked={field.value === true}
                  onCheckedChange={(c) => field.onChange(c === true)}
                  aria-invalid={field['aria-invalid']}
                />
              )}
            />
            <FormField
              control={form.control}
              name="fullName"
              label="Type your full name to sign"
              render={({ field }) => <Input {...field} autoComplete="name" />}
            />
          </FieldGroup>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={accept.isPending}>
              {accept.isPending && <Spinner />} Accept quote
            </Button>
            <Button type="button" variant="ghost" onClick={() => setDeclining(true)}>
              Decline
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function StateCard({
  title,
  success,
  children,
}: {
  title: string;
  success?: boolean;
  children: ReactNode;
}) {
  return (
    <Alert role="status">
      {success && <CircleCheck className="text-primary" aria-hidden />}
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
