import { useEffect } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  bpsToPercent,
  centsToDollars,
  dollarsToCents,
  percentToBps,
  type Settings,
} from '@disco/shared';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormField, applyServerErrors } from '@/components/form';
import { NumberInput } from '@/components/number-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupText } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { num, wholeDays } from '@/lib/form-schemas';
import { meQueryKey, useIsAdmin } from '@/lib/auth';
import { settingsQueryKey, useSettings, type SettingsView } from '@/lib/settings';

const TIME_ZONES = [
  'America/Chicago',
  'America/New_York',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
];

export const settingsFormSchema = z.object({
  businessName: z.string().trim().min(1, 'Business name is required').max(200),
  timeZone: z.string().min(1, 'Choose a time zone'),
  notificationEmail: z.union([z.literal(''), z.email('Enter a valid email')]),
  depositPercent: num('a percentage').min(0, 'Must be 0% or more').max(100, 'Must be 100% or less'),
  bufferDays: wholeDays('a number of days', 0, 14),
  rentalBalanceDueDays: wholeDays('a number of days', 0, 60),
  fullServiceInvoiceDueOffsetDays: wholeDays('a number of days', -60, 60),
  deliveryFee: num('an amount').min(0, 'Cannot be negative'),
  serviceAreas: z.string().max(2000),
  quoteValidityDays: wholeDays('a number of days', 1, 365),
  rentalTerms: z.string().max(20_000),
  fullServiceTerms: z.string().max(20_000),
  rentalUsageInstructions: z.string().max(20_000),
});
export type SettingsFormValues = z.infer<typeof settingsFormSchema>;

export function toFormValues(s: SettingsView): SettingsFormValues {
  return {
    businessName: s.businessName,
    timeZone: s.timeZone,
    notificationEmail: s.notificationEmail ?? '',
    depositPercent: bpsToPercent(s.rentalDepositBps),
    bufferDays: s.bufferDays,
    rentalBalanceDueDays: s.rentalBalanceDueDays,
    fullServiceInvoiceDueOffsetDays: s.fullServiceInvoiceDueOffsetDays,
    deliveryFee: centsToDollars(s.deliveryFeeCents),
    serviceAreas: s.serviceAreas.join('\n'),
    quoteValidityDays: s.quoteValidityDays,
    rentalTerms: s.rentalTerms,
    fullServiceTerms: s.fullServiceTerms,
    rentalUsageInstructions: s.rentalUsageInstructions,
  };
}

export function toSettings(v: SettingsFormValues): Settings {
  return {
    businessName: v.businessName,
    timeZone: v.timeZone,
    notificationEmail: v.notificationEmail || null,
    rentalDepositBps: percentToBps(v.depositPercent),
    bufferDays: v.bufferDays,
    rentalBalanceDueDays: v.rentalBalanceDueDays,
    fullServiceInvoiceDueOffsetDays: v.fullServiceInvoiceDueOffsetDays,
    deliveryFeeCents: dollarsToCents(v.deliveryFee),
    serviceAreas: v.serviceAreas
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    quoteValidityDays: v.quoteValidityDays,
    rentalTerms: v.rentalTerms,
    fullServiceTerms: v.fullServiceTerms,
    rentalUsageInstructions: v.rentalUsageInstructions,
  };
}

const SERVER_FIELD_MAP = {
  rentalDepositBps: 'depositPercent',
  deliveryFeeCents: 'deliveryFee',
} as const;

export function BusinessSettings() {
  const { data, isPending } = useSettings();
  if (isPending || !data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  return <BusinessSettingsForm settings={data} />;
}

function BusinessSettingsForm({ settings }: { settings: SettingsView }) {
  const isAdmin = useIsAdmin();
  const qc = useQueryClient();
  const form = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsFormSchema),
    defaultValues: toFormValues(settings),
  });
  useEffect(() => form.reset(toFormValues(settings)), [settings, form]);

  const save = useMutation({
    mutationFn: (v: SettingsFormValues) => api.put<SettingsView>('/api/settings', toSettings(v)),
    onSuccess: (saved) => {
      qc.setQueryData(settingsQueryKey, saved);
      void qc.invalidateQueries({ queryKey: meQueryKey });
      toast.success('Settings saved');
    },
    onError: (err) => applyServerErrors(form.setError, err, SERVER_FIELD_MAP),
  });
  const c = form.control;

  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate(v))} className="grid gap-6">
      <fieldset disabled={!isAdmin} className="grid min-w-0 gap-6">
        {!isAdmin && (
          <p className="text-muted-foreground text-sm">Only admins can change settings.</p>
        )}
        <Card>
          <CardHeader>
            <CardTitle>Business</CardTitle>
            <CardDescription>How your business appears on quotes and emails.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <FormField
                control={c}
                name="businessName"
                label="Business name"
                render={({ field }) => <Input {...field} />}
              />
              <FormField
                control={c}
                name="timeZone"
                label="Time zone"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!isAdmin}>
                    <SelectTrigger
                      id={field.id}
                      aria-invalid={field['aria-invalid']}
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIME_ZONES.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz.replace('_', ' ')}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FormField
                control={c}
                name="notificationEmail"
                label="Notification email"
                description="Where new quote requests and alerts are sent."
                render={({ field }) => <Input {...field} type="email" autoComplete="email" />}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Equipment rentals</CardTitle>
            <CardDescription>
              Applied when you build an equipment rental quote. Full-service bookings never take a
              holding deposit.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <FormField
                control={c}
                name="depositPercent"
                label="Holding deposit"
                description="Percent of the rental total due to hold the date."
                render={({ field }) => (
                  <InputGroup>
                    <NumberInput {...field} min={0} max={100} step={1} grouped />
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>%</InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                )}
              />
              <FormField
                control={c}
                name="rentalBalanceDueDays"
                label="Balance due"
                description="Days before dispatch the remaining balance is due."
                render={({ field }) => (
                  <NumberInput {...field} min={0} step={1} inputMode="numeric" />
                )}
              />
              <FormField
                control={c}
                name="bufferDays"
                label="Turnaround buffer"
                description="Days held after a rental returns for cleaning and charging."
                render={({ field }) => (
                  <NumberInput {...field} min={0} step={1} inputMode="numeric" />
                )}
              />
              <FormField
                control={c}
                name="deliveryFee"
                label="Suggested delivery fee"
                description="Pre-filled for deliveries outside your service areas. You can change it per quote."
                render={({ field }) => (
                  <InputGroup>
                    <InputGroupAddon>
                      <InputGroupText>$</InputGroupText>
                    </InputGroupAddon>
                    <NumberInput {...field} min={0} step={0.01} grouped />
                  </InputGroup>
                )}
              />
              <FormField
                control={c}
                name="serviceAreas"
                label="Service areas"
                description="One per line. Delivery inside these areas is free."
                render={({ field }) => <Textarea {...field} rows={3} />}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quotes and invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <FormField
                control={c}
                name="quoteValidityDays"
                label="Quotes valid for"
                description="Days before a sent quote expires."
                render={({ field }) => (
                  <NumberInput {...field} min={1} step={1} inputMode="numeric" />
                )}
              />
              <FormField
                control={c}
                name="fullServiceInvoiceDueOffsetDays"
                label="Full-service invoice due"
                description="Days relative to the event date (0 = event day, -7 = a week before)."
                render={({ field }) => <NumberInput {...field} step={1} inputMode="numeric" />}
              />
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Terms and instructions</CardTitle>
            <CardDescription>
              Shown on quotes. Customers accept the terms for their booking type.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <FormField
                control={c}
                name="rentalTerms"
                label="Equipment rental terms"
                render={({ field }) => <Textarea {...field} rows={8} />}
              />
              <FormField
                control={c}
                name="fullServiceTerms"
                label="Full-service event terms"
                render={({ field }) => <Textarea {...field} rows={8} />}
              />
              <FormField
                control={c}
                name="rentalUsageInstructions"
                label="Rental usage instructions"
                description="Sent with rental logistics emails."
                render={({ field }) => <Textarea {...field} rows={6} />}
              />
            </FieldGroup>
          </CardContent>
        </Card>
      </fieldset>
      {isAdmin && (
        <div className="bg-background/95 sticky bottom-0 -mx-4 flex justify-end gap-2 border-t px-4 py-3 md:-mx-6 md:px-6">
          <Button
            type="button"
            variant="outline"
            disabled={!form.formState.isDirty || save.isPending}
            onClick={() => form.reset()}
          >
            Discard changes
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending && <Spinner />} Save settings
          </Button>
        </div>
      )}
    </form>
  );
}
