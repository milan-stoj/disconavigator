import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  BOOKING_TYPES,
  bookingPolicy,
  centsToDollars,
  dollarsToCents,
  STAGE_LABELS,
  type BookingType,
} from '@disco/shared';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { ContactPicker, OrganizationPicker } from '@/components/crm/record-picker';
import { FormDialog } from '@/components/form-dialog';
import { FormField, applyServerErrors } from '@/components/form';
import { MoneyInput } from '@/components/money-input';
import { NumberInput } from '@/components/number-input';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { crmKeys, type Opportunity } from '@/lib/crm';
import { dollars, wholeNumber } from '@/lib/form-schemas';

const UNSPECIFIED = 'unspecified';

const formSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  organizationId: z.string().nullable(),
  contactId: z.string().nullable(),
  serviceInterest: z.enum([UNSPECIFIED, ...BOOKING_TYPES]),
  eventDate: z.string(),
  expectedAttendance: wholeNumber('attendance', 0, 100_000).nullable(),
  estimatedValue: dollars().nullable(),
  notes: z.string().trim().max(2000),
  stage: z.enum(['new', 'contacted']),
});
type Values = z.infer<typeof formSchema>;

function toValues(o: Opportunity | null, defaults: Partial<Values>): Values {
  return {
    title: o?.title ?? '',
    organizationId: o?.organizationId ?? defaults.organizationId ?? null,
    contactId: o?.contactId ?? defaults.contactId ?? null,
    serviceInterest: o?.serviceInterest ?? UNSPECIFIED,
    eventDate: o?.eventDate ?? '',
    expectedAttendance: o?.expectedAttendance ?? null,
    estimatedValue: o?.estimatedValueCents == null ? null : centsToDollars(o.estimatedValueCents),
    notes: o?.notes ?? '',
    stage: 'new',
  };
}

function toBody(v: Values, includeStage: boolean) {
  return {
    title: v.title,
    organizationId: v.organizationId,
    contactId: v.contactId,
    serviceInterest: v.serviceInterest === UNSPECIFIED ? null : (v.serviceInterest as BookingType),
    eventDate: v.eventDate || null,
    expectedAttendance: v.expectedAttendance,
    estimatedValueCents: v.estimatedValue === null ? null : dollarsToCents(v.estimatedValue),
    notes: v.notes || null,
    ...(includeStage ? { stage: v.stage } : {}),
  };
}

export function OpportunityFormDialog({
  opportunity,
  defaults = {},
  onClose,
  onSaved,
}: {
  opportunity: Opportunity | null;
  defaults?: Partial<Pick<Values, 'organizationId' | 'contactId'>>;
  onClose: () => void;
  onSaved?: (o: Opportunity) => void;
}) {
  const qc = useQueryClient();
  const form = useForm<Values>({
    resolver: zodResolver(formSchema),
    defaultValues: toValues(opportunity, defaults),
  });
  const organizationId = useWatch({ control: form.control, name: 'organizationId' });
  const save = useMutation({
    mutationFn: (v: Values) =>
      opportunity
        ? api.put<Opportunity>(`/api/opportunities/${opportunity.id}`, toBody(v, false))
        : api.post<Opportunity>('/api/opportunities', toBody(v, true)),
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: crmKeys.opportunities });
      void qc.invalidateQueries({ queryKey: crmKeys.organizations });
      void qc.invalidateQueries({ queryKey: crmKeys.contacts });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      toast.success(opportunity ? `${o.title} saved` : `${o.title} added to the pipeline`);
      onClose();
      onSaved?.(o);
    },
    onError: (err) =>
      applyServerErrors(form.setError, err, { estimatedValueCents: 'estimatedValue' }),
  });

  return (
    <FormDialog
      title={opportunity ? `Edit ${opportunity.title}` : 'New opportunity'}
      description="A possible booking you are working toward."
      onClose={onClose}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={opportunity ? 'Save' : 'Add opportunity'}
    >
      <FormField
        control={form.control}
        name="title"
        label="Title"
        render={({ field }) => (
          <Input {...field} autoFocus placeholder="Bar X summer silent disco" />
        )}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="organizationId"
          label="Organization"
          render={({ field }) => (
            <OrganizationPicker
              id={field.id}
              value={field.value}
              onChange={field.onChange}
              invalid={field['aria-invalid']}
            />
          )}
        />
        <FormField
          control={form.control}
          name="contactId"
          label="Contact"
          render={({ field }) => (
            <ContactPicker
              id={field.id}
              value={field.value}
              onChange={field.onChange}
              invalid={field['aria-invalid']}
              organizationId={organizationId}
            />
          )}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="serviceInterest"
          label="Interested in"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={field.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSPECIFIED}>Not sure yet</SelectItem>
                {BOOKING_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {bookingPolicy(t).label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <FormField
          control={form.control}
          name="eventDate"
          label="Event date"
          render={({ field }) => <Input {...field} type="date" />}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="expectedAttendance"
          label="Expected attendance"
          render={({ field }) => <NumberInput {...field} min={0} step={1} inputMode="numeric" />}
        />
        <FormField
          control={form.control}
          name="estimatedValue"
          label="Estimated value"
          render={({ field }) => <MoneyInput {...field} />}
        />
      </div>
      {!opportunity && (
        <FormField
          control={form.control}
          name="stage"
          label="Stage"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={field.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">{STAGE_LABELS.new}</SelectItem>
                <SelectItem value="contacted">{STAGE_LABELS.contacted}</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      )}
      <FormField
        control={form.control}
        name="notes"
        label="Notes"
        render={({ field }) => <Textarea {...field} rows={3} />}
      />
    </FormDialog>
  );
}
