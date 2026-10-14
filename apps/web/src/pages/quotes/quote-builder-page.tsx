import { useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  addDays,
  bookingPolicy,
  BOOKING_TYPES,
  centsToDollars,
  formatCents,
  PRICING_TERM_LABELS,
  type BookingType,
  type PricingTerm,
} from '@disco/shared';
import { AlertTriangle, Plus, Trash2 } from 'lucide-react';
import { useFieldArray, useForm, useWatch, type FieldPath } from 'react-hook-form';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { FormField, applyServerErrors } from '@/components/form';
import { MoneyInput } from '@/components/money-input';
import { NumberInput } from '@/components/number-input';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, errorMessage } from '@/lib/api';
import { useOpportunity, type Opportunity } from '@/lib/crm';
import { useEquipment, usePackages, type EquipmentType, type RentalPackage } from '@/lib/inventory';
import {
  shortDate,
  useAvailabilityCheck,
  useQuote,
  useSaveQuote,
  type AvailabilityCheckBody,
  type Quote,
} from '@/lib/quotes';
import { useSettings, type SettingsView } from '@/lib/settings';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { NotFoundPage } from '@/pages/not-found';
import {
  cleanRequirements,
  emptyQuoteForm,
  liveFinancials,
  occurrenceDatesOf,
  quoteFormSchema,
  quoteServerFieldMap,
  quoteToForm,
  seriesDates,
  seriesPatternLabel,
  SERIES_PATTERNS,
  toQuoteBody,
  type QuoteFormValues,
  type SeriesPattern,
} from './quote-form';
import { AvailabilityWarnings, FinancialSummary } from './quote-shared';

const BOOKING_TYPE_HINTS: Record<BookingType, string> = {
  equipment_rental: 'The customer rents headphones and runs the event. 20% holding deposit.',
  full_service: 'Our DJs run the show. Flat fee, door split, or guarantee plus split.',
};

/** /quotes/new?opportunityId=… and /quotes/:id/edit */
export function QuoteBuilderPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const quote = useQuote(id);
  const opportunityId = id ? quote.data?.opportunityId : (search.get('opportunityId') ?? '');
  const opportunity = useOpportunity(opportunityId ?? '');
  const settings = useSettings();
  const equipment = useEquipment();
  const packages = usePackages();

  const notFound =
    (quote.error instanceof ApiError && quote.error.status === 404) ||
    (opportunity.error instanceof ApiError && opportunity.error.status === 404) ||
    (!id && !opportunityId);
  if (notFound) return <NotFoundPage />;
  if (
    (id && !quote.data) ||
    !opportunity.data ||
    !settings.data ||
    !equipment.data ||
    !packages.data
  ) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  return (
    <QuoteBuilder
      key={quote.data?.current.id ?? 'new'}
      quote={quote.data ?? null}
      opportunity={opportunity.data}
      settings={settings.data}
      equipment={equipment.data}
      packages={packages.data}
    />
  );
}

function initialValues(
  quote: Quote | null,
  opportunity: Opportunity,
  packages: RentalPackage[],
): QuoteFormValues {
  if (quote) return quoteToForm(quote, packages);
  return emptyQuoteForm(opportunity.serviceInterest ?? 'full_service', {
    startDate: opportunity.eventDate,
    expectedAttendance: opportunity.expectedAttendance,
  });
}

function QuoteBuilder({
  quote,
  opportunity,
  settings,
  equipment,
  packages,
}: {
  quote: Quote | null;
  opportunity: Opportunity;
  settings: SettingsView;
  equipment: EquipmentType[];
  packages: RentalPackage[];
}) {
  const navigate = useNavigate();
  const save = useSaveQuote(quote?.id);
  const form = useForm<QuoteFormValues>({
    resolver: zodResolver(quoteFormSchema),
    defaultValues: initialValues(quote, opportunity, packages),
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const values = useWatch({ control: form.control }) as QuoteFormValues;
  const isRental = values.bookingType === 'equipment_rental';
  const showLines = isRental || values.pricingTerm === 'flat_fee';
  const policy = bookingPolicy(values.bookingType);
  const depositBps = quote?.current.depositBps ?? settings.rentalDepositBps;
  const financials = liveFinancials(values, depositBps);
  const occurrences = occurrenceDatesOf(values);
  const activePackages = packages.filter(
    (p) => p.active || values.lines.some((l) => l.packageId === p.id),
  );

  const checkJson = useDebouncedValue(JSON.stringify(availabilityBody(values)), 400);
  const checkBody = useMemo(
    () => JSON.parse(checkJson) as AvailabilityCheckBody | null,
    [checkJson],
  );
  const availability = useAvailabilityCheck(checkBody);

  const deliveryLine = (): QuoteFormValues['lines'][number] => ({
    kind: 'delivery',
    description: 'Delivery outside service area',
    quantity: 1,
    unitPrice: centsToDollars(settings.deliveryFeeCents),
    packageId: null,
  });

  const setBookingType = (type: BookingType) => {
    if (type === values.bookingType) return;
    form.setValue('bookingType', type);
    form.setValue('staffRequired', bookingPolicy(type).defaultStaffRequired);
    if (type === 'full_service') {
      // Packages and delivery fees belong to rentals only.
      const kept = form
        .getValues('lines')
        .filter((l) => l.kind !== 'package' && l.kind !== 'delivery');
      form.setValue(
        'lines',
        kept.map((l) => ({ ...l, kind: 'custom' as const })),
      );
      form.setValue('insideServiceArea', true);
      form.setValue('endDate', form.getValues('startDate'));
    } else {
      form.setValue('pricingTerm', 'flat_fee');
      form.setValue('seriesEnabled', false);
      const start = form.getValues('startDate');
      if (start && form.getValues('endDate') <= start) form.setValue('endDate', addDays(start, 1));
    }
    form.clearErrors();
  };

  const setInsideServiceArea = (inside: boolean) => {
    form.setValue('insideServiceArea', inside);
    const current = form.getValues('lines');
    const idx = current.findIndex((l) => l.kind === 'delivery');
    if (inside && idx >= 0) lines.remove(idx);
    if (!inside && idx < 0) lines.append(deliveryLine());
  };

  const addPackage = (packageId: string) => {
    const p = packages.find((x) => x.id === packageId);
    if (!p) return;
    lines.append({
      kind: 'package',
      description: p.name,
      quantity: 1,
      unitPrice: centsToDollars(p.priceCents),
      packageId: p.id,
    });
    const days = rentalDays(form.getValues('startDate'), form.getValues('endDate'));
    if (days > p.includedDays && p.extraDayPriceCents > 0) {
      const extra = days - p.includedDays;
      lines.append({
        kind: 'addon',
        description: `${p.name}: extra ${extra === 1 ? 'day' : 'days'}`,
        quantity: extra,
        unitPrice: centsToDollars(p.extraDayPriceCents),
        packageId: null,
      });
    }
  };

  const onSubmit = form.handleSubmit((v) =>
    save.mutate(toQuoteBody(v, opportunity.id), {
      onSuccess: (q) => void navigate(`/quotes/${q.id}`),
      onError: (err) =>
        applyServerErrors(
          form.setError,
          err,
          quoteServerFieldMap(
            err instanceof ApiError ? Object.keys(err.fieldErrors) : [],
          ) as Record<string, FieldPath<QuoteFormValues>>,
        ),
    }),
  );

  const linesError =
    form.formState.errors.lines?.root?.message ?? form.formState.errors.lines?.message;
  const editingSent = quote && quote.status !== 'draft';

  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4">
      <PageHeader
        title={quote ? `Edit quote ${quote.displayNumber}` : 'New quote'}
        description={opportunity.title}
        actions={
          <>
            <Button type="button" variant="outline" onClick={() => void navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />} {quote ? 'Save quote' : 'Create quote'}
            </Button>
          </>
        }
      />
      {editingSent && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Saving creates revision {quote.revisions.length + 1}</AlertTitle>
          <AlertDescription>
            The link sent to the customer stops working. Send the quote again after saving.
          </AlertDescription>
        </Alert>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>What are we quoting?</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RadioGroup
                aria-label="Booking type"
                value={values.bookingType}
                onValueChange={(t) => setBookingType(t as BookingType)}
                className="grid gap-3 sm:grid-cols-2"
              >
                {BOOKING_TYPES.map((t) => (
                  <FieldLabel key={t} htmlFor={`booking-type-${t}`} className="cursor-pointer">
                    <div className="flex w-full items-start gap-3 rounded-md border p-3 has-[[data-state=checked]]:border-primary">
                      <RadioGroupItem id={`booking-type-${t}`} value={t} className="mt-0.5" />
                      <div className="grid gap-1">
                        <span className="font-medium">{bookingPolicy(t).label}</span>
                        <span className="text-foreground/75 text-xs font-normal">
                          {BOOKING_TYPE_HINTS[t]}
                        </span>
                      </div>
                    </div>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{isRental ? 'Rental dates and delivery' : 'Event details'}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="startDate"
                    label={isRental ? 'Pickup date' : 'Event date'}
                    render={({ field }) => <Input {...field} type="date" />}
                  />
                  {isRental ? (
                    <FormField
                      control={form.control}
                      name="endDate"
                      label="Return date"
                      render={({ field }) => (
                        <Input {...field} type="date" min={values.startDate} />
                      )}
                    />
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="startTime"
                        label="Start time"
                        render={({ field }) => <Input {...field} type="time" />}
                      />
                      <FormField
                        control={form.control}
                        name="endTime"
                        label="End time"
                        render={({ field }) => <Input {...field} type="time" />}
                      />
                    </div>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
                  <FormField
                    control={form.control}
                    name="location"
                    label={isRental ? 'Delivery or pickup location' : 'Venue / location'}
                    render={({ field }) => <Input {...field} placeholder="Address or venue" />}
                  />
                  <FormField
                    control={form.control}
                    name="expectedAttendance"
                    label="Attendance"
                    render={({ field }) => (
                      <NumberInput {...field} min={0} step={1} inputMode="numeric" />
                    )}
                  />
                </div>
                {isRental && (
                  <FormField
                    control={form.control}
                    name="insideServiceArea"
                    label="Inside the service area"
                    orientation="horizontal"
                    description={`${settings.serviceAreas.length ? settings.serviceAreas.join(' or ') : 'Service area'}. Outside adds a ${formatCents(settings.deliveryFeeCents)} delivery fee you can edit.`}
                    render={({ field }) => (
                      <Switch
                        id={field.id}
                        checked={field.value}
                        onCheckedChange={setInsideServiceArea}
                        aria-describedby={field['aria-describedby']}
                      />
                    )}
                  />
                )}
                {!isRental && <SeriesFields form={form} values={values} />}
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Pricing</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                {!isRental && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField
                      control={form.control}
                      name="pricingTerm"
                      label="Pricing terms"
                      render={({ field }) => (
                        <Select value={field.value} onValueChange={field.onChange}>
                          <SelectTrigger id={field.id} className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {policy.allowedPricingTerms.map((t: PricingTerm) => (
                              <SelectItem key={t} value={t}>
                                {PRICING_TERM_LABELS[t]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {values.pricingTerm !== 'flat_fee' && (
                      <FormField
                        control={form.control}
                        name="splitPercent"
                        label="Door split %"
                        render={({ field }) => (
                          <NumberInput {...field} min={1} max={100} step={0.5} />
                        )}
                      />
                    )}
                    {values.pricingTerm === 'guarantee_plus_split' && (
                      <FormField
                        control={form.control}
                        name="guarantee"
                        label="Guarantee"
                        render={({ field }) => <MoneyInput {...field} />}
                      />
                    )}
                  </div>
                )}
                {!isRental && values.pricingTerm !== 'flat_fee' && (
                  <FieldDescription>
                    The venue collects the door. You record door revenue after the event to settle.
                  </FieldDescription>
                )}

                {showLines && (
                  <FieldSet>
                    <FieldLegend variant="label">Line items</FieldLegend>
                    {isRental && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value="" onValueChange={addPackage}>
                          <SelectTrigger aria-label="Add a package" className="w-64">
                            <SelectValue
                              placeholder={
                                activePackages.length ? 'Add a package…' : 'No packages yet'
                              }
                            />
                          </SelectTrigger>
                          <SelectContent>
                            {activePackages.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name} · {formatCents(p.priceCents)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="text-muted-foreground text-xs">
                          {rentalDays(values.startDate, values.endDate)}-day rental
                        </span>
                      </div>
                    )}
                    <ul className="grid gap-3" aria-label="Line items">
                      {lines.fields.map((line, index) => {
                        const watched = values.lines[index];
                        const total =
                          watched && watched.quantity != null && watched.unitPrice != null
                            ? formatCents(Math.round(watched.quantity * watched.unitPrice * 100))
                            : '—';
                        return (
                          <li
                            key={line.id}
                            className="grid gap-3 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_5rem_8rem_auto]"
                          >
                            <FormField
                              control={form.control}
                              name={`lines.${index}.description`}
                              label={lineLabel(watched?.kind)}
                              render={({ field }) => (
                                <Input {...field} readOnly={watched?.kind === 'package'} />
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`lines.${index}.quantity`}
                              label="Qty"
                              render={({ field }) => (
                                <NumberInput {...field} min={1} step={1} inputMode="numeric" />
                              )}
                            />
                            <FormField
                              control={form.control}
                              name={`lines.${index}.unitPrice`}
                              label="Unit price"
                              render={({ field }) => <MoneyInput {...field} />}
                            />
                            <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end">
                              <span className="text-sm tabular-nums" aria-label="Line total">
                                {total}
                              </span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove ${watched?.description || 'line'}`}
                                onClick={() => {
                                  if (watched?.kind === 'delivery') {
                                    form.setValue('insideServiceArea', true);
                                  }
                                  lines.remove(index);
                                }}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    {linesError && (
                      <p role="alert" className="text-destructive text-sm">
                        {linesError}
                      </p>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="justify-self-start"
                      onClick={() =>
                        lines.append({
                          kind: isRental ? 'addon' : 'custom',
                          description: '',
                          quantity: 1,
                          unitPrice: null as unknown as number,
                          packageId: null,
                        })
                      }
                    >
                      <Plus /> {isRental ? 'Add an add-on' : 'Add a line item'}
                    </Button>
                  </FieldSet>
                )}
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Equipment and staff</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <FieldDescription>
                  {isRental
                    ? 'Packages reserve their own equipment. Add anything extra the customer needs.'
                    : 'What this event needs from inventory.'}
                </FieldDescription>
                <div className="grid gap-4 sm:grid-cols-3">
                  {equipment.map((t) => (
                    <FormField
                      key={t.id}
                      control={form.control}
                      name={`requirements.${t.id}`}
                      label={isRental ? `Extra ${t.name.toLowerCase()}` : t.name}
                      description={`${t.inService} in service`}
                      render={({ field }) => (
                        <NumberInput
                          {...field}
                          value={field.value ?? null}
                          min={0}
                          step={1}
                          inputMode="numeric"
                        />
                      )}
                    />
                  ))}
                  {!isRental && (
                    <FormField
                      control={form.control}
                      name="staffRequired"
                      label="DJs"
                      render={({ field }) => (
                        <NumberInput {...field} min={0} step={1} inputMode="numeric" />
                      )}
                    />
                  )}
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Notes</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="notes"
                label="Notes for the customer"
                render={({ field }) => <Textarea {...field} rows={3} placeholder="Optional" />}
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 lg:sticky lg:top-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Summary</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FinancialSummary
                financials={financials}
                splitBps={
                  values.pricingTerm !== 'flat_fee' && values.splitPercent != null
                    ? Math.round(values.splitPercent * 100)
                    : null
                }
                showDeposit={policy.requiresDeposit}
                depositBps={depositBps}
              />
              {occurrences && occurrences.length > 1 && financials?.totalCents != null && (
                <p className="text-muted-foreground text-xs">
                  Per event, for {occurrences.length} events (
                  {formatCents(financials.totalCents * occurrences.length)} in total).
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Availability</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {checkBody ? (
                availability.data ? (
                  <AvailabilityWarnings availability={availability.data} showAllDates />
                ) : availability.error ? (
                  <p role="alert" className="text-destructive text-sm">
                    Couldn&apos;t check availability: {errorMessage(availability.error)}
                  </p>
                ) : (
                  <Skeleton className="h-10" />
                )
              ) : (
                <p className="text-muted-foreground text-sm">Choose dates to check availability.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}

function SeriesFields({
  form,
  values,
}: {
  form: ReturnType<typeof useForm<QuoteFormValues>>;
  values: QuoteFormValues;
}) {
  const dates = values.seriesEnabled ? seriesDates(values) : [];
  return (
    <FieldSet>
      <FormField
        control={form.control}
        name="seriesEnabled"
        label="Recurring series"
        orientation="horizontal"
        description="One quote for a repeating event, like a monthly bar night."
        render={({ field }) => (
          <Switch
            id={field.id}
            checked={field.value}
            onCheckedChange={field.onChange}
            aria-describedby={field['aria-describedby']}
          />
        )}
      />
      {values.seriesEnabled && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="seriesPattern"
              label="Repeats"
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(p) => field.onChange(p as SeriesPattern)}
                >
                  <SelectTrigger id={field.id} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SERIES_PATTERNS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {seriesPatternLabel(p, values.startDate)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FormField
              control={form.control}
              name="seriesUntil"
              label="Repeat until"
              render={({ field }) => <Input {...field} type="date" min={values.startDate} />}
            />
          </div>
          {dates.length > 0 && (
            <div className="grid gap-1">
              <FieldLabel asChild>
                <span>{dates.length} dates</span>
              </FieldLabel>
              <p className="text-muted-foreground text-sm" aria-label="Series dates">
                {dates.map(shortDate).join(' · ')}
              </p>
            </div>
          )}
        </>
      )}
    </FieldSet>
  );
}

const lineLabel = (kind: string | undefined) =>
  kind === 'package'
    ? 'Package'
    : kind === 'delivery'
      ? 'Delivery fee'
      : kind === 'addon'
        ? 'Add-on'
        : 'Description';

/** Rental length in days; a same-day or overnight rental counts as one day. */
function rentalDays(start: string, end: string): number {
  if (!start || !end || end < start) return 1;
  return Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000));
}

/** Capacity-check request for the current form values, or null until dates are usable. */
function availabilityBody(v: QuoteFormValues): AvailabilityCheckBody | null {
  if (!v.startDate) return null;
  const isRental = v.bookingType === 'equipment_rental';
  if (isRental && (!v.endDate || v.endDate < v.startDate)) return null;
  const occurrences = occurrenceDatesOf(v);
  if (occurrences && occurrences.length === 0) return null;
  return {
    bookingType: v.bookingType,
    startDate: v.startDate,
    endDate: isRental ? v.endDate : v.startDate,
    occurrenceDates: occurrences,
    lines: (v.lines ?? [])
      .filter((l) => l.kind === 'package' && l.packageId)
      .map((l) => ({ kind: l.kind, quantity: l.quantity ?? 0, packageId: l.packageId })),
    requirements: cleanRequirements(v.requirements),
    staffRequired: v.staffRequired ?? 0,
  };
}
