import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, transactionPool } from '../_db';
import { json, method, requireUser } from '../_http';

const ALLOWED = new Set(['inventory_event', 'product', 'customer', 'sale', 'expense']);
const PERMISSION_BY_ENTITY: Record<string,string> = { inventory_event:'inventory.write', product:'inventory.write', customer:'business.write', sale:'sales.write', expense:'finance.write' };
const WRITE_ROLES = new Set(['business_owner', 'platform_admin', 'manager', 'cashier', 'inventory_staff', 'accountant']);

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
  if (!membership.length || !WRITE_ROLES.has(String(membership[0].role))) return json(res, 403, { error: 'forbidden' });

  const results: any[] = [];
  for (const op of operations) {
    if (!op || typeof op !== 'object' || !ALLOWED.has(op.entity) || op.operation !== 'create' || typeof op.entityId !== 'string' || typeof op.deviceId !== 'string' || !Number.isInteger(op.localSequence) || op.localSequence < 0) {
      results.push({ id: (op as any)?.id ?? null, ok: false, rejected: true, error: 'invalid_operation' });
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
        const owned = await pool.query('select p.id from products p join locations l on l.id=$2 and l.organization_id=$3 where p.id=$1 and p.organization_id=$3 limit 1', [p.productId, p.locationId, organizationId]);
        if (!owned.rowCount) throw new Error('ownership_check_failed');

        if (p.type === 'sale') {
          await pool.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`inventory:${organizationId}:${p.locationId}:${p.productId}`]);
          const stockResult = await pool.query(`
            select coalesce(sum(case when event_type not in ('reservation','reservation_release') then quantity_delta else 0 end),0) as stock
            from inventory_events
            where organization_id=$1 and location_id=$2 and product_id=$3`, [organizationId, p.locationId, p.productId]);
          const stock = Number(stockResult.rows[0]?.stock ?? 0);
          const required = Math.abs(Number(p.quantityDelta));
          if (!Number.isFinite(required) || required <= 0 || stock < required) {
            await pool.query('ROLLBACK');
            results.push({ id: op.id, ok: false, conflict: true, error: 'insufficient_stock' });
            continue;
          }
        }

        await pool.query(`insert into inventory_events (id,organization_id,location_id,product_id,event_type,quantity_delta,unit_cost_minor,reference_id,occurred_at,device_id,local_sequence,created_at,created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          on conflict (id) do nothing`, [p.id, organizationId, p.locationId, p.productId, p.type, p.quantityDelta, p.unitCostMinor ?? null, p.referenceId ?? null, p.occurredAt, op.deviceId, op.localSequence, p.createdAt ?? new Date().toISOString(), user.id]);
      } else if (op.entity === 'product') {
        await pool.query(`insert into products (id,organization_id,sku,barcode,name,brand,category,unit,weight_value,weight_unit,image_url,standard_cost_minor,retail_price_minor,wholesale_price_minor,minimum_price_minor,reorder_level,active,track_batch,track_expiry,created_at,updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
          on conflict (id) do nothing`, [p.id,organizationId,p.sku,p.barcode??null,p.name,p.brand??null,p.category??null,p.unit,p.weightValue??null,p.weightUnit??null,p.imageUri??null,p.standardCostMinor,p.retailPriceMinor,p.wholesalePriceMinor??null,p.minimumPriceMinor??null,p.reorderLevel??null,p.active,p.trackBatch,p.trackExpiry,p.createdAt,p.updatedAt]);
      } else if (op.entity === 'customer') {
        await pool.query(`insert into customers (id,organization_id,name,phone,email,credit_limit_minor,active,created_at,updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`, [p.id,organizationId,p.name,p.phone??null,p.email??null,p.creditLimitMinor??null,p.active,p.createdAt,p.updatedAt]);
      } else if (op.entity === 'sale') {
        const sale = p.sale; const items = Array.isArray(p.items) ? p.items : (p.item ? [p.item] : []);
        if (!sale || !items.length) throw new Error('invalid_sale_payload');
        const location = await pool.query('select 1 from locations where id=$1 and organization_id=$2 limit 1', [sale.locationId, organizationId]);
        if (!location.rowCount) throw new Error('ownership_check_failed');
        if (sale.customerId) {
          const customer = await pool.query('select 1 from customers where id=$1 and organization_id=$2 limit 1', [sale.customerId, organizationId]);
          if (!customer.rowCount) throw new Error('customer_ownership_check_failed');
        }
        await pool.query(`insert into sales (id,organization_id,location_id,customer_id,subtotal_minor,discount_minor,total_minor,payment_method,status,below_cost,discount_reason,occurred_at,device_id,local_sequence,created_at,created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict (id) do nothing`, [sale.id,organizationId,sale.locationId,sale.customerId??null,sale.subtotalMinor,sale.discountMinor,sale.totalMinor,sale.paymentMethod,sale.status,sale.belowCost,sale.discountReason??null,sale.occurredAt,sale.deviceId,sale.localSequence,sale.createdAt,user.id]);
        const embeddedEvents = Array.isArray(p.inventoryEvents) ? p.inventoryEvents : (p.inventoryEvent ? [p.inventoryEvent] : []);
        for (let index = 0; index < items.length; index++) {
          const item = items[index];
          const product = await pool.query('select 1 from products where id=$1 and organization_id=$2 limit 1', [item.productId, organizationId]);
          if (!product.rowCount) throw new Error('product_ownership_check_failed');
          await pool.query(`insert into sale_items (id,sale_id,product_id,quantity,unit_price_minor,unit_cost_minor,discount_minor)
            values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`, [item.id,sale.id,item.productId,item.quantity,item.unitPriceMinor,item.unitCostMinor,item.discountMinor]);

          const event = embeddedEvents[index];
          if (!event) continue;
          const existingEvent = await pool.query('select 1 from inventory_events where id=$1 or reference_id=$2 limit 1', [event.id, sale.id]);
          if (existingEvent.rowCount) continue;
          await pool.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`inventory:${organizationId}:${sale.locationId}:${item.productId}`]);
          const stockResult = await pool.query(`select coalesce(sum(case when event_type not in ('reservation','reservation_release') then quantity_delta else 0 end),0) as stock from inventory_events where organization_id=$1 and location_id=$2 and product_id=$3`, [organizationId,sale.locationId,item.productId]);
          const stock = Number(stockResult.rows[0]?.stock ?? 0);
          const required = Math.abs(Number(event.quantityDelta));
          if (!Number.isFinite(required) || required <= 0 || stock < required) throw new Error('insufficient_stock');
          await pool.query(`insert into inventory_events (id,organization_id,location_id,product_id,event_type,quantity_delta,unit_cost_minor,reference_id,occurred_at,device_id,local_sequence,created_at,created_by)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (id) do nothing`, [event.id,organizationId,event.locationId,event.productId,event.type,event.quantityDelta,event.unitCostMinor??null,event.referenceId??sale.id,event.occurredAt,event.deviceId,event.localSequence,event.createdAt??sale.createdAt,user.id]);
          await pool.query(`insert into sync_receipts (organization_id,device_id,local_sequence,entity_type,entity_id) values ($1,$2,$3,'inventory_event',$4) on conflict do nothing`, [organizationId,event.deviceId,event.localSequence,event.id]);
        }
      } else {
        const expense = p;
        if (!expense.id || !expense.category || !expense.description || !Number.isFinite(Number(expense.amountMinor)) || Number(expense.amountMinor) <= 0) throw new Error('invalid_expense_payload');
        if (expense.locationId) {
          const location = await pool.query('select 1 from locations where id=$1 and organization_id=$2 limit 1', [expense.locationId, organizationId]);
          if (!location.rowCount) throw new Error('location_ownership_check_failed');
        }
        await pool.query(`insert into expenses (id,organization_id,location_id,amount_minor,category,description,payment_method,occurred_at,device_id,created_at,created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do nothing`, [expense.id,organizationId,expense.locationId??null,expense.amountMinor,expense.category,expense.description,expense.paymentMethod,expense.occurredAt,expense.deviceId,expense.createdAt,user.id]);
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
