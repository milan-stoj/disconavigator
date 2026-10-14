import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Pencil, Plus } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { ActivityTimeline } from '@/components/crm/activity-timeline';
import { ContactFormDialog } from '@/components/crm/contact-form';
import { OpportunityFormDialog } from '@/components/crm/opportunity-form';
import { DetailList, OpportunityList } from '@/components/crm/shared';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api';
import { crmKeys, setArchived, useContact } from '@/lib/crm';
import { NotFoundPage } from '@/pages/not-found';

export function ContactDetailPage() {
  const { id = '' } = useParams();
  const contact = useContact(id);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [addingOpportunity, setAddingOpportunity] = useState(false);
  const archive = useMutation({
    mutationFn: (archived: boolean) => setArchived('contact', id, archived),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: crmKeys.contacts });
      void qc.invalidateQueries({ queryKey: crmKeys.organizations });
      void qc.invalidateQueries({ queryKey: ['activity'] });
      toast.success(c.archivedAt ? `${c.name} archived` : `${c.name} restored`);
    },
    onError: (err) => toast.error(err.message),
  });

  if (contact.error instanceof ApiError && contact.error.status === 404) return <NotFoundPage />;
  if (!contact.data) {
    return (
      <div className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }
  const c = contact.data;
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {c.name}
            {c.archivedAt && <Badge variant="secondary">Archived</Badge>}
          </span>
        }
        description={[c.role, c.organizationName].filter(Boolean).join(' at ') || undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit
            </Button>
            <Button
              variant="outline"
              disabled={archive.isPending}
              onClick={() => archive.mutate(!c.archivedAt)}
            >
              {c.archivedAt ? (
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
                  [
                    'Organization',
                    c.organizationId && c.organizationName && (
                      <Link to={`/organizations/${c.organizationId}`} className="underline">
                        {c.organizationName}
                      </Link>
                    ),
                  ],
                  ['Email', c.email && <a href={`mailto:${c.email}`}>{c.email}</a>],
                  ['Phone', c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>],
                  ['Notes', c.notes],
                ]}
              />
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
              <OpportunityList opportunities={c.opportunities} />
            </CardContent>
          </Card>
        </div>
        <ActivityTimeline subject="contact" id={id} />
      </div>
      {addingOpportunity && (
        <OpportunityFormDialog
          opportunity={null}
          defaults={{ contactId: id, organizationId: c.organizationId }}
          onClose={() => setAddingOpportunity(false)}
        />
      )}
      {editing && <ContactFormDialog contact={c} onClose={() => setEditing(false)} />}
    </>
  );
}
