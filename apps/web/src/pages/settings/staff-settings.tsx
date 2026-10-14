import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { DataTable, columnHelper } from '@/components/data-table';
import { FormField, applyServerErrors } from '@/components/form';
import { FormDialog } from '@/components/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { availabilityKey, staffKey, useStaff, type StaffMember } from '@/lib/availability';
import { formatDate } from '@/lib/crm';

const staffFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  email: z.union([z.literal(''), z.email('Enter a valid email')]),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine((v) => !v || /^[+()\-.\s\d]{7,}$/.test(v), 'Enter a valid phone number'),
  active: z.boolean(),
});
type StaffFormValues = z.infer<typeof staffFormSchema>;

const h = columnHelper<StaffMember>();
function buildColumns(onEdit: (s: StaffMember) => void) {
  return [
    h.accessor('name', {
      header: 'Name',
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
      enableHiding: false,
    }),
    h.accessor((s) => s.email ?? '', { id: 'email', header: 'Email' }),
    h.accessor((s) => s.phone ?? '', { id: 'phone', header: 'Phone' }),
    h.accessor((s) => (s.active ? 'active' : 'inactive'), {
      id: 'status',
      header: 'Status',
      cell: (info) =>
        info.getValue() === 'active' ? (
          <Badge variant="outline">Active</Badge>
        ) : (
          <Badge variant="secondary">Inactive</Badge>
        ),
    }),
    h.accessor((s) => s.unavailable.map((u) => u.date).join(' '), {
      id: 'daysOff',
      header: 'Upcoming days off',
      enableSorting: false,
      cell: ({ row }) => {
        const days = row.original.unavailable;
        if (days.length === 0) return <span className="text-muted-foreground">None</span>;
        const shown = days.slice(0, 3).map((d) => formatDate(d.date));
        return `${shown.join(', ')}${days.length > 3 ? ` +${days.length - 3} more` : ''}`;
      },
    }),
    h.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.original.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(row.original)}>Edit</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }),
  ];
}

export function StaffSettings() {
  const staff = useStaff();
  const [editing, setEditing] = useState<StaffMember | 'new' | null>(null);
  const columns = useMemo(() => buildColumns(setEditing), []);
  return (
    <>
      <p className="text-muted-foreground mb-4 text-sm">
        DJs and crew who work events. Mark days off from the calendar's day details.
      </p>
      <DataTable
        label="Staff"
        columns={columns}
        data={staff.data}
        isLoading={staff.isPending}
        searchPlaceholder="Search staff…"
        getRowId={(s) => s.id}
        initialSorting={[{ id: 'name', desc: false }]}
        onRowClick={setEditing}
        toolbar={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus /> Add staff member
          </Button>
        }
      />
      {editing && (
        <StaffDialog
          member={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

function StaffDialog({ member, onClose }: { member?: StaffMember; onClose: () => void }) {
  const qc = useQueryClient();
  const form = useForm<StaffFormValues>({
    resolver: zodResolver(staffFormSchema),
    defaultValues: {
      name: member?.name ?? '',
      email: member?.email ?? '',
      phone: member?.phone ?? '',
      active: member?.active ?? true,
    },
  });
  const save = useMutation({
    mutationFn: (v: StaffFormValues) => {
      const body = { ...v, email: v.email || null, phone: v.phone || null };
      return member
        ? api.patch<StaffMember>(`/api/staff/${member.id}`, body)
        : api.post<StaffMember>('/api/staff', body);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: staffKey });
      void qc.invalidateQueries({ queryKey: availabilityKey });
      toast.success(member ? 'Staff member updated' : 'Staff member added');
      onClose();
    },
    onError: (err) => applyServerErrors(form.setError, err),
  });
  return (
    <FormDialog
      title={member ? `Edit ${member.name}` : 'Add staff member'}
      description="Active staff count toward daily DJ capacity on the calendar."
      onClose={onClose}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={member ? 'Save' : 'Add staff member'}
    >
      <FormField
        control={form.control}
        name="name"
        label="Name"
        render={({ field }) => <Input {...field} autoComplete="off" />}
      />
      <FormField
        control={form.control}
        name="email"
        label="Email"
        render={({ field }) => <Input {...field} type="email" />}
      />
      <FormField
        control={form.control}
        name="phone"
        label="Phone"
        render={({ field }) => <Input {...field} type="tel" />}
      />
      <FormField
        control={form.control}
        name="active"
        label="Active"
        description="Inactive staff don't count toward capacity."
        orientation="horizontal"
        render={({ field }) => (
          <Switch
            id={field.id}
            checked={field.value}
            onCheckedChange={field.onChange}
            aria-describedby={field['aria-describedby']}
          />
        )}
      />
    </FormDialog>
  );
}
