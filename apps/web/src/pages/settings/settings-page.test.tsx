import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routes } from '@/routes';
import { ME, mockApi, renderRoutes } from '@/test/utils';

afterEach(() => vi.unstubAllGlobals());

const SETTINGS = {
  businessName: 'Undercover Dance Party',
  timeZone: 'America/Chicago',
  notificationEmail: null,
  rentalDepositBps: 2000,
  bufferDays: 1,
  rentalBalanceDueDays: 7,
  fullServiceInvoiceDueOffsetDays: 0,
  deliveryFeeCents: 7500,
  serviceAreas: ['Milwaukee metro', 'Madison metro'],
  quoteValidityDays: 14,
  rentalTerms: 'Rental terms',
  fullServiceTerms: 'Event terms',
  rentalUsageInstructions: '',
  squareConnected: false,
  squareLocationName: null,
  squareEnvironment: null,
  squareConnectedAt: null,
  squareWebhookConfigured: false,
  squareWebhookUrl: 'http://localhost:5173/api/webhooks/square/undercover-dance-party',
  squareMode: 'mock',
};

describe('settings page', () => {
  it('shows percent and dollars, and saves basis points and cents', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ body: ME }),
      'GET /api/settings': () => ({ body: SETTINGS }),
      'PUT /api/settings': ({ body }) => ({ body: { ...SETTINGS, ...(body as object) } }),
    });
    const user = userEvent.setup();
    renderRoutes(routes, '/settings');
    const deposit = await screen.findByLabelText('Holding deposit');
    expect(deposit).toHaveValue(20);
    expect(screen.getByLabelText('Suggested delivery fee')).toHaveValue(75);

    await user.clear(deposit);
    await user.type(deposit, '25');
    await user.clear(screen.getByLabelText('Suggested delivery fee'));
    await user.type(screen.getByLabelText('Suggested delivery fee'), '82.50');
    await user.type(screen.getByLabelText('Service areas'), '\nWaukesha');
    await user.click(screen.getByRole('button', { name: 'Save settings' }));

    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.method === 'PUT')!.body as Record<string, unknown>;
    expect(put).toMatchObject({
      rentalDepositBps: 2500,
      deliveryFeeCents: 8250,
      serviceAreas: ['Milwaukee metro', 'Madison metro', 'Waukesha'],
      notificationEmail: null,
    });
    expect(await screen.findByText('Settings saved')).toBeInTheDocument();
  });

  it('validates before saving', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ body: ME }),
      'GET /api/settings': () => ({ body: SETTINGS }),
    });
    const user = userEvent.setup();
    renderRoutes(routes, '/settings');
    const deposit = await screen.findByLabelText('Holding deposit');
    await user.clear(deposit);
    await user.type(deposit, '150');
    await user.clear(screen.getByLabelText('Turnaround buffer'));
    await user.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Must be 100% or less')).toBeInTheDocument();
    expect(screen.getByText('Enter a number of days')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('is read-only for staff and hides user management', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ body: { ...ME, user: { ...ME.user, role: 'staff' } } }),
      'GET /api/settings': () => ({ body: SETTINGS }),
    });
    renderRoutes(routes, '/settings');
    expect(await screen.findByLabelText('Holding deposit')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save settings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('connects Square after testing the token and never shows it again', async () => {
    const { calls } = mockApi({
      'GET /api/auth/me': () => ({ body: ME }),
      'GET /api/settings': () => ({ body: SETTINGS }),
      'POST /api/settings/square/locations': () => ({
        body: { locations: [{ id: 'LOC1', name: 'Milwaukee' }] },
      }),
      'PUT /api/settings/square': () => ({
        body: {
          ...SETTINGS,
          squareConnected: true,
          squareLocationName: 'Milwaukee',
          squareEnvironment: 'sandbox',
          squareConnectedAt: '2099-01-01T00:00:00Z',
        },
      }),
    });
    const user = userEvent.setup();
    renderRoutes(routes, '/settings?tab=square');
    expect(await screen.findByText('Square is not connected')).toBeInTheDocument();
    expect(screen.getByDisplayValue(SETTINGS.squareWebhookUrl)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Access token'), 'EAAA-sandbox-token');
    await user.click(screen.getByRole('button', { name: /find locations/i }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'POST',
        path: '/api/settings/square/locations',
        body: { environment: 'sandbox', accessToken: 'EAAA-sandbox-token' },
      }),
    );
    await user.click(screen.getByRole('button', { name: /connect square/i }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: 'PUT',
        path: '/api/settings/square',
        body: { environment: 'sandbox', accessToken: 'EAAA-sandbox-token', locationId: 'LOC1' },
      }),
    );
    expect(await screen.findByText(/connected to milwaukee/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Access token')).toHaveValue('');
  });
});
