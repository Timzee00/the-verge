import type { InventoryLot } from '../core/types.js';

export type LotAvailability = 'sellable'|'near_expiry'|'expired'|'blocked';

export function lotAvailability(lot: InventoryLot, now = new Date(), warningDays = 90): LotAvailability {
  if (lot.status === 'quarantined' || lot.status === 'recalled' || lot.status === 'depleted' || lot.quantityAvailable <= 0) return 'blocked';
  if (!lot.expiryDate) return 'sellable';
  const expiry = new Date(lot.expiryDate);
  if (Number.isNaN(expiry.getTime())) return 'blocked';
  const endOfExpiry = new Date(expiry); endOfExpiry.setUTCHours(23,59,59,999);
  if (endOfExpiry.getTime() < now.getTime()) return 'expired';
  const warningMs = warningDays * 86_400_000;
  if (endOfExpiry.getTime() - now.getTime() <= warningMs) return 'near_expiry';
  return 'sellable';
}

export function sortLotsFEFO(lots: InventoryLot[], now = new Date()): InventoryLot[] {
  return lots.filter(lot => {
    const state = lotAvailability(lot, now);
    return state === 'sellable' || state === 'near_expiry';
  }).sort((a,b) => {
    const ae = a.expiryDate ? new Date(a.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
    const be = b.expiryDate ? new Date(b.expiryDate).getTime() : Number.MAX_SAFE_INTEGER;
    return ae - be || a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id);
  });
}

export function allocateFEFO(lots: InventoryLot[], quantity: number, now = new Date()) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('invalid_quantity');
  let remaining = quantity;
  const allocations: Array<{lotId:string;batchNumber:string;quantity:number}> = [];
  for (const lot of sortLotsFEFO(lots, now)) {
    if (remaining <= 0) break;
    const take = Math.min(Number(lot.quantityAvailable), remaining);
    if (take > 0) allocations.push({lotId:lot.id,batchNumber:lot.batchNumber,quantity:take});
    remaining -= take;
  }
  return { allocations, fulfilled: remaining <= 0, shortfall: Math.max(0, remaining) };
}

export function requiresTrackedLot(product:{trackBatch:boolean;trackExpiry:boolean;productKind?:string}) {
  return Boolean(product.trackBatch || product.trackExpiry || product.productKind === 'medicine');
}
