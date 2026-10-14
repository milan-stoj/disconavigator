import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { Printer, Save, Send } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormField, applyServerErrors } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { errorMessage } from '@/lib/api';
import { useStaff } from '@/lib/availability';
import {
  overbookingFrom,
  useAssignStaff,
  useSaveEventDetails,
  useSaveLogistics,
  useSendRentalConfirmation,
  type Booking,
  type LogisticsBody,
  type OverbookingDetails,
} from '@/lib/bookings';
import { formatDateTime } from '@/lib/inventory';
import { OverbookingDialog } from './booking-shared';

const EDITABLE = ['awaiting_deposit', 'confirmed', 'out', 'returned'];
export const isEditable = (b: Booking) => EDITABLE.includes(b.status);
const orNull = (v: string) => (v.trim() ? v.trim() : null);

// ---------- Full-service: event details and DJs ----------

const eventForm = z.object({
  venueContact: z.string().max(200),
  loadInTime: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  channels: z.string(),
  runOfShow: z.string().max(10_000),
});
type EventValues = z.infer<typeof eventForm>;

export function StaffingTab({ booking }: { booking: Booking }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <EventDetailsCard booking={booking} />
      <DjAssignmentCard booking={booking} />
    </div>
  );
}

function EventDetailsCard({ booking: b }: { booking: Booking }) {
  const save = useSaveEventDetails(b.id);
  const form = useForm<EventValues>({
    resolver: zodResolver(eventForm),
    defaultValues: {
      venueContact: b.venueContact ?? '',
      loadInTime: b.loadInTime ?? '',
      startTime: b.startTime ?? '',
      endTime: b.endTime ?? '',
      channels: b.channels ? String(b.channels) : '',
      runOfShow: b.runOfShow ?? '',
    },
  });
  const editable = isEditable(b);
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Event details</h2>
        </CardTitle>
        <CardAction>
          <Button size="sm" variant="outline" asChild>
            <Link to={`/bookings/${b.id}/sheet`}>
              <Printer /> Event sheet
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          aria-label="Event details"
          onSubmit={form.handleSubmit((v) =>
            save.mutate(
              {
                venueContact: orNull(v.venueContact),
                loadInTime: orNull(v.loadInTime),
                startTime: orNull(v.startTime),
                endTime: orNull(v.endTime),
                channels: v.channels ? Number(v.channels) : null,
                runOfShow: orNull(v.runOfShow),
              },
              {
                onSuccess: () => toast.success('Event details saved'),
                onError: (err) => applyServerErrors(form.setError, err),
              },
            ),
          )}
        >
          <fieldset disabled={!editable} className="grid gap-4">
            <FieldGroup>
              <FormField
                control={form.control}
                name="venueContact"
                label="Venue contact"
                description="Who to find on the night, with a phone number."
                render={({ field }) => <Input {...field} />}
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="loadInTime"
                  label="Load-in"
                  render={({ field }) => <Input {...field} type="time" />}
                />
                <FormField
                  control={form.control}
                  name="startTime"
                  label="Start"
                  render={({ field }) => <Input {...field} type="time" />}
                />
                <FormField
                  control={form.control}
                  name="endTime"
                  label="End"
                  render={({ field }) => <Input {...field} type="time" />}
                />
              </div>
              <FormField
                control={form.control}
                name="channels"
                label="Channels"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id={field.id}
                      className="w-40"
                      aria-invalid={field['aria-invalid']}
                    >
                      <SelectValue placeholder="Not set" />
                    </SelectTrigger>
                    <SelectContent>
                      {['1', '2', '3'].map((n) => (
                        <SelectItem key={n} value={n}>
                          {n} {n === '1' ? 'channel' : 'channels'}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FormField
                control={form.control}
                name="runOfShow"
                label="Run of show"
                render={({ field }) => <Textarea {...field} rows={6} />}
              />
            </FieldGroup>
            {editable && (
              <div>
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? <Spinner /> : <Save />} Save event details
                </Button>
              </div>
            )}
          </fieldset>
        </form>
      </CardContent>
    </Card>
  );
}

function DjAssignmentCard({ booking: b }: { booking: Booking }) {
  const staff = useStaff();
  const assign = useAssignStaff(b.id);
  const [selected, setSelected] = useState<string[]>(b.staff.map((s) => s.id));
  const [overbooking, setOverbooking] = useState<OverbookingDetails | null>(null);
  const options = (staff.data ?? []).filter((s) => s.active || selected.includes(s.id));
  const editable = isEditable(b);
  const submit = (confirmOverbooking = false) =>
    assign.mutate(
      { staffMemberIds: selected, confirmOverbooking },
      {
        onSuccess: () => toast.success('DJs saved'),
        onError: (err) => {
          const ob = overbookingFrom(err);
          if (ob) setOverbooking(ob);
          else toast.error(errorMessage(err));
        },
      },
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>DJs</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="grid gap-4"
        >
          <FieldSet disabled={!editable}>
            <FieldLegend variant="label">
              Assigned DJs ({selected.length} of {b.staffRequired} needed)
            </FieldLegend>
            <FieldGroup className="gap-3">
              {options.map((s) => (
                <Field key={s.id} orientation="horizontal">
                  <Checkbox
                    id={`dj-${s.id}`}
                    checked={selected.includes(s.id)}
                    onCheckedChange={(c) =>
                      setSelected((cur) => (c ? [...cur, s.id] : cur.filter((id) => id !== s.id)))
                    }
                  />
                  <FieldLabel htmlFor={`dj-${s.id}`} className="font-normal">
                    {s.name}
                  </FieldLabel>
                </Field>
              ))}
              {staff.data && options.length === 0 && (
                <p className="text-muted-foreground text-sm">Add DJs in Settings → Staff first.</p>
              )}
            </FieldGroup>
          </FieldSet>
          {editable && (
            <div>
              <Button type="submit" variant="outline" disabled={assign.isPending}>
                {assign.isPending ? <Spinner /> : <Save />} Save DJs
              </Button>
            </div>
          )}
        </form>
      </CardContent>
      {overbooking && (
        <OverbookingDialog
          details={overbooking}
          action="Assign"
          onCancel={() => setOverbooking(null)}
          onConfirm={() => {
            setOverbooking(null);
            submit(true);
          }}
        />
      )}
    </Card>
  );
}

// ---------- Equipment rental: logistics ----------

const logisticsForm = z
  .object({
    fulfillment: z.enum(['pickup', 'delivery']),
    dispatchDate: z.string().min(1, 'Choose a date'),
    dispatchTime: z.string(),
    returnDate: z.string().min(1, 'Choose a date'),
    returnTime: z.string(),
    deliveryAddress: z.string().max(300),
    customerInstructions: z.string().max(5000),
  })
  .superRefine((v, ctx) => {
    if (v.returnDate && v.dispatchDate && v.returnDate < v.dispatchDate)
      ctx.addIssue({
        code: 'custom',
        path: ['returnDate'],
        message: 'Return must be on or after dispatch',
      });
    if (v.fulfillment === 'delivery' && !v.deliveryAddress.trim())
      ctx.addIssue({ code: 'custom', path: ['deliveryAddress'], message: 'Enter the address' });
  });
type LogisticsValues = z.infer<typeof logisticsForm>;

export function LogisticsTab({ booking: b }: { booking: Booking }) {
  const save = useSaveLogistics(b.id);
  const send = useSendRentalConfirmation(b.id);
  const [pending, setPending] = useState<{
    body: LogisticsBody;
    details: OverbookingDetails;
  } | null>(null);
  const form = useForm<LogisticsValues>({
    resolver: zodResolver(logisticsForm),
    defaultValues: {
      fulfillment: b.fulfillment ?? 'pickup',
      dispatchDate: b.startDate,
      dispatchTime: b.dispatchTime ?? '',
      returnDate: b.endDate,
      returnTime: b.returnTime ?? '',
      deliveryAddress: b.deliveryAddress ?? '',
      customerInstructions: b.customerInstructions ?? '',
    },
  });
  const fulfillment = useWatch({ control: form.control, name: 'fulfillment' });
  const editable = isEditable(b);
  const canSend = (b.status === 'confirmed' || b.status === 'out') && !!b.contact?.email;
  const submit = (body: LogisticsBody) =>
    save.mutate(body, {
      onSuccess: () => {
        toast.success('Logistics saved');
        form.reset(form.getValues());
      },
      onError: (err) => {
        const ob = overbookingFrom(err);
        if (ob) setPending({ body, details: ob });
        else applyServerErrors(form.setError, err);
      },
    });
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Pickup or delivery</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            noValidate
            aria-label="Rental logistics"
            onSubmit={form.handleSubmit((v) =>
              submit({
                fulfillment: v.fulfillment,
                dispatchDate: v.dispatchDate,
                dispatchTime: orNull(v.dispatchTime),
                returnDate: v.returnDate,
                returnTime: orNull(v.returnTime),
                deliveryAddress: v.fulfillment === 'delivery' ? orNull(v.deliveryAddress) : null,
                customerInstructions: orNull(v.customerInstructions),
              }),
            )}
          >
            <fieldset disabled={!editable} className="grid gap-4">
              <FieldGroup>
                <FormField
                  control={form.control}
                  name="fulfillment"
                  label="Handoff"
                  render={({ field }) => (
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      aria-label="Handoff"
                      className="flex gap-6"
                    >
                      {(['pickup', 'delivery'] as const).map((f) => (
                        <Field key={f} orientation="horizontal" className="w-auto">
                          <RadioGroupItem id={`fulfillment-${f}`} value={f} />
                          <FieldLabel htmlFor={`fulfillment-${f}`} className="font-normal">
                            {f === 'pickup' ? 'Customer picks up' : 'We deliver'}
                          </FieldLabel>
                        </Field>
                      ))}
                    </RadioGroup>
                  )}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="dispatchDate"
                    label={fulfillment === 'delivery' ? 'Delivery date' : 'Pickup date'}
                    render={({ field }) => <Input {...field} type="date" />}
                  />
                  <FormField
                    control={form.control}
                    name="dispatchTime"
                    label={fulfillment === 'delivery' ? 'Delivery time' : 'Pickup time'}
                    render={({ field }) => <Input {...field} type="time" />}
                  />
                  <FormField
                    control={form.control}
                    name="returnDate"
                    label="Return date"
                    render={({ field }) => <Input {...field} type="date" />}
                  />
                  <FormField
                    control={form.control}
                    name="returnTime"
                    label="Return time"
                    render={({ field }) => <Input {...field} type="time" />}
                  />
                </div>
                {fulfillment === 'delivery' && (
                  <FormField
                    control={form.control}
                    name="deliveryAddress"
                    label="Delivery address"
                    render={({ field }) => <Input {...field} autoComplete="street-address" />}
                  />
                )}
                <FormField
                  control={form.control}
                  name="customerInstructions"
                  label="Notes for the customer"
                  description="Included in the confirmation email."
                  render={({ field }) => <Textarea {...field} rows={3} />}
                />
              </FieldGroup>
              {editable && (
                <div>
                  <Button type="submit" disabled={save.isPending}>
                    {save.isPending ? <Spinner /> : <Save />} Save logistics
                  </Button>
                </div>
              )}
            </fieldset>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <h2>Confirmation email</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm">
          <p className="text-muted-foreground">
            Sends the customer the handoff and return times, address, equipment list, and your usage
            instructions.
          </p>
          {b.confirmationSentAt && <p>Last sent {formatDateTime(b.confirmationSentAt)}</p>}
          {!b.contact?.email && <p className="text-destructive">The customer has no email.</p>}
          {b.status === 'awaiting_deposit' && (
            <p className="text-muted-foreground">Available once the rental is confirmed.</p>
          )}
          <div>
            <Button
              variant="outline"
              disabled={!canSend || send.isPending || form.formState.isDirty}
              onClick={() =>
                send.mutate(undefined, {
                  onSuccess: () => toast.success(`Confirmation sent to ${b.contact?.email}`),
                  onError: (err) => toast.error(errorMessage(err)),
                })
              }
            >
              {send.isPending ? <Spinner /> : <Send />}
              {b.confirmationSentAt ? 'Resend confirmation' : 'Send confirmation'}
            </Button>
            {form.formState.isDirty && (
              <p className="text-muted-foreground mt-2 text-xs">Save your changes first.</p>
            )}
          </div>
        </CardContent>
      </Card>
      {pending && (
        <OverbookingDialog
          details={pending.details}
          action="Save"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const body = { ...pending.body, confirmOverbooking: true };
            setPending(null);
            submit(body);
          }}
        />
      )}
    </div>
  );
}
