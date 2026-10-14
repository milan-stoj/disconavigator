import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { ContactFormDialog } from '@/components/crm/contact-form';
import { ArchiveFilterSelect, useArchiveFilter } from '@/components/crm/shared';
import { DataTable, columnHelper } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useContacts, type ContactListItem } from '@/lib/crm';

const h = columnHelper<ContactListItem>();
const columns = [
  h.accessor('name', {
    header: 'Name',
    enableHiding: false,
    cell: ({ row }) => (
      <div className="min-w-36">
        <div className="flex items-center gap-2 font-medium">
          {row.original.name}
          {row.original.archivedAt && <Badge variant="secondary">Archived</Badge>}
        </div>
        {row.original.role && (
          <div className="text-muted-foreground text-xs">{row.original.role}</div>
        )}
      </div>
    ),
  }),
  h.accessor((c) => c.organizationName ?? '', {
    id: 'organization',
    header: 'Organization',
    cell: (i) => i.getValue() || '—',
  }),
  h.accessor((c) => c.email ?? '', {
    id: 'email',
    header: 'Email',
    cell: (i) => i.getValue() || '—',
  }),
  h.accessor((c) => c.phone ?? '', {
    id: 'phone',
    header: 'Phone',
    cell: (i) => i.getValue() || '—',
  }),
];

export function ContactsPage() {
  const [archived, setArchived] = useArchiveFilter();
  const contacts = useContacts(archived);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Contacts"
        description="The people you work with: owners, bookers, and planners."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New contact
          </Button>
        }
      />
      <DataTable
        label="Contacts"
        columns={columns}
        data={contacts.data}
        isLoading={contacts.isPending}
        searchPlaceholder="Search contacts…"
        emptyMessage={archived === 'archived' ? 'No archived contacts.' : 'No contacts yet.'}
        getRowId={(c) => c.id}
        initialSorting={[{ id: 'name', desc: false }]}
        onRowClick={(c) => navigate(`/contacts/${c.id}`)}
        toolbar={<ArchiveFilterSelect value={archived} onChange={setArchived} />}
      />
      {creating && (
        <ContactFormDialog
          contact={null}
          onClose={() => setCreating(false)}
          onSaved={(c) => navigate(`/contacts/${c.id}`)}
        />
      )}
    </>
  );
}
