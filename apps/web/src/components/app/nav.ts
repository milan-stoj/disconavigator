import {
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  KanbanSquare,
  LayoutDashboard,
  Package,
  Settings,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  keywords?: string[];
  adminOnly?: boolean;
}

export const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [{ title: 'Dashboard', url: '/', icon: LayoutDashboard, keywords: ['home'] }],
  },
  {
    label: 'Sales',
    items: [
      {
        title: 'Pipeline',
        url: '/pipeline',
        icon: KanbanSquare,
        keywords: ['leads', 'opportunities', 'crm'],
      },
      {
        title: 'Organizations',
        url: '/organizations',
        icon: Building2,
        keywords: ['bars', 'venues', 'customers'],
      },
      { title: 'Contacts', url: '/contacts', icon: Users, keywords: ['people'] },
      { title: 'Quotes', url: '/quotes', icon: FileText, keywords: ['proposals'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { title: 'Bookings', url: '/bookings', icon: ClipboardList, keywords: ['events', 'rentals'] },
      {
        title: 'Calendar',
        url: '/calendar',
        icon: CalendarDays,
        keywords: ['availability', 'capacity'],
      },
      {
        title: 'Inventory',
        url: '/inventory',
        icon: Package,
        keywords: ['equipment', 'headphones', 'packages'],
      },
      {
        title: 'Money Owed',
        url: '/money-owed',
        icon: Wallet,
        keywords: ['payments', 'invoices', 'balance'],
      },
    ],
  },
  {
    label: 'Admin',
    items: [
      {
        title: 'Settings',
        url: '/settings',
        icon: Settings,
        keywords: ['users', 'square', 'terms'],
      },
    ],
  },
];

export const NAV_ITEMS = NAV_SECTIONS.flatMap((s) => s.items);
