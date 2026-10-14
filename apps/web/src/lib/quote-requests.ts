import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BookingType } from '@disco/shared';
import { api } from '@/lib/api';

export interface QuoteRequest {
  id: string;
  opportunityId: string | null;
  name: string;
  email: string;
  phone: string | null;
  organization: string | null;
  serviceInterest: BookingType;
  eventDate: string;
  expectedAttendance: number;
  location: string;
  message: string | null;
  seenAt: string | null;
  createdAt: string;
}

export interface QuoteRequestList {
  items: QuoteRequest[];
  unseenCount: number;
}

export const quoteRequestKeys = { unseen: ['quote-requests', 'unseen'] as const };

/** New (unseen) quote requests; polled so the indicator updates without a reload. */
export function useNewQuoteRequests() {
  return useQuery({
    queryKey: quoteRequestKeys.unseen,
    queryFn: () => api.get<QuoteRequestList>('/api/quote-requests?unseen=true'),
    refetchInterval: 60_000,
  });
}

export function useMarkQuoteRequestsSeen() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: string[]) =>
      api.post<QuoteRequestList>('/api/quote-requests/seen', ids ? { ids } : {}),
    onSuccess: (data) => qc.setQueryData(quoteRequestKeys.unseen, data),
  });
}

export interface PublicTenant {
  name: string;
  slug: string;
  timeZone: string;
  serviceAreas: string[];
}
