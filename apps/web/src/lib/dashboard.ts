import { useQuery } from '@tanstack/react-query';
import type { BookingStatus, BookingType } from '@disco/shared';
import { api } from '@/lib/api';

export interface DashboardBooking {
  id: string;
  numberLabel: string;
  title: string;
  bookingType: BookingType;
  status: BookingStatus;
  startDate: string;
  endDate: string;
  startTime: string | null;
  customerName: string | null;
}

export interface Dashboard {
  today: string;
  upcoming: DashboardBooking[];
  overdueReturns: (DashboardBooking & { returnTime: string | null; overdueAt: string })[];
  moneyOwed: { totalCents: number; count: number; overdueCents: number; overdueCount: number };
  pendingCharges: {
    id: string;
    bookingId: string;
    numberLabel: string;
    title: string;
    kind: 'loss' | 'damage';
    proposedCents: number;
    createdAt: string;
    customerName: string | null;
  }[];
}

export const dashboardKey = ['dashboard'] as const;
export function useDashboard() {
  return useQuery({ queryKey: dashboardKey, queryFn: () => api.get<Dashboard>('/api/dashboard') });
}
