import { localDB } from '../db/local';
import { validateInventoryEvent, calculateStock } from '../domain/inventory';
import type { InventoryEvent, Product } from '../core/types';

export async function getLocalStock(locationId: string, productId: string) {
  const events = await localDB.inventoryEvents.where('[locationId+productId]').equals([locationId,productId]).toArray();
  return calculateStock(events, locationId, productId);
}

export async function appendInventoryEvent(event: InventoryEvent) {
  validateInventoryEvent(event);
  await localDB.transaction('rw', localDB.inventoryEvents, localDB.syncOperations, async () => {
    await localDB.inventoryEvents.put(event);
    await localDB.syncOperations.put({ id:event.id, organizationId:event.organizationId, deviceId:event.deviceId, entity:'inventory_event', entityId:event.id, operation:'create', payload:event, createdAt:event.createdAt, attempts:0, state:'pending' });
  });
}

export async function validateProductForSale(product: Product, locationId:string, quantity:number) {
  const stock = await getLocalStock(locationId, product.id);
  return { product, stock, allowed: stock >= quantity && quantity > 0 };
}
