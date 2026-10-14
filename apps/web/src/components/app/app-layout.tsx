import { Fragment, useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, Outlet, useLocation, useMatches, type UIMatch } from 'react-router';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Spinner } from '@/components/ui/spinner';
import { setUnauthorizedHandler } from '@/lib/api';
import { meQueryKey, useMe } from '@/lib/auth';
import { isSessionExpired, markSessionExpired } from '@/lib/session';
import { AppSidebar } from './app-sidebar';
import { CommandPalette } from './command-palette';
import { ModeToggle } from './mode-toggle';

export interface RouteHandle {
  crumb?: ReactNode | ((match: UIMatch) => ReactNode);
}

export function signInPath(next: string, expired = false) {
  const params = new URLSearchParams();
  if (next && next !== '/') params.set('next', next);
  if (expired) params.set('expired', '1');
  const qs = params.toString();
  return qs ? `/sign-in?${qs}` : '/sign-in';
}

/**
 * When any API call returns 401, drop cached data and mark the session as signed out. The auth
 * guard below then redirects to sign-in (keeping the current page as `next`).
 */
function SessionExpiryHandler() {
  const qc = useQueryClient();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      markSessionExpired();
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== meQueryKey[0] });
      qc.setQueryData(meQueryKey, null);
    });
    return () => setUnauthorizedHandler(null);
  }, [qc]);
  return null;
}

export function FullPageSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Loading">
      <Spinner className="size-6" />
    </div>
  );
}

function Breadcrumbs() {
  const matches = useMatches() as UIMatch<unknown, RouteHandle | undefined>[];
  const crumbs = matches
    .filter((m) => m.handle?.crumb)
    .map((m) => ({
      id: m.id,
      path: m.pathname,
      label:
        typeof m.handle!.crumb === 'function'
          ? (m.handle!.crumb as (m: UIMatch) => ReactNode)(m)
          : m.handle!.crumb,
    }));
  if (crumbs.length === 0) return null;
  return (
    <Breadcrumb>
      <BreadcrumbList>
        {crumbs.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 && <BreadcrumbSeparator className="hidden md:block" />}
            <BreadcrumbItem className={i < crumbs.length - 1 ? 'hidden md:block' : undefined}>
              {i < crumbs.length - 1 ? (
                <BreadcrumbLink asChild>
                  <Link to={c.path}>{c.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{c.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export function AppLayout() {
  const { data: me, isPending } = useMe();
  const location = useLocation();
  if (isPending) return <FullPageSpinner />;
  if (!me)
    return (
      <Navigate to={signInPath(location.pathname + location.search, isSessionExpired())} replace />
    );

  return (
    <SidebarProvider>
      <SessionExpiryHandler />
      <AppSidebar />
      <SidebarInset>
        <header className="print:hidden bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <div className="min-w-0 flex-1">
            <Breadcrumbs />
          </div>
          <CommandPalette />
          <ModeToggle />
        </header>
        <main id="main" className="flex flex-1 flex-col gap-6 p-4 md:p-6 print:p-0">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
