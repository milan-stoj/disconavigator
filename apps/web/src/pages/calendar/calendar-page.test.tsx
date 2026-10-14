import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { eachDate, type CapacityDay } from '@disco/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/routes';
import { ME, mockApi, renderRoutes } from '@/test/utils';
import { addMonths, keyTarget, visibleRange } from './calendar-utils';

afterEach(() => vi.unstubAllGlobals());

const HP = 'hp';
const TX = 'tx';
const CONFLICT_DATE = '2099-07-11';

function capacityDay(date: string): CapacityDay {
  const conflict = date === CONFLICT_DATE;
  const quoted = date === '2099-07-14';
  return {
    date,
    equipment: {
      [HP]: {
        equipmentTypeId: HP,
        usable: 100,
        committed: conflict ? 130 : 0,
        tentative: conflict ? 30 : 0,
        softDemand: quoted ? 60 : 0,
        available: conflict ? 0 : 100,
        shortfall: conflict ? 30 : 0,
      },
      [TX]: {
        equipmentTypeId: TX,
        usable: 3,
        committed: conflict ? 2 : 0,
        tentative: 0,
        softDemand: 0,
        available: conflict ? 1 : 3,
        shortfall: 0,
      },
    },
    staff: {
      total: 2,
      unavailable: 0,
      committed: conflict ? 1 : 0,
      available: conflict ? 1 : 2,
      shortfall: 0,
      doubleBookedStaffIds: [],
      assignedButUnavailableIds: [],
    },
    holds: conflict
      ? [
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
            label: 'Garden party',
            strength: 'tentative',
            bookingType: 'equipment_rental',
          },
        ]
      : quoted
        ? [
            {
              id: 'q1',
              source: 'quote',
              label: 'Quote Q-7',
              strength: 'soft',
              bookingType: 'equipment_rental',
            },
          ]
        : [],
    fleetSplit: false,
    conflict,
  };
}

function setup(path = `/calendar?view=month&date=${CONFLICT_DATE}`) {
  const { calls } = mockApi({
    'GET /api/auth/me': () => ({ body: ME }),
    'GET /api/availability': ({ url }) => {
      const from = url.searchParams.get('from')!;
      const to = url.searchParams.get('to')!;
      const days = eachDate(from, to).map(capacityDay);
      return {
        body: {
          from,
          to,
          bufferDays: 1,
          equipmentTypes: [
            { id: HP, name: 'Headphones' },
            { id: TX, name: 'Transmitters' },
          ],
          staff: [
            { id: 's1', name: 'DJ 1', active: true },
            { id: 's2', name: 'DJ 2', active: true },
          ],
          staffUnavailability: [],
          days,
          bookings: days.some((d) => d.date === CONFLICT_DATE)
            ? [
                {
                  id: 'b1',
                  number: 4,
                  title: 'Brew City night',
                  bookingType: 'full_service',
                  status: 'confirmed',
                  overdue: false,
                  strength: 'confirmed',
                  startDate: CONFLICT_DATE,
                  endDate: CONFLICT_DATE,
                  holdEndDate: '2099-07-12',
                  staffRequired: 1,
                },
                {
                  id: 'b2',
                  number: 5,
                  title: 'Garden party',
                  bookingType: 'equipment_rental',
                  status: 'awaiting_deposit',
                  overdue: false,
                  strength: 'tentative',
                  startDate: CONFLICT_DATE,
                  endDate: CONFLICT_DATE,
                  holdEndDate: '2099-07-12',
                  staffRequired: 0,
                },
              ]
            : [],
          conflicts: days
            .filter((d) => d.conflict)
            .map((d) => ({
              date: d.date,
              fleetSplit: false,
              shortfalls: [{ resource: HP, shortfall: 30 }],
              holds: d.holds,
            })),
        },
      };
    },
  });
  const utils = renderRoutes(routes, path);
  return { ...utils, calls };
}

const cell = (date: string) =>
  document.querySelector<HTMLElement>(`[role="gridcell"][data-date="${date}"]`)!;

describe('calendar utils', () => {
  it('builds whole-week month ranges and moves by keys', () => {
    expect(visibleRange('month', '2099-07-11')).toEqual({ from: '2099-06-28', to: '2099-08-01' });
    expect(visibleRange('week', '2099-07-11')).toEqual({ from: '2099-07-05', to: '2099-07-11' });
    expect(addMonths('2099-01-31', 1)).toBe('2099-02-28');
    expect(keyTarget('ArrowUp', '2099-07-11')).toBe('2099-07-04');
    expect(keyTarget('End', '2099-07-08')).toBe('2099-07-11');
    expect(keyTarget('Tab', '2099-07-08')).toBeNull();
  });
});

describe('calendar page', () => {
  it('highlights a conflict day and explains the shortfall', async () => {
    setup();
    const grid = await screen.findByRole('grid', { name: 'Capacity calendar, July 2099' });
    await waitFor(() => expect(cell(CONFLICT_DATE)).toHaveAttribute('data-conflict', 'true'));
    expect(cell('2099-07-10')).not.toHaveAttribute('data-conflict');
    expect(cell(CONFLICT_DATE)).toHaveAccessibleName(
      expect.stringContaining('Saturday, July 11, 2099. Conflict. Headphones 0 of 100 available'),
    );
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(35);

    // Range banner and day details
    const banner = screen.getByText('1 date has a capacity conflict').closest('[role="alert"]')!;
    expect(
      within(banner as HTMLElement).getByRole('button', { name: 'Jul 11' }),
    ).toBeInTheDocument();
    const details = screen.getByRole('region', { name: 'Day details' });
    expect(within(details).getByText('Headphones short by 30')).toBeInTheDocument();
    const bookings = within(details).getByRole('list', { name: 'Bookings on this day' });
    expect(within(bookings).getByRole('link', { name: 'B-4 · Brew City night' })).toHaveAttribute(
      'href',
      '/bookings/b1',
    );
    expect(within(bookings).getByText('Tentative')).toBeInTheDocument();
    expect(within(bookings).getByText('Confirmed')).toBeInTheDocument();
    expect(
      within(details).getByText(/0 available of 100 · 130 committed \(30 tentative\)/),
    ).toBeInTheDocument();

    // Tentative vs confirmed chips in the grid
    const strengths = [...cell(CONFLICT_DATE).querySelectorAll('[data-strength]')].map((e) =>
      e.getAttribute('data-strength'),
    );
    expect(strengths).toEqual(['confirmed', 'tentative']);
  });

  it('shows quotes as indicators without reducing capacity', async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(cell('2099-07-14')).toHaveAccessibleName(/1 pending quote/));
    await user.click(cell('2099-07-14'));
    const details = await screen.findByRole('region', { name: 'Day details' });
    expect(
      within(details).getByRole('heading', { name: 'Tuesday, July 14, 2099' }),
    ).toBeInTheDocument();
    expect(
      within(details).getByText(/100 available of 100 · 0 committed · 60 quoted/),
    ).toBeInTheDocument();
    expect(
      within(within(details).getByRole('list', { name: 'Quotes on this day' })).getByRole('link', {
        name: 'Quote Q-7',
      }),
    ).toHaveAttribute('href', '/quotes/q1');
  });

  it('moves between days with the keyboard and opens the day view', async () => {
    const user = userEvent.setup();
    const { router, calls } = setup();
    await screen.findByRole('grid');
    await waitFor(() => expect(cell(CONFLICT_DATE)).toHaveAttribute('tabindex', '0'));
    cell(CONFLICT_DATE).focus();

    await user.keyboard('{ArrowRight}');
    await waitFor(() => expect(cell('2099-07-12')).toHaveFocus());
    expect(cell('2099-07-12')).toHaveAttribute('aria-selected', 'true');
    expect(cell(CONFLICT_DATE)).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(cell('2099-07-19')).toHaveFocus());
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    await waitFor(() => expect(cell('2099-07-11')).toHaveFocus());

    // Crossing into the next month re-renders the grid and keeps focus
    await user.keyboard('{PageDown}');
    await waitFor(() => expect(cell('2099-08-11')).toHaveFocus());
    expect(
      screen.getByRole('grid', { name: 'Capacity calendar, August 2099' }),
    ).toBeInTheDocument();
    const aug = visibleRange('month', '2099-08-11');
    expect(calls.some((c) => c.path === `/api/availability?from=${aug.from}&to=${aug.to}`)).toBe(
      true,
    );

    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.search).toBe('?view=day&date=2099-08-11'));
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Tuesday, August 11, 2099' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Day details' })).getByText('Headphones'),
    ).toBeInTheDocument();
  });

  it('switches to the week view', async () => {
    const user = userEvent.setup();
    setup();
    await screen.findByRole('grid');
    await user.click(screen.getByRole('radio', { name: 'Week' }));
    const grid = await screen.findByRole('grid', {
      name: 'Capacity calendar, Jul 5 – Jul 11, 2099',
    });
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(7);
    await user.click(screen.getByRole('button', { name: 'Next week' }));
    expect(
      await screen.findByRole('grid', { name: 'Capacity calendar, Jul 12 – Jul 18, 2099' }),
    ).toBeInTheDocument();
  });
});
