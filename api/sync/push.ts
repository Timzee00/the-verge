import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, transactionPool } from '../_db';
import { json, method, requireUser } from '../_http';

const ALLOWED = new Set(['inventory_event', 'product', 'customer', 'sale', 'expense']);
const PERMISSION_BY_ENTITY: Record<string,string> = { inventory_event:'inventory.write', product:'inventory.write', customer:'business.write', sale:'sales.write', expense:'finance.write' };
const ROLE_PERMISSIONS: Record<string, Set<string>> = {
  business_owner: new Set(['business.write','inventory.write','sales.write','sales.void','finance.read','finance.write','staff.manage','api.manage']),
  manager: new Set(['business.write','inventory.write','sales.write','sales.void','finance.read']),
  cashier: new Set(['business.read','inventory.read','sales.write']),
  inventory_staff: new Set(['business.read','inventory.read','inventory.write']),
  accountant: new Set(['business.read','finance.read','finance.write']),
  platform_admin: new Set(['business.write','inventory.write','sales.write','sales.void','finance.read','finance.write','staff.manage','api.manage','billing.manage','security.manage'])
};
const INVENTORY_SIGN: Record<string,'positive'|'negative'|'any'> = {
  opening:'positive', purchase:'positive', sale:'negative', sale_void:'positive', return:'positive',
  damage:'negative', adjustment:'any', transfer_out:'negative', transfer_in:'positive',
  reservation:'positive', reservation_release:'positive'
};
function roleCan(role:string, permission:string){ return ROLE_PERMISSIONS[role]?.has(permission) ?? false; }
function hasSafeMinor(value:unknown){ return Number.isSafeInteger(value) && Number(value)>=0; }
function locationAllowed(pool:any, role:string, membershipId:string, organizationId:string, locationId:string){
  if(role==='platform_admin') return Promise.resolve(true);
  return pool.query('select 1 from membership_locations ml join locations l on l.id=ml.location_id where ml.membership_id=$1 and ml.location_id=$2 and ml.active=true and l.organization_id=$3 and l.active=true limit 1',[membershipId,locationId,organizationId]).then((r:any)=>Boolean(r.rowCount));
}
async function audit(pool:any, organizationId:string, userId:string, action:string, entityType:string, entityId:string, after:any, reason?:string){
  await pool.query('insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,after_data,reason) values ($1,$2,$3,$4,$5,$6::jsonb,$7)',[organizationId,userId,action,entityType,entityId,JSON.stringify(after??null),reason??null]);
}
async function change(pool:any, organizationId:string, entityType:string, entityId:string){
  await pool.query('insert into sync_changes (organization_id,entity_type,entity_id) values ($1,$2,$3)',[organizationId,entityType,entityId]);
}

function errorText(error: unknown) { return String((error as any)?.message ?? error); }
function pIdentity(payload:any, entityId:string, organizationId:string, deviceId:string){ if(!payload||payload.id!==entityId||(payload.organizationId&&payload.organizationId!==organizationId)||(payload.deviceId&&payload.deviceId!==deviceId)) return 'operation_identity_mismatch'; return ''; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ['POST'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  const { organizationId, operations } = req.body ?? {};
  if (typeof organizationId !== 'string' || !Array.isArray(operations) || operations.length > 100) {
    return json(res, 400, { error: 'invalid_batch' });
  }

  const sql = db();
  const membership = await sql`select m.id as membership_id,m.role,o.status from memberships m join organizations o on o.id=m.organization_id where m.organization_id=${organizationId} and m.user_id=${user.id} and m.active=true limit 1`;
  if (!membership.length || String(membership[0].status)!=='active') return json(res, 403, { error: 'forbidden' });

  const results: any[] = [];
  const role=String(membership[0].role);
  const membershipId=String(membership[0].membership_id);
  for (const op of operations) {
    if (!op || typeof op !== 'object' || !ALLOWED.has(op.entity) || op.operation !== 'create' || typeof op.id !== 'string' || typeof op.entityId !== 'string' || typeof op.deviceId !== 'string' || !Number.isInteger(op.localSequence) || op.localSequence < 0 || (op.organizationId && op.organizationId!==organizationId)) {
      results.push({ id: (op as any)?.id ?? null, ok: false, rejected: true, error: 'invalid_operation' });
      continue;
    }
    const permission=PERMISSION_BY_ENTITY[String(op.entity)];
    if(!roleCan(role,permission)){ results.push({id:op.id,ok:false,rejected:true,error:'forbidden'}); continue; }

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
        if (pIdentity(op.payload, op.entityId, organizationId, op.deviceId)) throw new Error(pIdentity(op.payload, op.entityId, organizationId, op.deviceId)!);
        const eventType=(op.payload as any)?.type;
        const delta=(op.payload as any)?.quantityDelta;
        const direction=(INVENTORY_SIGN as any)[eventType];
        if(!direction || !Number.isFinite(delta) || delta===0 || (direction==='positive'&&delta<=0) || (direction==='negative'&&delta>=0)) throw new Error('invalid_inventory_direction');
        const owned = await pool.query('select p.id from products p join locations l on l.id=$2 and l.organization_id=$3 where p.id=$1 and p.organization_id=$3 limit 1', [p.productId, p.locationId, organizationId]);
        if (!owned.rowCount) throw new Error('ownership_check_failed');

        if (!(await locationAllowed(pool,role,membershipId,organizationId,p.locationId))) throw new Error('location_forbidden');
        const duplicateEvent=await pool.query('select id from inventory_events where id=$1 and organization_id=$2 limit 1',[p.id,organizationId]);
        if(duplicateEvent.rowCount){
          await pool.query('insert into sync_receipts (organization_id,device_id,local_sequence,entity_type,entity_id) values ($1,$2,$3,$4,$5) on conflict do nothing',[organizationId,op.deviceId,op.localSequence,op.entity,op.entityId]);
          await pool.query('COMMIT');
          results.push({id:op.id,ok:true,deduplicated:true});
          continue;
        }
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
        if(p.id!==op.entityId || (p.organizationId&&p.organizationId!==organizationId) || typeof p.sku!=='string' || !p.sku.trim() || typeof p.name!=='string' || !p.name.trim() || typeof p.unit!=='string' || !p.unit.trim()) throw new Error('invalid_product');
        if(!hasSafeMinor(p.standardCostMinor)||!hasSafeMinor(p.retailPriceMinor) || (p.wholesalePriceMinor!=null&&!hasSafeMinor(p.wholesalePriceMinor)) || (p.minimumPriceMinor!=null&&!hasSafeMinor(p.minimumPriceMinor))) throw new Error('invalid_product');
        await pool.query(`insert into products (id,organization_id,sku,barcode,name,brand,category,unit,weight_value,weight_unit,image_url,standard_cost_minor,retail_price_minor,wholesale_price_minor,minimum_price_minor,reorder_level,active,track_batch,track_expiry,created_at,updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
          on conflict (id) do nothing`, [p.id,organizationId,p.sku,p.barcode??null,p.name,p.brand??null,p.category??null,p.unit,p.weightValue??null,p.weightUnit??null,p.imageUri??null,p.standardCostMinor,p.retailPriceMinor,p.wholesalePriceMinor??null,p.minimumPriceMinor??null,p.reorderLevel??null,p.active,p.trackBatch,p.trackExpiry,p.createdAt,p.updatedAt]);
        await audit(pool,organizationId,user.id,'product.created','product',p.id,p);
        await change(pool,organizationId,'product',p.id);
      } else if (op.entity === 'customer') {
        if(p.id!==op.entityId || (p.organizationId&&p.organizationId!==organizationId) || typeof p.name!=='string' || !p.name.trim()) throw new Error('invalid_customer');
        if(p.creditLimitMinor!=null&&!hasSafeMinor(p.creditLimitMinor)) throw new Error('invalid_customer');
        await pool.query(`insert into customers (id,organization_id,name,phone,email,credit_limit_minor,active,created_at,updated_at)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (id) do nothing`, [p.id,organizationId,p.name,p.phone??null,p.email??null,p.creditLimitMinor??null,p.active,p.createdAt,p.updatedAt]);
        await audit(pool,organizationId,user.id,'customer.created','customer',p.id,p);
        await change(pool,organizationId,'customer',p.id);
      } else if (op.entity === 'sale') {
        const sale = p.sale; const items = Array.isArray(p.items) ? p.items : (p.item ? [p.item] : []);
        if (!sale || !items.length || sale.id!==op.entityId) throw new Error('invalid_sale_payload');
        if (sale.organizationId && sale.organizationId!==organizationId) throw new Error('operation_identity_mismatch');
        if (sale.deviceId && sale.deviceId!==op.deviceId) throw new Error('operation_identity_mismatch');
        if (!['cash','bank','transfer','card','credit'].includes(sale.paymentMethod) || sale.status!=='completed') throw new Error('invalid_sale_state');
        if (!Number.isSafeInteger(sale.subtotalMinor)||sale.subtotalMinor<0||!Number.isSafeInteger(sale.discountMinor)||sale.discountMinor<0||!Number.isSafeInteger(sale.totalMinor)||sale.totalMinor<0) throw new Error('invalid_sale_totals');
        if (!(await locationAllowed(pool,role,membershipId,organizationId,sale.locationId))) throw new Error('location_forbidden');
        const location = await pool.query('select 1 from locations where id=$1 and organization_id=$2 and active=true limit 1', [sale.locationId, organizationId]);
        if (!location.rowCount) throw new Error('ownership_check_failed');
        if (sale.customerId) {
          const customer = await pool.query('select 1 from customers where id=$1 and organization_id=$2 limit 1', [sale.customerId, organizationId]);
          if (!customer.rowCount) throw new Error('customer_ownership_check_failed');
        }
        let authoritativeSubtotal=0, authoritativeDiscount=0, authoritativeCost=0;
        const productCosts=new Map<string,number>();
        for(const item of items){
          if(!item||typeof item.id!=='string'||item.saleId!==sale.id||typeof item.productId!=='string'||!Number.isFinite(Number(item.quantity))||Number(item.quantity)<=0) throw new Error('invalid_sale_item');
          if(!Number.isSafeInteger(item.unitPriceMinor)||item.unitPriceMinor<0||!Number.isSafeInteger(item.discountMinor)||item.discountMinor<0) throw new Error('invalid_sale_item');
          const gross=item.unitPriceMinor*Number(item.quantity);
          if(!Number.isSafeInteger(gross)||item.discountMinor>gross) throw new Error('invalid_sale_item');
          const product=await pool.query('select standard_cost_minor from products where id=$1 and organization_id=$2 and active=true limit 1',[item.productId,organizationId]);
          if(!product.rowCount) throw new Error('product_ownership_check_failed');
          const unitCost=Number(product.rows[0].standard_cost_minor);
          if(!Number.isSafeInteger(unitCost)||unitCost<0) throw new Error('invalid_product_cost');
          authoritativeSubtotal+=gross; authoritativeDiscount+=item.discountMinor; authoritativeCost+=unitCost*Number(item.quantity); productCosts.set(item.productId,unitCost);
          if(!Number.isSafeInteger(authoritativeSubtotal)||!Number.isSafeInteger(authoritativeDiscount)||!Number.isSafeInteger(authoritativeCost)) throw new Error('sale_total_overflow');
        }
        const authoritativeTotal=authoritativeSubtotal-authoritativeDiscount;
        const authoritativeBelowCost=authoritativeTotal<authoritativeCost;
        if(sale.subtotalMinor!==authoritativeSubtotal||sale.discountMinor!==authoritativeDiscount||sale.totalMinor!==authoritativeTotal||Boolean(sale.belowCost)!==authoritativeBelowCost) throw new Error('sale_total_mismatch');
        if(authoritativeBelowCost&&!String(sale.discountReason??'').trim()) throw new Error('below_cost_reason_required');
        await pool.query(`insert into sales (id,organization_id,location_id,customer_id,subtotal_minor,discount_minor,total_minor,payment_method,status,below_cost,discount_reason,occurred_at,device_id,local_sequence,created_at,created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) on conflict (id) do nothing`, [sale.id,organizationId,sale.locationId,sale.customerId??null,sale.subtotalMinor,sale.discountMinor,sale.totalMinor,sale.paymentMethod,sale.status,sale.belowCost,sale.discountReason??null,sale.occurredAt,sale.deviceId,sale.localSequence,sale.createdAt,user.id]);
        const embeddedEvents = Array.isArray(p.inventoryEvents) ? p.inventoryEvents : (p.inventoryEvent ? [p.inventoryEvent] : []);
        for (let index = 0; index < items.length; index++) {
          const item = items[index];
          const product = await pool.query('select standard_cost_minor from products where id=$1 and organization_id=$2 and active=true limit 1', [item.productId, organizationId]);
          if (!product.rowCount) throw new Error('product_ownership_check_failed');
          const authoritativeUnitCost=Number(productCosts.get(item.productId));
          await pool.query(`insert into sale_items (id,sale_id,product_id,quantity,unit_price_minor,unit_cost_minor,discount_minor)
            values ($1,$2,$3,$4,$5,$6,$7) on conflict (id) do nothing`, [item.id,sale.id,item.productId,item.quantity,item.unitPriceMinor,authoritativeUnitCost,item.discountMinor]);

          const event = embeddedEvents[index];
          if (!event || event.referenceId!==sale.id || event.locationId!==sale.locationId || event.productId!==item.productId || event.type!=='sale' || Number(event.quantityDelta)!==-Number(item.quantity) || event.deviceId && event.deviceId!==op.deviceId) throw new Error('invalid_sale_inventory_event');
          const existingEvent = await pool.query('select 1 from inventory_events where id=$1 or reference_id=$2 limit 1', [event.id, sale.id]);
          if (existingEvent.rowCount) continue;
          await pool.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`inventory:${organizationId}:${sale.locationId}:${item.productId}`]);
          const stockResult = await pool.query(`select coalesce(sum(case when event_type not in ('reservation','reservation_release') then quantity_delta else 0 end),0) as stock from inventory_events where organization_id=$1 and location_id=$2 and product_id=$3`, [organizationId,sale.locationId,item.productId]);
          const stock = Number(stockResult.rows[0]?.stock ?? 0);
          const required = Number(item.quantity);
          if (!Number.isFinite(required) || required <= 0 || stock < required) throw new Error('insufficient_stock');
          await pool.query(`insert into inventory_events (id,organization_id,location_id,product_id,event_type,quantity_delta,unit_cost_minor,reference_id,occurred_at,device_id,local_sequence,created_at,created_by)
            values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) on conflict (id) do nothing`, [event.id,organizationId,event.locationId,event.productId,event.type,event.quantityDelta,event.unitCostMinor??null,event.referenceId??sale.id,event.occurredAt,event.deviceId,event.localSequence,event.createdAt??sale.createdAt,user.id]);
          await change(pool,organizationId,'inventory_event',event.id);
        }
        await audit(pool,organizationId,user.id,'sale.created','sale',sale.id,{...sale,subtotalMinor:authoritativeSubtotal,discountMinor:authoritativeDiscount,totalMinor:authoritativeTotal,belowCost:authoritativeBelowCost});
        await change(pool,organizationId,'sale',sale.id);
      } else {
        const expense = p;
        if (expense.id!==op.entityId || (expense.organizationId&&expense.organizationId!==organizationId) || !expense.category || !expense.description || !hasSafeMinor(expense.amountMinor) || Number(expense.amountMinor) <= 0) throw new Error('invalid_expense_payload');
        if(!['cash','bank','transfer','card'].includes(expense.paymentMethod)) throw new Error('invalid_expense_payment');
        if (expense.locationId) {
          const location = await pool.query('select 1 from locations where id=$1 and organization_id=$2 limit 1', [expense.locationId, organizationId]);
          if (!location.rowCount) throw new Error('location_ownership_check_failed');
        }
        await pool.query(`insert into expenses (id,organization_id,location_id,amount_minor,category,description,payment_method,occurred_at,device_id,created_at,created_by)
          values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (id) do nothing`, [expense.id,organizationId,expense.locationId??null,expense.amountMinor,expense.category,expense.description,expense.paymentMethod,expense.occurredAt,expense.deviceId,expense.createdAt,user.id]);
        await audit(pool,organizationId,user.id,'expense.created','expense',expense.id,expense);
        await change(pool,organizationId,'expense',expense.id);
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
