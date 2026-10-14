import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { DataTable, columnHelper } from './data-table';

interface Row {
  id: string;
  name: string;
  type: string;
  headphones: number;
}
const h = columnHelper<Row>();
const columns = [
  h.accessor('name', { header: 'Name', enableHiding: false }),
  h.accessor('type', { header: 'Type', filterFn: 'equalsString' }),
  h.accessor('headphones', { header: 'Headphones' }),
];
const rows: Row[] = [
  { id: '1', name: 'Bounce Bar', type: 'bar', headphones: 100 },
  { id: '2', name: 'Art Museum', type: 'venue', headphones: 50 },
  { id: '3', name: 'Cactus Club', type: 'bar', headphones: 75 },
];

const bodyNames = () =>
  within(screen.getByRole('table', { name: 'Venues' }))
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getAllByRole('cell')[0]!.textContent);

function setup(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}) {
  const user = userEvent.setup();
  render(
    <DataTable
      label="Venues"
      columns={columns}
      data={rows}
      getRowId={(r) => r.id}
      filters={[
        {
          columnId: 'type',
          title: 'Types',
          options: [
            { value: 'bar', label: 'Bar' },
            { value: 'venue', label: 'Venue' },
          ],
        },
      ]}
      {...props}
    />,
  );
  return user;
}

describe('DataTable', () => {
  it('sorts ascending then descending when a header is clicked', async () => {
    const user = setup();
    expect(bodyNames()).toEqual(['Bounce Bar', 'Art Museum', 'Cactus Club']);
    await user.click(screen.getByRole('button', { name: /^Name/ }));
    expect(bodyNames()).toEqual(['Art Museum', 'Bounce Bar', 'Cactus Club']);
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await user.click(screen.getByRole('button', { name: /^Name/ }));
    expect(bodyNames()).toEqual(['Cactus Club', 'Bounce Bar', 'Art Museum']);
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('sorts numbers numerically', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: /^Headphones/ }));
    expect(bodyNames()).toEqual(['Art Museum', 'Cactus Club', 'Bounce Bar']);
  });

  it('filters by global search', async () => {
    const user = setup();
    await user.type(screen.getByRole('textbox', { name: 'Search…' }), 'cactus');
    expect(bodyNames()).toEqual(['Cactus Club']);
    expect(screen.getByText('1 row')).toBeInTheDocument();
  });

  it('shows the empty message when nothing matches', async () => {
    const user = setup({ emptyMessage: 'No venues yet.' });
    await user.type(screen.getByRole('textbox', { name: 'Search…' }), 'zzz');
    expect(screen.getByText('No venues yet.')).toBeInTheDocument();
  });

  it('paginates', async () => {
    const user = setup({ pageSize: 2 });
    expect(bodyNames()).toHaveLength(2);
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(bodyNames()).toEqual(['Cactus Club']);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
  });

  it('hides columns from the column menu', async () => {
    const user = setup();
    expect(screen.getByRole('columnheader', { name: /Type/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Columns/ }));
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'Type' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('columnheader', { name: /Type/ })).not.toBeInTheDocument();
  });
});
