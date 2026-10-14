import { useState } from 'react';
import { formatCents } from '@disco/shared';
import { PackageCheck, PackageOpen, Search } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { useRecordFound, type Booking, type EquipmentRecord } from '@/lib/bookings';
import { formatDateTime } from '@/lib/inventory';
import { Stepper } from './equipment-flow-pages';

const recordLine = (verb: string, r: EquipmentRecord) =>
  `${verb} ${formatDateTime(r.at)}${r.by ? ` by ${r.by}` : ''}`;

export function EquipmentTab({ booking: b }: { booking: Booking }) {
  const [found, setFound] = useState(false);
  const eq = b.equipment;
  const started = !!eq.checkedOut;
  const missing = eq.lines.filter((l) => l.missing > 0);
  const canCheckOut = b.status === 'confirmed' && b.requirements.length > 0;
  const canCheckIn = b.status === 'out';

  return (
    <div className="grid gap-4">
      {b.overdue && (
        <Alert variant="destructive">
          <AlertTitle>The equipment is overdue</AlertTitle>
          <AlertDescription>
            It should have been back by now. Check it in once it is.
          </AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader className="flex flex-wrap items-start justify-between gap-2">
          <div className="grid gap-1">
            <CardTitle>
              <h2>Equipment</h2>
            </CardTitle>
            {(eq.checkedOut || eq.checkedIn) && (
              <CardDescription className="grid">
                {eq.checkedOut && <span>{recordLine('Checked out', eq.checkedOut)}</span>}
                {eq.checkedIn && <span>{recordLine('Checked in', eq.checkedIn)}</span>}
              </CardDescription>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canCheckOut && (
              <Button asChild>
                <Link to={`/bookings/${b.id}/check-out`}>
                  <PackageOpen /> Check out
                </Link>
              </Button>
            )}
            {canCheckIn && (
              <Button asChild>
                <Link to={`/bookings/${b.id}/check-in`}>
                  <PackageCheck /> Check in
                </Link>
              </Button>
            )}
            {missing.length > 0 && (
              <Button variant="outline" onClick={() => setFound(true)}>
                <Search /> Record found items
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          {eq.lines.length === 0 ? (
            <p className="text-muted-foreground text-sm">No equipment on this booking.</p>
          ) : (
            <Table aria-label="Equipment">
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Booked</TableHead>
                  {started && <TableHead className="text-right">Out</TableHead>}
                  {eq.checkedIn && (
                    <>
                      <TableHead className="text-right">Returned</TableHead>
                      <TableHead className="text-right">Damaged</TableHead>
                      <TableHead className="text-right">Missing</TableHead>
                    </>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {eq.lines.map((l) => (
                  <TableRow key={l.equipmentTypeId}>
                    <TableCell>
                      {l.name}
                      {l.units.length > 0 && (
                        <span className="text-muted-foreground block text-xs">
                          {l.units
                            .map(
                              (u) =>
                                `${u.label}${u.missing ? ' (missing)' : u.damaged ? ' (damaged)' : ''}`,
                            )
                            .join(', ')}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.required}</TableCell>
                    {started && (
                      <TableCell className="text-right tabular-nums">{l.checkedOut}</TableCell>
                    )}
                    {eq.checkedIn && (
                      <>
                        <TableCell className="text-right tabular-nums">{l.returned}</TableCell>
                        <TableCell className="text-right tabular-nums">{l.damaged}</TableCell>
                        <TableCell
                          className={
                            l.missing > 0
                              ? 'text-destructive text-right font-medium tabular-nums'
                              : 'text-right tabular-nums'
                          }
                        >
                          {l.missing}
                          {l.found > 0 && (
                            <span className="text-muted-foreground block text-xs font-normal">
                              {l.found} found later
                            </span>
                          )}
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {(eq.checkedOut?.note || eq.checkedIn?.note) && (
            <div className="text-muted-foreground grid gap-1 text-sm">
              {eq.checkedOut?.note && <p>Check-out note: {eq.checkedOut.note}</p>}
              {eq.checkedIn?.note && <p>Check-in note: {eq.checkedIn.note}</p>}
            </div>
          )}
        </CardContent>
      </Card>
      {eq.corrections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Found after check-in</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2 text-sm" aria-label="Found items">
              {eq.corrections.map((c) => (
                <li key={c.at + c.items.map((i) => i.equipmentTypeId).join()}>
                  <span className="font-medium">
                    {c.items
                      .map((i) =>
                        i.unitLabel ? i.unitLabel : `${i.quantity} ${i.name.toLowerCase()}`,
                      )
                      .join(', ')}
                  </span>
                  <span className="text-muted-foreground">
                    {' · '}
                    {recordLine('Recorded', c)}
                    {c.note && ` · ${c.note}`}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {found && <FoundDialog booking={b} onClose={() => setFound(false)} />}
    </div>
  );
}

function FoundDialog({ booking: b, onClose }: { booking: Booking; onClose: () => void }) {
  const record = useRecordFound(b.id);
  const missing = b.equipment.lines.filter((l) => l.missing > 0);
  const [typeId, setTypeId] = useState(missing[0]?.equipmentTypeId ?? '');
  const line = missing.find((l) => l.equipmentTypeId === typeId);
  const [quantity, setQuantity] = useState(1);
  const [unitIds, setUnitIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const serialized = line?.trackingMode === 'serialized';
  const missingUnits = line?.units.filter((u) => u.missing) ?? [];
  const isRental = b.bookingType === 'equipment_rental';

  return (
    <FormDialog
      title="Record found items"
      description={
        isRental
          ? 'Found items go back into inventory and reduce the proposed loss charge.'
          : 'Found items go back into inventory.'
      }
      submitLabel="Record found"
      pending={record.isPending}
      onClose={onClose}
      onSubmit={(e) => {
        e.preventDefault();
        setErrors({});
        record.mutate(
          {
            equipmentTypeId: typeId,
            quantity: serialized ? unitIds.length : quantity,
            unitIds: serialized ? unitIds : [],
            note: note || null,
          },
          {
            onSuccess: () => {
              toast.success('Found items recorded');
              onClose();
            },
            onError: (err) =>
              setErrors(
                err instanceof ApiError
                  ? { quantity: err.message, ...err.fieldErrors }
                  : { quantity: 'Something went wrong' },
              ),
          },
        );
      }}
    >
      {missing.length > 1 && (
        <Field>
          <FieldLabel htmlFor="found-type">Item</FieldLabel>
          <Select
            value={typeId}
            onValueChange={(v) => {
              setTypeId(v);
              setQuantity(1);
              setUnitIds([]);
            }}
          >
            <SelectTrigger id="found-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {missing.map((l) => (
                <SelectItem key={l.equipmentTypeId} value={l.equipmentTypeId}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {line && serialized ? (
        <Field>
          <FieldLabel>Which {line.name.toLowerCase()} turned up?</FieldLabel>
          <div className="grid gap-2">
            {missingUnits.map((u) => (
              <div key={u.id} className="flex items-center gap-2">
                <Checkbox
                  id={`found-${u.id}`}
                  checked={unitIds.includes(u.id)}
                  onCheckedChange={(v) =>
                    setUnitIds((s) => (v === true ? [...s, u.id] : s.filter((x) => x !== u.id)))
                  }
                />
                <label htmlFor={`found-${u.id}`} className="text-sm">
                  {u.label}
                </label>
              </div>
            ))}
          </div>
          <FieldError>{errors.unitIds ?? errors.quantity}</FieldError>
        </Field>
      ) : (
        line && (
          <Field>
            <Stepper
              id="found-quantity"
              label={`${line.name} found`}
              value={quantity}
              max={line.missing}
              onChange={setQuantity}
              hint={`${line.missing} still missing${isRental && line.lossFeeCents ? ` · ${formatCents(line.lossFeeCents)} each` : ''}`}
            />
            <FieldError>{errors.quantity}</FieldError>
          </Field>
        )
      )}
      <Field>
        <FieldLabel htmlFor="found-note">Note (optional)</FieldLabel>
        <Textarea
          id="found-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Where it turned up"
        />
      </Field>
    </FormDialog>
  );
}
