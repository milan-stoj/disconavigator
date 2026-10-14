import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  BookingType,
  OpportunityStage,
  PricingTerm,
  QuoteLineKind,
  Shortfall,
} from '@disco/shared';
import { api } from '@/lib/api';
import { crmKeys } from '@/lib/crm';

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
};

export interface QuoteLine {
  id: string;
  position: number;
  kind: QuoteLineKind;
  description: string;
  quantity: number;
  unitPriceCents: number;
  packageId: string | null;
}

export interface QuoteFinancialsView {
  totalCents: number | null;
  depositCents: number;
  balanceCents: number | null;
  minimumCents: number | null;
  finalDeterminedAfterEvent: boolean;
  summary: string;
}

export interface QuoteRevision {
  id: string;
  revisionNumber: number;
  bookingType: BookingType;
  pricingTerm: PricingTerm;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  insideServiceArea: boolean;
  expectedAttendance: number | null;
  splitBps: number | null;
  guaranteeCents: number | null;
  depositBps: number;
  requirements: Record<string, number>;
  staffRequired: number;
  occurrenceDates: string[] | null;
  notes: string | null;
  expiresOn: string | null;
  sentAt: string | null;
  tokenRevokedAt: string | null;
  lines: QuoteLine[];
  financials: QuoteFinancialsView;
  publicUrl: string | null;
}

export interface OccurrenceAvailability {
  startDate: string;
  endDate: string;
  available: boolean;
  shortfalls: Shortfall[];
}

export interface Quote {
  id: string;
  number: number;
  displayNumber: string;
  status: QuoteStatus;
  bookingType: BookingType;
  opportunityId: string;
  sentAt: string | null;
  acceptedAt: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  opportunity: { id: string; title: string; stage: OpportunityStage };
  contact: { id: string; name: string; email: string | null } | null;
  organization: { id: string; name: string } | null;
  current: QuoteRevision;
  revisions: {
    id: string;
    revisionNumber: number;
    sentAt: string | null;
    tokenRevokedAt: string | null;
    totalCents: number | null;
    pricingTerm: PricingTerm;
    createdAt: string;
  }[];
  availability: OccurrenceAvailability[];
  acceptance: {
    fullName: string;
    acceptedAt: string;
    revisionId: string;
    ip: string | null;
  } | null;
  bookings: { id: string; number: number; status: string; startDate: string }[];
}

export interface QuoteListItem {
  id: string;
  number: number;
  displayNumber: string;
  status: QuoteStatus;
  bookingType: BookingType;
  opportunityId: string;
  opportunityTitle: string;
  startDate: string | null;
  endDate: string | null;
  occurrenceCount: number;
  pricingTerm: PricingTerm;
  totalCents: number | null;
  revisionNumber: number;
  sentAt: string | null;
  updatedAt: string;
}

export interface QuoteBody {
  opportunityId: string;
  bookingType: BookingType;
  pricingTerm: PricingTerm;
  startDate: string;
  endDate: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  insideServiceArea: boolean;
  expectedAttendance: number | null;
  lines: {
    kind: QuoteLineKind;
    description: string;
    quantity: number;
    unitPriceCents: number;
    packageId: string | null;
  }[];
  splitBps: number | null;
  guaranteeCents: number | null;
  requirements: Record<string, number>;
  staffRequired: number;
  occurrenceDates: string[] | null;
  notes: string | null;
}

export const quoteKeys = {
  all: ['quotes'] as const,
  list: (opportunityId?: string) => ['quotes', 'list', opportunityId ?? 'all'] as const,
  detail: (id: string) => ['quotes', id] as const,
};

export function useQuotes(opportunityId?: string) {
  return useQuery({
    queryKey: quoteKeys.list(opportunityId),
    queryFn: () =>
      api.get<QuoteListItem[]>(
        opportunityId ? `/api/quotes?opportunityId=${opportunityId}` : '/api/quotes',
      ),
  });
}

export function useQuote(id: string | undefined) {
  return useQuery({
    queryKey: quoteKeys.detail(id ?? ''),
    queryFn: () => api.get<Quote>(`/api/quotes/${id}`),
    enabled: !!id,
  });
}

/** Mutations that change a quote also move the opportunity and write activity. */
function useQuoteMutation<V>(fn: (v: V) => Promise<Quote>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (q) => {
      qc.setQueryData(quoteKeys.detail(q.id), q);
      void qc.invalidateQueries({ queryKey: ['quotes', 'list'] });
      void qc.invalidateQueries({ queryKey: crmKeys.opportunities });
      void qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}

export function useSaveQuote(id?: string) {
  return useQuoteMutation((body: QuoteBody) =>
    id ? api.put<Quote>(`/api/quotes/${id}`, body) : api.post<Quote>('/api/quotes', body),
  );
}

export function useSendQuote() {
  return useQuoteMutation((id: string) => api.post<Quote>(`/api/quotes/${id}/send`));
}

export function useDeclineQuote() {
  return useQuoteMutation(({ id, reason }: { id: string; reason: string | null }) =>
    api.post<Quote>(`/api/quotes/${id}/decline`, { reason }),
  );
}

export interface AvailabilityCheckBody {
  bookingType: BookingType;
  startDate: string;
  endDate: string;
  occurrenceDates: string[] | null;
  lines: { kind: QuoteLineKind; quantity: number; packageId: string | null }[];
  requirements: Record<string, number>;
  staffRequired: number;
}

/** Live capacity check for the builder; null body disables the query. */
export function useAvailabilityCheck(body: AvailabilityCheckBody | null) {
  return useQuery({
    queryKey: ['quotes', 'availability-check', body],
    queryFn: () => api.post<OccurrenceAvailability[]>('/api/quotes/availability-check', body),
    enabled: !!body,
    placeholderData: (prev) => prev,
  });
}

// ---------- Public ----------
export type PublicQuoteState = 'open' | 'expired' | 'revoked' | 'accepted' | 'declined';

export interface PublicQuote {
  state: PublicQuoteState;
  tenant: { name: string; slug: string };
  number: string;
  quote: {
    bookingType: BookingType;
    bookingTypeLabel: string;
    title: string;
    customerName: string | null;
    organizationName: string | null;
    pricingTerm: PricingTerm;
    startDate: string;
    endDate: string;
    startTime: string | null;
    endTime: string | null;
    location: string | null;
    expectedAttendance: number | null;
    occurrenceDates: string[] | null;
    lines: { kind: QuoteLineKind; description: string; quantity: number; unitPriceCents: number }[];
    splitBps: number | null;
    guaranteeCents: number | null;
    depositBps: number;
    financials: QuoteFinancialsView;
    notes: string | null;
    termsText: string;
    expiresOn: string | null;
    acceptedBy: { fullName: string; acceptedAt: string } | null;
    declinedAt: string | null;
  } | null;
}

export const publicQuoteKey = (token: string) => ['public-quote', token] as const;

export function usePublicQuote(token: string) {
  return useQuery({
    queryKey: publicQuoteKey(token),
    queryFn: () => api.get<PublicQuote>(`/api/public/quotes/${token}`, { allowUnauthorized: true }),
    retry: false,
  });
}

export function useAcceptPublicQuote(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { fullName: string; agreeToTerms: true }) =>
      api.post<{ bookingIds: string[] }>(`/api/public/quotes/${token}/accept`, body, {
        allowUnauthorized: true,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: publicQuoteKey(token) }),
  });
}

export function useDeclinePublicQuote(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { reason: string | null }) =>
      api.post(`/api/public/quotes/${token}/decline`, body, { allowUnauthorized: true }),
    onSettled: () => qc.invalidateQueries({ queryKey: publicQuoteKey(token) }),
  });
}

export const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
