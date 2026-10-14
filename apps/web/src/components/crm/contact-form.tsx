import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { contactSchema } from '@disco/shared';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { DuplicateWarningDialog, duplicatesFrom } from '@/components/crm/duplicate-dialog';
import { OrganizationPicker } from '@/components/crm/record-picker';
import { FormDialog } from '@/components/form-dialog';
import { FormField, applyServerErrors } from '@/components/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { crmKeys, type Contact, type DuplicateMatch } from '@/lib/crm';

type Values = z.input<typeof contactSchema>;
type Output = z.output<typeof contactSchema>;

const toValues = (c: Contact | null, organizationId: string | null): Values => ({
  organizationId: c ? c.organizationId : organizationId,
  name: c?.name ?? '',
  role: c?.role ?? '',
  email: c?.email ?? '',
  phone: c?.phone ?? '',
  notes: c?.notes ?? '',
});

export function ContactFormDialog({
  contact,
  organizationId = null,
  onClose,
  onSaved,
}: {
  contact: Contact | null;
  /** Pre-selects the organization for a new contact. */
  organizationId?: string | null;
  onClose: () => void;
  onSaved?: (c: Contact) => void;
}) {
  const qc = useQueryClient();
  const form = useForm<Values, unknown, Output>({
    resolver: zodResolver(contactSchema),
    defaultValues: toValues(contact, organizationId),
  });
  const [dupes, setDupes] = useState<{ matches: DuplicateMatch[]; values: Output } | null>(null);
  const save = useMutation({
    mutationFn: ({ values, allowDuplicate }: { values: Output; allowDuplicate?: boolean }) =>
      contact
        ? api.put<Contact>(`/api/contacts/${contact.id}`, values)
        : api.post<Contact>('/api/contacts', { ...values, allowDuplicate }),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: crmKeys.contacts });
      void qc.invalidateQueries({ queryKey: crmKeys.organizations });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      toast.success(contact ? `${c.name} saved` : `${c.name} added`);
      setDupes(null);
      onClose();
      onSaved?.(c);
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
        title={contact ? `Edit ${contact.name}` : 'New contact'}
        description="A person you talk to: an owner, booker, or event planner."
        onClose={onClose}
        onSubmit={form.handleSubmit((values) => save.mutate({ values }))}
        pending={save.isPending}
        submitLabel={contact ? 'Save' : 'Add contact'}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="name"
            label="Name"
            render={({ field }) => <Input {...field} autoFocus />}
          />
          <FormField
            control={form.control}
            name="role"
            label="Role"
            render={({ field }) => (
              <Input {...field} value={field.value ?? ''} placeholder="Owner, booker…" />
            )}
          />
        </div>
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
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="email"
            label="Email"
            render={({ field }) => <Input {...field} value={field.value ?? ''} type="email" />}
          />
          <FormField
            control={form.control}
            name="phone"
            label="Phone"
            render={({ field }) => <Input {...field} value={field.value ?? ''} type="tel" />}
          />
        </div>
        <FormField
          control={form.control}
          name="notes"
          label="Notes"
          render={({ field }) => <Textarea {...field} value={field.value ?? ''} rows={3} />}
        />
      </FormDialog>
      {dupes && (
        <DuplicateWarningDialog
          what="contact"
          basePath="/contacts"
          matches={dupes.matches}
          pending={save.isPending}
          onCancel={() => setDupes(null)}
          onContinue={() => save.mutate({ values: dupes.values, allowDuplicate: true })}
        />
      )}
    </>
  );
}
