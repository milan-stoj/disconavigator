import { zodResolver } from '@hookform/resolvers/zod';
import { LOSS_REASON_LABELS, LOSS_REASONS, stageChangeSchema } from '@disco/shared';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormDialog } from '@/components/form-dialog';
import { FormField } from '@/components/form';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';

export type StageChange = z.output<typeof stageChangeSchema>;
type Values = z.input<typeof stageChangeSchema>;

/** Asks why an opportunity was lost; the reason is required, and "other" needs a note. */
export function LossReasonDialog({
  title,
  pending,
  onClose,
  onConfirm,
}: {
  title: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: (change: StageChange) => void;
}) {
  const form = useForm<Values, unknown, StageChange>({
    resolver: zodResolver(stageChangeSchema),
    defaultValues: { stage: 'lost', lossReason: null, lossNote: '' },
  });
  return (
    <FormDialog
      title={`Mark ${title} as lost`}
      description="Why didn't this one book? Loss reasons show what to fix."
      onClose={onClose}
      onSubmit={form.handleSubmit(onConfirm)}
      pending={pending}
      submitLabel="Mark lost"
      destructive
    >
      <FormField
        control={form.control}
        name="lossReason"
        label="Reason"
        render={({ field }) => (
          <RadioGroup
            value={field.value ?? ''}
            onValueChange={field.onChange}
            aria-invalid={field['aria-invalid']}
            aria-label="Reason"
            className="grid gap-2"
          >
            {LOSS_REASONS.map((r) => (
              <div key={r} className="flex items-center gap-2">
                <RadioGroupItem value={r} id={`${field.id}-${r}`} />
                <Label htmlFor={`${field.id}-${r}`} className="font-normal">
                  {LOSS_REASON_LABELS[r]}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
      />
      <FormField
        control={form.control}
        name="lossNote"
        label="Note"
        description='Required for "Other".'
        render={({ field }) => <Textarea {...field} value={field.value ?? ''} rows={2} />}
      />
    </FormDialog>
  );
}
