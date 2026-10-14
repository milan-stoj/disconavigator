import { screen, within } from '@testing-library/react';
import { addDays, diffDays } from '@disco/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Dashboard } from '@/lib/dashboard';
import { routes } from '@/routes';
import { ME, mockApi, renderRoutes } from '@/test/utils';

afterEach(() => vi.unstubAllGlobals());

const DASHBOARD: Dashboard = {
  today: '2099-07-01',
  upcoming: [
    {
      id: 'b1',
      numberLabel: 'B-1',
      title: 'Office party rental',
      bookingType: 'equipment_rental',
      status: 'confirmed',
      startDate: '2099-07-05',
      endDate: '2099-07-06',
      startTime: null,
      customerName: 'Acme Co',
    },
  ],
  overdueReturns: [
    {
      id: 'b2',
      numberLabel: 'B-2',
      title: 'Wedding rental',
      bookingType: 'equipment_rental',
      status: 'out',
      startDate: '2099-06-25',
      endDate: '2099-06-27',
      startTime: null,
      customerName: 'Pat Smith',
      returnTime: '10:00',
      overdueAt: '2099-06-27T16:00:00Z',
    },
  ],
  moneyOwed: { totalCents: 130_000, count: 3, overdueCents: 40_000, overdueCount: 1 },
  pendingCharges: [
    {
      id: 'ch1',
      bookingId: 'b3',
      numberLabel: 'B-3',
      title: 'Town festival',
      kind: 'loss',
      proposedCents: 18_000,
      createdAt: '2099-06-30T12:00:00Z',
      customerName: 'Village of Shorewood',
    },
  ],
};

function setup(withConflict: boolean, dashboard: Dashboard = DASHBOARD) {
  let overbooked = '';
  const { calls } = mockApi({
    'GET /api/dashboard': () => ({ body: dashboard }),
    'GET /api/auth/me': () => ({ body: ME }),
    'GET /api/quote-requests': () => ({ body: { items: [], unseenCount: 0 } }),
    'GET /api/availability': ({ url }) => {
      const from = url.searchParams.get('from')!;
      overbooked = addDays(from, 5);
      return {
        body: {
          from,
          to: url.searchParams.get('to'),
          bufferDays: 1,
          equipmentTypes: [{ id: 'hp', name: 'Headphones' }],
          staff: [],
          staffUnavailability: [],
          days: [],
          bookings: [],
          conflicts: withConflict
            ? [
                {
                  date: overbooked,
                  fleetSplit: true,
                  shortfalls: [
                    { resource: 'hp', shortfall: 30 },
                    { resource: 'staff', shortfall: 1 },
                  ],
                  holds: [
                    {
                      id: 'b1',
                      source: 'booking',
                      label: 'Brew City night',
                      strength: 'confirmed',
                      bookingType: 'full_service',
                    },
                    {
                      id: 'b2',
                      source: 'booking',
                      label: 'Taproom party',
                      strength: 'confirmed',
                      bookingType: 'full_service',
                    },
                  ],
                },
              ]
            : [],
        },
      };
    },
  });
  renderRoutes(routes, '/');
  return { calls, overbooked: () => overbooked };
}

describe('dashboard conflicts widget', () => {
  it('lists an overbooked date with its shortfalls', async () => {
    const { calls, overbooked } = setup(true);
    const list = await screen.findByRole('list', { name: 'Capacity conflicts' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    const link = within(items[0]!).getByRole('link');
    expect(link).toHaveAttribute('href', `/calendar?view=day&date=${overbooked()}`);
    expect(items[0]).toHaveTextContent('Brew City night, Taproom party');
    expect(items[0]).toHaveTextContent('Headphones short 30 · DJs short 1 · Fleet split');

    const call = calls.find((c) => c.path.startsWith('/api/availability'))!;
    const q = new URL(call.path, 'http://x').searchParams;
    expect(diffDays(q.get('from')!, q.get('to')!)).toBe(89);
  });

  it('says when everything fits', async () => {
    setup(false);
    expect(await screen.findByText('No conflicts. Everything fits.')).toBeInTheDocument();
  });
});

describe('dashboard widgets', () => {
  it('renders each widget from fixture data', async () => {
    setup(false);
    const money = await screen.findByRole('region', { name: 'Money owed' });
    expect(await within(money).findByText('$1,300.00')).toBeInTheDocument();
    expect(money).toHaveTextContent('$400.00');
    expect(within(money).getByRole('link', { name: 'View all' })).toHaveAttribute(
      'href',
      '/money-owed',
    );

    const upcoming = screen.getByRole('list', { name: 'Upcoming bookings' });
    expect(upcoming).toHaveTextContent('B-1 · Office party rental');
    expect(upcoming).toHaveTextContent('Acme Co');
    expect(within(upcoming).getByRole('link')).toHaveAttribute('href', '/bookings/b1');

    const overdue = screen.getByRole('list', { name: 'Overdue returns' });
    expect(overdue).toHaveTextContent('B-2 · Wedding rental');
    expect(overdue).toHaveTextContent('10:00 AM');

    const charges = screen.getByRole('list', { name: 'Pending loss charges' });
    expect(charges).toHaveTextContent('$180.00');
    expect(within(charges).getByRole('link')).toHaveAttribute('href', '/bookings/b3?tab=payments');

    expect(await screen.findByText("You're all caught up.")).toBeInTheDocument();
    expect(await screen.findByText('No conflicts. Everything fits.')).toBeInTheDocument();
  });

  it('shows empty states', async () => {
    setup(false, {
      ...DASHBOARD,
      upcoming: [],
      overdueReturns: [],
      pendingCharges: [],
      moneyOwed: { totalCents: 0, count: 0, overdueCents: 0, overdueCount: 0 },
    });
    expect(await screen.findByText('All gear is back on time.')).toBeInTheDocument();
    expect(screen.getByText('Nothing booked in the next two weeks.')).toBeInTheDocument();
    expect(screen.getByText('No charges to review.')).toBeInTheDocument();
  });
});
