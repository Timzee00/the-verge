import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, transactionPool } from '../_db.js';
import { json, method, requireUser } from '../_http.js';
import { validateInventoryMovement } from '../../src/domain/inventory.js';
import { postExpenseJournal, postSaleJournal } from '../_accounting.js';

const ALLOWED = new Set(['inventory_event', 'product', 'customer', 'sale', 'expense']);
const ENTITY_PERMISSION: Record<string, string> = {
  inventory_event: 'inventory.write',
  product: 'inventory.write',
  customer: 'business.write',
  sale: 'sales.write',
  expense: 'finance.write',
};
const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  business_owner: new Set(['business.write', 'inventory.write', 'sales.write', 'sales.void', 'finance.write']),
  platform_admin: new Set(['business.write', 'inventory.write', 'sales.write', 'sales.void', 'finance.write']),
  manager: new Set(['business.write', 'inventory.write', 'sales.write', 'sales.void', 'finance.write']),
  cashier: new Set(['sales.write']),
  inventory_staff: new Set(['inventory.write']),
  accountant: new Set(['finance.write']),
};
function canWrite(role: string, entity: string) {
  const required = ENTITY_PERMISSION[entity];
  return Boolean(required && ROLE_PERMISSIONS[role]?.has(required));
}

function errorText(error: unknown) { return String((error as any)?.message ?? error); }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ['POST'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  const { organizationId, operations } = req.body ?? {};
  if (typeof organizationId !== 'string' || !Array.isArray(operations) || operations.length > 100) {
    return json(res, 400, { error: 'invalid_batch' });
  }

  const sql = db();
  const membership = await sql`select role from memberships where organization_id=${organizationId} and user_id=${user.id} and active=true limit 1`;
  if (!membership.length) return json(res, 403, { error: 'forbidden' });
  const role = String(membership[0].role);
  const organizationWide = ['business_owner', 'platform_admin'].includes(role);
  const assignedRows = organizationWide ? [] : await sql`select location_id from membership_locations where organization_id=${organizationId} and user_id=${user.id}`;
  const assignedLocationIds = new Set(assignedRows.map((row:any)=>String(row.location_id)));
  const canAccessLocation = (locationId: unknown) => organizationWide || (typeof locationId==='string' && assignedLocationIds.has(locationId));

  const results: any[] = [];
  for (const op of operations) {
    if (!op || typeof op !== 'object' || !ALLOWED.has(op.entity) || op.operation !== 'create' || typeof op.entityId !== 'string' || typeof op.deviceId !== 'string' || !Number.isInteger(op.localSequence) || op.localSequence < 0) {
      results.push({ id: (op as any)?.id ?? null, ok: false, rejected: true, error: 'invalid_operation' });
      continue;
    }

    if (!canWrite(role, op.entity)) {
      results.push({ id: op.id, ok: false, rejected: true, error: 'permission_denied' });
      continue;
    }

    const pool = transactionPool();
    try {
      await pool.query('BEGIN');
      const existing = await pool.query('select 1 from sync_receipts where device_id=$1 and local_sequence=$2 limit 1', [op.deviceId, op.localSequence]);
      if (existing.rowCount) {
        await pool.query('COMMIT');
        results.push({ id: op.id, ok: true, deduplicated: true });
        continue;
      }

      const p: any = op.payload;
      if (!p || typeof p !== 'object') throw new Error('invalid_payload');

      if (op.entity === 'inventory_event') {
        if (p.id !== op.entityId || p.organizationId !== organizationId || p.deviceId !== op.deviceId || p.localSequence !== op.localSequence) {
          throw new Error('invalid_inventory_event_identity');
        }
        const owned = await pool.query('select p.id from products p join locations l on l.id=$2 and l.organization_id=$3 and l.active=true where p.id=$1 and p.organization_id=$3 limit 1', [p.productId, p.locationId, organizationId]);
        if (!owned.rowCount) throw new Error('ownership_check_failed');
        if (!canAccessLocation(p.locationId)) throw new Error('location_access_denied');

        const quantityDelta = validateInventoryMovement(p.type, p.quantityDelta);
        if (quantityDelta < 0) {
          await pool.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
            `inventory:${organizationId}:${p.locationId}:${p.productId}`,
          ]);
          const stockResult = await pool.query(
            `select coalesce(sum(case when event_type not in ('reservation','reservation_release') then quantity_delta else 0 end),0) as stock
             from inventory_events where organization_id=$1 and location_id=$2 and product_id=$3`,
            [organizationId, p.locationId, p.productId],
          );
          const stock = Number(stockResult.rows[0]?.stock ?? 0);
          if (!Number.isFinite(stock) || stock + quantityDelta < 0) throw new Error('insufficient_stock');
        }
        await pool.query(`insert into inventory_events (id,organization_id,location_id,product_id,event_type,quantity_delta,unit_cost_minor,reference_id,occurred_at,device_id,local_sequence,created_at,created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          on conflict (id) do nothing`, [p.id, organizationId, p.locationId, p.productId, p.type, quantityDelta, p.unitCostMinor ?? null, p.referenceId ?? null, p.occurredAt, op.deviceId, op.localSequence, p.createdAt ?? new Date().toISOString(), user.id]);
      } else if (op.entity === 'product') {
        if (p.id !== op.entityId || p.organizationId !== organizationId) throw new Error('invalid_product_identity');
        await pool.query(`insert into products (id,organization_id,sku,barcode,name,brand,category,unit,weight_value,weight_unit,image_url,standard_cost_minor,retail_price_minor,wholesale_price_minor,minimum_price_minor,reorder_level,active,track_batch,track_expiry,created_at,updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
          on conflict (id) do nothing`, [p.id,organizationId,p.sku,p.barcode??null,p.name,p.brand??null,p.category??null,p.unit,p.weightValue??null,p.weightUnit??null,p.imageUri??null,p.standardCostMinor,p.retailPriceMinor,p.wholesalePriceMinor??null,p.minimumPriceMinor??null,p.reorderLevel??null,p.active,p.trackBatch,p.trackExpiry,p.createdAt,p.updatedAt]);
      } else if (op.entity === 'customer') {
        if (p.id !== op.entityId || p.organizationId !== organizationId) throw new Error('invalid_customer_identity');
        await pool.query(`insert into customers (id,organization_id,name,phone,email,credit_limit_minor,active,created_at,updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`, [p.id,organizationId,p.name,p.phone??null,p.email??null,p.creditLimitMinor??null,p.active,p.createdAt,p.updatedAt]);
      } else if (op.entity === 'sale') {
        const sale = p.sale;
        const items = Array.isArray(p.items) ? p.items : (p.item ? [p.item] : []);
        const embeddedEvents = Array.isArray(p.inventoryEvents) ? p.inventoryEvents : (p.inventoryEvent ? [p.inventoryEvent] : []);
        if (!sale || !items.length || items.length > 100 || embeddedEvents.length !== items.length) throw new Error('invalid_sale_payload');
        if (sale.organizationId !== organizationId || sale.id !== op.entityId || sale.status !== 'completed' || sale.deviceId !== op.deviceId || sale.localSequence !== op.localSequence) throw new Error('invalid_sale_header');
        if (!['cash', 'bank', 'transfer', 'card', 'credit'].includes(String(sale.paymentMethod))) throw new Error('invalid_payment_method');
        if (sale.paymentMethod === 'credit' && !['business_owner', 'platform_admin', 'manager'].includes(role)) throw new Error('credit_sale_requires_manager');
        if (![sale.subtotalMinor, sale.discountMinor, sale.totalMinor].every(value => Number.isSafeInteger(Number(value)) && Number(value) >= 0)) throw new Error('invalid_sale_amount');
        if (Number(sale.discountMinor) !== 0) throw new Error('discount_requires_approval_workflow');

        const location = await pool.query('select 1 from locations where id=$1 and organization_id=$2 and active=true limit 1', [sale.locationId, organizationId]);
        if (!location.rowCount) throw new Error('ownership_check_failed');
        if (!canAccessLocation(sale.locationId)) throw new Error('location_access_denied');
        if (sale.customerId) {
          const customer = await pool.query('select 1 from customers where id=$1 and organization_id=$2 and active=true limit 1', [sale.customerId, organizationId]);
          if (!customer.rowCount) throw new Error('customer_ownership_check_failed');
        }

        const productIds = new Set<string>();
        const validatedItems: Array<{ item: any; event: any; unitPriceMinor: number; unitCostMinor: number }> = [];
        let subtotalMinor = 0;
        for (let index = 0; index < items.length; index++) {
          const item = items[index];
          const event = embeddedEvents[index];
          if (!item || typeof item.productId !== 'string' || productIds.has(item.productId)) throw new Error('invalid_or_duplicate_sale_product');
          productIds.add(item.productId);
          if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) throw new Error('invalid_sale_quantity');
          if (!Number.isSafeInteger(item.discountMinor) || item.discountMinor !== 0) throw new Error('discount_requires_approval_workflow');

          const productResult = await pool.query(
            'select retail_price_minor,standard_cost_minor,active from products where id=$1 and organization_id=$2 limit 1 for share',
            [item.productId, organizationId],
          );
          if (!productResult.rowCount || !productResult.rows[0].active) throw new Error('product_not_available');
          const unitPriceMinor = Number(productResult.rows[0].retail_price_minor);
          const unitCostMinor = Number(productResult.rows[0].standard_cost_minor);
          if (!Number.isSafeInteger(unitPriceMinor) || !Number.isSafeInteger(unitCostMinor)) throw new Error('invalid_product_price');
          if (Number(item.unitPriceMinor) !== unitPriceMinor) throw new Error('price_changed_refresh_cart');
          if (Number(item.unitCostMinor) !== unitCostMinor) throw new Error('product_cost_changed_refresh_cart');
          const lineTotal = unitPriceMinor * item.quantity;
          if (!Number.isSafeInteger(lineTotal)) throw new Error('sale_total_overflow');
          subtotalMinor += lineTotal;
          if (!Number.isSafeInteger(subtotalMinor)) throw new Error('sale_total_overflow');

          if (!event || event.type !== 'sale' || event.locationId !== sale.locationId ||
            event.productId !== item.productId || Number(event.quantityDelta) !== -item.quantity ||
            (event.referenceId && event.referenceId !== sale.id) || event.deviceId !== op.deviceId ||
            !Number.isInteger(event.localSequence) || event.localSequence < 0) {
            throw new Error('invalid_sale_inventory_event');
          }
          validatedItems.push({ item, event, unitPriceMinor, unitCostMinor });
        }

        if (subtotalMinor !== Number(sale.subtotalMinor) || subtotalMinor !== Number(sale.totalMinor)) {
          throw new Error('sale_total_mismatch');
        }

        // Acquire locks in a deterministic order to prevent deadlocks when two
        // terminals sell overlapping multi-product carts at the same time.
        for (const productId of [...productIds].sort()) {
          await pool.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
            `inventory:${organizationId}:${sale.locationId}:${productId}`,
          ]);
        }

        // All inventory checks happen before any sale records are inserted.
        for (const { item, event } of validatedItems) {
          const stockResult = await pool.query(
            `select coalesce(sum(case when event_type not in ('reservation','reservation_release') then quantity_delta else 0 end),0) as stock
             from inventory_events where organization_id=$1 and location_id=$2 and product_id=$3`,
            [organizationId, sale.locationId, item.productId],
          );
          const stock = Number(stockResult.rows[0]?.stock ?? 0);
          const required = Math.abs(Number(event.quantityDelta));
          if (!Number.isSafeInteger(required) || required <= 0 || stock < required) throw new Error('insufficient_stock');
        }

        await pool.query(`insert into sales (id,organization_id,location_id,customer_id,subtotal_minor,discount_minor,total_minor,payment_method,status,below_cost,discount_reason,occurred_at,device_id,local_sequence,created_at,created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),$15) on conflict (id) do nothing`,
          [sale.id,organizationId,sale.locationId,sale.customerId??null,subtotalMinor,0,subtotalMinor,sale.paymentMethod,'completed',false,null,sale.occurredAt,op.deviceId,op.localSequence,user.id]);

        for (const { item, event, unitPriceMinor, unitCostMinor } of validatedItems) {
          await pool.query(`insert into sale_items (id,sale_id,product_id,quantity,unit_price_minor,unit_cost_minor,discount_minor)
            values ($1,$2,$3,$4,$5,$6,0) on conflict (id) do nothing`,
            [item.id,sale.id,item.productId,item.quantity,unitPriceMinor,unitCostMinor]);

          const existingEvent = await pool.query('select 1 from inventory_events where id=$1 limit 1', [event.id]);
          if (!existingEvent.rowCount) {
            await pool.query(`insert into inventory_events (id,organization_id,location_id,product_id,event_type,quantity_delta,unit_cost_minor,reference_id,occurred_at,device_id,local_sequence,created_at,created_by)
              values ($1,$2,$3,$4,'sale',$5,$6,$7,$8,$9,$10,$11,$12)`,
              [event.id,organizationId,event.locationId,event.productId,event.quantityDelta,unitCostMinor,sale.id,event.occurredAt,op.deviceId,event.localSequence,event.createdAt??sale.createdAt,user.id]);
            await pool.query(`insert into sync_receipts (organization_id,device_id,local_sequence,entity_type,entity_id)
              values ($1,$2,$3,'inventory_event',$4) on conflict do nothing`,
              [organizationId,op.deviceId,event.localSequence,event.id]);
          }
        }

        await postSaleJournal(pool, {
          organizationId,
          locationId: sale.locationId,
          sourceId: sale.id,
          occurredAt: sale.occurredAt,
          createdBy: user.id,
          paymentMethod: sale.paymentMethod,
          totalMinor: subtotalMinor,
          items: validatedItems.map(({ item, unitCostMinor }) => ({ quantity: item.quantity, unitCostMinor })),
        });
      } else {
        const expense = p;
        if (expense.id !== op.entityId || expense.organizationId !== organizationId || expense.deviceId !== op.deviceId) throw new Error('invalid_expense_identity');
        if (!expense.id || typeof expense.category !== 'string' || !expense.category.trim() || typeof expense.description !== 'string' || !expense.description.trim() || !Number.isSafeInteger(Number(expense.amountMinor)) || Number(expense.amountMinor) <= 0 || !['cash','bank','transfer','card'].includes(String(expense.paymentMethod)) || typeof expense.occurredAt !== 'string') throw new Error('invalid_expense_payload');
        if (!expense.locationId) throw new Error('expense_location_required');
        if (expense.locationId) {
          const location = await pool.query('select 1 from locations where id=$1 and organization_id=$2 and active=true limit 1', [expense.locationId, organizationId]);
          if (!location.rowCount) throw new Error('location_ownership_check_failed');
          if (!canAccessLocation(expense.locationId)) throw new Error('location_access_denied');
        }
        await pool.query(`insert into expenses (id,organization_id,location_id,amount_minor,category,description,payment_method,occurred_at,device_id,created_at,created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do nothing`, [expense.id,organizationId,expense.locationId??null,expense.amountMinor,expense.category,expense.description,expense.paymentMethod,expense.occurredAt,expense.deviceId,expense.createdAt,user.id]);
        await postExpenseJournal(pool, {
          organizationId,
          locationId: expense.locationId,
          sourceId: expense.id,
          occurredAt: expense.occurredAt,
          createdBy: user.id,
          paymentMethod: expense.paymentMethod,
          amountMinor: Number(expense.amountMinor),
          category: expense.category.trim(),
          description: expense.description.trim(),
        });
      }

      await pool.query(`insert into sync_receipts (organization_id,device_id,local_sequence,entity_type,entity_id)
        values ($1,$2,$3,$4,$5) on conflict do nothing`, [organizationId,op.deviceId,op.localSequence,op.entity,op.entityId]);
      await pool.query(`insert into sync_operations (id,organization_id,device_id,entity_type,entity_id,operation_type,payload,created_at,processed_at,state)
        values ($1,$2,$3,$4,$5,'create',$6::jsonb,$7,now(),'processed')
        on conflict (id) do update set state='processed',processed_at=now(),error_code=null,error_message=null`, [op.id,organizationId,op.deviceId,op.entity,op.entityId,JSON.stringify(op.payload),op.createdAt]);
      await pool.query('COMMIT');
      results.push({ id: op.id, ok: true });
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => undefined);
      const message = errorText(error);
      results.push({ id: op.id, ok: false, conflict: message.includes('insufficient_stock'), error: message });
    } finally {
      await pool.end();
    }
  }
  return json(res, 200, { results });
}
