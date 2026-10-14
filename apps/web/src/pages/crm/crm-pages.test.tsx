import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/routes';
import { ME, mockApi, renderRoutes } from '@/test/utils';

afterEach(() => vi.unstubAllGlobals());

const BAR_X = {
  id: 'o1',
  name: 'Bar X',
  type: 'bar',
  city: 'Milwaukee',
  address: null,
  website: 'barx.test',
  phone: '(414) 555-0100',
  notes: null,
  competitorNote: 'Used Quiet Events last summer',
  archivedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  contacts: [
    {
      id: 'c1',
      organizationId: 'o1',
      name: 'Jordan',
      role: 'Owner',
      email: 'jordan@barx.test',
      phone: null,
      notes: null,
      archivedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  opportunities: [
    {
      id: 'p1',
      title: 'Summer silent disco',
      stage: 'quoted',
      eventDate: '2026-07-18',
      estimatedValueCents: 90000,
    },
  ],
};

const entry = (id: string, kind: string, body: string, createdAt: string) => ({
  id,
  subjectType: 'organization',
  subjectId: 'o1',
  kind,
  body,
  createdAt,
  authorName: 'Kali',
});

describe('organization detail', () => {
  it('logs a call that appears in the timeline', async () => {
    const timeline = [entry('a1', 'created', 'Created', '2026-01-01T00:00:00.000Z')];
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ body: ME }),
      'GET /api/organizations/o1': () => ({ body: BAR_X }),
      'GET /api/organizations': () => ({ body: [] }),
      'GET /api/organizations/o1/activity': () => ({ body: timeline }),
      'POST /api/organizations/o1/activity': ({ body }) => {
        const { kind, body: text } = body as { kind: string; body: string };
        const created = entry('a2', kind, text, '2026-02-01T18:00:00.000Z');
        timeline.unshift(created);
        return { status: 201, body: created };
      },
    });
    const user = userEvent.setup();
    renderRoutes(routes, '/organizations/o1');

    expect(await screen.findByRole('heading', { level: 1, name: /Bar X/ })).toBeInTheDocument();
    expect(screen.getByText('Used Quiet Events last summer')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Jordan' })).toHaveAttribute('href', '/contacts/c1');
    expect(screen.getByRole('link', { name: 'Summer silent disco' })).toHaveAttribute(
      'href',
      '/pipeline/p1',
    );
    const list = await screen.findByRole('list', { name: 'Activity timeline' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Log activity' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log activity' });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Note is required')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('combobox', { name: 'Type' }));
    await user.click(await screen.findByRole('option', { name: 'Call' }));
    await user.type(
      within(dialog).getByLabelText('What happened?'),
      'Jordan wants a Friday in July',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.body).toEqual({ kind: 'call', body: 'Jordan wants a Friday in July' });
    const updated = screen.getByRole('list', { name: 'Activity timeline' });
    await waitFor(() => expect(within(updated).getAllByRole('listitem')).toHaveLength(2));
    const first = within(updated).getAllByRole('listitem')[0]!;
    expect(first).toHaveTextContent('Call');
    expect(first).toHaveTextContent('Jordan wants a Friday in July');
    expect(first).toHaveTextContent('by Kali');
  });
});

describe('creating an organization', () => {
  it('warns about a possible duplicate and creates anyway when confirmed', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ body: ME }),
      'GET /api/organizations': () => ({ body: [] }),
      'POST /api/organizations': ({ body }) => {
        const b = body as { allowDuplicate?: boolean; name: string };
        if (!b.allowDuplicate) {
          return {
            status: 409,
            body: {
              error: 'duplicate',
              message: 'This organization may already exist',
              details: {
                duplicates: [
                  {
                    id: 'o1',
                    name: 'Bar X',
                    detail: 'Milwaukee',
                    archived: false,
                    matchedOn: ['name', 'city'],
                  },
                ],
              },
            },
          };
        }
        return { status: 201, body: { ...BAR_X, id: 'o2' } };
      },
      'GET /api/organizations/o2': () => ({ body: { ...BAR_X, id: 'o2' } }),
      'GET /api/organizations/o2/activity': () => ({ body: [] }),
    });
    const user = userEvent.setup();
    const { router } = renderRoutes(routes, '/organizations');

    await user.click(await screen.findByRole('button', { name: 'New organization' }));
    const dialog = await screen.findByRole('dialog', { name: 'New organization' });
    await user.type(within(dialog).getByLabelText('Name'), 'Bar X');
    await user.type(within(dialog).getByLabelText('City'), 'Milwaukee');
    await user.click(within(dialog).getByRole('button', { name: 'Add organization' }));

    const warning = await screen.findByRole('alertdialog', {
      name: 'This organization may already exist',
    });
    expect(within(warning).getByRole('link', { name: 'Open Bar X' })).toHaveAttribute(
      'href',
      '/organizations/o1',
    );
    expect(within(warning).getByText(/Same name and city/)).toBeInTheDocument();
    await user.click(within(warning).getByRole('button', { name: 'Create anyway' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/organizations/o2'));
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]!.body).toMatchObject({
      name: 'Bar X',
      city: 'Milwaukee',
      allowDuplicate: true,
    });
  });
});
