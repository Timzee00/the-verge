import type { Product, Sale, SaleItem } from '../core/types.js';

export interface SaleDraft {
  product: Product;
  quantity: number;
  unitPriceMinor: number;
  discountMinor?: number;
  discountReason?: string;
  paymentMethod: Sale['paymentMethod'];
}

export function calculateSale(draft: SaleDraft) {
  if (!Number.isFinite(draft.quantity) || draft.quantity <= 0 || draft.quantity > 1_000_000) throw new Error('Quantity must be a positive finite number');
  const quantityRounded = Number(draft.quantity.toFixed(6));
  if (quantityRounded !== draft.quantity) throw new Error('Quantity supports up to 6 decimal places');
  if (!Number.isSafeInteger(draft.unitPriceMinor) || draft.unitPriceMinor < 0) throw new Error('Unit price must be a non-negative safe integer');
  const discount = draft.discountMinor ?? 0;
  if (!Number.isSafeInteger(discount) || discount < 0) throw new Error('Discount must be a non-negative safe integer');
  const subtotalMinor = Math.round(draft.unitPriceMinor * quantityRounded);
  if (!Number.isSafeInteger(subtotalMinor)) throw new Error('Sale total overflow');
  if (discount > subtotalMinor) throw new Error('Discount cannot exceed subtotal');
  const totalMinor = subtotalMinor - discount;
  const costMinor = Math.round(draft.product.standardCostMinor * quantityRounded);
  const belowCost = totalMinor < costMinor;
  if (belowCost && !draft.discountReason?.trim()) throw new Error('A below-cost sale requires a reason');
  return { subtotalMinor, discountMinor: discount, totalMinor, costMinor, belowCost };
}

export function buildSale(product: Product, draft: Omit<SaleDraft, 'product'>, base: Pick<Sale,'id'|'organizationId'|'locationId'|'occurredAt'|'deviceId'|'localSequence'|'createdAt'>): { sale: Sale; item: SaleItem } {
  const totals = calculateSale({product, ...draft});
  const sale: Sale = { ...base, customerId: undefined, subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, totalMinor: totals.totalMinor, paymentMethod: draft.paymentMethod, status:'completed', belowCost:totals.belowCost, discountReason:draft.discountReason?.trim() || undefined, syncState:'pending' };
  const item: SaleItem = { id: crypto.randomUUID(), saleId:sale.id, productId:product.id, quantity:draft.quantity, unitPriceMinor:draft.unitPriceMinor, unitCostMinor:product.standardCostMinor, discountMinor:totals.discountMinor };
  return {sale,item};
}
