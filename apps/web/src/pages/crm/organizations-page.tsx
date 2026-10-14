import { useMemo, useState } from 'react';
import { ORGANIZATION_TYPE_LABELS, ORGANIZATION_TYPES } from '@disco/shared';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { OrganizationFormDialog } from '@/components/crm/organization-form';
import { ArchiveFilterSelect, useArchiveFilter } from '@/components/crm/shared';
import { DataTable, columnHelper } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useOrganizations, type OrganizationListItem } from '@/lib/crm';
import { formatDateTime } from '@/lib/inventory';

const h = columnHelper<OrganizationListItem>();
const columns = [
  h.accessor('name', {
    header: 'Name',
    enableHiding: false,
    cell: ({ row }) => (
      <div className="min-w-40">
        <div className="flex items-center gap-2 font-medium">
          {row.original.name}
          {row.original.archivedAt && <Badge variant="secondary">Archived</Badge>}
        </div>
        {row.original.city && (
          <div className="text-muted-foreground text-xs">{row.original.city}</div>
        )}
      </div>
    ),
  }),
  h.accessor('type', {
    header: 'Type',
    filterFn: 'equalsString',
    cell: (info) => ORGANIZATION_TYPE_LABELS[info.getValue()],
  }),
  h.accessor('contactCount', { header: 'Contacts', cell: (i) => i.getValue() }),
  h.accessor('openOpportunityCount', { header: 'Open deals', cell: (i) => i.getValue() }),
  h.accessor('lastActivityAt', {
    header: 'Last activity',
    cell: (i) => {
      const v = i.getValue();
      return v ? <span className="text-muted-foreground">{formatDateTime(v)}</span> : '—';
    },
  }),
  // Hidden, so the table search also matches city, notes, and competitor notes.
  h.accessor((o) => [o.city, o.notes, o.competitorNote].filter(Boolean).join(' '), {
    id: 'searchText',
    header: 'Details',
    enableHiding: false,
  }),
];

export function OrganizationsPage() {
  const [archived, setArchived] = useArchiveFilter();
  const orgs = useOrganizations(archived);
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const filters = useMemo(
    () => [
      {
        columnId: 'type',
        title: 'Types',
        options: ORGANIZATION_TYPES.map((t) => ({ value: t, label: ORGANIZATION_TYPE_LABELS[t] })),
      },
    ],
    [],
  );
  return (
    <>
      <PageHeader
        title="Organizations"
        description="Bars, venues, towns, and businesses you work with or want to."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New organization
          </Button>
        }
      />
      <DataTable
        label="Organizations"
        columns={columns}
        data={orgs.data}
        isLoading={orgs.isPending}
        searchPlaceholder="Search organizations…"
        emptyMessage={
          archived === 'archived'
            ? 'No archived organizations.'
            : 'No organizations yet. Add the bars and venues you work with.'
        }
        getRowId={(o) => o.id}
        initialSorting={[{ id: 'name', desc: false }]}
        initialColumnVisibility={{ searchText: false }}
        onRowClick={(o) => navigate(`/organizations/${o.id}`)}
        filters={filters}
        toolbar={<ArchiveFilterSelect value={archived} onChange={setArchived} />}
      />
      {creating && (
        <OrganizationFormDialog
          organization={null}
          onClose={() => setCreating(false)}
          onSaved={(o) => navigate(`/organizations/${o.id}`)}
        />
      )}
    </>
  );
}
