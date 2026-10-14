import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createUserSchema, passwordSchema, USER_ROLES, type UserRole } from '@disco/shared';
import { MoreHorizontal, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { DataTable, columnHelper } from '@/components/data-table';
import { FormField, applyServerErrors } from '@/components/form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useMe } from '@/lib/auth';

export interface UserRow {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const usersKey = ['users'] as const;
const ROLE_LABELS: Record<UserRole, string> = { admin: 'Admin', staff: 'Staff' };

const editUserFormSchema = z.object({
  displayName: z.string().trim().min(1, 'Name is required').max(100),
  role: z.enum(USER_ROLES),
  active: z.boolean(),
  password: z.union([z.literal(''), passwordSchema]),
});
type EditUserValues = z.infer<typeof editUserFormSchema>;
type CreateUserValues = z.infer<typeof createUserSchema>;

const formatDateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(iso),
      )
    : 'Never';

function RoleSelect({
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: UserRole;
  onChange: (v: UserRole) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as UserRole)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {USER_ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const h = columnHelper<UserRow>();
function buildColumns(onEdit: (u: UserRow) => void) {
  return [
    h.accessor('displayName', {
      header: 'Name',
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
      enableHiding: false,
    }),
    h.accessor('username', { header: 'Username' }),
    h.accessor('role', {
      header: 'Role',
      filterFn: 'equalsString',
      cell: (info) => (
        <Badge variant={info.getValue() === 'admin' ? 'default' : 'secondary'}>
          {ROLE_LABELS[info.getValue()]}
        </Badge>
      ),
    }),
    h.accessor((u) => (u.active ? 'active' : 'inactive'), {
      id: 'status',
      header: 'Status',
      filterFn: 'equalsString',
      cell: (info) =>
        info.getValue() === 'active' ? (
          <Badge variant="outline">Active</Badge>
        ) : (
          <Badge variant="destructive">Inactive</Badge>
        ),
    }),
    h.accessor('lastLoginAt', {
      header: 'Last sign-in',
      cell: (info) => formatDateTime(info.getValue()),
      sortFn: 'text',
    }),
    h.display({
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${row.original.displayName}`}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onEdit(row.original)}>Edit user</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    }),
  ];
}

export function UsersSettings() {
  const users = useQuery({ queryKey: usersKey, queryFn: () => api.get<UserRow[]>('/api/users') });
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const columns = useMemo(() => buildColumns(setEditing), []);

  return (
    <>
      <DataTable
        label="Users"
        columns={columns}
        data={users.data}
        isLoading={users.isPending}
        searchPlaceholder="Search users…"
        getRowId={(u) => u.id}
        initialSorting={[{ id: 'displayName', desc: false }]}
        onRowClick={setEditing}
        filters={[
          {
            columnId: 'role',
            title: 'Roles',
            options: USER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })),
          },
          {
            columnId: 'status',
            title: 'Statuses',
            options: [
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
            ],
          },
        ]}
        toolbar={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus /> Add user
          </Button>
        }
      />
      <CreateUserDialog open={creating} onOpenChange={setCreating} />
      {editing && <EditUserDialog user={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const qc = useQueryClient();
  const form = useForm<CreateUserValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { username: '', displayName: '', role: 'staff', password: '' },
  });
  const create = useMutation({
    mutationFn: (v: CreateUserValues) => api.post<UserRow>('/api/users', v),
    onSuccess: (u) => {
      void qc.invalidateQueries({ queryKey: usersKey });
      toast.success(`${u.displayName} can now sign in as ${u.username}`);
      form.reset();
      onOpenChange(false);
    },
    onError: (err) => applyServerErrors(form.setError, err),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) form.reset();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <form
          noValidate
          onSubmit={form.handleSubmit((v) => create.mutate(v))}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              Staff can run bookings and check equipment in and out. Admins can also manage settings
              and users.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <FormField
              control={form.control}
              name="displayName"
              label="Name"
              render={({ field }) => <Input {...field} autoFocus />}
            />
            <FormField
              control={form.control}
              name="username"
              label="Username"
              render={({ field }) => <Input {...field} autoCapitalize="none" autoComplete="off" />}
            />
            <FormField
              control={form.control}
              name="role"
              label="Role"
              render={({ field }) => (
                <RoleSelect id={field.id} value={field.value} onChange={field.onChange} />
              )}
            />
            <FormField
              control={form.control}
              name="password"
              label="Temporary password"
              description="At least 10 characters. Share it with them privately."
              render={({ field }) => (
                <Input {...field} type="password" autoComplete="new-password" />
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />} Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditUserDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const isSelf = me?.user.id === user.id;
  const form = useForm<EditUserValues>({
    resolver: zodResolver(editUserFormSchema),
    defaultValues: {
      displayName: user.displayName,
      role: user.role,
      active: user.active,
      password: '',
    },
  });
  const update = useMutation({
    mutationFn: (v: EditUserValues) =>
      api.patch<UserRow>(`/api/users/${user.id}`, {
        displayName: v.displayName,
        role: v.role,
        active: v.active,
        ...(v.password ? { password: v.password } : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: usersKey });
      toast.success('User updated');
      onClose();
    },
    onError: (err) => applyServerErrors(form.setError, err),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form
          noValidate
          onSubmit={form.handleSubmit((v) => update.mutate(v))}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Edit {user.displayName}</DialogTitle>
            <DialogDescription>Username: {user.username}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <FormField
              control={form.control}
              name="displayName"
              label="Name"
              render={({ field }) => <Input {...field} />}
            />
            <FormField
              control={form.control}
              name="role"
              label="Role"
              description={isSelf ? 'You cannot remove your own admin role.' : undefined}
              render={({ field }) => (
                <RoleSelect
                  id={field.id}
                  value={field.value}
                  onChange={field.onChange}
                  disabled={isSelf}
                />
              )}
            />
            <FormField
              control={form.control}
              name="active"
              label="Active"
              orientation="horizontal"
              description={
                isSelf
                  ? 'You cannot deactivate yourself.'
                  : 'Inactive users are signed out and cannot sign in.'
              }
              render={({ field }) => (
                <Switch
                  id={field.id}
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  disabled={isSelf}
                  aria-describedby={field['aria-describedby']}
                />
              )}
            />
            <FormField
              control={form.control}
              name="password"
              label="Reset password"
              description="Leave blank to keep the current password. Resetting signs them out everywhere."
              render={({ field }) => (
                <Input {...field} type="password" autoComplete="new-password" />
              )}
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={update.isPending}>
              {update.isPending && <Spinner />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
