import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  STAGE_LABELS,
  type ActivityKind,
  type BookingType,
  type LossReason,
  type OpportunityStage,
  type OrganizationType,
} from '@disco/shared';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api';

export type ArchiveFilter = 'active' | 'archived' | 'all';

export interface Organization {
  id: string;
  name: string;
  type: OrganizationType;
  city: string | null;
  address: string | null;
  website: string | null;
  phone: string | null;
  notes: string | null;
  competitorNote: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface OrganizationListItem extends Organization {
  contactCount: number;
  openOpportunityCount: number;
  lastActivityAt: string | null;
}

export interface Contact {
  id: string;
  organizationId: string | null;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
}

export interface ContactListItem extends Contact {
  organizationName: string | null;
}

export interface Opportunity {
  id: string;
  title: string;
  organizationId: string | null;
  organizationName: string | null;
  contactId: string | null;
  contactName: string | null;
  stage: OpportunityStage;
  serviceInterest: BookingType | null;
  eventDate: string | null;
  expectedAttendance: number | null;
  estimatedValueCents: number | null;
  source: string;
  lossReason: LossReason | null;
  lossNote: string | null;
  needsLossReason: boolean;
  notes: string | null;
  stageChangedAt: string;
  closedAt: string | null;
  createdAt: string;
}

export interface OrganizationDetail extends Organization {
  contacts: Contact[];
  opportunities: Opportunity[];
}

export interface ContactDetail extends Contact {
  organizationName: string | null;
  opportunities: Opportunity[];
}

export interface ActivityEntry {
  id: string;
  subjectType: string;
  subjectId: string;
  kind: string;
  body: string | null;
  createdAt: string;
  authorName: string | null;
}

export interface DuplicateMatch {
  id: string;
  name: string;
  detail: string | null;
  archived: boolean;
  matchedOn: string[];
}

export type ActivitySubject = 'organization' | 'contact' | 'opportunity';
const SUBJECT_PATHS: Record<ActivitySubject, string> = {
  organization: '/api/organizations',
  contact: '/api/contacts',
  opportunity: '/api/opportunities',
};

export const crmKeys = {
  organizations: ['organizations'] as const,
  contacts: ['contacts'] as const,
  opportunities: ['opportunities'] as const,
  activity: (subject: ActivitySubject, id: string) => ['activity', subject, id] as const,
};

function qs(params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function useOrganizations(archived: ArchiveFilter = 'active') {
  return useQuery({
    queryKey: [...crmKeys.organizations, 'list', archived],
    queryFn: () => api.get<OrganizationListItem[]>(`/api/organizations${qs({ archived })}`),
    placeholderData: keepPreviousData,
  });
}

export function useOrganization(id: string) {
  return useQuery({
    queryKey: [...crmKeys.organizations, id],
    queryFn: () => api.get<OrganizationDetail>(`/api/organizations/${id}`),
  });
}

export function useContacts(archived: ArchiveFilter = 'active') {
  return useQuery({
    queryKey: [...crmKeys.contacts, 'list', archived],
    queryFn: () => api.get<ContactListItem[]>(`/api/contacts${qs({ archived })}`),
    placeholderData: keepPreviousData,
  });
}

export function useContact(id: string) {
  return useQuery({
    queryKey: [...crmKeys.contacts, id],
    queryFn: () => api.get<ContactDetail>(`/api/contacts/${id}`),
  });
}

export function useOpportunities(params: { closedSince?: string } = {}) {
  return useQuery({
    queryKey: [...crmKeys.opportunities, 'list', params],
    queryFn: () => api.get<Opportunity[]>(`/api/opportunities${qs(params)}`),
  });
}

export function useOpportunity(id: string) {
  return useQuery({
    queryKey: [...crmKeys.opportunities, id],
    queryFn: () => api.get<Opportunity>(`/api/opportunities/${id}`),
  });
}

export function useActivity(subject: ActivitySubject, id: string) {
  return useQuery({
    queryKey: crmKeys.activity(subject, id),
    queryFn: () => api.get<ActivityEntry[]>(`${SUBJECT_PATHS[subject]}/${id}/activity`),
  });
}

export function logActivity(
  subject: ActivitySubject,
  id: string,
  body: { kind: ActivityKind; body: string },
) {
  return api.post<ActivityEntry>(`${SUBJECT_PATHS[subject]}/${id}/activity`, body);
}

export function setArchived(subject: 'organization' | 'contact', id: string, archived: boolean) {
  return api.put<Organization | Contact>(`${SUBJECT_PATHS[subject]}/${id}/archived`, {
    archived,
  });
}

export const ACTIVITY_KIND_LABELS: Record<string, string> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  created: 'Created',
  updated: 'Updated',
  archived: 'Archived',
  restored: 'Restored',
  stage_changed: 'Stage changed',
  quote_request: 'Quote request',
  quote_created: 'Quote created',
  quote_revised: 'Quote revised',
  quote_sent: 'Quote sent',
  quote_accepted: 'Quote accepted',
  quote_declined: 'Quote declined',
  booking_created: 'Booking created',
  booking_confirmed: 'Booking confirmed',
  booking_cancelled: 'Booking cancelled',
  booking_closed: 'Booking closed',
  status_changed: 'Status changed',
  event_details_updated: 'Event details updated',
  staff_assigned: 'DJs assigned',
  logistics_updated: 'Logistics updated',
  rental_confirmation_sent: 'Confirmation sent',
  settlement_recorded: 'Settlement recorded',
  checked_out: 'Equipment checked out',
  checked_in: 'Equipment checked in',
  equipment_found: 'Missing equipment found',
  return_overdue: 'Return overdue',
  invoice_published: 'Invoice sent',
  payment_received: 'Payment received',
  payment_recorded: 'Payment recorded',
  charge_approved: 'Charge approved',
  charge_waived: 'Charge waived',
  charge_collected: 'Card charged',
  charge_card_declined: 'Card declined',
};

export const SOURCE_LABELS: Record<string, string> = {
  manual: 'Added by hand',
  quote_request: 'Website quote request',
};

export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );

export interface StageChangeInput {
  stage: OpportunityStage;
  lossReason?: LossReason | null;
  lossNote?: string | null;
}

/** Moves an opportunity to a stage, updating cached lists immediately and rolling back on error. */
export function useChangeStage() {
  const qc = useQueryClient();
  const listKey = [...crmKeys.opportunities, 'list'];
  return useMutation({
    mutationFn: ({ id, change }: { id: string; change: StageChangeInput }) =>
      api.post<Opportunity>(`/api/opportunities/${id}/stage`, change),
    onMutate: async ({ id, change }) => {
      await qc.cancelQueries({ queryKey: listKey });
      const snapshots = qc.getQueriesData<Opportunity[]>({ queryKey: listKey });
      const closed = change.stage === 'won' || change.stage === 'lost';
      qc.setQueriesData<Opportunity[]>({ queryKey: listKey }, (old) =>
        old?.map((o) =>
          o.id === id
            ? {
                ...o,
                stage: change.stage,
                closedAt: closed ? new Date().toISOString() : null,
                needsLossReason: false,
              }
            : o,
        ),
      );
      return { snapshots };
    },
    onError: (err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(errorMessage(err));
    },
    onSuccess: (o) => toast.success(`${o.title} moved to ${STAGE_LABELS[o.stage]}`),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: crmKeys.opportunities });
      void qc.invalidateQueries({ queryKey: crmKeys.organizations });
      void qc.invalidateQueries({ queryKey: crmKeys.contacts });
      void qc.invalidateQueries({ queryKey: ['activity'] });
    },
  });
}
