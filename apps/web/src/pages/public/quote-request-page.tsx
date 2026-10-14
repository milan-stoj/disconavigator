import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  bookingPolicy,
  BOOKING_TYPES,
  makeQuoteRequestSchema,
  todayIn,
  type BookingType,
} from '@disco/shared';
import { CircleCheck, Headphones } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useParams } from 'react-router';
import type { z } from 'zod';
import { ModeToggle } from '@/components/app/mode-toggle';
import { applyServerErrors, FormField } from '@/components/form';
import { NumberInput } from '@/components/number-input';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiError } from '@/lib/api';
import { wholeNumber } from '@/lib/form-schemas';
import type { PublicTenant } from '@/lib/quote-requests';
import { NotFoundPage } from '@/pages/not-found';

const SERVICE_COPY: Record<BookingType, { title: string; description: string }> = {
  equipment_rental: {
    title: 'Rent the headphones',
    description: 'We drop off or you pick up the gear, and you run your own party.',
  },
  full_service: {
    title: 'Book us to run the show',
    description: 'Our DJs bring the headphones and run the whole silent disco.',
  },
};

const makeSchema = (timeZone: string) =>
  makeQuoteRequestSchema(() => todayIn(timeZone)).extend({
    expectedAttendance: wholeNumber('expected attendance', 1, 100_000),
  });
type Schema = ReturnType<typeof makeSchema>;

/** Public, unauthenticated form where prospective customers ask for a quote. */
export function QuoteRequestPage() {
  const { slug = '' } = useParams();
  const tenant = useQuery({
    queryKey: ['public-tenant', slug],
    queryFn: () => api.get<PublicTenant>(`/api/public/tenants/${slug}`),
    retry: false,
  });

  if (tenant.error instanceof ApiError && tenant.error.status === 404) return <NotFoundPage />;

  return (
    <div className="bg-muted/40 min-h-svh">
      <header className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-4">
        <div className="flex items-center gap-2 font-semibold">
          <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
            <Headphones className="size-4" aria-hidden />
          </div>
          {tenant.data ? tenant.data.name : <Skeleton className="h-5 w-48" />}
        </div>
        <ModeToggle />
      </header>
      <main className="mx-auto max-w-2xl px-4 pb-12">
        {tenant.data ? (
          <RequestForm slug={slug} tenant={tenant.data} />
        ) : tenant.error ? (
          <Alert variant="destructive">
            <AlertTitle>We couldn't load this form</AlertTitle>
            <AlertDescription>Please refresh the page or try again later.</AlertDescription>
          </Alert>
        ) : (
          <Skeleton className="h-[32rem]" />
        )}
      </main>
    </div>
  );
}

function RequestForm({ slug, tenant }: { slug: string; tenant: PublicTenant }) {
  const [schema] = useState(() => makeSchema(tenant.timeZone));
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useForm<z.input<Schema>, unknown, z.output<Schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      organization: '',
      eventDate: '',
      expectedAttendance: null as unknown as number,
      location: '',
      message: '',
      website: '',
    },
  });
  const submit = useMutation({
    mutationFn: (values: z.output<Schema>) =>
      api.post(`/api/public/tenants/${slug}/quote-requests`, values),
    onSuccess: (_, values) => setSentTo(values.email),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 429) return;
      applyServerErrors(form.setError, err);
    },
  });

  if (sentTo) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="flex items-center gap-2 text-xl">
              <CircleCheck className="text-primary size-5" aria-hidden /> Thanks, we got your
              request
            </h1>
          </CardTitle>
          <CardDescription>
            We'll reply to {sentTo} with a quote, usually within one business day.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            onClick={() => {
              form.reset();
              submit.reset();
              setSentTo(null);
            }}
          >
            Send another request
          </Button>
        </CardContent>
      </Card>
    );
  }

  const rateLimited = submit.error instanceof ApiError && submit.error.status === 429;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="text-xl">Request a silent disco quote</h1>
        </CardTitle>
        <CardDescription>
          Tell us about your event and we'll send a custom quote.
          {tenant.serviceAreas.length > 0 &&
            ` We serve ${tenant.serviceAreas.join(' and ')}; a delivery fee applies elsewhere.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form noValidate onSubmit={form.handleSubmit((v) => submit.mutate(v))}>
          <FieldGroup>
            <FormField
              control={form.control}
              name="serviceInterest"
              label="What do you need?"
              render={({ field }) => (
                <RadioGroup
                  value={field.value ?? ''}
                  onValueChange={field.onChange}
                  aria-invalid={field['aria-invalid']}
                  aria-label="What do you need?"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {BOOKING_TYPES.map((t) => (
                    <Label
                      key={t}
                      htmlFor={`${field.id}-${t}`}
                      className="has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 flex items-start gap-3 rounded-lg border p-3 font-normal"
                    >
                      <RadioGroupItem value={t} id={`${field.id}-${t}`} className="mt-0.5" />
                      <span>
                        <span className="block font-medium">{SERVICE_COPY[t].title}</span>
                        <span className="text-muted-foreground block text-sm">
                          {SERVICE_COPY[t].description}
                        </span>
                        <span className="sr-only"> ({bookingPolicy(t).label})</span>
                      </span>
                    </Label>
                  ))}
                </RadioGroup>
              )}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="eventDate"
                label="Event date"
                render={({ field }) => (
                  <Input {...field} type="date" min={todayIn(tenant.timeZone)} />
                )}
              />
              <FormField
                control={form.control}
                name="expectedAttendance"
                label="Expected guests"
                render={({ field }) => <NumberInput {...field} inputMode="numeric" min={1} />}
              />
            </div>
            <FormField
              control={form.control}
              name="location"
              label="Event location"
              description="Venue name or address, including the city."
              render={({ field }) => <Input {...field} autoComplete="street-address" />}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="name"
                label="Your name"
                render={({ field }) => <Input {...field} autoComplete="name" />}
              />
              <FormField
                control={form.control}
                name="organization"
                label="Organization (optional)"
                render={({ field }) => (
                  <Input {...field} value={field.value ?? ''} autoComplete="organization" />
                )}
              />
              <FormField
                control={form.control}
                name="email"
                label="Email"
                render={({ field }) => <Input {...field} type="email" autoComplete="email" />}
              />
              <FormField
                control={form.control}
                name="phone"
                label="Phone (optional)"
                render={({ field }) => (
                  <Input {...field} value={field.value ?? ''} type="tel" autoComplete="tel" />
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="message"
              label="Anything else? (optional)"
              render={({ field }) => (
                <Textarea
                  {...field}
                  value={field.value ?? ''}
                  rows={4}
                  placeholder="Theme, timing, indoor or outdoor, questions…"
                />
              )}
            />
            {/* Spam trap: hidden from people and assistive tech; bots tend to fill it. */}
            <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
              <label>
                Website
                <input {...form.register('website')} type="text" tabIndex={-1} autoComplete="off" />
              </label>
            </div>
            {rateLimited && (
              <Alert variant="destructive">
                <AlertTitle>Too many requests</AlertTitle>
                <AlertDescription>Please wait a while and try again.</AlertDescription>
              </Alert>
            )}
            <Button
              type="submit"
              size="lg"
              disabled={submit.isPending}
              className="w-full sm:w-auto"
            >
              {submit.isPending && <Spinner />} Request a quote
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
