import type { Product } from '../core/types.js';

export interface CartLineInput {
  product: Product;
  quantity: number;
}

export interface CartTotals {
  subtotalMinor: number;
  totalMinor: number;
  itemCount: number;
  unitCount: number;
}

/**
 * Computes a cashier cart from trusted catalogue values.
 * Price overrides and discounts are intentionally not supported by this
 * cashier-level helper; those need an explicit approval workflow.
 */
export function calculateCartTotals(lines: CartLineInput[]): CartTotals {
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new Error('Add at least one product before checkout.');
  }

  const seen = new Set<string>();
  let subtotalMinor = 0;
  let unitCount = 0;

  for (const line of lines) {
    const product = line?.product;
    const quantity = line?.quantity;

    if (!product?.id || !product.active) {
      throw new Error('One of the products is no longer available.');
    }
    if (seen.has(product.id)) {
      throw new Error('A product may only appear once in the cart.');
    }
    seen.add(product.id);

    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      throw new Error('Product quantities must be positive whole numbers.');
    }
    if (!Number.isSafeInteger(product.retailPriceMinor) || product.retailPriceMinor < 0) {
      throw new Error('A product has an invalid selling price. Contact a manager.');
    }

    const lineTotal = product.retailPriceMinor * quantity;
    if (!Number.isSafeInteger(lineTotal)) {
      throw new Error('The cart total is too large to calculate safely.');
    }

    subtotalMinor += lineTotal;
    unitCount += quantity;
    if (!Number.isSafeInteger(subtotalMinor) || !Number.isSafeInteger(unitCount)) {
      throw new Error('The cart total is too large to calculate safely.');
    }
  }

  return { subtotalMinor, totalMinor: subtotalMinor, itemCount: lines.length, unitCount };
}
