import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { centsToDollars, dollarsToCents, formatCents } from '@disco/shared';
import { MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useForm, useWatch, type FieldPath } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { DataTable, columnHelper } from '@/components/data-table';
import { FormField, applyServerErrors } from '@/components/form';
import { MoneyInput } from '@/components/money-input';
import { NumberInput } from '@/components/number-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FieldDescription, FieldGroup, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api';
import { useIsAdmin } from '@/lib/auth';
import { dollars, wholeNumber } from '@/lib/form-schemas';
import {
  packagesKey,
  useEquipment,
  usePackages,
  type EquipmentType,
  type RentalPackage,
} from '@/lib/inventory';

const itemsSummary = (p: RentalPackage) =>
  p.items.map((i) => `${i.quantity} × ${i.equipmentName}`).join(', ');

const h = columnHelper<RentalPackage>();
function buildColumns(opts: {
  isAdmin: boolean;
  onEdit: (p: RentalPackage) => void;
  onToggle: (p: RentalPackage) => void;
}) {
  return [
    h.accessor('name', {
      header: 'Package',
      enableHiding: false,
      cell: ({ row }) => (
        <div className="min-w-40">
          <div className="font-medium">{row.original.name}</div>
          <div className="text-muted-foreground text-xs">{itemsSummary(row.original)}</div>
        </div>
      ),
    }),
    h.accessor('priceCents', {
      header: 'Price',
      cell: (info) => <span className="tabular-nums">{formatCents(info.getValue())}</span>,
    }),
    h.accessor('includedDays', {
      header: 'Included days',
      cell: (info) => `${info.getValue()} ${info.getValue() === 1 ? 'day' : 'days'}`,
    }),
    h.accessor('extraDayPriceCents', {
      header: 'Extra day',
      cell: (info) => <span className="tabular-nums">{formatCents(info.getValue())}</span>,
    }),
    h.accessor((p) => (p.active ? 'active' : 'inactive'), {
      id: 'status',
      header: 'Status',
      filterFn: 'equalsString',
      cell: (info) =>
        info.getValue() === 'active' ? (
          <Badge variant="outline">Active</Badge>
        ) : (
          <Badge variant="secondary">Inactive</Badge>
        ),
    }),
    ...(opts.isAdmin
      ? [
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
                    aria-label={`Actions for ${row.original.name}`}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                  <DropdownMenuItem onSelect={() => opts.onEdit(row.original)}>
                    Edit package
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => opts.onToggle(row.original)}>
                    {row.original.active ? 'Deactivate' : 'Reactivate'}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ),
          }),
        ]
      : []),
  ];
}

export function PackagesTab() {
  const isAdmin = useIsAdmin();
  const packages = usePackages();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<RentalPackage | 'new' | null>(null);
  const toggle = useMutation({
    mutationFn: (p: RentalPackage) =>
      api.patch<RentalPackage>(`/api/packages/${p.id}/active`, { active: !p.active }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: packagesKey });
      toast.success(p.active ? `${p.name} is available for quotes again` : `${p.name} deactivated`);
    },
    onError: (err) => toast.error(err.message),
  });
  const columns = useMemo(
    () => buildColumns({ isAdmin, onEdit: setEditing, onToggle: (p) => toggle.mutate(p) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toggle.mutate is stable
    [isAdmin],
  );

  return (
    <>
      <DataTable
        label="Rental packages"
        columns={columns}
        data={packages.data}
        isLoading={packages.isPending}
        searchPlaceholder="Search packages…"
        emptyMessage="No packages yet. Packages are what customers rent, like 50 headphones and a transmitter."
        getRowId={(p) => p.id}
        initialSorting={[{ id: 'priceCents', desc: false }]}
        onRowClick={setEditing}
        filters={[
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
          isAdmin && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus /> New package
            </Button>
          )
        }
      />
      {editing && (
        <PackageEditor
          pkg={editing === 'new' ? null : editing}
          readOnly={!isAdmin}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export const packageFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  description: z.string().trim().max(2000),
  price: dollars('a price'),
  includedDays: wholeNumber('a number of days', 1, 60),
  extraDayPrice: dollars(),
  active: z.boolean(),
  items: z
    .array(
      z.object({
        equipmentTypeId: z.string().min(1, 'Choose equipment'),
        quantity: wholeNumber('a quantity', 1, 100_000),
        lossFee: dollars().nullable(),
      }),
    )
    .min(1, 'Add at least one item'),
});
export type PackageFormValues = z.infer<typeof packageFormSchema>;

function toFormValues(p: RentalPackage | null, equipment: EquipmentType[]): PackageFormValues {
  if (!p) {
    return {
      name: '',
      description: '',
      price: null as unknown as number,
      includedDays: 1,
      extraDayPrice: 0,
      active: true,
      items: equipment.length
        ? [
            {
              equipmentTypeId: equipment[0]!.id,
              quantity: null as unknown as number,
              lossFee: null,
            },
          ]
        : [],
    };
  }
  return {
    name: p.name,
    description: p.description ?? '',
    price: centsToDollars(p.priceCents),
    includedDays: p.includedDays,
    extraDayPrice: centsToDollars(p.extraDayPriceCents),
    active: p.active,
    items: p.items.map((i) => ({
      equipmentTypeId: i.equipmentTypeId,
      quantity: i.quantity,
      lossFee: i.lossFeeCents === null ? null : centsToDollars(i.lossFeeCents),
    })),
  };
}

export function toPackageBody(v: PackageFormValues) {
  return {
    name: v.name,
    description: v.description || null,
    priceCents: dollarsToCents(v.price),
    includedDays: v.includedDays,
    extraDayPriceCents: dollarsToCents(v.extraDayPrice),
    active: v.active,
    items: v.items.map((i) => ({
      equipmentTypeId: i.equipmentTypeId,
      quantity: i.quantity,
      lossFeeCents: i.lossFee === null ? null : dollarsToCents(i.lossFee),
    })),
  };
}

const SERVER_FIELDS: Record<string, string> = {
  priceCents: 'price',
  extraDayPriceCents: 'extraDayPrice',
};
/** Maps server field names (cents) to form field names (dollars). */
function serverFieldMap(err: unknown) {
  const keys = err instanceof ApiError ? Object.keys(err.fieldErrors) : [];
  return Object.fromEntries(
    keys.map((k) => [
      k,
      SERVER_FIELDS[k] ?? k.replace(/^items\.(\d+)\.lossFeeCents$/, 'items.$1.lossFee'),
    ]),
  ) as Record<string, FieldPath<PackageFormValues>>;
}

function PackageEditor({
  pkg,
  readOnly,
  onClose,
}: {
  pkg: RentalPackage | null;
  readOnly: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const equipment = useEquipment().data ?? [];
  const form = useForm<PackageFormValues>({
    resolver: zodResolver(packageFormSchema),
    defaultValues: toFormValues(pkg, equipment),
  });
  const items = useFieldArray({ control: form.control, name: 'items' });
  const watchedItems = useWatch({ control: form.control, name: 'items' });
  const save = useMutation({
    mutationFn: (v: PackageFormValues) =>
      pkg
        ? api.put<RentalPackage>(`/api/packages/${pkg.id}`, toPackageBody(v))
        : api.post<RentalPackage>('/api/packages', toPackageBody(v)),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: packagesKey });
      toast.success(pkg ? `${p.name} saved` : `${p.name} created`);
      onClose();
    },
    onError: (err) => applyServerErrors(form.setError, err, serverFieldMap(err)),
  });
  const usedTypeIds = new Set(watchedItems.map((i) => i.equipmentTypeId));
  const nextType = equipment.find((t) => !usedTypeIds.has(t.id));
  const itemsError =
    form.formState.errors.items?.root?.message ?? form.formState.errors.items?.message;

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <form
          noValidate
          onSubmit={form.handleSubmit((v) => save.mutate(v))}
          className="flex h-full min-h-0 flex-col"
        >
          <SheetHeader>
            <SheetTitle>
              {pkg ? (readOnly ? pkg.name : `Edit ${pkg.name}`) : 'New package'}
            </SheetTitle>
            <SheetDescription>
              {readOnly
                ? 'Only admins can change packages.'
                : 'What customers rent. Deactivated packages stay on existing quotes and bookings.'}
            </SheetDescription>
          </SheetHeader>
          <fieldset disabled={readOnly} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <FieldGroup>
              <FormField
                control={form.control}
                name="name"
                label="Name"
                render={({ field }) => (
                  <Input {...field} autoFocus={!readOnly} placeholder="Party 50" />
                )}
              />
              <FormField
                control={form.control}
                name="description"
                label="Description"
                render={({ field }) => <Textarea {...field} rows={2} placeholder="Optional" />}
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="price"
                  label="Price"
                  render={({ field }) => <MoneyInput {...field} />}
                />
                <FormField
                  control={form.control}
                  name="includedDays"
                  label="Included days"
                  render={({ field }) => (
                    <NumberInput {...field} min={1} step={1} inputMode="numeric" />
                  )}
                />
                <FormField
                  control={form.control}
                  name="extraDayPrice"
                  label="Per extra day"
                  render={({ field }) => <MoneyInput {...field} />}
                />
              </div>

              <FieldSet>
                <FieldLegend variant="label">Included equipment</FieldLegend>
                <FieldDescription>
                  Loss fees apply per item not returned. Leave blank to use the equipment default.
                </FieldDescription>
                <ul className="grid gap-3" aria-label="Included equipment">
                  {items.fields.map((item, index) => {
                    const type = equipment.find(
                      (t) => t.id === watchedItems[index]?.equipmentTypeId,
                    );
                    const qty = watchedItems[index]?.quantity;
                    return (
                      <li key={item.id} className="grid gap-3 rounded-md border p-3">
                        <div className="flex items-start gap-2">
                          <FormField
                            control={form.control}
                            name={`items.${index}.equipmentTypeId`}
                            label="Equipment"
                            render={({ field }) => (
                              <Select
                                value={field.value}
                                onValueChange={field.onChange}
                                disabled={readOnly}
                              >
                                <SelectTrigger
                                  id={field.id}
                                  className="w-full"
                                  aria-invalid={field['aria-invalid']}
                                >
                                  <SelectValue placeholder="Choose equipment" />
                                </SelectTrigger>
                                <SelectContent>
                                  {equipment.map((t) => (
                                    <SelectItem
                                      key={t.id}
                                      value={t.id}
                                      disabled={t.id !== field.value && usedTypeIds.has(t.id)}
                                    >
                                      {t.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                          {!readOnly && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="mt-6 shrink-0"
                              aria-label={`Remove ${type?.name ?? 'item'}`}
                              onClick={() => items.remove(index)}
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <FormField
                            control={form.control}
                            name={`items.${index}.quantity`}
                            label="Quantity"
                            description={
                              type && typeof qty === 'number' && qty > type.owned
                                ? `You own only ${type.owned}.`
                                : undefined
                            }
                            render={({ field }) => (
                              <NumberInput {...field} min={1} step={1} inputMode="numeric" />
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`items.${index}.lossFee`}
                            label="Loss fee each"
                            render={({ field }) => (
                              <MoneyInput
                                {...field}
                                placeholder={
                                  type
                                    ? `${centsToDollars(type.lossFeeCents)} (default)`
                                    : undefined
                                }
                              />
                            )}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {itemsError && (
                  <p role="alert" className="text-destructive text-sm">
                    {itemsError}
                  </p>
                )}
                {!readOnly && nextType && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-self-start"
                    onClick={() =>
                      items.append({
                        equipmentTypeId: nextType.id,
                        quantity: null as unknown as number,
                        lossFee: null,
                      })
                    }
                  >
                    <Plus /> Add equipment
                  </Button>
                )}
              </FieldSet>

              <FormField
                control={form.control}
                name="active"
                label="Available for new quotes"
                orientation="horizontal"
                description="Turn off to retire a package without affecting existing quotes."
                render={({ field }) => (
                  <Switch
                    id={field.id}
                    checked={field.value}
                    onCheckedChange={field.onChange}
                    disabled={readOnly}
                    aria-describedby={field['aria-describedby']}
                  />
                )}
              />
            </FieldGroup>
          </fieldset>
          <SheetFooter className="border-t sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Spinner />} {pkg ? 'Save package' : 'Create package'}
              </Button>
            )}
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
