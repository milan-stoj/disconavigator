import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { signInSchema } from '@disco/shared';
import { TriangleAlert } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import type { z } from 'zod';
import { FullPageSpinner } from '@/components/app/app-layout';
import { FormField, applyServerErrors } from '@/components/form';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, ApiError } from '@/lib/api';
import { meQueryKey, useMe, type Me } from '@/lib/auth';
import { clearSessionExpired } from '@/lib/session';
import { AuthShell } from './auth-shell';

type SignInValues = z.infer<typeof signInSchema>;

/** Only allow same-app relative redirects. */
export function safeNext(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

export function SignInPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const expired = params.get('expired') === '1';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const setup = useQuery({
    queryKey: ['setup-status'],
    queryFn: () =>
      api.get<{ setupRequired: boolean }>('/api/setup/status', { allowUnauthorized: true }),
  });
  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { username: '', password: '' },
  });
  const signIn = useMutation({
    mutationFn: (values: SignInValues) =>
      api.post<Me>('/api/auth/sign-in', values, { allowUnauthorized: true }),
    onSuccess: (data) => {
      clearSessionExpired();
      qc.setQueryData(meQueryKey, data);
      void navigate(next, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        form.setError('root', { message: 'Incorrect username or password.' });
        form.setFocus('password');
      } else if (err instanceof ApiError && err.status === 429) {
        form.setError('root', { message: 'Too many attempts. Wait a minute and try again.' });
      } else applyServerErrors(form.setError, err);
    },
  });

  if (me.isPending || setup.isPending) return <FullPageSpinner />;
  if (me.data) return <Navigate to={next} replace />;
  if (setup.data?.setupRequired) return <Navigate to="/setup" replace />;

  const rootError = form.formState.errors.root?.message;
  return (
    <AuthShell>
      <Card>
        <CardHeader>
          <CardTitle>
            <h1 className="text-xl">Sign in</h1>
          </CardTitle>
          <CardDescription>Use your Disco Controller account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form noValidate onSubmit={form.handleSubmit((v) => signIn.mutate(v))}>
            <FieldGroup>
              {expired && !rootError && (
                <Alert>
                  <TriangleAlert />
                  <AlertTitle>Your session expired</AlertTitle>
                  <AlertDescription>Sign in again to continue where you left off.</AlertDescription>
                </Alert>
              )}
              {rootError && (
                <Alert variant="destructive">
                  <TriangleAlert />
                  <AlertTitle>{rootError}</AlertTitle>
                </Alert>
              )}
              <FormField
                control={form.control}
                name="username"
                label="Username"
                render={({ field }) => (
                  <Input {...field} autoComplete="username" autoCapitalize="none" autoFocus />
                )}
              />
              <FormField
                control={form.control}
                name="password"
                label="Password"
                render={({ field }) => (
                  <Input {...field} type="password" autoComplete="current-password" />
                )}
              />
              <Button type="submit" disabled={signIn.isPending}>
                {signIn.isPending && <Spinner />} Sign in
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </AuthShell>
  );
}
