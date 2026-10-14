import { addDays, bookingPolicy, formatCents, todayIn } from '@disco/shared';
import {
  AlertTriangle,
  CalendarDays,
  CheckCheck,
  CircleDollarSign,
  Inbox,
  PackageX,
  Receipt,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useMe } from '@/lib/auth';
import { resourceLabel, useAvailability } from '@/lib/availability';
import { formatTime } from '@/lib/bookings';
import { formatDate } from '@/lib/crm';
import { useDashboard, type Dashboard } from '@/lib/dashboard';
import { formatDateTime } from '@/lib/inventory';
import { BookingStatusBadge, bookingDates } from '@/pages/bookings/booking-shared';
import { useMarkQuoteRequestsSeen, useNewQuoteRequests } from '@/lib/quote-requests';

export function DashboardPage() {
  const { data: me } = useMe();
  return (
    <>
      <PageHeader
        title="Dashboard"
        description={me ? `Welcome back, ${me.user.displayName}.` : undefined}
      />
      <DashboardWidgets />
    </>
  );
}

function DashboardWidgets() {
  const dashboard = useDashboard();
  const d = dashboard.data;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {dashboard.isError && (
        <p role="alert" className="text-destructive text-sm lg:col-span-2">
          Could not load the dashboard. Refresh to try again.
        </p>
      )}
      <MoneyOwedCard data={d} />
      <OverdueReturnsCard data={d} />
      <NewQuoteRequestsCard />
      <UpcomingBookingsCard data={d} />
      <ConflictsCard />
      <PendingChargesCard data={d} />
    </div>
  );
}

function WidgetCard({
  icon,
  title,
  badge,
  description,
  action,
  children,
}: {
  icon: ReactNode;
  title: string;
  badge?: ReactNode;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            {icon} {title}
            {badge}
          </h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function MoneyOwedCard({ data }: { data: Dashboard | undefined }) {
  const m = data?.moneyOwed;
  return (
    <WidgetCard
      icon={<CircleDollarSign className="size-4" aria-hidden />}
      title="Money owed"
      description="Deposits, balances, settlements, and charges still to collect."
      action={
        <Button variant="outline" size="sm" asChild>
          <Link to="/money-owed">View all</Link>
        </Button>
      }
    >
      {!m ? (
        <Skeleton className="h-16" />
      ) : (
        <dl className="grid grid-cols-2 gap-4">
          <div>
            <dt className="text-muted-foreground text-sm">Outstanding</dt>
            <dd className="text-2xl font-semibold tabular-nums">{formatCents(m.totalCents)}</dd>
            <dd className="text-muted-foreground text-xs">
              {m.count} {m.count === 1 ? 'booking' : 'bookings'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-sm">Overdue</dt>
            <dd
              className={`text-2xl font-semibold tabular-nums ${m.overdueCents > 0 ? 'text-destructive' : ''}`}
            >
              {formatCents(m.overdueCents)}
            </dd>
            <dd className="text-muted-foreground text-xs">
              {m.overdueCount} {m.overdueCount === 1 ? 'booking' : 'bookings'}
            </dd>
          </div>
        </dl>
      )}
    </WidgetCard>
  );
}

function BookingLink({ b }: { b: { id: string; numberLabel: string; title: string } }) {
  return (
    <Link to={`/bookings/${b.id}`} className="font-medium underline-offset-4 hover:underline">
      {b.numberLabel} · {b.title}
    </Link>
  );
}

function OverdueReturnsCard({ data }: { data: Dashboard | undefined }) {
  const items = data?.overdueReturns ?? [];
  return (
    <WidgetCard
      icon={<PackageX className="size-4" aria-hidden />}
      title="Overdue returns"
      badge={items.length > 0 && <Badge variant="destructive">{items.length}</Badge>}
      description="Gear that is still out after its return date."
    >
      {!data ? (
        <Skeleton className="h-16" />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">All gear is back on time.</p>
      ) : (
        <ul className="divide-y" aria-label="Overdue returns">
          {items.map((b) => (
            <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <div className="min-w-0">
                <BookingLink b={b} />
                <p className="text-muted-foreground text-sm">{b.customerName ?? '—'}</p>
              </div>
              <span className="text-destructive text-sm whitespace-nowrap">
                Due {formatDate(b.endDate)}
                {b.returnTime && ` ${formatTime(b.returnTime)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function UpcomingBookingsCard({ data }: { data: Dashboard | undefined }) {
  const items = data?.upcoming ?? [];
  return (
    <WidgetCard
      icon={<CalendarDays className="size-4" aria-hidden />}
      title="Upcoming bookings"
      badge={items.length > 0 && <Badge variant="secondary">{items.length}</Badge>}
      description="Rentals and events in the next 14 days."
      action={
        <Button variant="outline" size="sm" asChild>
          <Link to="/bookings">All bookings</Link>
        </Button>
      }
    >
      {!data ? (
        <Skeleton className="h-16" />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing booked in the next two weeks.</p>
      ) : (
        <ul className="divide-y" aria-label="Upcoming bookings">
          {items.map((b) => (
            <li key={b.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <div className="min-w-0">
                <BookingLink b={b} />
                <p className="text-muted-foreground text-sm">
                  {bookingPolicy(b.bookingType).label}
                  {b.customerName && ` · ${b.customerName}`}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm whitespace-nowrap">
                <span>
                  {bookingDates(b)}
                  {b.startTime && ` · ${formatTime(b.startTime)}`}
                </span>
                <BookingStatusBadge status={b.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function PendingChargesCard({ data }: { data: Dashboard | undefined }) {
  const items = data?.pendingCharges ?? [];
  return (
    <WidgetCard
      icon={<Receipt className="size-4" aria-hidden />}
      title="Pending loss charges"
      badge={items.length > 0 && <Badge>{items.length}</Badge>}
      description="Missing or damaged gear waiting for you to approve or waive the charge."
    >
      {!data ? (
        <Skeleton className="h-16" />
      ) : items.length === 0 ? (
        <p className="text-muted-foreground text-sm">No charges to review.</p>
      ) : (
        <ul className="divide-y" aria-label="Pending loss charges">
          {items.map((c) => (
            <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <div className="min-w-0">
                <Link
                  to={`/bookings/${c.bookingId}?tab=payments`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {c.numberLabel} · {c.title}
                </Link>
                <p className="text-muted-foreground text-sm">
                  {c.customerName ?? '—'} · proposed {formatDateTime(c.createdAt)}
                </p>
              </div>
              <span className="text-sm whitespace-nowrap tabular-nums">
                <span className="capitalize">{c.kind}</span> {formatCents(c.proposedCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

function NewQuoteRequestsCard() {
  const requests = useNewQuoteRequests();
  const markSeen = useMarkQuoteRequestsSeen();
  const items = requests.data?.items ?? [];
  const count = requests.data?.unseenCount ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <Inbox className="size-4" aria-hidden /> New quote requests
            {count > 0 && <Badge>{count}</Badge>}
          </h2>
        </CardTitle>
        <CardDescription>
          Requests from your public form that nobody has opened yet.
        </CardDescription>
        {count > 0 && (
          <CardAction>
            <Button
              variant="outline"
              size="sm"
              disabled={markSeen.isPending}
              onClick={() => markSeen.mutate(undefined)}
            >
              <CheckCheck /> Mark all seen
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {requests.isPending ? (
          <Skeleton className="h-16" />
        ) : items.length === 0 ? (
          <p className="text-muted-foreground text-sm">You're all caught up.</p>
        ) : (
          <ul className="divide-y" aria-label="New quote requests">
            {items.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
              >
                <div className="min-w-0">
                  {r.opportunityId ? (
                    <Link
                      to={`/pipeline/${r.opportunityId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {r.organization ? `${r.name} · ${r.organization}` : r.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{r.name}</span>
                  )}
                  <p className="text-muted-foreground text-sm">
                    {bookingPolicy(r.serviceInterest).label} ·{' '}
                    {r.expectedAttendance.toLocaleString()} guests · {r.location}
                  </p>
                </div>
                <span className="text-muted-foreground text-sm whitespace-nowrap">
                  {formatDate(r.eventDate)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Days ahead the dashboard scans for capacity conflicts (the API allows up to 100). */
const CONFLICT_LOOKAHEAD_DAYS = 90;

const conflictDate = (d: string) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

function ConflictsCard() {
  const { data: me } = useMe();
  const today = todayIn(me?.tenant.timeZone ?? 'America/Chicago');
  const availability = useAvailability(today, addDays(today, CONFLICT_LOOKAHEAD_DAYS - 1));
  const data = availability.data;
  const conflicts = data?.conflicts ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <AlertTriangle className="size-4" aria-hidden /> Capacity conflicts
            {conflicts.length > 0 && <Badge variant="destructive">{conflicts.length}</Badge>}
          </h2>
        </CardTitle>
        <CardDescription>
          Dates in the next {CONFLICT_LOOKAHEAD_DAYS} days that need more gear or DJs than you have.
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" asChild>
            <Link to="/calendar">Open calendar</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {availability.isPending ? (
          <Skeleton className="h-16" />
        ) : availability.isError ? (
          <p className="text-destructive text-sm">Could not check availability.</p>
        ) : conflicts.length === 0 ? (
          <p className="text-muted-foreground text-sm">No conflicts. Everything fits.</p>
        ) : (
          <ul className="divide-y" aria-label="Capacity conflicts">
            {conflicts.map((c) => (
              <li key={c.date} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                <div className="min-w-0">
                  <Link
                    to={`/calendar?view=day&date=${c.date}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {conflictDate(c.date)}
                  </Link>
                  <p className="text-muted-foreground text-sm">
                    {c.holds.map((h) => h.label).join(', ')}
                  </p>
                </div>
                <span className="text-destructive text-sm">
                  {[
                    ...c.shortfalls.map(
                      (s) =>
                        `${resourceLabel(s.resource, data!.equipmentTypes)} short ${s.shortfall}`,
                    ),
                    ...(c.fleetSplit ? ['Fleet split'] : []),
                  ].join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
