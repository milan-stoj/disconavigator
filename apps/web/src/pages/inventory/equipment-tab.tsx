import { Fragment, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ADJUSTMENT_REASONS,
  centsToDollars,
  dollarsToCents,
  formatCents,
  TRACKING_MODES,
} from '@disco/shared';
import { History, MoreHorizontal, Pencil, Plus, Wrench } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormField, applyServerErrors } from '@/components/form';
import { FormDialog } from '@/components/form-dialog';
import { NumberInput } from '@/components/number-input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupText } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useIsAdmin } from '@/lib/auth';
import { dollars, wholeNumber } from '@/lib/form-schemas';
import {
  ADDING_REASONS,
  ADJUSTMENT_REASON_LABELS,
  adjustmentsKey,
  equipmentKey,
  formatDateTime,
  UNIT_STATUS_LABELS,
  useEquipment,
  type AdjustmentReason,
  type EquipmentType,
  type EquipmentUnit,
  type InventoryAdjustment,
  type UnitStatus,
} from '@/lib/inventory';

function useEquipmentMutation<V>(
  fn: (v: V) => Promise<EquipmentType>,
  opts: { success: string; onDone: () => void; onError?: (err: unknown) => void },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (type) => {
      qc.setQueryData<EquipmentType[]>(equipmentKey, (list) =>
        list?.some((t) => t.id === type.id)
          ? list.map((t) => (t.id === type.id ? type : t))
          : [...(list ?? []), type],
      );
      void qc.invalidateQueries({ queryKey: equipmentKey });
      toast.success(opts.success);
      opts.onDone();
    },
    onError: opts.onError,
  });
}

type DialogState =
  | { kind: 'create' }
  | { kind: 'edit'; type: EquipmentType }
  | { kind: 'adjust'; type: EquipmentType }
  | { kind: 'out-of-service'; type: EquipmentType }
  | { kind: 'add-unit'; type: EquipmentType }
  | { kind: 'unit-status'; type: EquipmentType; unit: EquipmentUnit; status: UnitStatus }
  | { kind: 'history'; type: EquipmentType };

export function EquipmentTab() {
  const isAdmin = useIsAdmin();
  const equipment = useEquipment();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const close = () => setDialog(null);

  return (
    <div className="grid gap-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'create' })}>
            <Plus /> Add equipment type
          </Button>
        </div>
      )}
      {equipment.isPending ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : equipment.data?.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Wrench />
            </EmptyMedia>
            <EmptyTitle>No equipment yet</EmptyTitle>
            <EmptyDescription>Add the headphones and transmitters you own.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {equipment.data?.map((type) => (
            <EquipmentCard key={type.id} type={type} isAdmin={isAdmin} onOpen={setDialog} />
          ))}
        </div>
      )}

      {dialog?.kind === 'create' && <EquipmentTypeDialog onClose={close} />}
      {dialog?.kind === 'edit' && <EquipmentTypeDialog type={dialog.type} onClose={close} />}
      {dialog?.kind === 'adjust' && <AdjustDialog type={dialog.type} onClose={close} />}
      {dialog?.kind === 'out-of-service' && (
        <OutOfServiceDialog type={dialog.type} onClose={close} />
      )}
      {dialog?.kind === 'add-unit' && <AddUnitDialog type={dialog.type} onClose={close} />}
      {dialog?.kind === 'unit-status' && (
        <UnitStatusDialog unit={dialog.unit} status={dialog.status} onClose={close} />
      )}
      <HistorySheet type={dialog?.kind === 'history' ? dialog.type : null} onClose={close} />
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="bg-muted/50 rounded-md px-3 py-2">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={`text-2xl font-semibold tabular-nums ${warn && value > 0 ? 'text-amber-600 dark:text-amber-400' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

function UnitBadge({ status }: { status: UnitStatus }) {
  const variant =
    status === 'in_service' ? 'outline' : status === 'out_of_service' ? 'secondary' : 'destructive';
  return <Badge variant={variant}>{UNIT_STATUS_LABELS[status]}</Badge>;
}

function EquipmentCard({
  type,
  isAdmin,
  onOpen,
}: {
  type: EquipmentType;
  isAdmin: boolean;
  onOpen: (d: DialogState) => void;
}) {
  const pooled = type.trackingMode === 'pooled';
  return (
    <Card role="region" aria-labelledby={`equipment-${type.id}`}>
      <CardHeader>
        <CardTitle>
          <h2 id={`equipment-${type.id}`}>{type.name}</h2>
        </CardTitle>
        <CardDescription>
          {pooled ? 'Pooled quantity' : 'Individually tracked units'} ·{' '}
          {formatCents(type.lossFeeCents)} loss fee
        </CardDescription>
        <CardAction>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${type.name}`}>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onOpen({ kind: 'history', type })}>
                <History /> View history
              </DropdownMenuItem>
              {isAdmin && (
                <DropdownMenuItem onSelect={() => onOpen({ kind: 'edit', type })}>
                  <Pencil /> Edit details
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <dl className="grid grid-cols-3 gap-2">
          <Stat label="Owned" value={type.owned} />
          <Stat label="In service" value={type.inService} />
          <Stat label="Out of service" value={type.outOfService} warn />
        </dl>
        {!pooled && <UnitList type={type} isAdmin={isAdmin} onOpen={onOpen} />}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        {pooled ? (
          <>
            {isAdmin && (
              <Button size="sm" onClick={() => onOpen({ kind: 'adjust', type })}>
                Adjust quantity
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpen({ kind: 'out-of-service', type })}
            >
              Set out of service
            </Button>
          </>
        ) : (
          isAdmin && (
            <Button size="sm" onClick={() => onOpen({ kind: 'add-unit', type })}>
              <Plus /> Add unit
            </Button>
          )
        )}
      </CardFooter>
    </Card>
  );
}

const isOwnedStatus = (s: UnitStatus) => s === 'in_service' || s === 'out_of_service';

function unitActions(unit: EquipmentUnit, isAdmin: boolean) {
  if (!isOwnedStatus(unit.status)) {
    return isAdmin ? [{ status: 'in_service' as const, label: 'Restore to service' }] : [];
  }
  const actions: { status: UnitStatus; label: string }[] = [
    unit.status === 'in_service'
      ? { status: 'out_of_service', label: 'Mark out of service' }
      : { status: 'in_service', label: 'Return to service' },
  ];
  if (isAdmin) {
    actions.push({ status: 'retired', label: 'Retire' }, { status: 'lost', label: 'Mark lost' });
  }
  return actions;
}

function UnitList({
  type,
  isAdmin,
  onOpen,
}: {
  type: EquipmentType;
  isAdmin: boolean;
  onOpen: (d: DialogState) => void;
}) {
  if (type.units.length === 0) {
    return <p className="text-muted-foreground text-sm">No units yet.</p>;
  }
  return (
    <ul className="divide-y rounded-md border" aria-label={`${type.name} units`}>
      {type.units.map((unit) => {
        const actions = unitActions(unit, isAdmin);
        return (
          <li key={unit.id} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
            <span
              className={`font-medium ${isOwnedStatus(unit.status) ? '' : 'text-muted-foreground line-through'}`}
            >
              {unit.label}
            </span>
            <UnitBadge status={unit.status} />
            {actions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto"
                    aria-label={`Actions for ${unit.label}`}
                  >
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {actions.map((a, i) => (
                    <Fragment key={a.status}>
                      {i === 1 && <DropdownMenuSeparator />}
                      <DropdownMenuItem
                        variant={
                          a.status === 'retired' || a.status === 'lost' ? 'destructive' : 'default'
                        }
                        onSelect={() =>
                          onOpen({ kind: 'unit-status', type, unit, status: a.status })
                        }
                      >
                        {a.label}
                      </DropdownMenuItem>
                    </Fragment>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const noteSchema = z.string().trim().max(2000);

const typeFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  trackingMode: z.enum(TRACKING_MODES),
  lossFee: dollars(),
});
type TypeFormValues = z.infer<typeof typeFormSchema>;

function EquipmentTypeDialog({ type, onClose }: { type?: EquipmentType; onClose: () => void }) {
  const form = useForm<TypeFormValues>({
    resolver: zodResolver(typeFormSchema),
    defaultValues: {
      name: type?.name ?? '',
      trackingMode: type?.trackingMode ?? 'pooled',
      lossFee: type ? centsToDollars(type.lossFeeCents) : 0,
    },
  });
  const save = useEquipmentMutation(
    (v: TypeFormValues) => {
      const body = { name: v.name, lossFeeCents: dollarsToCents(v.lossFee) };
      return type
        ? api.patch<EquipmentType>(`/api/equipment/${type.id}`, body)
        : api.post<EquipmentType>('/api/equipment', { ...body, trackingMode: v.trackingMode });
    },
    {
      success: type ? 'Equipment updated' : 'Equipment type added',
      onDone: onClose,
      onError: (err) => applyServerErrors(form.setError, err, { lossFeeCents: 'lossFee' }),
    },
  );
  return (
    <FormDialog
      title={type ? `Edit ${type.name}` : 'Add equipment type'}
      description="The loss fee is charged when an item is not returned or comes back damaged. Packages can override it."
      onClose={onClose}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={type ? 'Save' : 'Add equipment type'}
    >
      <FormField
        control={form.control}
        name="name"
        label="Name"
        render={({ field }) => <Input {...field} autoFocus />}
      />
      {!type && (
        <FormField
          control={form.control}
          name="trackingMode"
          label="Tracking"
          render={({ field }) => (
            <RadioGroup
              id={field.id}
              value={field.value}
              onValueChange={field.onChange}
              className="grid gap-2"
            >
              <Label className="flex items-start gap-2 font-normal">
                <RadioGroupItem value="pooled" />
                <span>
                  <span className="font-medium">Pooled quantity</span>
                  <span className="text-muted-foreground block text-sm">
                    Interchangeable items counted in bulk, like headphones.
                  </span>
                </span>
              </Label>
              <Label className="flex items-start gap-2 font-normal">
                <RadioGroupItem value="serialized" />
                <span>
                  <span className="font-medium">Individual units</span>
                  <span className="text-muted-foreground block text-sm">
                    Each item has a label, like transmitters TX-1 to TX-3.
                  </span>
                </span>
              </Label>
            </RadioGroup>
          )}
        />
      )}
      <FormField
        control={form.control}
        name="lossFee"
        label="Default loss fee"
        render={({ field }) => (
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <NumberInput {...field} min={0} step={0.01} grouped />
          </InputGroup>
        )}
      />
    </FormDialog>
  );
}

const adjustFormSchema = z.object({
  reason: z.enum(ADJUSTMENT_REASONS, 'Choose a reason'),
  quantity: wholeNumber('a quantity', 1, 100_000),
  note: noteSchema,
});
type AdjustFormValues = z.infer<typeof adjustFormSchema>;

function AdjustDialog({ type, onClose }: { type: EquipmentType; onClose: () => void }) {
  const form = useForm<AdjustFormValues>({
    resolver: zodResolver(adjustFormSchema),
    defaultValues: { reason: 'purchase', quantity: null as unknown as number, note: '' },
  });
  const reason = useWatch({ control: form.control, name: 'reason' });
  const adds = ADDING_REASONS.includes(reason);
  const save = useEquipmentMutation(
    (v: AdjustFormValues) =>
      api.post<EquipmentType>(`/api/equipment/${type.id}/adjustments`, {
        reason: v.reason,
        delta: ADDING_REASONS.includes(v.reason) ? v.quantity : -v.quantity,
        note: v.note || null,
      }),
    {
      success: `${type.name} updated`,
      onDone: onClose,
      onError: (err) => applyServerErrors(form.setError, err, { delta: 'quantity' }),
    },
  );
  return (
    <FormDialog
      title={`Adjust ${type.name.toLowerCase()}`}
      description={`You own ${type.owned}. Record purchases and items found, or remove items that were retired, lost, or damaged beyond repair.`}
      onClose={onClose}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={adds ? 'Add to inventory' : 'Remove from inventory'}
      destructive={!adds}
    >
      <FormField
        control={form.control}
        name="reason"
        label="Reason"
        render={({ field }) => (
          <Select value={field.value} onValueChange={(v) => field.onChange(v as AdjustmentReason)}>
            <SelectTrigger id={field.id} className="w-full" aria-invalid={field['aria-invalid']}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ADJUSTMENT_REASONS.map((r) => (
                <SelectItem key={r} value={r}>
                  {ADJUSTMENT_REASON_LABELS[r]} ({ADDING_REASONS.includes(r) ? 'adds' : 'removes'})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      <FormField
        control={form.control}
        name="quantity"
        label={adds ? 'Quantity to add' : 'Quantity to remove'}
        render={({ field }) => (
          <NumberInput {...field} min={1} step={1} inputMode="numeric" autoFocus />
        )}
      />
      <FormField
        control={form.control}
        name="note"
        label="Note"
        render={({ field }) => <Textarea {...field} rows={2} placeholder="Optional" />}
      />
    </FormDialog>
  );
}

function OutOfServiceDialog({ type, onClose }: { type: EquipmentType; onClose: () => void }) {
  const schema = z.object({
    quantity: wholeNumber('a quantity', 0, type.owned),
    note: noteSchema,
  });
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { quantity: type.outOfService, note: '' },
  });
  const save = useEquipmentMutation(
    (v: Values) =>
      api.put<EquipmentType>(`/api/equipment/${type.id}/out-of-service`, {
        quantity: v.quantity,
        note: v.note || null,
      }),
    {
      success: `${type.name} updated`,
      onDone: onClose,
      onError: (err) => applyServerErrors(form.setError, err),
    },
  );
  return (
    <FormDialog
      title={`${type.name} out of service`}
      description="Items out of service, for example not charging or in repair, are excluded from availability until you return them to service."
      onClose={onClose}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel="Save"
    >
      <FormField
        control={form.control}
        name="quantity"
        label="Number out of service"
        description={`Of ${type.owned} owned. Set to 0 when everything is back in service.`}
        render={({ field }) => (
          <NumberInput {...field} min={0} max={type.owned} step={1} inputMode="numeric" autoFocus />
        )}
      />
      <FormField
        control={form.control}
        name="note"
        label="Note"
        render={({ field }) => <Textarea {...field} rows={2} placeholder="What's wrong?" />}
      />
    </FormDialog>
  );
}

const unitFormSchema = z.object({
  label: z.string().trim().min(1, 'Label is required').max(50),
  notes: noteSchema,
});
type UnitFormValues = z.infer<typeof unitFormSchema>;

function AddUnitDialog({ type, onClose }: { type: EquipmentType; onClose: () => void }) {
  const form = useForm<UnitFormValues>({
    resolver: zodResolver(unitFormSchema),
    defaultValues: { label: '', notes: '' },
  });
  const save = useEquipmentMutation(
    (v: UnitFormValues) =>
      api.post<EquipmentType>(`/api/equipment/${type.id}/units`, {
        label: v.label,
        notes: v.notes || null,
      }),
    {
      success: 'Unit added',
      onDone: onClose,
      onError: (err) => applyServerErrors(form.setError, err),
    },
  );
  return (
    <FormDialog
      title={`Add ${type.name.toLowerCase()} unit`}
      description="Adding a unit records it as purchased."
      onClose={onClose}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel="Add unit"
    >
      <FormField
        control={form.control}
        name="label"
        label="Label or serial number"
        render={({ field }) => <Input {...field} autoFocus placeholder="TX-4" />}
      />
      <FormField
        control={form.control}
        name="notes"
        label="Notes"
        render={({ field }) => <Textarea {...field} rows={2} placeholder="Optional" />}
      />
    </FormDialog>
  );
}

const STATUS_COPY: Record<UnitStatus, { title: string; description: string; submit: string }> = {
  out_of_service: {
    title: 'Mark out of service',
    description: 'It will be excluded from availability until it is returned to service.',
    submit: 'Mark out of service',
  },
  in_service: {
    title: 'Return to service',
    description: 'It will count toward availability again.',
    submit: 'Return to service',
  },
  retired: {
    title: 'Retire unit',
    description: 'It will no longer count toward capacity but stays in history.',
    submit: 'Retire',
  },
  lost: {
    title: 'Mark unit lost',
    description: 'It will no longer count toward capacity but stays in history.',
    submit: 'Mark lost',
  },
};

function UnitStatusDialog({
  unit,
  status,
  onClose,
}: {
  unit: EquipmentUnit;
  status: UnitStatus;
  onClose: () => void;
}) {
  const form = useForm<{ note: string }>({
    resolver: zodResolver(z.object({ note: noteSchema })),
    defaultValues: { note: '' },
  });
  const copy = STATUS_COPY[status];
  const save = useEquipmentMutation(
    (v: { note: string }) =>
      api.put<EquipmentType>(`/api/equipment-units/${unit.id}/status`, {
        status,
        note: v.note || null,
      }),
    {
      success: `${unit.label}: ${UNIT_STATUS_LABELS[status].toLowerCase()}`,
      onDone: onClose,
      onError: (err) => applyServerErrors(form.setError, err),
    },
  );
  return (
    <FormDialog
      title={`${copy.title}: ${unit.label}`}
      description={copy.description}
      onClose={onClose}
      onSubmit={form.handleSubmit((v) => save.mutate(v))}
      pending={save.isPending}
      submitLabel={copy.submit}
      destructive={status === 'retired' || status === 'lost'}
    >
      <FormField
        control={form.control}
        name="note"
        label="Note"
        render={({ field }) => <Textarea {...field} rows={2} placeholder="Optional" autoFocus />}
      />
    </FormDialog>
  );
}

const SERVICE_REASONS = new Set(['out_of_service', 'returned_to_service']);

function HistorySheet({ type, onClose }: { type: EquipmentType | null; onClose: () => void }) {
  const history = useQuery({
    queryKey: adjustmentsKey(type?.id ?? ''),
    queryFn: () => api.get<InventoryAdjustment[]>(`/api/equipment/${type!.id}/adjustments`),
    enabled: !!type,
  });
  return (
    <Sheet open={!!type} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{type?.name} history</SheetTitle>
          <SheetDescription>Purchases, removals, and service changes.</SheetDescription>
        </SheetHeader>
        <div className="overflow-y-auto px-4 pb-4">
          {history.isPending ? (
            <Skeleton className="h-32" />
          ) : history.data?.length === 0 ? (
            <p className="text-muted-foreground text-sm">No changes recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.data?.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="align-top whitespace-nowrap">
                      {formatDateTime(a.createdAt)}
                      {a.userName && (
                        <span className="text-muted-foreground block text-xs">{a.userName}</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top whitespace-normal">
                      {ADJUSTMENT_REASON_LABELS[a.reason] ?? a.reason}
                      {a.unitLabel && ` · ${a.unitLabel}`}
                      {a.note && (
                        <span className="text-muted-foreground block text-xs">{a.note}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right align-top tabular-nums">
                      {SERVICE_REASONS.has(a.reason)
                        ? a.unitId
                          ? '—'
                          : a.delta
                        : a.delta > 0
                          ? `+${a.delta}`
                          : a.delta}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
