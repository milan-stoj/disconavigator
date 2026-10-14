import { useState } from 'react';
import { dollarsToCents, formatCents, PAYMENT_METHODS, todayIn } from '@disco/shared';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { MoneyInput } from '@/components/money-input';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useDecideCharge, useRecordPayment, type Booking } from '@/lib/bookings';

const METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: 'Cash',
  check: 'Check',
  other: 'Other',
};

export function RecordPaymentDialog({
  booking,
  onClose,
}: {
  booking: Booking;
  onClose: () => void;
}) {
  const record = useRecordPayment(booking.id);
  const { data: me } = useMe();
  const balance = booking.money.balanceCents;
  const [amount, setAmount] = useState<number | null>(
    balance && balance > 0 ? balance / 100 : null,
  );
  const [receivedOn, setReceivedOn] = useState(() =>
    todayIn(me?.tenant.timeZone ?? 'America/Chicago'),
  );
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>('cash');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  return (
    <FormDialog
      title="Record payment"
      description="For cash or checks received outside Square. It counts toward what this booking has paid."
      onClose={onClose}
      pending={record.isPending}
      submitLabel="Record payment"
      onSubmit={(e) => {
        e.preventDefault();
        if (amount == null || amount <= 0)
          return setErrors({ amountCents: 'Enter the amount received' });
        if (!receivedOn) return setErrors({ receivedOn: 'Enter the date received' });
        record.mutate(
          { amountCents: dollarsToCents(amount), receivedOn, method, note: note.trim() || null },
          {
            onSuccess: () => {
              toast.success(
                `${METHOD_LABELS[method]} payment of ${formatCents(dollarsToCents(amount))} recorded`,
              );
              onClose();
            },
            onError: (err) =>
              err instanceof ApiError && Object.keys(err.fieldErrors).length
                ? setErrors(err.fieldErrors)
                : toast.error(errorMessage(err)),
          },
        );
      }}
    >
      <Field data-invalid={!!errors.amountCents}>
        <FieldLabel htmlFor="payment-amount">Amount</FieldLabel>
        <MoneyInput
          id="payment-amount"
          value={amount}
          aria-invalid={!!errors.amountCents}
          onChange={(v) => {
            setAmount(v);
            setErrors({});
          }}
        />
        {balance != null && balance > 0 && (
          <FieldDescription>Balance due: {formatCents(balance)}</FieldDescription>
        )}
        <FieldError>{errors.amountCents}</FieldError>
      </Field>
      <Field data-invalid={!!errors.receivedOn}>
        <FieldLabel htmlFor="payment-date">Received on</FieldLabel>
        <Input
          id="payment-date"
          type="date"
          value={receivedOn}
          aria-invalid={!!errors.receivedOn}
          onChange={(e) => setReceivedOn(e.target.value)}
        />
        <FieldError>{errors.receivedOn}</FieldError>
      </Field>
      <Field>
        <FieldLabel id="payment-method-label">Method</FieldLabel>
        <RadioGroup
          aria-labelledby="payment-method-label"
          value={method}
          onValueChange={(v) => setMethod(v as typeof method)}
          className="flex gap-4"
        >
          {PAYMENT_METHODS.map((m) => (
            <div key={m} className="flex items-center gap-2">
              <RadioGroupItem id={`payment-method-${m}`} value={m} />
              <Label htmlFor={`payment-method-${m}`}>{METHOD_LABELS[m]}</Label>
            </div>
          ))}
        </RadioGroup>
      </Field>
      <Field>
        <FieldLabel htmlFor="payment-note">Note</FieldLabel>
        <Textarea
          id="payment-note"
          rows={2}
          value={note}
          placeholder="Optional, e.g. check number"
          onChange={(e) => setNote(e.target.value)}
        />
      </Field>
    </FormDialog>
  );
}

type Charge = Booking['charges'][number];

export function ChargeDecisionDialog({
  booking,
  charge,
  action,
  onClose,
}: {
  booking: Booking;
  charge: Charge;
  action: 'approve' | 'waive';
  onClose: () => void;
}) {
  const decide = useDecideCharge(booking.id);
  const [amount, setAmount] = useState<number | null>(charge.proposedCents / 100);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const approving = action === 'approve';
  return (
    <FormDialog
      title={approving ? 'Approve loss charge' : 'Waive loss charge'}
      description={
        approving
          ? 'The customer’s saved Square card is charged. Without a saved card, a Square invoice is sent instead.'
          : `No charge is made for the proposed ${formatCents(charge.proposedCents)}.`
      }
      onClose={onClose}
      pending={decide.isPending}
      submitLabel={approving ? 'Approve charge' : 'Waive charge'}
      destructive={!approving}
      onSubmit={(e) => {
        e.preventDefault();
        if (approving && (amount == null || amount <= 0)) {
          return setErrors({
            amountCents: 'Enter an amount greater than zero, or waive the charge',
          });
        }
        if (!approving && !reason.trim())
          return setErrors({ reason: 'Enter a reason for waiving' });
        decide.mutate(
          {
            chargeId: charge.id,
            action,
            ...(approving ? { amountCents: dollarsToCents(amount!) } : {}),
            reason: reason.trim() || undefined,
          },
          {
            onSuccess: () => {
              toast.success(approving ? 'Charge approved' : 'Charge waived');
              onClose();
            },
            onError: (err) =>
              err instanceof ApiError && Object.keys(err.fieldErrors).length
                ? setErrors(err.fieldErrors)
                : toast.error(errorMessage(err)),
          },
        );
      }}
    >
      {approving && (
        <Field data-invalid={!!errors.amountCents}>
          <FieldLabel htmlFor="charge-amount">Amount</FieldLabel>
          <MoneyInput
            id="charge-amount"
            value={amount}
            aria-invalid={!!errors.amountCents}
            onChange={(v) => {
              setAmount(v);
              setErrors({});
            }}
          />
          <FieldDescription>
            Proposed at check-in: {formatCents(charge.proposedCents)}
          </FieldDescription>
          <FieldError>{errors.amountCents}</FieldError>
        </Field>
      )}
      <Field data-invalid={!!errors.reason}>
        <FieldLabel htmlFor="charge-reason">{approving ? 'Note' : 'Reason'}</FieldLabel>
        <Textarea
          id="charge-reason"
          rows={2}
          value={reason}
          aria-invalid={!!errors.reason}
          placeholder={
            approving ? 'Optional, e.g. why the amount changed' : 'e.g. regular customer'
          }
          onChange={(e) => {
            setReason(e.target.value);
            setErrors({});
          }}
        />
        <FieldError>{errors.reason}</FieldError>
      </Field>
    </FormDialog>
  );
}
