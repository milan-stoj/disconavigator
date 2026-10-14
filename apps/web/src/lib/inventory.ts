import { useQuery } from '@tanstack/react-query';
import type { ADJUSTMENT_REASONS, TRACKING_MODES, UNIT_STATUSES } from '@disco/shared';
import { api } from '@/lib/api';

export type TrackingMode = (typeof TRACKING_MODES)[number];
export type UnitStatus = (typeof UNIT_STATUSES)[number];
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export interface EquipmentUnit {
  id: string;
  equipmentTypeId: string;
  label: string;
  status: UnitStatus;
  notes: string | null;
}

export interface EquipmentType {
  id: string;
  name: string;
  trackingMode: TrackingMode;
  lossFeeCents: number;
  owned: number;
  outOfService: number;
  inService: number;
  units: EquipmentUnit[];
}

export interface InventoryAdjustment {
  id: string;
  delta: number;
  reason: string;
  note: string | null;
  unitId: string | null;
  unitLabel: string | null;
  bookingId: string | null;
  userName: string | null;
  createdAt: string;
}

export interface PackageItem {
  equipmentTypeId: string;
  equipmentName: string;
  quantity: number;
  lossFeeCents: number | null;
  effectiveLossFeeCents: number;
}

export interface RentalPackage {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  includedDays: number;
  extraDayPriceCents: number;
  active: boolean;
  items: PackageItem[];
}

export const equipmentKey = ['equipment'] as const;
export const adjustmentsKey = (typeId: string) => ['equipment', typeId, 'adjustments'] as const;
export const packagesKey = ['packages'] as const;

export function useEquipment() {
  return useQuery({
    queryKey: equipmentKey,
    queryFn: () => api.get<EquipmentType[]>('/api/equipment'),
  });
}

export function usePackages() {
  return useQuery({
    queryKey: packagesKey,
    queryFn: () => api.get<RentalPackage[]>('/api/packages'),
  });
}

export const UNIT_STATUS_LABELS: Record<UnitStatus, string> = {
  in_service: 'In service',
  out_of_service: 'Out of service',
  retired: 'Retired',
  lost: 'Lost',
};

export const ADJUSTMENT_REASON_LABELS: Record<string, string> = {
  purchase: 'Purchased',
  found: 'Found',
  retired: 'Retired',
  lost: 'Lost',
  damaged: 'Damaged',
  out_of_service: 'Out of service',
  returned_to_service: 'Returned to service',
};

export const ADDING_REASONS: AdjustmentReason[] = ['purchase', 'found'];

export const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(iso),
  );
