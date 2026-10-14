import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Booking } from '@/lib/bookings';
import { routes } from '@/routes';
import { ME, mockApi, renderRoutes } from '@/test/utils';

afterEach(() => vi.unstubAllGlobals());

function booking(over: Partial<Booking> = {}): Booking {
  return {
    id: 'bk1',
    number: 12,
    numberLabel: 'B-12',
    opportunityId: 'o1',
    contactId: 'c1',
    organizationId: 'org1',
    quoteId: 'q1',
    seriesId: null,
    bookingType: 'full_service',
    status: 'confirmed',
    pricingTerm: 'door_split',
    title: 'Brew City silent disco',
    startDate: '2099-07-10',
    endDate: '2099-07-10',
    startTime: '21:00',
    endTime: '01:00',
    location: '123 Water St, Milwaukee',
    expectedAttendance: 150,
    totalCents: null,
    depositCents: 0,
    splitBps: 4000,
    guaranteeCents: null,
    staffRequired: 1,
    fulfillment: null,
    dispatchTime: null,
    returnTime: null,
    deliveryAddress: null,
    customerInstructions: null,
    confirmationSentAt: null,
    venueContact: 'Sam, 414-555-0100',
    loadInTime: '19:30',
    channels: 3,
    runOfShow: '9pm doors\n10pm theme set',
    confirmedAt: '2099-06-01T12:00:00Z',
    confirmOverrideReason: null,
    overbookingAcknowledged: false,
    cancelledAt: null,
    cancelReason: null,
    closedAt: null,
    needsInvoice: false,
    invoiceError: null,
    policy: { label: 'Full-service event' },
    organization: { id: 'org1', name: 'Brew City Bar' },
    contact: { id: 'c1', name: 'Pat Owner', email: 'pat@example.com', phone: '414-555-0199' },
    quote: { id: 'q1', eventDate: '2099-07-10' },
    requirements: [{ equipmentTypeId: 'hp', name: 'Headphones', quantity: 100 }],
    staff: [{ id: 's1', name: 'DJ Nova', phone: '414-555-0123' }],
    settlement: null,
    payments: [],
    charges: [],
    invoices: [],
    money: {
      owedCents: null,
      chargesCents: 0,
      paidCents: 0,
      balanceCents: null,
      settlementRequired: true,
      settled: false,
    },
    closeBlockers: [{ code: 'settlement_missing', message: 'Record the door settlement' }],
    overdue: false,
    equipment: {
      checkedOut: null,
      checkedIn: null,
      corrections: [],
      busyUnits: [],
      lines: [
        {
          equipmentTypeId: 'hp',
          name: 'Headphones',
          trackingMode: 'pooled',
          required: 100,
          checkedOut: 0,
          returned: 0,
          damaged: 0,
          missing: 0,
          found: 0,
          lossFeeCents: 6000,
          units: [],
        },
      ],
    },
    series: [],
    activity: [],
    ...over,
  };
}

describe('booking pages', () => {
  it('shows the event sheet with assigned DJs and tap-to-call phones', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ body: ME }),
      'GET /api/bookings/bk1': () => ({ body: booking() }),
    });
    renderRoutes(routes, '/bookings/bk1/sheet');
    const sheet = await screen.findByRole('article', { name: 'Brew City silent disco' });
    const djs = within(sheet).getByRole('list', { name: 'DJs' });
    expect(djs).toHaveTextContent('DJ Nova');
    expect(within(sheet).getByRole('link', { name: /414-555-0199/ })).toHaveAttribute(
      'href',
      'tel:414-555-0199',
    );
    expect(sheet).toHaveTextContent('7:30 PM');
    expect(sheet).toHaveTextContent('10pm theme set');
    expect(within(sheet).getByRole('button', { name: /print/i })).toBeInTheDocument();
  });

  it('records a door settlement from the booking page', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ body: ME }),
      'GET /api/bookings/bk1': () => ({ body: booking() }),
      'POST /api/bookings/bk1/settlement': () => ({
        status: 201,
        body: booking({
          settlement: {
            id: 'st1',
            doorRevenueCents: 150_000,
            splitBps: 4000,
            guaranteeCents: null,
            amountCents: 60_000,
            note: null,
            createdAt: '2099-07-11T12:00:00Z',
          },
          closeBlockers: [],
        }),
      }),
    });
    renderRoutes(routes, '/bookings/bk1');
    expect(await screen.findByRole('list', { name: 'Close blockers' })).toHaveTextContent(
      'Record the door settlement',
    );
    await userEvent.click(screen.getByRole('button', { name: /record settlement/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Door revenue'), '1500');
    expect(dialog).toHaveTextContent('Amount owed: $600.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record settlement' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/bookings/bk1/settlement',
        body: { doorRevenueCents: 150_000, note: null },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('list', { name: 'Close blockers' })).not.toBeInTheDocument();
  });

  it('hides admin-only confirmation from staff users', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ body: { ...ME, user: { ...ME.user, role: 'staff' } } }),
      'GET /api/bookings/bk1': () => ({
        body: booking({
          bookingType: 'equipment_rental',
          status: 'awaiting_deposit',
          pricingTerm: 'flat_fee',
          totalCents: 50_000,
          depositCents: 10_000,
          policy: { label: 'Equipment rental' },
          money: { ...booking().money, settlementRequired: false },
        }),
      }),
    });
    renderRoutes(routes, '/bookings/bk1');
    expect(
      await screen.findByText(/Waiting for the \$100\.00 holding deposit/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /confirm without deposit/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Logistics' })).toBeInTheDocument();
  });

  it('records a cash payment and approves a loss charge', async () => {
    const rental = booking({
      bookingType: 'equipment_rental',
      status: 'returned',
      pricingTerm: 'flat_fee',
      totalCents: 50_000,
      depositCents: 10_000,
      policy: { label: 'Equipment rental' },
      charges: [
        {
          id: 'ch1',
          kind: 'loss',
          proposedCents: 12_000,
          amountCents: null,
          status: 'proposed',
          reason: null,
        },
      ],
      money: {
        owedCents: 50_000,
        chargesCents: 0,
        paidCents: 10_000,
        balanceCents: 40_000,
        settlementRequired: false,
        settled: false,
      },
      invoiceError: 'Square is not connected; the invoice will be created once it is',
    });
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ body: ME }),
      'GET /api/bookings/bk1': () => ({ body: rental }),
      'POST /api/bookings/bk1/payments': () => ({ status: 201, body: rental }),
      'POST /api/bookings/bk1/charges/ch1/decision': () => ({ body: rental }),
    });
    const user = userEvent.setup();
    renderRoutes(routes, '/bookings/bk1?tab=payments');
    expect(await screen.findByText('Invoice not sent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry invoice/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /record payment/i }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Amount')).toHaveValue(400);
    await user.click(within(dialog).getByLabelText('Check'));
    await user.type(within(dialog).getByLabelText('Note'), '#1042');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    await waitFor(() =>
      expect(calls).toContainEqual(
        expect.objectContaining({
          method: 'POST',
          path: '/api/bookings/bk1/payments',
          body: expect.objectContaining({ amountCents: 40_000, method: 'check', note: '#1042' }),
        }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText('Amount');
    await user.clear(amount);
    await user.type(amount, '90');
    await user.click(within(dialog).getByRole('button', { name: 'Approve charge' }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/bookings/bk1/charges/ch1/decision',
        body: { action: 'approve', amountCents: 9_000 },
      }),
    );
  });

  it('requires a reason to waive a loss charge', async () => {
    const rental = booking({
      bookingType: 'equipment_rental',
      status: 'returned',
      charges: [
        {
          id: 'ch1',
          kind: 'loss',
          proposedCents: 12_000,
          amountCents: null,
          status: 'proposed',
          reason: null,
        },
      ],
    });
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ body: ME }),
      'GET /api/bookings/bk1': () => ({ body: rental }),
    });
    const user = userEvent.setup();
    renderRoutes(routes, '/bookings/bk1?tab=payments');
    await user.click(await screen.findByRole('button', { name: 'Waive' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Waive charge' }));
    expect(await within(dialog).findByText('Enter a reason for waiving')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});
