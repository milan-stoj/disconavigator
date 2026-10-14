import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MoneyOwedRow } from '@/lib/bookings';
import { routes } from '@/routes';
import { ME, mockApi, renderRoutes } from '@/test/utils';

afterEach(() => vi.unstubAllGlobals());

const row = (over: Partial<MoneyOwedRow>): MoneyOwedRow => ({
  id: 'bk1',
  numberLabel: 'B-1',
  title: 'Office party rental',
  bookingType: 'equipment_rental',
  status: 'awaiting_deposit',
  startDate: '2099-07-10',
  customerName: 'Acme Co',
  owedCents: 50_000,
  paidCents: 0,
  balanceCents: 50_000,
  dueDate: '2099-07-01',
  overdue: false,
  invoiceUrl: null,
  needsInvoice: true,
  invoiceError: null,
  ...over,
});

describe('money owed page', () => {
  it('lists balances with overdue badges and invoice links', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ body: ME }),
      'GET /api/money-owed': () => ({
        body: [
          row({ id: 'a', numberLabel: 'B-1', overdue: true, dueDate: '2020-01-01' }),
          row({
            id: 'b',
            numberLabel: 'B-2',
            customerName: 'Brew City Bar',
            bookingType: 'full_service',
            balanceCents: 80_000,
            owedCents: 80_000,
            invoiceUrl: 'https://squareup.test/pay-invoice/x',
            needsInvoice: false,
          }),
        ],
      }),
    });
    renderRoutes(routes, '/money-owed');
    const table = await screen.findByRole('table', { name: 'Money owed' });
    await within(table).findByText('B-1');
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('B-1');
    expect(within(rows[1]!).getByText('Overdue')).toBeInTheDocument();
    expect(within(rows[2]!).queryByText('Overdue')).not.toBeInTheDocument();
    expect(within(rows[2]!).getByRole('link', { name: /open in square/i })).toHaveAttribute(
      'href',
      'https://squareup.test/pay-invoice/x',
    );
    expect(screen.getByText('$1,300.00 outstanding, $500.00 overdue.')).toBeInTheDocument();
  });
});
