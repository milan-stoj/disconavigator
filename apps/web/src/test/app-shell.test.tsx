import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NAV_ITEMS } from '@/components/app/nav';
import { routes } from '@/routes';
import { ME, mockApi, renderRoutes } from './utils';

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
};

describe('authentication guard and session expiry', () => {
  it('redirects to sign-in when not signed in, keeping the destination', async () => {
    mockApi({
      'GET /api/auth/me': () => ({
        status: 401,
        body: { error: 'unauthorized', message: 'Sign in' },
      }),
      'GET /api/setup/status': () => ({ body: { setupRequired: false } }),
    });
    const { router } = renderRoutes(routes, '/inventory');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(router.state.location.search).toBe('?next=%2Finventory');
  });

  it('sends first-run users to setup', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 401, body: {} }),
      'GET /api/setup/status': () => ({ body: { setupRequired: true } }),
    });
    const { router } = renderRoutes(routes, '/sign-in');
    expect(await screen.findByText('Welcome to Disco Controller')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/setup');
  });

  it('redirects to sign-in with an expiry notice when a request returns 401, then returns after sign-in', async () => {
    let expired = false;
    mockApi({
      'GET /api/auth/me': () => (expired ? { status: 401, body: {} } : { body: ME }),
      'GET /api/settings': () => {
        expired = true;
        return { status: 401, body: { error: 'unauthorized', message: 'Session expired' } };
      },
      'GET /api/setup/status': () => ({ body: { setupRequired: false } }),
      'POST /api/auth/sign-in': () => {
        expired = false;
        return { body: ME };
      },
    });
    const user = userEvent.setup();
    const { router } = renderRoutes(routes, '/settings');
    expect(await screen.findByText('Your session expired')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/sign-in');
    expect(new URLSearchParams(router.state.location.search).get('next')).toBe('/settings');

    await user.type(screen.getByLabelText('Username'), 'kali');
    await user.type(screen.getByLabelText('Password'), 'e2e-password-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });

  it('shows a generic error for bad credentials', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ status: 401, body: {} }),
      'GET /api/setup/status': () => ({ body: { setupRequired: false } }),
      'POST /api/auth/sign-in': () => ({
        status: 401,
        body: { error: 'unauthorized', message: 'Invalid' },
      }),
    });
    const user = userEvent.setup();
    renderRoutes(routes, '/sign-in');
    await user.type(await screen.findByLabelText('Username'), 'kali');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Incorrect username or password.')).toBeInTheDocument();
  });
});

describe('app shell navigation', () => {
  const signedIn = () =>
    mockApi({
      'GET /api/auth/me': () => ({ body: ME }),
      'GET /api/settings': () => ({ body: SETTINGS }),
      'GET /api/users': () => ({ body: [] }),
      'GET /api/search': ({ url }) => ({
        body:
          url.searchParams.get('q') === 'bounce'
            ? [
                {
                  kind: 'organization',
                  id: 'o1',
                  title: 'Bounce Milwaukee',
                  subtitle: 'Milwaukee',
                  url: '/organizations/o1',
                },
              ]
            : [],
      }),
    });

  it('renders every section in the sidebar and navigates with breadcrumbs', async () => {
    signedIn();
    const user = userEvent.setup();
    const { router } = renderRoutes(routes, '/');
    await screen.findByRole('heading', { name: 'Dashboard' });
    const sidebar = within(document.querySelector<HTMLElement>('[data-sidebar="content"]')!);
    for (const item of NAV_ITEMS)
      expect(sidebar.getByRole('link', { name: item.title })).toBeInTheDocument();
    await user.click(sidebar.getByRole('link', { name: 'Inventory' }));
    expect(router.state.location.pathname).toBe('/inventory');
    expect(sidebar.getByRole('link', { name: 'Inventory' })).toHaveAttribute('data-active', 'true');
    const crumbs = screen.getByRole('navigation', { name: 'breadcrumb' });
    expect(within(crumbs).getByText('Inventory')).toHaveAttribute('aria-current', 'page');
  });

  it('opens the command palette with Ctrl+K and reaches every section by keyboard alone', async () => {
    signedIn();
    const user = userEvent.setup();
    const { router } = renderRoutes(routes, '/');
    await screen.findByRole('heading', { name: 'Dashboard' });
    for (const item of NAV_ITEMS) {
      await user.keyboard('{Control>}k{/Control}');
      const input = await screen.findByPlaceholderText(/Go to a section/);
      expect(input).toHaveFocus();
      await user.keyboard(item.title);
      await user.keyboard('{Enter}');
      await waitFor(() => expect(router.state.location.pathname).toBe(item.url));
      expect(screen.queryByPlaceholderText(/Go to a section/)).not.toBeInTheDocument();
    }
  });

  it('finds records from the command palette', async () => {
    signedIn();
    const user = userEvent.setup();
    const { router } = renderRoutes(routes, '/');
    await screen.findByRole('heading', { name: 'Dashboard' });
    await user.keyboard('{Meta>}k{/Meta}');
    await user.keyboard('bounce');
    expect(await screen.findByRole('option', { name: /Bounce Milwaukee/ })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/organizations/o1'));
  });
});
