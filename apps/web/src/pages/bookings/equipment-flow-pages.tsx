import { useState, type ReactNode } from 'react';
import { formatCents } from '@disco/shared';
import { ArrowLeft, Check, Minus, Plus, Radio, TriangleAlert } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Toggle } from '@/components/ui/toggle';
import { ApiError } from '@/lib/api';
import {
  quantityMismatchFrom,
  useBooking,
  useCheckIn,
  useCheckOut,
  type Booking,
  type QuantityDifference,
} from '@/lib/bookings';
import { useEquipment } from '@/lib/inventory';
import { cn } from '@/lib/utils';
import { NotFoundPage } from '@/pages/not-found';
import { bookingDates } from './booking-shared';

/** A large +/- number control that is comfortable to use with a thumb. */
export function Stepper({
  id,
  label,
  value,
  onChange,
  max,
  hint,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  max?: number;
  hint?: ReactNode;
}) {
  const clamp = (n: number) => Math.max(0, max === undefined ? n : Math.min(max, n));
  return (
    <div className="grid gap-2">
      <Label htmlFor={id} className="text-base">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="size-14 shrink-0"
          aria-label={`Decrease ${label.toLowerCase()}`}
          disabled={value <= 0}
          onClick={() => onChange(clamp(value - 1))}
        >
          <Minus className="size-6" />
        </Button>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          value={value}
          onChange={(e) => onChange(clamp(Math.trunc(Number(e.target.value) || 0)))}
          onFocus={(e) => e.target.select()}
          className="h-14 text-center text-2xl font-semibold tabular-nums md:text-2xl"
        />
        <Button
          type="button"
          variant="outline"
          className="size-14 shrink-0"
          aria-label={`Increase ${label.toLowerCase()}`}
          disabled={max !== undefined && value >= max}
          onClick={() => onChange(clamp(value + 1))}
        >
          <Plus className="size-6" />
        </Button>
      </div>
      {hint && <p className="text-muted-foreground text-sm">{hint}</p>}
    </div>
  );
}

function UnitToggle({
  label,
  pressed,
  onPressedChange,
  disabled,
  note,
}: {
  label: string;
  pressed: boolean;
  onPressedChange: (p: boolean) => void;
  disabled?: boolean;
  note?: string;
}) {
  return (
    <Toggle
      variant="outline"
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={disabled}
      aria-label={label}
      className="data-[state=on]:bg-primary data-[state=on]:text-primary-foreground h-16 min-w-24 flex-col gap-0.5 text-base"
    >
      <span className="flex items-center gap-1">
        {pressed ? <Check className="size-4" /> : <Radio className="size-4" />}
        {label}
      </span>
      {note && <span className="text-xs font-normal opacity-80">{note}</span>}
    </Toggle>
  );
}

function FlowFrame({
  booking: b,
  title,
  children,
}: {
  booking: Booking;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto grid w-full max-w-xl gap-4 pb-24">
      <PageHeader
        title={title}
        description={`${b.numberLabel} · ${b.title} · ${bookingDates(b)}`}
        actions={
          <Button variant="ghost" asChild>
            <Link to={`/bookings/${b.id}?tab=equipment`}>
              <ArrowLeft /> Back to booking
            </Link>
          </Button>
        }
      />
      {children}
    </div>
  );
}

/** Loads the booking and shows a notice if it is not in the status this flow needs. */
function useFlowBooking() {
  const { id = '' } = useParams();
  const booking = useBooking(id);
  let gate: ReactNode = null;
  if (booking.error instanceof ApiError && booking.error.status === 404) gate = <NotFoundPage />;
  else if (!booking.data)
    gate = (
      <div className="mx-auto grid w-full max-w-xl gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64" />
      </div>
    );
  return { id, booking: booking.data, gate };
}

function WrongStatus({ booking: b, message }: { booking: Booking; message: string }) {
  return (
    <Alert>
      <AlertTitle>{message}</AlertTitle>
      <AlertDescription>
        <Link to={`/bookings/${b.id}?tab=equipment`} className="underline">
          Go back to {b.numberLabel}
        </Link>
      </AlertDescription>
    </Alert>
  );
}

/** A fixed bar at the bottom of the screen on phones; inline on larger screens. */
function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background/95 fixed inset-x-0 bottom-0 z-10 flex gap-2 border-t p-3 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0 [&>*]:h-12 [&>*]:flex-1 [&>*]:text-base">
      {children}
    </div>
  );
}

// ---------- Check-out ----------

export function CheckOutPage() {
  const { id, booking: b, gate } = useFlowBooking();
  if (gate || !b) return gate;
  if (b.status !== 'confirmed') {
    return (
      <FlowFrame booking={b} title="Check out">
        <WrongStatus
          booking={b}
          message={
            b.status === 'out'
              ? 'This equipment is already checked out.'
              : 'Confirm the booking before checking out equipment.'
          }
        />
      </FlowFrame>
    );
  }
  return <CheckOutForm key={id} booking={b} />;
}

function CheckOutForm({ booking: b }: { booking: Booking }) {
  const navigate = useNavigate();
  const equipment = useEquipment();
  const checkOut = useCheckOut(b.id);
  const pooledLines = b.equipment.lines.filter((l) => l.trackingMode === 'pooled');
  const serialLines = b.equipment.lines.filter((l) => l.trackingMode === 'serialized');
  const [counts, setCounts] = useState<Record<string, number>>(() =>
    Object.fromEntries(pooledLines.map((l) => [l.equipmentTypeId, l.required])),
  );
  const [units, setUnits] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'count' | 'review'>('count');
  const [mismatch, setMismatch] = useState<QuantityDifference[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = new Map(b.equipment.busyUnits.map((u) => [u.unitId, u.numberLabel]));
  const typeUnits = (typeId: string) =>
    (equipment.data?.find((t) => t.id === typeId)?.units ?? []).filter(
      (u) => u.status === 'in_service',
    );
  const unitLabel = (unitId: string) =>
    equipment.data?.flatMap((t) => t.units).find((u) => u.id === unitId)?.label ?? 'Unit';

  const submit = (acknowledgeDifference = false) => {
    setError(null);
    checkOut.mutate(
      {
        pooled: pooledLines.map((l) => ({
          equipmentTypeId: l.equipmentTypeId,
          quantity: counts[l.equipmentTypeId] ?? 0,
        })),
        unitIds: units,
        note: note || null,
        acknowledgeDifference,
      },
      {
        onSuccess: () => {
          toast.success('Equipment checked out');
          void navigate(`/bookings/${b.id}?tab=equipment`);
        },
        onError: (err) => {
          const diff = quantityMismatchFrom(err);
          if (diff) setMismatch(diff);
          else
            setError(
              err instanceof ApiError
                ? (Object.values(err.fieldErrors)[0] ?? err.message)
                : 'Check-out failed',
            );
        },
      },
    );
  };

  return (
    <FlowFrame booking={b} title={step === 'count' ? 'Check out' : 'Review check-out'}>
      {error && (
        <Alert variant="destructive" role="alert">
          <TriangleAlert />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
      {step === 'count' ? (
        <>
          {pooledLines.map((l) => (
            <Card key={l.equipmentTypeId}>
              <CardContent>
                <Stepper
                  id={`out-${l.equipmentTypeId}`}
                  label={l.name}
                  value={counts[l.equipmentTypeId] ?? 0}
                  onChange={(n) => setCounts((c) => ({ ...c, [l.equipmentTypeId]: n }))}
                  hint={`Booking needs ${l.required}`}
                />
              </CardContent>
            </Card>
          ))}
          {serialLines.map((l) => {
            const picked = units.filter((u) =>
              typeUnits(l.equipmentTypeId).some((x) => x.id === u),
            );
            return (
              <Card key={l.equipmentTypeId}>
                <CardHeader>
                  <CardTitle>
                    <h2>{l.name}</h2>
                  </CardTitle>
                  <CardDescription>
                    Tap each one going out · {picked.length} of {l.required} selected
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2" role="group" aria-label={l.name}>
                  {equipment.isPending && <Skeleton className="h-16 w-full" />}
                  {typeUnits(l.equipmentTypeId).map((u) => {
                    const elsewhere = busy.get(u.id);
                    return (
                      <UnitToggle
                        key={u.id}
                        label={u.label}
                        pressed={units.includes(u.id)}
                        disabled={!!elsewhere}
                        note={elsewhere ? `Out on ${elsewhere}` : undefined}
                        onPressedChange={(p) =>
                          setUnits((s) => (p ? [...s, u.id] : s.filter((x) => x !== u.id)))
                        }
                      />
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
          <div className="grid gap-2">
            <Label htmlFor="checkout-note">Note (optional)</Label>
            <Textarea
              id="checkout-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Anything worth remembering about what went out"
            />
          </div>
          <ActionBar>
            <Button onClick={() => setStep('review')}>Review</Button>
          </ActionBar>
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Going out</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-3" aria-label="Check-out summary">
                {pooledLines.map((l) => {
                  const n = counts[l.equipmentTypeId] ?? 0;
                  return (
                    <SummaryRow
                      key={l.equipmentTypeId}
                      label={l.name}
                      value={n}
                      warn={n !== l.required ? `Booking needs ${l.required}` : undefined}
                    />
                  );
                })}
                {serialLines.map((l) => {
                  const picked = units.filter((u) =>
                    typeUnits(l.equipmentTypeId).some((x) => x.id === u),
                  );
                  return (
                    <SummaryRow
                      key={l.equipmentTypeId}
                      label={l.name}
                      value={picked.length}
                      detail={picked.map(unitLabel).sort().join(', ') || 'None'}
                      warn={
                        picked.length !== l.required ? `Booking needs ${l.required}` : undefined
                      }
                    />
                  );
                })}
              </ul>
              {note && <p className="text-muted-foreground mt-3 text-sm">{note}</p>}
            </CardContent>
          </Card>
          <ActionBar>
            <Button variant="outline" onClick={() => setStep('count')}>
              Edit
            </Button>
            <Button onClick={() => submit()} disabled={checkOut.isPending}>
              {checkOut.isPending && <Spinner />} Complete check-out
            </Button>
          </ActionBar>
        </>
      )}
      <MismatchDialog
        differences={mismatch}
        pending={checkOut.isPending}
        onCancel={() => setMismatch(null)}
        onConfirm={() => {
          setMismatch(null);
          submit(true);
        }}
      />
    </FlowFrame>
  );
}

function SummaryRow({
  label,
  value,
  detail,
  warn,
  tone,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  warn?: string;
  tone?: 'destructive';
}) {
  return (
    <li className="flex items-start justify-between gap-3">
      <div className="grid gap-0.5">
        <span className="font-medium">{label}</span>
        {detail && <span className="text-muted-foreground text-sm">{detail}</span>}
        {warn && (
          <span className="flex items-center gap-1 text-sm text-amber-700 dark:text-amber-400">
            <TriangleAlert className="size-3.5" /> {warn}
          </span>
        )}
      </div>
      <span
        className={cn(
          'text-2xl font-semibold tabular-nums',
          tone === 'destructive' && 'text-destructive',
        )}
      >
        {value}
      </span>
    </li>
  );
}

function MismatchDialog({
  differences,
  pending,
  onCancel,
  onConfirm,
}: {
  differences: QuantityDifference[] | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={!!differences} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This differs from the booking</AlertDialogTitle>
          <AlertDialogDescription>
            Check out anyway? The booking itself won't change.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="grid gap-1 text-sm" aria-label="Differences">
          {differences?.map((d) => (
            <li key={d.equipmentTypeId}>
              {d.name}: {d.checkedOut} going out, booking needs {d.required}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Go back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            Check out anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ---------- Check-in ----------

export function CheckInPage() {
  const { id, booking: b, gate } = useFlowBooking();
  if (gate || !b) return gate;
  if (b.status !== 'out') {
    return (
      <FlowFrame booking={b} title="Check in">
        <WrongStatus
          booking={b}
          message={
            b.equipment.checkedIn
              ? 'This equipment has already been checked in.'
              : 'Check out the equipment before checking it in.'
          }
        />
      </FlowFrame>
    );
  }
  return <CheckInForm key={id} booking={b} />;
}

function CheckInForm({ booking: b }: { booking: Booking }) {
  const navigate = useNavigate();
  const checkIn = useCheckIn(b.id);
  const isRental = b.bookingType === 'equipment_rental';
  const outLines = b.equipment.lines.filter((l) => l.checkedOut > 0);
  const pooledLines = outLines.filter((l) => l.trackingMode === 'pooled');
  const serialLines = outLines.filter((l) => l.trackingMode === 'serialized');
  const [counts, setCounts] = useState<Record<string, { returned: number; damaged: number }>>(() =>
    Object.fromEntries(
      pooledLines.map((l) => [l.equipmentTypeId, { returned: l.checkedOut, damaged: 0 }]),
    ),
  );
  const [returnedUnits, setReturnedUnits] = useState<string[]>(() =>
    serialLines.flatMap((l) => l.units.map((u) => u.id)),
  );
  const [damagedUnits, setDamagedUnits] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [step, setStep] = useState<'count' | 'review'>('count');
  const [error, setError] = useState<string | null>(null);

  const setCount = (typeId: string, patch: Partial<{ returned: number; damaged: number }>) =>
    setCounts((c) => {
      const next = { ...(c[typeId] ?? { returned: 0, damaged: 0 }), ...patch };
      next.damaged = Math.min(next.damaged, next.returned);
      return { ...c, [typeId]: next };
    });

  const summary = outLines.map((l) => {
    if (l.trackingMode === 'pooled') {
      const c = counts[l.equipmentTypeId] ?? { returned: 0, damaged: 0 };
      return { line: l, ...c, missing: l.checkedOut - c.returned, missingLabels: [] as string[] };
    }
    const back = l.units.filter((u) => returnedUnits.includes(u.id));
    const missing = l.units.filter((u) => !returnedUnits.includes(u.id));
    return {
      line: l,
      returned: back.length,
      damaged: back.filter((u) => damagedUnits.includes(u.id)).length,
      missing: missing.length,
      missingLabels: missing.map((u) => u.label),
    };
  });
  const lossCents = isRental
    ? summary.reduce((sum, s) => sum + s.missing * s.line.lossFeeCents, 0)
    : 0;

  const submit = () => {
    setError(null);
    checkIn.mutate(
      {
        pooled: pooledLines.map((l) => ({
          equipmentTypeId: l.equipmentTypeId,
          ...counts[l.equipmentTypeId]!,
        })),
        returnedUnitIds: returnedUnits,
        damagedUnitIds: damagedUnits.filter((u) => returnedUnits.includes(u)),
        note: note || null,
      },
      {
        onSuccess: () => {
          toast.success('Equipment checked in');
          void navigate(`/bookings/${b.id}?tab=equipment`);
        },
        onError: (err) =>
          setError(
            err instanceof ApiError
              ? (Object.values(err.fieldErrors)[0] ?? err.message)
              : 'Check-in failed',
          ),
      },
    );
  };

  return (
    <FlowFrame booking={b} title={step === 'count' ? 'Check in' : 'Review check-in'}>
      {b.overdue && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>This return is overdue</AlertTitle>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive" role="alert">
          <TriangleAlert />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
      {step === 'count' ? (
        <>
          {pooledLines.map((l) => {
            const c = counts[l.equipmentTypeId] ?? { returned: 0, damaged: 0 };
            return (
              <Card key={l.equipmentTypeId}>
                <CardHeader>
                  <CardTitle>
                    <h2>{l.name}</h2>
                  </CardTitle>
                  <CardDescription>{l.checkedOut} went out</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4">
                  <Stepper
                    id={`returned-${l.equipmentTypeId}`}
                    label={`${l.name} returned`}
                    value={c.returned}
                    max={l.checkedOut}
                    onChange={(n) => setCount(l.equipmentTypeId, { returned: n })}
                  />
                  <Stepper
                    id={`damaged-${l.equipmentTypeId}`}
                    label={`${l.name} damaged`}
                    value={c.damaged}
                    max={c.returned}
                    onChange={(n) => setCount(l.equipmentTypeId, { damaged: n })}
                    hint="Damaged items are taken out of service."
                  />
                </CardContent>
              </Card>
            );
          })}
          {serialLines.map((l) => (
            <Card key={l.equipmentTypeId}>
              <CardHeader>
                <CardTitle>
                  <h2>{l.name}</h2>
                </CardTitle>
                <CardDescription>Untap any that did not come back</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div
                  className="flex flex-wrap gap-2"
                  role="group"
                  aria-label={`${l.name} returned`}
                >
                  {l.units.map((u) => (
                    <UnitToggle
                      key={u.id}
                      label={u.label}
                      pressed={returnedUnits.includes(u.id)}
                      note={returnedUnits.includes(u.id) ? 'Returned' : 'Missing'}
                      onPressedChange={(p) =>
                        setReturnedUnits((s) => (p ? [...s, u.id] : s.filter((x) => x !== u.id)))
                      }
                    />
                  ))}
                </div>
                {l.units
                  .filter((u) => returnedUnits.includes(u.id))
                  .map((u) => (
                    <div key={u.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`damaged-unit-${u.id}`}
                        checked={damagedUnits.includes(u.id)}
                        onCheckedChange={(v) =>
                          setDamagedUnits((s) =>
                            v === true ? [...s, u.id] : s.filter((x) => x !== u.id),
                          )
                        }
                      />
                      <Label htmlFor={`damaged-unit-${u.id}`}>{u.label} is damaged</Label>
                    </div>
                  ))}
              </CardContent>
            </Card>
          ))}
          <div className="grid gap-2">
            <Label htmlFor="checkin-note">Note (optional)</Label>
            <Textarea
              id="checkin-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What happened to anything missing or damaged"
            />
          </div>
          <ActionBar>
            <Button onClick={() => setStep('review')}>Review</Button>
          </ActionBar>
        </>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Coming back</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <ul className="grid gap-3" aria-label="Check-in summary">
                {summary.map((s) => (
                  <SummaryRow
                    key={s.line.equipmentTypeId}
                    label={s.line.name}
                    value={`${s.returned} / ${s.line.checkedOut}`}
                    detail={
                      [
                        s.damaged > 0 && `${s.damaged} damaged`,
                        s.missing > 0 &&
                          `${s.missing} missing${s.missingLabels.length ? ` (${s.missingLabels.join(', ')})` : ''}`,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'All back'
                    }
                    tone={s.missing > 0 ? 'destructive' : undefined}
                  />
                ))}
              </ul>
              {lossCents > 0 && (
                <Alert>
                  <TriangleAlert />
                  <AlertTitle>A {formatCents(lossCents)} loss charge will be proposed</AlertTitle>
                  <AlertDescription>
                    An admin reviews it before the customer is charged.
                  </AlertDescription>
                </Alert>
              )}
              {!isRental && summary.some((s) => s.missing > 0) && (
                <p className="text-muted-foreground text-sm">
                  Missing gear is written off inventory. Customers aren't charged for staffed
                  events.
                </p>
              )}
              {note && <p className="text-muted-foreground text-sm">{note}</p>}
            </CardContent>
          </Card>
          <ActionBar>
            <Button variant="outline" onClick={() => setStep('count')}>
              Edit
            </Button>
            <Button onClick={submit} disabled={checkIn.isPending}>
              {checkIn.isPending && <Spinner />} Complete check-in
            </Button>
          </ActionBar>
        </>
      )}
    </FlowFrame>
  );
}
