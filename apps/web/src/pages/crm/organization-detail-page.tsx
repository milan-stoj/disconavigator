import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ORGANIZATION_TYPE_LABELS } from '@disco/shared';
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ActivityTimeline } from '@/components/crm/activity-timeline';
import { ContactFormDialog } from '@/components/crm/contact-form';
import { OpportunityFormDialog } from '@/components/crm/opportunity-form';
import { OrganizationFormDialog } from '@/components/crm/organization-form';
import { DetailList, OpportunityList } from '@/components/crm/shared';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { crmKeys, setArchived, useOrganization } from '@/lib/crm';
import { NotFoundPage } from '@/pages/not-found';
import { ApiError } from '@/lib/api';

export function OrganizationDetailPage() {
  const { id = '' } = useParams();
  const org = useOrganization(id);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [addingOpportunity, setAddingOpportunity] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const archive = useMutation({
    mutationFn: (archived: boolean) => setArchived('organization', id, archived),
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: crmKeys.organizations });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      toast.success(o.archivedAt ? `${o.name} archived` : `${o.name} restored`);
    },
    onError: (err) => toast.error(err.message),
  });

  if (org.error instanceof ApiError && org.error.status === 404) return <NotFoundPage />;
  if (!org.data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  const o = org.data;
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {o.name}
            <Badge variant="outline">{ORGANIZATION_TYPE_LABELS[o.type]}</Badge>
            {o.archivedAt && <Badge variant="secondary">Archived</Badge>}
          </span>
        }
        description={o.city ?? undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <Button
              variant="outline"
              disabled={archive.isPending}
              onClick={() => archive.mutate(!o.archivedAt)}
            >
              {o.archivedAt ? (
                <>
                  <ArchiveRestore /> Restore
                </>
              ) : (
                <>
                  <Archive /> Archive
                </>
              )}
            </Button>
          </>
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Details</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DetailList
                items={[
                  ['Phone', o.phone && <a href={`tel:${o.phone}`}>{o.phone}</a>],
                  ['Address', o.address],
                  [
                    'Website',
                    o.website && (
                      <a
                        href={/^https?:\/\//.test(o.website) ? o.website : `https://${o.website}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                      >
                        {o.website}
                      </a>
                    ),
                  ],
                  ['Competitors', o.competitorNote],
                  ['Notes', o.notes],
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Contacts</h2>
              </CardTitle>
              <CardAction>
                <Button size="sm" variant="outline" onClick={() => setAddingContact(true)}>
                  <Plus /> Add contact
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {o.contacts.length ? (
                <ul className="divide-y" aria-label="Contacts">
                  {o.contacts.map((c) => (
                    <li key={c.id} className="py-2 first:pt-0">
                      <Link to={`/contacts/${c.id}`} className="font-medium hover:underline">
                        {c.name}
                      </Link>
                      {c.archivedAt && (
                        <Badge variant="secondary" className="ml-2">
                          Archived
                        </Badge>
                      )}
                      <div className="text-muted-foreground text-xs">
                        {[c.role, c.email, c.phone].filter(Boolean).join(' · ')}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No contacts yet.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Opportunities</h2>
              </CardTitle>
              <CardAction>
                <Button size="sm" variant="outline" onClick={() => setAddingOpportunity(true)}>
                  <Plus /> New opportunity
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              <OpportunityList opportunities={o.opportunities} />
            </CardContent>
          </Card>
        </div>
        <ActivityTimeline subject="organization" id={id} />
      </div>
      {addingOpportunity && (
        <OpportunityFormDialog
          opportunity={null}
          defaults={{ organizationId: id }}
          onClose={() => setAddingOpportunity(false)}
        />
      )}
      {editing && <OrganizationFormDialog organization={o} onClose={() => setEditing(false)} />}
      {addingContact && (
        <ContactFormDialog
          contact={null}
          organizationId={id}
          onClose={() => setAddingContact(false)}
        />
      )}
    </>
  );
}
