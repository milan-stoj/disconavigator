import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ORGANIZATION_TYPE_LABELS, ORGANIZATION_TYPES, organizationSchema } from '@disco/shared';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { DuplicateWarningDialog, duplicatesFrom } from '@/components/crm/duplicate-dialog';
import { FormDialog } from '@/components/form-dialog';
import { FormField, applyServerErrors } from '@/components/form';
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
import { crmKeys, type DuplicateMatch, type Organization } from '@/lib/crm';

type Values = z.input<typeof organizationSchema>;
type Output = z.output<typeof organizationSchema>;

const toValues = (o: Organization | null): Values => ({
  name: o?.name ?? '',
  type: o?.type ?? 'bar',
  city: o?.city ?? '',
  address: o?.address ?? '',
  website: o?.website ?? '',
  phone: o?.phone ?? '',
  notes: o?.notes ?? '',
  competitorNote: o?.competitorNote ?? '',
});

export function OrganizationFormDialog({
  organization,
  onClose,
  onSaved,
}: {
  organization: Organization | null;
  onClose: () => void;
  onSaved?: (o: Organization) => void;
}) {
  const qc = useQueryClient();
  const form = useForm<Values, unknown, Output>({
    resolver: zodResolver(organizationSchema),
    defaultValues: toValues(organization),
  });
  const [dupes, setDupes] = useState<{ matches: DuplicateMatch[]; values: Output } | null>(null);
  const save = useMutation({
    mutationFn: ({ values, allowDuplicate }: { values: Output; allowDuplicate?: boolean }) =>
      organization
        ? api.put<Organization>(`/api/organizations/${organization.id}`, values)
        : api.post<Organization>('/api/organizations', { ...values, allowDuplicate }),
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: crmKeys.organizations });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      toast.success(organization ? `${o.name} saved` : `${o.name} added`);
      setDupes(null);
      onClose();
      onSaved?.(o);
    },
    onError: (err, vars) => {
      const matches = duplicatesFrom(err);
      if (matches) setDupes({ matches, values: vars.values });
      else applyServerErrors(form.setError, err);
    },
  });

  return (
    <>
      <FormDialog
        title={organization ? `Edit ${organization.name}` : 'New organization'}
        description="A bar, venue, town, business, or anyone else you work with."
        onClose={onClose}
        onSubmit={form.handleSubmit((values) => save.mutate({ values }))}
        pending={save.isPending}
        submitLabel={organization ? 'Save' : 'Add organization'}
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
          <FormField
            control={form.control}
            name="name"
            label="Name"
            render={({ field }) => <Input {...field} autoFocus />}
          />
          <FormField
            control={form.control}
            name="type"
            label="Type"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger
                  id={field.id}
                  aria-invalid={field['aria-invalid']}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ORGANIZATION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {ORGANIZATION_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="city"
            label="City"
            render={({ field }) => <Input {...field} value={field.value ?? ''} />}
          />
          <FormField
            control={form.control}
            name="phone"
            label="Phone"
            render={({ field }) => (
              <Input {...field} value={field.value ?? ''} type="tel" autoComplete="off" />
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="address"
          label="Address"
          render={({ field }) => <Input {...field} value={field.value ?? ''} />}
        />
        <FormField
          control={form.control}
          name="website"
          label="Website"
          render={({ field }) => <Input {...field} value={field.value ?? ''} />}
        />
        <FormField
          control={form.control}
          name="competitorNote"
          label="Competitor notes"
          description="Who they've used before, what they paid, how it went."
          render={({ field }) => <Textarea {...field} value={field.value ?? ''} rows={2} />}
        />
        <FormField
          control={form.control}
          name="notes"
          label="Notes"
          render={({ field }) => <Textarea {...field} value={field.value ?? ''} rows={3} />}
        />
      </FormDialog>
      {dupes && (
        <DuplicateWarningDialog
          what="organization"
          basePath="/organizations"
          matches={dupes.matches}
          pending={save.isPending}
          onCancel={() => setDupes(null)}
          onContinue={() => save.mutate({ values: dupes.values, allowDuplicate: true })}
        />
      )}
    </>
  );
}
