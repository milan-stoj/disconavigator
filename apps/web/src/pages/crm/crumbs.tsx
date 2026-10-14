import { useContact, useOpportunity, useOrganization } from '@/lib/crm';

export function OrganizationCrumb({ id }: { id: string }) {
  return <>{useOrganization(id).data?.name ?? 'Organization'}</>;
}

export function ContactCrumb({ id }: { id: string }) {
  return <>{useContact(id).data?.name ?? 'Contact'}</>;
}

export function OpportunityCrumb({ id }: { id: string }) {
  return <>{useOpportunity(id).data?.title ?? 'Opportunity'}</>;
}
