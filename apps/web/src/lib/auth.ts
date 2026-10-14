import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from './api';

export interface Me {
  user: { id: string; username: string; displayName: string; role: 'admin' | 'staff' };
  tenant: { id: string; name: string; timeZone: string };
}

export const meQueryKey = ['auth', 'me'] as const;

export function fetchMe(): Promise<Me | null> {
  return api.get<Me>('/api/auth/me', { allowUnauthorized: true }).catch((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  });
}

export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: fetchMe, staleTime: 60_000 });
}

export function useIsAdmin() {
  return useMe().data?.user.role === 'admin';
}
