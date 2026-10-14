import { useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import {
  formatBookingNumber,
  isIsoDate,
  todayIn,
  type CapacityDay,
  type IsoDate,
} from '@disco/shared';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, FileText } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useIsAdmin, useMe } from '@/lib/auth';
import {
  resourceLabel,
  useAvailability,
  useSetStaffAvailability,
  type Availability,
} from '@/lib/availability';
import { cn } from '@/lib/utils';
import {
  CALENDAR_VIEWS,
  formatLongDate,
  formatShortDate,
  keyTarget,
  startOfMonth,
  step,
  viewTitle,
  visibleRange,
  WEEKDAYS,
  weeksOf,
  type CalendarView,
} from './calendar-utils';

const VIEW_LABELS: Record<CalendarView, string> = { month: 'Month', week: 'Week', day: 'Day' };

export function CalendarPage() {
  const { data: me } = useMe();
  const today = todayIn(me?.tenant.timeZone ?? 'America/Chicago');
  const [params, setParams] = useSearchParams();
  const rawView = params.get('view');
  const view: CalendarView = CALENDAR_VIEWS.includes(rawView as CalendarView)
    ? (rawView as CalendarView)
    : 'month';
  const rawDate = params.get('date');
  const date = rawDate && isIsoDate(rawDate) ? rawDate : today;
  const range = visibleRange(view, date);
  const availability = useAvailability(range.from, range.to);
  const data = availability.data;
  const days = useMemo(() => new Map(data?.days.map((d) => [d.date, d])), [data]);

  const go = (next: { view?: CalendarView; date?: IsoDate }) =>
    setParams({ view: next.view ?? view, date: next.date ?? date }, { replace: true });

  const conflicts = data?.conflicts.filter((c) => c.date >= range.from && c.date <= range.to);

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Headphones, transmitters, and DJs committed and free each day."
      />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={`Previous ${view}`}
            onClick={() => go({ date: step(view, date, -1) })}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => go({ date: today })}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Next ${view}`}
            onClick={() => go({ date: step(view, date, 1) })}
          >
            <ChevronRight />
          </Button>
        </div>
        <h2 className="mr-auto text-lg font-semibold" aria-live="polite">
          {viewTitle(view, date)}
        </h2>
        <ToggleGroup
          type="single"
          variant="outline"
          value={view}
          onValueChange={(v) => v && go({ view: v as CalendarView })}
          aria-label="Calendar view"
        >
          {CALENDAR_VIEWS.map((v) => (
            <ToggleGroupItem key={v} value={v}>
              {VIEW_LABELS[v]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <Legend />

      {availability.isError && (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangle />
          <AlertTitle>Could not load availability</AlertTitle>
          <AlertDescription>
            <Button variant="outline" size="sm" onClick={() => void availability.refetch()}>
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {conflicts && conflicts.length > 0 && view !== 'day' && (
        <Alert variant="destructive" className="mt-4">
          <AlertTriangle />
          <AlertTitle>
            {conflicts.length === 1 ? '1 date has' : `${conflicts.length} dates have`} a capacity
            conflict
          </AlertTitle>
          <AlertDescription>
            <ul className="flex flex-wrap gap-2" aria-label="Conflict dates">
              {conflicts.map((c) => (
                <li key={c.date}>
                  <Button variant="outline" size="sm" onClick={() => go({ date: c.date })}>
                    {formatShortDate(c.date)}
                  </Button>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div
        className={cn(
          'mt-4 grid items-start gap-4',
          view !== 'day' && 'xl:grid-cols-[minmax(0,1fr)_22rem]',
        )}
      >
        {view !== 'day' && (
          <CapacityGrid
            view={view}
            anchor={date}
            today={today}
            from={range.from}
            to={range.to}
            days={days}
            data={data}
            onSelect={(d) => go({ date: d })}
            onOpenDay={(d) => go({ view: 'day', date: d })}
          />
        )}
        <DayDetails
          date={date}
          day={days.get(date)}
          data={data}
          loading={availability.isPending}
          onOpenDay={view === 'day' ? undefined : () => go({ view: 'day' })}
        />
      </div>
    </>
  );
}

function Legend() {
  return (
    <ul
      className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs"
      aria-label="Legend"
    >
      <li className="flex items-center gap-1.5">
        <span className="bg-primary size-2.5 rounded-sm" aria-hidden /> Confirmed
      </li>
      <li className="flex items-center gap-1.5">
        <span
          className="bg-primary/35 border-primary size-2.5 rounded-sm border border-dashed"
          aria-hidden
        />
        Tentative (awaiting deposit)
      </li>
      <li className="flex items-center gap-1.5">
        <FileText className="size-3" aria-hidden /> Quote (doesn't use capacity)
      </li>
      <li className="flex items-center gap-1.5">
        <AlertTriangle className="text-destructive size-3" aria-hidden /> Conflict
      </li>
    </ul>
  );
}

interface Resource {
  key: string;
  label: string;
  short: string;
  usable: number;
  committed: number;
  tentative: number;
  softDemand: number;
  available: number;
  shortfall: number;
}

function resourcesOf(day: CapacityDay | undefined, data: Availability | undefined): Resource[] {
  if (!day || !data) return [];
  const equipment = data.equipmentTypes
    .filter((t) => day.equipment[t.id])
    .map((t) => {
      const e = day.equipment[t.id]!;
      return {
        key: t.id,
        label: t.name,
        short: t.name.slice(0, 2).toUpperCase(),
        usable: e.usable,
        committed: e.committed,
        tentative: e.tentative,
        softDemand: e.softDemand,
        available: e.available,
        shortfall: e.shortfall,
      };
    });
  const s = day.staff;
  return [
    ...equipment,
    {
      key: 'staff',
      label: 'DJs',
      short: 'DJ',
      usable: s.total - s.unavailable,
      committed: s.committed,
      tentative: 0,
      softDemand: 0,
      available: s.available,
      shortfall: s.shortfall,
    },
  ];
}

function CapacityBar({ r, compact }: { r: Resource; compact?: boolean }) {
  const pct = (n: number) => (r.usable > 0 ? Math.min(100, (n / r.usable) * 100) : n > 0 ? 100 : 0);
  const confirmed = r.committed - r.tentative;
  const over = r.shortfall > 0;
  return (
    <div className="grid gap-0.5" data-resource={r.key}>
      <div className="flex items-baseline justify-between gap-1 text-[11px] leading-tight">
        <span className={cn('truncate', compact && 'hidden sm:inline')}>
          {compact ? r.short : r.label}
        </span>
        <span className={cn('tabular-nums', over && 'text-destructive font-semibold')}>
          {r.available}/{r.usable}
        </span>
      </div>
      <div className="bg-muted flex h-1.5 overflow-hidden rounded-full" aria-hidden>
        {over ? (
          <div className="bg-destructive h-full w-full" />
        ) : (
          <>
            <div className="bg-primary h-full" style={{ width: `${pct(confirmed)}%` }} />
            <div
              className="bg-primary/35 h-full"
              style={{ width: `${pct(Math.min(r.tentative, r.usable - confirmed))}%` }}
            />
          </>
        )}
      </div>
    </div>
  );
}

function dayLabel(date: IsoDate, day: CapacityDay | undefined, data: Availability | undefined) {
  const parts = [formatLongDate(date)];
  if (!day || !data) return parts.join('. ');
  if (day.conflict || day.fleetSplit) parts.push('Conflict');
  parts.push(
    resourcesOf(day, data)
      .map((r) => `${r.label} ${r.available} of ${r.usable} available`)
      .join(', '),
  );
  const bookings = day.holds.filter((h) => h.source === 'booking').length;
  const quotes = day.holds.filter((h) => h.source === 'quote').length;
  if (bookings) parts.push(`${bookings} booking${bookings === 1 ? '' : 's'}`);
  if (quotes) parts.push(`${quotes} pending quote${quotes === 1 ? '' : 's'}`);
  return parts.join('. ');
}

function CapacityGrid({
  view,
  anchor,
  today,
  from,
  to,
  days,
  data,
  onSelect,
  onOpenDay,
}: {
  view: Exclude<CalendarView, 'day'>;
  anchor: IsoDate;
  today: IsoDate;
  from: IsoDate;
  to: IsoDate;
  days: Map<IsoDate, CapacityDay>;
  data: Availability | undefined;
  onSelect: (d: IsoDate) => void;
  onOpenDay: (d: IsoDate) => void;
}) {
  const cells = useRef(new Map<IsoDate, HTMLDivElement>());
  const focusPending = useRef(false);
  const month = startOfMonth(anchor).slice(0, 7);

  useEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    cells.current.get(anchor)?.focus();
  }, [anchor, from]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpenDay(anchor);
      return;
    }
    const target = keyTarget(e.key, anchor);
    if (!target) return;
    e.preventDefault();
    focusPending.current = true;
    onSelect(target);
  };

  return (
    <div
      role="grid"
      aria-label={`Capacity calendar, ${viewTitle(view, anchor)}`}
      className="bg-card overflow-hidden rounded-xl border"
      onKeyDown={onKeyDown}
    >
      <div role="row" className="bg-muted/50 grid grid-cols-7 border-b">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            role="columnheader"
            className="text-muted-foreground px-2 py-1.5 text-xs font-medium"
          >
            {d}
          </div>
        ))}
      </div>
      {weeksOf(from, to).map((week) => (
        <div role="row" key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
          {week.map((date) => {
            const day = days.get(date);
            const selected = date === anchor;
            const conflict = !!day && (day.conflict || day.fleetSplit);
            const outside = view === 'month' && date.slice(0, 7) !== month;
            return (
              <div
                key={date}
                ref={(el) => {
                  if (el) cells.current.set(date, el);
                  else cells.current.delete(date);
                }}
                role="gridcell"
                tabIndex={selected ? 0 : -1}
                aria-selected={selected}
                aria-label={dayLabel(date, day, data)}
                aria-current={date === today ? 'date' : undefined}
                data-date={date}
                data-conflict={conflict || undefined}
                onClick={() => onSelect(date)}
                onDoubleClick={() => onOpenDay(date)}
                className={cn(
                  'focus-visible:ring-ring relative flex min-w-0 cursor-pointer flex-col gap-1 border-r p-1.5 text-left outline-none last:border-r-0 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset',
                  view === 'month' ? 'min-h-24 sm:min-h-28' : 'min-h-64',
                  outside && 'bg-muted/30 text-muted-foreground',
                  selected && 'bg-accent',
                  conflict && 'bg-destructive/10 ring-destructive/60 ring-1 ring-inset',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <span
                    className={cn(
                      'flex size-6 items-center justify-center rounded-full text-xs font-medium tabular-nums',
                      date === today && 'bg-primary text-primary-foreground',
                    )}
                  >
                    {Number(date.slice(8))}
                  </span>
                  {conflict && <AlertTriangle className="text-destructive size-3.5" aria-hidden />}
                </div>
                {day && data ? (
                  <DayCellBody day={day} data={data} expanded={view === 'week'} />
                ) : (
                  <Skeleton className="h-8" />
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DayCellBody({
  day,
  data,
  expanded,
}: {
  day: CapacityDay;
  data: Availability;
  expanded: boolean;
}) {
  const bookings = day.holds.filter((h) => h.source === 'booking');
  const quotes = day.holds.filter((h) => h.source === 'quote');
  const busy = bookings.length > 0;
  const limit = expanded ? bookings.length : 2;
  return (
    <div className="grid min-w-0 gap-1" aria-hidden>
      {(busy || expanded) && (
        <div className={cn('grid gap-1', !expanded && 'hidden sm:grid')}>
          {resourcesOf(day, data).map((r) => (
            <CapacityBar key={r.key} r={r} compact={!expanded} />
          ))}
        </div>
      )}
      {bookings.slice(0, limit).map((h) => (
        <HoldChip
          key={h.id}
          label={h.label}
          strength={h.strength}
          overdue={data.bookings.some((b) => b.id === h.id && b.overdue)}
        />
      ))}
      {bookings.length > limit && (
        <span className="text-muted-foreground text-[11px]">+{bookings.length - limit} more</span>
      )}
      {quotes.length > 0 && (
        <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
          <FileText className="size-3 shrink-0" />
          {quotes.length} quote{quotes.length === 1 ? '' : 's'}
        </span>
      )}
    </div>
  );
}

function HoldChip({
  label,
  strength,
  overdue,
}: {
  label: string;
  strength: string;
  overdue: boolean;
}) {
  return (
    <span
      data-strength={strength}
      data-overdue={overdue || undefined}
      className={cn(
        'truncate rounded px-1.5 py-0.5 text-[11px] leading-tight font-medium',
        strength === 'confirmed' && 'bg-primary text-primary-foreground',
        strength === 'tentative' &&
          'border-primary text-foreground bg-primary/15 border border-dashed',
        overdue && 'bg-destructive text-white',
      )}
    >
      {label}
    </span>
  );
}

function DayDetails({
  date,
  day,
  data,
  loading,
  onOpenDay,
}: {
  date: IsoDate;
  day: CapacityDay | undefined;
  data: Availability | undefined;
  loading: boolean;
  onOpenDay?: () => void;
}) {
  const isAdmin = useIsAdmin();
  const setAvailability = useSetStaffAvailability();
  const conflict = data?.conflicts.find((c) => c.date === date);
  const bookingHolds = day?.holds.filter((h) => h.source === 'booking') ?? [];
  const quoteHolds = day?.holds.filter((h) => h.source === 'quote') ?? [];
  const bookingsById = new Map(data?.bookings.map((b) => [b.id, b]));
  const unavailable = new Set(
    data?.staffUnavailability.filter((u) => u.date === date).map((u) => u.staffMemberId),
  );

  return (
    <Card role="region" aria-label="Day details">
      <CardHeader>
        <CardTitle>
          <h2 className="flex items-center gap-2">
            <CalendarDays className="size-4" aria-hidden />{' '}
            {onOpenDay ? formatLongDate(date) : 'Capacity and bookings'}
          </h2>
        </CardTitle>
        {onOpenDay && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={onOpenDay}>
              Day view
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="grid gap-5">
        {loading || !day || !data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            {conflict && (
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>Capacity conflict</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-4">
                    {conflict.shortfalls.map((s) => (
                      <li key={s.resource}>
                        {resourceLabel(s.resource, data.equipmentTypes)} short by {s.shortfall}
                      </li>
                    ))}
                    {conflict.fleetSplit && (
                      <li>Two full-service events share this night, so the fleet must be split.</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            <section aria-label="Capacity" className="grid gap-3">
              {resourcesOf(day, data).map((r) => (
                <div key={r.key} className="grid gap-1">
                  <CapacityBar r={r} />
                  <p className="text-muted-foreground text-xs">
                    {r.available} available of {r.usable} · {r.committed} committed
                    {r.tentative > 0 && ` (${r.tentative} tentative)`}
                    {r.softDemand > 0 && ` · ${r.softDemand} quoted`}
                  </p>
                </div>
              ))}
            </section>

            <section className="grid gap-2">
              <h3 className="text-sm font-medium">Bookings</h3>
              {bookingHolds.length === 0 ? (
                <p className="text-muted-foreground text-sm">Nothing booked.</p>
              ) : (
                <ul className="grid gap-2" aria-label="Bookings on this day">
                  {bookingHolds.map((h) => {
                    const b = bookingsById.get(h.id);
                    const turnaround = b && date > b.endDate;
                    return (
                      <li key={h.id} className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          to={`/bookings/${h.id}`}
                          className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
                        >
                          {b ? `${formatBookingNumber(b.number)} · ` : ''}
                          {h.label}
                        </Link>
                        <span className="flex items-center gap-1">
                          {b?.overdue && <Badge variant="destructive">Overdue</Badge>}
                          {turnaround && <Badge variant="secondary">Turnaround</Badge>}
                          {h.strength === 'tentative' ? (
                            <Badge variant="outline" className="border-dashed">
                              Tentative
                            </Badge>
                          ) : (
                            <Badge>Confirmed</Badge>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {quoteHolds.length > 0 && (
              <section className="grid gap-2">
                <h3 className="text-sm font-medium">Pending quotes</h3>
                <ul className="grid gap-1" aria-label="Quotes on this day">
                  {quoteHolds.map((h) => (
                    <li key={h.id} className="flex items-center gap-2 text-sm">
                      <FileText className="text-muted-foreground size-3.5" aria-hidden />
                      <Link
                        to={`/quotes/${h.id.split(':')[0]}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {h.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="grid gap-2">
              <h3 className="text-sm font-medium">DJs</h3>
              <ul className="grid gap-2" aria-label="DJ availability">
                {data.staff
                  .filter((s) => s.active)
                  .map((s) => {
                    const available = !unavailable.has(s.id);
                    const id = `dj-${s.id}-${date}`;
                    return (
                      <li key={s.id} className="flex items-center justify-between gap-2">
                        <Label htmlFor={id} className="font-normal">
                          {s.name}
                        </Label>
                        <span className="flex items-center gap-2">
                          <span className="text-muted-foreground text-xs">
                            {available ? 'Available' : 'Day off'}
                          </span>
                          <Switch
                            id={id}
                            checked={available}
                            disabled={!isAdmin || setAvailability.isPending}
                            onCheckedChange={(v) =>
                              setAvailability.mutate({ staffId: s.id, date, available: v })
                            }
                          />
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
