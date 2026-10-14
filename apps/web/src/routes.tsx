import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppLayout, type RouteHandle } from '@/components/app/app-layout';
import { BookingCrumb } from '@/pages/bookings/booking-crumb';
import { BookingDetailPage } from '@/pages/bookings/booking-detail-page';
import { BookingsPage } from '@/pages/bookings/bookings-page';
import { CheckInPage, CheckOutPage } from '@/pages/bookings/equipment-flow-pages';
import { EventSheetPage } from '@/pages/bookings/event-sheet-page';
import { ContactDetailPage } from '@/pages/crm/contact-detail-page';
import { ContactsPage } from '@/pages/crm/contacts-page';
import { ContactCrumb, OpportunityCrumb, OrganizationCrumb } from '@/pages/crm/crumbs';
import { OpportunityDetailPage } from '@/pages/crm/opportunity-detail-page';
import { OrganizationDetailPage } from '@/pages/crm/organization-detail-page';
import { OrganizationsPage } from '@/pages/crm/organizations-page';
import { PipelinePage } from '@/pages/crm/pipeline-page';
import { CalendarPage } from '@/pages/calendar/calendar-page';
import { DashboardPage } from '@/pages/dashboard';
import { InventoryPage } from '@/pages/inventory/inventory-page';
import { MoneyOwedPage } from '@/pages/money-owed/money-owed-page';
import { NotFoundPage } from '@/pages/not-found';
import { PublicQuotePage } from '@/pages/public/public-quote-page';
import { QuoteRequestPage } from '@/pages/public/quote-request-page';
import { QuoteBuilderPage } from '@/pages/quotes/quote-builder-page';
import { QuoteCrumb } from '@/pages/quotes/quote-crumb';
import { QuoteDetailPage } from '@/pages/quotes/quote-detail-page';
import { QuotesPage } from '@/pages/quotes/quotes-page';
import { SettingsPage } from '@/pages/settings/settings-page';
import { SetupPage } from '@/pages/setup';
import { SignInPage } from '@/pages/sign-in';

const crumb = (label: string): RouteHandle => ({ crumb: label });

export const routes: RouteObject[] = [
  { path: '/sign-in', element: <SignInPage /> },
  { path: '/setup', element: <SetupPage /> },
  { path: '/request/:slug', element: <QuoteRequestPage /> },
  { path: '/q/:token', element: <PublicQuotePage /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, handle: crumb('Dashboard'), element: <DashboardPage /> },
      {
        path: 'pipeline',
        handle: crumb('Pipeline'),
        children: [
          { index: true, element: <PipelinePage /> },
          {
            path: ':id',
            handle: { crumb: (m) => <OpportunityCrumb id={m.params.id!} /> } satisfies RouteHandle,
            element: <OpportunityDetailPage />,
          },
        ],
      },
      {
        path: 'organizations',
        handle: crumb('Organizations'),
        children: [
          { index: true, element: <OrganizationsPage /> },
          {
            path: ':id',
            handle: { crumb: (m) => <OrganizationCrumb id={m.params.id!} /> } satisfies RouteHandle,
            element: <OrganizationDetailPage />,
          },
        ],
      },
      {
        path: 'contacts',
        handle: crumb('Contacts'),
        children: [
          { index: true, element: <ContactsPage /> },
          {
            path: ':id',
            handle: { crumb: (m) => <ContactCrumb id={m.params.id!} /> } satisfies RouteHandle,
            element: <ContactDetailPage />,
          },
        ],
      },
      {
        path: 'quotes',
        handle: crumb('Quotes'),
        children: [
          { index: true, element: <QuotesPage /> },
          { path: 'new', handle: crumb('New quote'), element: <QuoteBuilderPage /> },
          {
            path: ':id',
            handle: { crumb: (m) => <QuoteCrumb id={m.params.id!} /> } satisfies RouteHandle,
            children: [
              { index: true, element: <QuoteDetailPage /> },
              { path: 'edit', handle: crumb('Edit'), element: <QuoteBuilderPage /> },
            ],
          },
        ],
      },
      {
        path: 'bookings',
        handle: crumb('Bookings'),
        children: [
          { index: true, element: <BookingsPage /> },
          {
            path: ':id',
            handle: { crumb: (m) => <BookingCrumb id={m.params.id!} /> } satisfies RouteHandle,
            children: [
              { index: true, element: <BookingDetailPage /> },
              { path: 'sheet', handle: crumb('Event sheet'), element: <EventSheetPage /> },
              { path: 'check-out', handle: crumb('Check out'), element: <CheckOutPage /> },
              { path: 'check-in', handle: crumb('Check in'), element: <CheckInPage /> },
            ],
          },
        ],
      },
      { path: 'calendar', handle: crumb('Calendar'), element: <CalendarPage /> },
      { path: 'inventory', handle: crumb('Inventory'), element: <InventoryPage /> },
      { path: 'money-owed', handle: crumb('Money Owed'), element: <MoneyOwedPage /> },
      { path: 'settings', handle: crumb('Settings'), element: <SettingsPage /> },
      { path: '*', handle: crumb('Not found'), element: <NotFoundPage /> },
    ],
  },
];

export function createRouter() {
  return createBrowserRouter(routes);
}
