import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Copy, PlugZap, Unplug } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { FormField, applyServerErrors } from '@/components/form';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import {
  settingsQueryKey,
  useSettings,
  type SettingsView,
  type SquareLocation,
} from '@/lib/settings';

const squareFormSchema = z.object({
  environment: z.enum(['sandbox', 'production']),
  accessToken: z.string().trim().max(500),
  locationId: z.string(),
  webhookSignatureKey: z.string().trim().max(500),
});
type SquareFormValues = z.infer<typeof squareFormSchema>;

const ENVIRONMENTS = [
  { value: 'sandbox', label: 'Sandbox (testing)' },
  { value: 'production', label: 'Production (real payments)' },
] as const;

export function SquareSettings() {
  const { data, isPending } = useSettings();
  if (isPending || !data) return <Skeleton className="h-96 w-full" />;
  return <SquareSettingsForm settings={data} />;
}

function SquareSettingsForm({ settings }: { settings: SettingsView }) {
  const qc = useQueryClient();
  const [locations, setLocations] = useState<SquareLocation[]>([]);
  const form = useForm<SquareFormValues>({
    resolver: zodResolver(squareFormSchema),
    defaultValues: {
      environment: settings.squareEnvironment ?? 'sandbox',
      accessToken: '',
      locationId: '',
      webhookSignatureKey: '',
    },
  });
  const environment = useWatch({ control: form.control, name: 'environment' });
  const canReuseToken = settings.squareConnected && environment === settings.squareEnvironment;

  const tokenBody = (v: SquareFormValues) => ({
    environment: v.environment,
    ...(v.accessToken ? { accessToken: v.accessToken } : {}),
  });

  const findLocations = useMutation({
    mutationFn: (v: SquareFormValues) =>
      api.post<{ locations: SquareLocation[] }>('/api/settings/square/locations', tokenBody(v)),
    onSuccess: ({ locations: found }) => {
      setLocations(found);
      if (found.length === 1) form.setValue('locationId', found[0]!.id);
      if (found.length === 0) toast.error('This Square account has no active locations');
    },
    onError: (err) => applyServerErrors(form.setError, err),
  });

  const save = useMutation({
    mutationFn: (v: SquareFormValues) =>
      api.put<SettingsView>('/api/settings/square', {
        ...tokenBody(v),
        locationId: v.locationId || null,
        ...(v.webhookSignatureKey ? { webhookSignatureKey: v.webhookSignatureKey } : {}),
      }),
    onSuccess: (saved) => {
      qc.setQueryData(settingsQueryKey, saved);
      form.reset({ ...form.getValues(), accessToken: '', webhookSignatureKey: '' });
      setLocations([]);
      toast.success(`Connected to Square: ${saved.squareLocationName}`);
    },
    onError: (err) => applyServerErrors(form.setError, err),
  });

  const disconnect = useMutation({
    mutationFn: () => api.delete<SettingsView>('/api/settings/square'),
    onSuccess: (saved) => {
      qc.setQueryData(settingsQueryKey, saved);
      toast.success('Square disconnected');
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const c = form.control;
  const busy = findLocations.isPending || save.isPending;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Square connection</CardTitle>
          <CardDescription>
            Invoices, deposits, and card payments run through your Square account. The access token
            is encrypted on this server and never shown again after you save it.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {settings.squareConnected ? (
            <Alert>
              <CheckCircle2 />
              <AlertTitle className="flex flex-wrap items-center gap-2">
                Connected to {settings.squareLocationName}
                <Badge
                  variant={settings.squareEnvironment === 'production' ? 'default' : 'secondary'}
                >
                  {settings.squareEnvironment === 'production' ? 'Production' : 'Sandbox'}
                </Badge>
              </AlertTitle>
              <AlertDescription>
                Invoices are created automatically when quotes are accepted and settlements are
                recorded.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <Unplug />
              <AlertTitle>Square is not connected</AlertTitle>
              <AlertDescription>
                Accepted bookings wait for an invoice until you connect Square.
              </AlertDescription>
            </Alert>
          )}
          {settings.squareMode === 'mock' && (
            <p className="text-muted-foreground text-sm">
              Development mode: Square calls go to an in-memory mock. Any token works except ones
              starting with “invalid”.
            </p>
          )}
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit((v) => save.mutate(v))}
          >
            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <FormField
                control={c}
                name="environment"
                label="Environment"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v);
                      setLocations([]);
                      form.setValue('locationId', '');
                    }}
                  >
                    <SelectTrigger id={field.id} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ENVIRONMENTS.map((e) => (
                        <SelectItem key={e.value} value={e.value}>
                          {e.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FormField
                control={c}
                name="accessToken"
                label="Access token"
                description={
                  canReuseToken
                    ? 'Saved. Leave blank to keep the current token.'
                    : 'From the Square Developer Dashboard → your app → Credentials.'
                }
                render={({ field }) => (
                  <Input
                    {...field}
                    type="password"
                    autoComplete="off"
                    placeholder={canReuseToken ? '••••••••••••' : ''}
                  />
                )}
              />
              <FormField
                control={c}
                name="locationId"
                label="Location"
                description={
                  locations.length === 0
                    ? 'Find locations to test the token and choose where payments go.'
                    : undefined
                }
                render={({ field }) => (
                  <div className="flex gap-2">
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={locations.length === 0}
                    >
                      <SelectTrigger
                        id={field.id}
                        aria-invalid={field['aria-invalid']}
                        className="w-full min-w-0 flex-1"
                      >
                        <SelectValue
                          placeholder={
                            settings.squareConnected && locations.length === 0
                              ? settings.squareLocationName
                              : 'Choose a location'
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={form.handleSubmit((v) => findLocations.mutate(v))}
                    >
                      {findLocations.isPending && <Spinner />} Find locations
                    </Button>
                  </div>
                )}
              />
              <FormField
                control={c}
                name="webhookSignatureKey"
                label="Webhook signature key"
                description={
                  settings.squareWebhookConfigured
                    ? 'Saved. Leave blank to keep the current key.'
                    : 'Lets Square tell us about payments as they happen.'
                }
                render={({ field }) => (
                  <Input
                    {...field}
                    type="password"
                    autoComplete="off"
                    placeholder={settings.squareWebhookConfigured ? '••••••••••••' : ''}
                  />
                )}
              />
            </FieldGroup>
            <div className="flex flex-wrap justify-end gap-2">
              {settings.squareConnected && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="outline" disabled={disconnect.isPending}>
                      <Unplug /> Disconnect
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Disconnect Square?</AlertDialogTitle>
                      <AlertDialogDescription>
                        The saved token is deleted. Existing Square invoices stay in Square, but
                        payments will not sync and new invoices wait until you reconnect.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => disconnect.mutate()}>
                        Disconnect
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <Button type="submit" disabled={busy}>
                {save.isPending ? <Spinner /> : <PlugZap />}
                {settings.squareConnected ? 'Save connection' : 'Connect Square'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment notifications</CardTitle>
          <CardDescription>
            In the Square Developer Dashboard, add a webhook subscription with this URL for the{' '}
            <code>invoice.payment_made</code>, <code>invoice.updated</code>, and{' '}
            <code>payment.updated</code> events, then paste its signature key above. Payments are
            also re-checked periodically in case a notification is missed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InputGroup>
            <InputGroupInput
              readOnly
              value={settings.squareWebhookUrl}
              aria-label="Webhook URL"
              className="font-mono text-xs"
            />
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                aria-label="Copy webhook URL"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(settings.squareWebhookUrl)
                    .then(() => toast.success('Webhook URL copied'));
                }}
              >
                <Copy />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </CardContent>
      </Card>
    </div>
  );
}
