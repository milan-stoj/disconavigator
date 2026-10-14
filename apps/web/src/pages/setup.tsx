import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { passwordSchema } from '@disco/shared';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate } from 'react-router';
import { z } from 'zod';
import { FullPageSpinner } from '@/components/app/app-layout';
import { FormField, applyServerErrors } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { meQueryKey, type Me } from '@/lib/auth';
import { AuthShell } from './auth-shell';

const setupFormSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords do not match',
  });
type SetupValues = z.infer<typeof setupFormSchema>;

export function SetupPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['setup-status'],
    queryFn: () =>
      api.get<{ setupRequired: boolean }>('/api/setup/status', { allowUnauthorized: true }),
  });
  const form = useForm<SetupValues>({
    resolver: zodResolver(setupFormSchema),
    defaultValues: { password: '', confirm: '' },
  });
  const setup = useMutation({
    mutationFn: (v: SetupValues) =>
      api.post<Me>('/api/setup', { password: v.password }, { allowUnauthorized: true }),
    onSuccess: (me) => {
      qc.setQueryData(meQueryKey, me);
      qc.setQueryData(['setup-status'], { setupRequired: false });
      void navigate('/', { replace: true });
    },
    onError: (err) => applyServerErrors(form.setError, err),
  });

  if (status.isPending) return <FullPageSpinner />;
  if (!status.data?.setupRequired) return <Navigate to="/sign-in" replace />;

  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl">Welcome to Disco Controller</h1>
          </CardTitle>
          <CardDescription>
            Choose a password for the admin account <strong>kali</strong>. You only need to do this
            once.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={form.handleSubmit((v) => setup.mutate(v))}>
            <FieldGroup>
              <FormField
                control={form.control}
                name="password"
                label="New password"
                description="At least 10 characters."
                render={({ field }) => (
                  <Input {...field} type="password" autoComplete="new-password" autoFocus />
                )}
              />
              <FormField
                control={form.control}
                name="confirm"
                label="Confirm password"
                render={({ field }) => (
                  <Input {...field} type="password" autoComplete="new-password" />
                )}
              />
              <Button type="submit" disabled={setup.isPending}>
                {setup.isPending && <Spinner />} Finish setup
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
