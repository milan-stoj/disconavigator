import { useState } from 'react';
import { formatCents, PRICING_TERM_LABELS } from '@disco/shared';
import {
  Ban,
  CheckCircle2,
  ExternalLink,
  Lock,
  PackageCheck,
  PackageOpen,
  Printer,
  Receipt,
  RotateCw,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link, useParams, useSearchParams } from 'react-router';
import { ActivityList } from '@/components/crm/activity-timeline';
import { DetailList } from '@/components/crm/shared';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiError, errorMessage } from '@/lib/api';
import { useIsAdmin } from '@/lib/auth';
import { formatTime, useBooking, useRetryInvoice, type Booking } from '@/lib/bookings';
import { formatDate } from '@/lib/crm';
import { formatDateTime } from '@/lib/inventory';
import { shortDate } from '@/lib/quotes';
import { NotFoundPage } from '@/pages/not-found';
import {
  CancelBookingDialog,
  CloseBookingDialog,
  ConfirmBookingDialog,
  SettlementDialog,
} from './booking-dialogs';
import { BookingStatusBadge, bookingDates } from './booking-shared';
import { LogisticsTab, StaffingTab } from './booking-tabs';
import { EquipmentTab } from './equipment-tab';
import { ChargeDecisionDialog, RecordPaymentDialog } from './payment-dialogs';

type DialogKind = 'confirm' | 'cancel' | 'close' | 'settle';

export function BookingDetailPage() {
  const { id = '' } = useParams();
  const booking = useBooking(id);
  const isAdmin = useIsAdmin();
  const [params, setParams] = useSearchParams();
  const [dialog, setDialog] = useState<DialogKind | null>(null);

  if (booking.error instanceof ApiError && booking.error.status === 404) return <NotFoundPage />;
  if (!booking.data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  const b = booking.data;
  const isRental = b.bookingType === 'equipment_rental';
  const opsTab = isRental ? 'logistics' : 'staffing';
  const tabs = ['overview', opsTab, 'equipment', 'payments', 'activity'];
  const requested = params.get('tab') ?? 'overview';
  const tab = tabs.includes(requested) ? requested : 'overview';

  const canConfirm = isAdmin && b.status === 'awaiting_deposit';
  const canSettle =
    b.money.settlementRequired && ['confirmed', 'out', 'returned'].includes(b.status);
  const canClose = b.status === 'confirmed' || b.status === 'returned';
  const canCancel = b.status === 'awaiting_deposit' || b.status === 'confirmed';

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {b.numberLabel}
            <BookingStatusBadge status={b.status} />
            <Badge variant="outline">{b.policy.label}</Badge>
          </span>
        }
        description={
          <>
            {b.title}
            {b.organization && (
              <>
                {' · '}
                <Link to={`/organizations/${b.organization.id}`} className="underline">
                  {b.organization.name}
                </Link>
              </>
            )}
            {` · ${bookingDates(b)}`}
          </>
        }
        actions={
          <>
            {!isRental && (
              <Button variant="outline" asChild>
                <Link to={`/bookings/${b.id}/sheet`}>
                  <Printer /> Event sheet
                </Link>
              </Button>
            )}
            {canCancel && (
              <Button variant="outline" onClick={() => setDialog('cancel')}>
                <Ban /> Cancel booking
              </Button>
            )}
            {canSettle && (
              <Button variant="outline" onClick={() => setDialog('settle')}>
                <Receipt /> {b.settlement ? 'Correct settlement' : 'Record settlement'}
              </Button>
            )}
            {canClose && (
              <Button variant="outline" onClick={() => setDialog('close')}>
                <Lock /> Close booking
              </Button>
            )}
            {b.status === 'confirmed' && b.requirements.length > 0 && (
              <Button asChild>
                <Link to={`/bookings/${b.id}/check-out`}>
                  <PackageOpen /> Check out
                </Link>
              </Button>
            )}
            {b.status === 'out' && (
              <Button asChild>
                <Link to={`/bookings/${b.id}/check-in`}>
                  <PackageCheck /> Check in
                </Link>
              </Button>
            )}
            {canConfirm && (
              <Button onClick={() => setDialog('confirm')}>
                <CheckCircle2 /> Confirm without deposit
              </Button>
            )}
          </>
        }
      />
      {b.status === 'awaiting_deposit' && (
        <Alert>
          <AlertTitle>Waiting for the {formatCents(b.depositCents)} holding deposit</AlertTitle>
          <AlertDescription>
            Equipment is held tentatively. The booking confirms itself when the deposit is paid.
          </AlertDescription>
        </Alert>
      )}
      {b.overdue && (
        <Alert variant="destructive">
          <AlertTitle>Equipment return is overdue</AlertTitle>
          <AlertDescription>
            The equipment should be back by now.{' '}
            <Link to={`/bookings/${b.id}/check-in`} className="underline">
              Check it in
            </Link>{' '}
            when it arrives.
          </AlertDescription>
        </Alert>
      )}
      {b.status === 'cancelled' && (
        <Alert variant="destructive">
          <AlertTitle>Cancelled {b.cancelledAt && formatDateTime(b.cancelledAt)}</AlertTitle>
          {b.cancelReason && <AlertDescription>{b.cancelReason}</AlertDescription>}
        </Alert>
      )}
      {canClose && b.closeBlockers.length > 0 && (
        <Alert>
          <AlertTitle>Before this booking can close</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4" aria-label="Close blockers">
              {b.closeBlockers.map((x) => (
                <li key={x.code}>{x.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <Tabs
        value={tab}
        onValueChange={(t) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true })}
      >
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value={opsTab}>{isRental ? 'Logistics' : 'Staffing'}</TabsTrigger>
          <TabsTrigger value="equipment">Equipment</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab booking={b} />
        </TabsContent>
        <TabsContent value={opsTab} className="mt-4">
          {isRental ? <LogisticsTab booking={b} /> : <StaffingTab booking={b} />}
        </TabsContent>
        <TabsContent value="equipment" className="mt-4">
          <EquipmentTab booking={b} />
        </TabsContent>
        <TabsContent value="payments" className="mt-4">
          <PaymentsTab booking={b} />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardContent>
              <ActivityList entries={b.activity} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {dialog === 'confirm' && <ConfirmBookingDialog booking={b} onClose={() => setDialog(null)} />}
      {dialog === 'cancel' && <CancelBookingDialog booking={b} onClose={() => setDialog(null)} />}
      {dialog === 'close' && (
        <CloseBookingDialog booking={b} isAdmin={isAdmin} onClose={() => setDialog(null)} />
      )}
      {dialog === 'settle' && <SettlementDialog booking={b} onClose={() => setDialog(null)} />}
    </>
  );
}

function pricing(b: Booking) {
  if (b.pricingTerm === 'flat_fee') return b.totalCents !== null ? formatCents(b.totalCents) : '';
  const pct = b.splitBps !== null ? `${b.splitBps / 100}% of the door` : 'Door split';
  return b.guaranteeCents ? `${pct}, at least ${formatCents(b.guaranteeCents)}` : pct;
}

function OverviewTab({ booking: b }: { booking: Booking }) {
  const isRental = b.bookingType === 'equipment_rental';
  const time = [formatTime(b.startTime), formatTime(b.endTime)].filter(Boolean).join(' – ');
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
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
                'Customer',
                b.contact && (
                  <Link to={`/contacts/${b.contact.id}`} className="underline">
                    {b.contact.name}
                  </Link>
                ),
              ],
              [
                'Phone',
                b.contact?.phone && <a href={`tel:${b.contact.phone}`}>{b.contact.phone}</a>,
              ],
              ['Email', b.contact?.email],
              [
                isRental ? 'Rental' : 'Event date',
                isRental
                  ? `${formatDate(b.startDate)} to ${formatDate(b.endDate)}`
                  : formatDate(b.startDate),
              ],
              [
                'Event date',
                isRental &&
                  b.quote &&
                  b.quote.eventDate !== b.startDate &&
                  formatDate(b.quote.eventDate),
              ],
              ['Time', !isRental && time],
              ['Location', b.location],
              ['Attendance', b.expectedAttendance?.toLocaleString()],
              ['Pricing', `${PRICING_TERM_LABELS[b.pricingTerm]} · ${pricing(b)}`],
              ['Deposit', isRental && formatCents(b.depositCents)],
              [
                'DJs',
                !isRental &&
                  (b.staff.map((s) => s.name).join(', ') ||
                    `${b.staffRequired} needed, none assigned`),
              ],
              [
                'Confirmed',
                b.confirmedAt &&
                  `${formatDateTime(b.confirmedAt)}${b.confirmOverrideReason ? ` (without deposit: ${b.confirmOverrideReason})` : ''}`,
              ],
              ['Closed', b.closedAt && formatDateTime(b.closedAt)],
            ]}
          />
        </CardContent>
      </Card>
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Linked records</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            {b.opportunityId && (
              <Link to={`/pipeline/${b.opportunityId}`} className="underline">
                Opportunity
              </Link>
            )}
            {b.quote && (
              <Link to={`/quotes/${b.quote.id}`} className="underline">
                Accepted quote
              </Link>
            )}
          </CardContent>
        </Card>
        {b.series.length > 1 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Series</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-2 text-sm" aria-label="Series">
                {b.series.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    {s.id === b.id ? (
                      <span className="font-medium">
                        {s.numberLabel} · {shortDate(s.startDate)} (this one)
                      </span>
                    ) : (
                      <Link to={`/bookings/${s.id}`} className="hover:underline">
                        {s.numberLabel} · {shortDate(s.startDate)}
                      </Link>
                    )}
                    <BookingStatusBadge status={s.status} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

type PaymentDialog =
  { kind: 'record' } | { kind: 'approve' | 'waive'; charge: Booking['charges'][number] };

function PaymentsTab({ booking: b }: { booking: Booking }) {
  const m = b.money;
  const retry = useRetryInvoice(b.id);
  const [dialog, setDialog] = useState<PaymentDialog | null>(null);
  const canRecord = b.status !== 'cancelled' && (m.balanceCents ?? 0) > 0;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid min-w-0 gap-4">
        {b.invoiceError && (
          <Alert variant="destructive">
            <AlertTitle>Invoice not sent</AlertTitle>
            <AlertDescription className="grid gap-2">
              <p>{b.invoiceError}</p>
              <div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={retry.isPending}
                  onClick={() =>
                    retry.mutate(undefined, {
                      onSuccess: () => toast.success('Retrying the Square invoice'),
                      onError: (err) => toast.error(errorMessage(err)),
                    })
                  }
                >
                  <RotateCw /> Retry invoice
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Invoices</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {b.invoices.length === 0 ? (
              <p className="text-muted-foreground text-sm">No invoices yet.</p>
            ) : (
              <Table aria-label="Invoices">
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Due</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {b.invoices.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="capitalize">
                        {i.publicUrl ? (
                          <a
                            href={i.publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline"
                          >
                            {i.kind}
                            <ExternalLink className="size-3" aria-hidden />
                            <span className="sr-only">(opens Square)</span>
                          </a>
                        ) : (
                          i.kind
                        )}
                      </TableCell>
                      <TableCell>{shortDate(i.dueDate)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {i.status.replaceAll('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(i.amountCents)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCents(i.paidCents)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Payments received</h2>
            </CardTitle>
            {canRecord && (
              <CardAction>
                <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'record' })}>
                  <Wallet /> Record payment
                </Button>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {b.payments.length === 0 ? (
              <p className="text-muted-foreground text-sm">No payments yet.</p>
            ) : (
              <ul className="divide-y text-sm" aria-label="Payments">
                {b.payments.map((p) => (
                  <li key={p.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span>
                      {shortDate(p.receivedOn)} ·{' '}
                      {p.source === 'square' ? 'Square' : (p.method ?? 'Recorded payment')}
                      {p.note && <span className="text-muted-foreground"> · {p.note}</span>}
                    </span>
                    <span className="tabular-nums">{formatCents(p.amountCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        {b.charges.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Loss and damage</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm" aria-label="Charges">
                {b.charges.map((c) => (
                  <li key={c.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <span className="capitalize">
                      {c.kind} · {c.status}
                      {c.reason && <span className="text-muted-foreground"> · {c.reason}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">
                        {formatCents(c.amountCents ?? c.proposedCents)}
                      </span>
                      {c.status === 'proposed' && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => setDialog({ kind: 'approve', charge: c })}
                          >
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setDialog({ kind: 'waive', charge: c })}
                          >
                            Waive
                          </Button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
      <div className="grid gap-4">
        <Card role="region" aria-label="Money summary">
          <CardHeader>
            <CardTitle>
              <h2>Money</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Owed</dt>
              <dd className="text-right tabular-nums">
                {m.owedCents !== null ? formatCents(m.owedCents) : 'After settlement'}
              </dd>
              {m.chargesCents > 0 && (
                <>
                  <dt className="text-muted-foreground">Loss and damage</dt>
                  <dd className="text-right tabular-nums">{formatCents(m.chargesCents)}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Paid</dt>
              <dd className="text-right tabular-nums">{formatCents(m.paidCents)}</dd>
              <dt className="font-medium">Balance</dt>
              <dd className="text-right font-medium tabular-nums">
                {m.balanceCents !== null ? formatCents(m.balanceCents) : '—'}
              </dd>
            </dl>
          </CardContent>
        </Card>
        {m.settlementRequired && (
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Door settlement</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-1 text-sm">
              {b.settlement ? (
                <>
                  <p>
                    Door {formatCents(b.settlement.doorRevenueCents)} →{' '}
                    <strong>{formatCents(b.settlement.amountCents)}</strong> owed
                  </p>
                  <p className="text-muted-foreground text-xs">
                    Recorded {formatDateTime(b.settlement.createdAt)}
                  </p>
                  {b.settlement.note && (
                    <p className="text-muted-foreground whitespace-pre-wrap">{b.settlement.note}</p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">
                  Record the door total after the event to invoice the split.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      {dialog?.kind === 'record' && (
        <RecordPaymentDialog booking={b} onClose={() => setDialog(null)} />
      )}
      {(dialog?.kind === 'approve' || dialog?.kind === 'waive') && (
        <ChargeDecisionDialog
          booking={b}
          charge={dialog.charge}
          action={dialog.kind}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
