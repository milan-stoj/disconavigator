import { Headphones } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { useMe } from '@/lib/auth';
import { useNewQuoteRequests } from '@/lib/quote-requests';
import { NAV_SECTIONS } from './nav';
import { UserMenu } from './user-menu';

export function isActivePath(pathname: string, url: string) {
  return url === '/' ? pathname === '/' : pathname === url || pathname.startsWith(`${url}/`);
}

export function AppSidebar() {
  const { pathname } = useLocation();
  const { data: me } = useMe();
  const { setOpenMobile, isMobile } = useSidebar();
  const closeOnMobile = () => isMobile && setOpenMobile(false);
  const newRequests = useNewQuoteRequests().data?.unseenCount ?? 0;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/" onClick={closeOnMobile}>
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Headphones className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">Disco Controller</span>
                  <span className="text-muted-foreground truncate text-xs">{me?.tenant.name}</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV_SECTIONS.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActivePath(pathname, item.url)}
                      tooltip={item.title}
                    >
                      <Link to={item.url} onClick={closeOnMobile}>
                        <item.icon />
                        <span>{item.title}</span>
                        {item.url === '/pipeline' && newRequests > 0 && (
                          <span className="sr-only">
                            {`(${newRequests} new quote request${newRequests === 1 ? '' : 's'})`}
                          </span>
                        )}
                      </Link>
                    </SidebarMenuButton>
                    {item.url === '/pipeline' && newRequests > 0 && (
                      <SidebarMenuBadge
                        aria-hidden
                        className="bg-primary text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-active/menu-button:text-primary-foreground"
                      >
                        {newRequests}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
