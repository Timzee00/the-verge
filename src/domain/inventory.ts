import type { InventoryEvent, InventoryEventType, ID } from '../core/types.js';

const TYPES = new Set<InventoryEventType>(['opening','purchase','sale','sale_void','return','damage','adjustment','transfer_out','transfer_in','reservation','reservation_release']);

export function validateInventoryEvent(event: Pick<InventoryEvent,'type'|'quantityDelta'|'locationId'|'productId'>): void {
  if (!TYPES.has(event.type)) throw new Error(`Unsupported inventory event type: ${event.type}`);
  if (!Number.isFinite(event.quantityDelta) || event.quantityDelta === 0) throw new Error('Inventory quantity delta must be a non-zero finite number');
  if (!event.locationId || !event.productId) throw new Error('Inventory event requires location and product');
}

export function calculateStock(events: InventoryEvent[], locationId: ID, productId: ID): number {
  return events.filter((e) => e.locationId === locationId && e.productId === productId && e.type !== 'reservation' && e.type !== 'reservation_release').reduce((sum, e) => sum + e.quantityDelta, 0);
}

export function calculateReserved(events: InventoryEvent[], locationId: ID, productId: ID): number {
  return events.filter((e) => e.locationId === locationId && e.productId === productId)
    .reduce((sum, e) => sum + (e.type === 'reservation' ? e.quantityDelta : e.type === 'reservation_release' ? -Math.abs(e.quantityDelta) : 0), 0);
}

export function calculateAvailable(events: InventoryEvent[], locationId: ID, productId: ID): number {
  return calculateStock(events, locationId, productId) - calculateReserved(events, locationId, productId);
}

export function validateSaleAgainstSnapshot(available: number, requested: number) {
  if (!Number.isFinite(requested) || requested <= 0) return { accepted: false as const, available, reason: 'invalid_quantity' as const };
  if (available < requested) return { accepted: false as const, available, reason: 'insufficient_stock' as const };
  return { accepted: true as const, available: available - requested };
}

export function deterministicEventOrder(events: InventoryEvent[]): InventoryEvent[] {
  return [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.deviceId.localeCompare(b.deviceId) || a.localSequence - b.localSequence || a.id.localeCompare(b.id));
}
