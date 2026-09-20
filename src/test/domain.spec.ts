function assert(condition: unknown, message = 'assertion failed') { if (!condition) throw new Error(message); }
function equal(a: unknown, b: unknown, message?: string) { assert(a === b, message ?? `${String(a)} !== ${String(b)}`); }
function deepEqual(a: unknown, b: unknown, message='deep equality failed') { equal(JSON.stringify(a), JSON.stringify(b), message); }
function throws(fn: () => unknown) { let thrown = false; try { fn(); } catch { thrown = true; } assert(thrown, 'expected function to throw'); }
import { assertBalanced, buildSaleJournalLines } from '../domain/accounting.js';
import { parseMajorToMinor, formatMinor } from '../domain/money.js';
import { calculateAvailable, validateSaleAgainstSnapshot } from '../domain/inventory.js';
import { deduplicateOperations, nextRetryAt } from '../domain/sync.js';

equal(parseMajorToMinor('1,250.50'), 125050);
throws(() => parseMajorToMinor('10.999'));
equal(formatMinor(125050, 'NGN', 'en-NG').includes('1,250.50'), true);

const sale = buildSaleJournalLines({
  cashOrReceivableAccountId: 'cash', revenueAccountId: 'rev', inventoryAccountId: 'inv', cogsAccountId: 'cogs',
  saleAmountMinor: 850000, costAmountMinor: 1000000, creditSale: false,
});
assertBalanced(sale);
equal(sale.length, 4);
equal(sale[0].debitMinor, 850000);
equal(sale[2].debitMinor, 1000000);

const available = calculateAvailable([
  { id:'1', organizationId:'o', locationId:'l', productId:'p', type:'opening', quantityDelta:1, occurredAt:'2026-01-01T00:00:00.000Z', deviceId:'d1', localSequence:1, syncState:'synced', createdAt:'2026-01-01T00:00:00.000Z' },
  { id:'2', organizationId:'o', locationId:'l', productId:'p', type:'reservation', quantityDelta:1, occurredAt:'2026-01-01T00:01:00.000Z', deviceId:'d1', localSequence:2, syncState:'synced', createdAt:'2026-01-01T00:01:00.000Z' },
], 'l', 'p');
equal(available, 0);
deepEqual(validateSaleAgainstSnapshot(0, 1).reason, 'insufficient_stock');

const ops = deduplicateOperations([
  { id:'2', deviceId:'d', entity:'sale', entityId:'s', operation:'create', payload:{}, createdAt:'2026-01-02', attempts:0, state:'pending' },
  { id:'1', deviceId:'d', entity:'sale', entityId:'s', operation:'create', payload:{}, createdAt:'2026-01-01', attempts:0, state:'pending' },
]);
equal(ops.length, 1);
assert(nextRetryAt(0).endsWith('Z'));

console.log('domain tests passed');

import { calculateSale } from '../domain/sales.js';
const saleProduct = { id:'p', organizationId:'o', sku:'SKU', name:'Item', unit:'piece', standardCostMinor:1000, retailPriceMinor:1500, active:true, trackBatch:false, trackExpiry:false, createdAt:'2026-01-01', updatedAt:'2026-01-01' } as any;
equal(calculateSale({product:saleProduct,quantity:2,unitPriceMinor:1500,paymentMethod:'cash'}).totalMinor,3000);
equal(calculateSale({product:saleProduct,quantity:2,unitPriceMinor:1500,discountMinor:1000,paymentMethod:'cash'}).belowCost,false);
throws(() => calculateSale({product:saleProduct,quantity:2,unitPriceMinor:500,discountMinor:1,paymentMethod:'cash'}));
equal(calculateSale({product:saleProduct,quantity:0.5,unitPriceMinor:1500,paymentMethod:'cash'}).totalMinor,750);
throws(() => calculateSale({product:saleProduct,quantity:0.1234567,unitPriceMinor:1500,paymentMethod:'cash'}));
