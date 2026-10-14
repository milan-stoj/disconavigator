import { useState } from 'react';
import { bpsToPercent, dollarsToCents, formatCents, settlementAmount } from '@disco/shared';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { MoneyInput } from '@/components/money-input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api';
import {
  overbookingFrom,
  useCancelBooking,
  useCloseBooking,
  useConfirmBooking,
  useRecordSettlement,
  type Booking,
  type OverbookingDetails,
} from '@/lib/bookings';
import { OverbookingDialog } from './booking-shared';

interface DialogProps {
  booking: Booking;
  onClose: () => void;
}

function ReasonField({
  id,
  label,
  value,
  onChange,
  error,
  description,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  description?: string;
}) {
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        id={id}
        rows={3}
        value={value}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
      />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export function ConfirmBookingDialog({ booking, onClose }: DialogProps) {
  const confirm = useConfirmBooking(booking.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [overbooking, setOverbooking] = useState<OverbookingDetails | null>(null);
  const submit = (confirmOverbooking = false) =>
    confirm.mutate(
      { reason: reason.trim(), confirmOverbooking },
      {
        onSuccess: () => {
          toast.success(`Booking ${booking.numberLabel} confirmed`);
          onClose();
        },
        onError: (err) => {
          const ob = overbookingFrom(err);
          if (ob) setOverbooking(ob);
          else if (err instanceof ApiError && err.fieldErrors.reason)
            setError(err.fieldErrors.reason);
          else toast.error(errorMessage(err));
        },
      },
    );
  return (
    <>
      <FormDialog
        title={`Confirm ${booking.numberLabel} without a deposit`}
        description="The equipment is held as confirmed. The deposit invoice stays open in Square."
        onClose={onClose}
        pending={confirm.isPending}
        submitLabel="Confirm booking"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) setError('Enter a reason');
          else submit();
        }}
      >
        <ReasonField
          id="confirm-reason"
          label="Reason"
          value={reason}
          onChange={(v) => {
            setReason(v);
            setError(null);
          }}
          error={error}
          description="For example: repeat client, pays at pickup."
        />
      </FormDialog>
      {overbooking && (
        <OverbookingDialog
          details={overbooking}
          action="Confirm"
          onCancel={() => setOverbooking(null)}
          onConfirm={() => {
            setOverbooking(null);
            submit(true);
          }}
        />
      )}
    </>
  );
}

export function CancelBookingDialog({ booking, onClose }: DialogProps) {
  const cancel = useCancelBooking(booking.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <FormDialog
      title={`Cancel ${booking.numberLabel}`}
      description="Its equipment and DJs are released from the calendar."
      onClose={onClose}
      pending={cancel.isPending}
      submitLabel="Cancel booking"
      destructive
      onSubmit={(e) => {
        e.preventDefault();
        if (!reason.trim()) return setError('Enter a reason');
        cancel.mutate(
          { reason: reason.trim() },
          {
            onSuccess: () => {
              toast.success(`Booking ${booking.numberLabel} cancelled`);
              onClose();
            },
            onError: (err) => toast.error(errorMessage(err)),
          },
        );
      }}
    >
      {booking.money.paidCents > 0 && (
        <Alert>
          <AlertTitle>{formatCents(booking.money.paidCents)} has been paid</AlertTitle>
          <AlertDescription>
            Payments stay recorded. Refund the customer in Square if needed.
          </AlertDescription>
        </Alert>
      )}
      <ReasonField
        id="cancel-reason"
        label="Reason"
        value={reason}
        onChange={(v) => {
          setReason(v);
          setError(null);
        }}
        error={error}
      />
    </FormDialog>
  );
}

export function CloseBookingDialog({
  booking,
  isAdmin,
  onClose,
}: DialogProps & { isAdmin: boolean }) {
  const close = useCloseBooking(booking.id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const blocked = booking.closeBlockers.length > 0;
  const canOverride = blocked && isAdmin;
  return (
    <FormDialog
      title={`Close ${booking.numberLabel}`}
      description={
        blocked
          ? 'This booking has open items.'
          : 'Everything is checked in and paid. Closing marks the booking complete.'
      }
      onClose={onClose}
      pending={close.isPending}
      submitLabel={canOverride ? 'Close anyway' : 'Close booking'}
      destructive={canOverride}
      onSubmit={(e) => {
        e.preventDefault();
        if (blocked && !isAdmin) return onClose();
        if (canOverride && !reason.trim()) return setError('Enter a reason for closing anyway');
        close.mutate(
          { overrideReason: canOverride ? reason.trim() : null },
          {
            onSuccess: () => {
              toast.success(`Booking ${booking.numberLabel} closed`);
              onClose();
            },
            onError: (err) => toast.error(errorMessage(err)),
          },
        );
      }}
    >
      {blocked && (
        <Alert variant="destructive">
          <AlertTitle>Can't close yet</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4" aria-label="Close blockers">
              {booking.closeBlockers.map((b) => (
                <li key={b.code}>{b.message}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {canOverride && (
        <ReasonField
          id="close-reason"
          label="Reason for closing anyway"
          value={reason}
          onChange={(v) => {
            setReason(v);
            setError(null);
          }}
          error={error}
          description="Recorded in the booking's activity history."
        />
      )}
      {blocked && !isAdmin && (
        <p className="text-muted-foreground text-sm">Ask an admin to close it anyway.</p>
      )}
    </FormDialog>
  );
}

export function SettlementDialog({ booking, onClose }: DialogProps) {
  const settle = useRecordSettlement(booking.id);
  const [door, setDoor] = useState<number | null>(
    booking.settlement ? booking.settlement.doorRevenueCents / 100 : null,
  );
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const split = booking.splitBps ?? 0;
  const owed =
    door != null && door >= 0
      ? settlementAmount({
          pricingTerm: booking.pricingTerm,
          doorRevenueCents: dollarsToCents(door),
          splitBps: split,
          guaranteeCents: booking.guaranteeCents,
        })
      : null;
  return (
    <FormDialog
      title={`Settle ${booking.numberLabel}`}
      description={`Enter the door revenue the venue reported. We get ${bpsToPercent(split)}%${
        booking.guaranteeCents ? `, minimum ${formatCents(booking.guaranteeCents)}` : ''
      }.`}
      onClose={onClose}
      pending={settle.isPending}
      submitLabel="Record settlement"
      onSubmit={(e) => {
        e.preventDefault();
        if (door == null || door < 0) return setError('Enter the door revenue');
        settle.mutate(
          { doorRevenueCents: dollarsToCents(door), note: note.trim() || null },
          {
            onSuccess: (b) => {
              toast.success(`Settled: ${formatCents(b.settlement?.amountCents ?? 0)} owed`);
              onClose();
            },
            onError: (err) => toast.error(errorMessage(err)),
          },
        );
      }}
    >
      <Field data-invalid={!!error}>
        <FieldLabel htmlFor="settlement-door">Door revenue</FieldLabel>
        <MoneyInput
          id="settlement-door"
          value={door}
          aria-invalid={!!error}
          onChange={(v) => {
            setDoor(v);
            setError(null);
          }}
        />
        <FieldError>{error}</FieldError>
      </Field>
      <p className="text-sm" aria-live="polite">
        Amount owed: <strong>{owed == null ? '—' : formatCents(owed)}</strong>
      </p>
      <Field>
        <FieldLabel htmlFor="settlement-note">Note</FieldLabel>
        <Textarea
          id="settlement-note"
          rows={2}
          value={note}
          placeholder="Optional, e.g. per the bar manager's count"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}
