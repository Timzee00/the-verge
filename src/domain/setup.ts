import type { ID, InventoryEvent } from '../core/types.js';

export const CORE_SETUP_STEP_COUNT = 5;

export function isStoreCodeValid(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(value.trim().toUpperCase());
}

export function hasUsableStoreStock(events: InventoryEvent[], locationId?: ID): boolean {
  if (!locationId) return false;
  return events.some((event) =>
    event.locationId === locationId &&
    event.syncState !== 'rejected' &&
    event.syncState !== 'conflict' &&
    event.quantityDelta > 0 &&
    event.type !== 'reservation' &&
    event.type !== 'reservation_release' &&
    event.type !== 'sale_void'
  );
}

export function calculateSetupProgress(input: {
  businessReady: boolean;
  storeConfigured: boolean;
  productCount: number;
  hasOpeningStock: boolean;
  saleCount: number;
}): number {
  return [
    input.businessReady,
    input.storeConfigured,
    input.productCount > 0,
    input.hasOpeningStock,
    input.saleCount > 0,
  ].filter(Boolean).length;
}
