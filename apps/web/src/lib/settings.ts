import { useQuery } from '@tanstack/react-query';
import type { Settings } from '@disco/shared';
import { api } from './api';

export type SettingsView = Settings & {
  squareConnected: boolean;
  squareLocationName: string | null;
  squareEnvironment: 'sandbox' | 'production' | null;
  squareConnectedAt: string | null;
  squareWebhookConfigured: boolean;
  squareWebhookUrl: string;
  squareMode: 'live' | 'mock';
};

export interface SquareLocation {
  id: string;
  name: string;
}
export const settingsQueryKey = ['settings'] as const;

export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: () => api.get<SettingsView>('/api/settings'),
  });
}
