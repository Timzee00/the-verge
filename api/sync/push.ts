import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, transactionPool } from '../_db';
import { json, method, requireSameOrigin, requireUser } from '../_http';

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
function safeOperationError(error:unknown){
  const code=String((error as any)?.message??'');
  const known=['invalid_operation','invalid_payload','operation_identity_mismatch','invalid_inventory_direction','ownership_check_failed','location_forbidden','invalid_product','invalid_customer','invalid_sale_payload','invalid_sale_state','invalid_sale_totals','invalid_sale_item','product_ownership_check_failed','customer_ownership_check_failed','sale_total_mismatch','below_cost_reason_required','invalid_sale_inventory_event','insufficient_stock','invalid_expense_payload','invalid_expense_payment','location_ownership_check_failed','invalid_sale_zero_total','accounting_chart_incomplete','sale_journal_missing','invalid_void_payload','invalid_void_inventory_event','sale_not_found','sale_already_voided','sale_items_missing'];
  if(known.includes(code)||code.startsWith('invalid_'))return code;
  const pgCode=String((error as any)?.code??'');
  if(pgCode==='40001'||pgCode==='40P01'||pgCode==='53300')return 'temporary_database_conflict';
  return 'operation_rejected';
}
function pIdentity(payload:any, entityId:string, organizationId:string, deviceId:string){ if(!payload||payload.id!==entityId||(payload.organizationId&&payload.organizationId!==organizationId)||(payload.deviceId&&payload.deviceId!==deviceId)) return 'operation_identity_mismatch'; return ''; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ['POST'])) return;
  if (!requireSameOrigin(req, res)) return;
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
    if (!op || typeof op !== 'object' || !ALLOWED.has(op.entity) || (op.operation !== 'create' && !(op.operation === 'void' && op.entity === 'sale')) || typeof op.id !== 'string' || op.id.length > 100 || typeof op.entityId !== 'string' || op.entityId.length > 100 || typeof op.deviceId !== 'string' || op.deviceId.length > 200 || !Number.isSafeInteger(op.localSequence) || op.localSequence < 0 || (op.organizationId && op.organizationId!==organizationId)) {
      results.push({ id: (op as any)?.id ?? null, ok: false, rejected: true, error: 'invalid_operation' });
      continue;
    }
    const permission=op.operation==='void'?'sales.void':PERMISSION_BY_ENTITY[String(op.entity)];
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

      if(op.operation==='void'){
        if(op.entity!=='sale'||p.saleId!==op.entityId||!String(p.reason??'').trim()||String(p.reason).length>500) throw new Error('invalid_void_payload');
        const saleResult=await pool.query('select id,organization_id,location_id,status from sales where id=$1 and organization_id=$2 limit 1 for update',[p.saleId,organizationId]);
        if(!saleResult.rowCount) throw new Error('sale_not_found');
        const saleRow=saleResult.rows[0] as any;
        if(String(saleRow.status)!=='completed') throw new Error('sale_already_voided');
        if(!(await locationAllowed(pool,role,membershipId,organizationId,String(saleRow.location_id)))) throw new Error('location_forbidden');
        const itemRows=await pool.query('select id,sale_id,product_id,quantity,unit_cost_minor from sale_items where sale_id=$1 order by id',[p.saleId]);
        if(!itemRows.rowCount) throw new Error('sale_items_missing');
        const events=Array.isArray(p.inventoryEvents)?p.inventoryEvents:[];
        if(events.length!==itemRows.rowCount) throw new Error('invalid_void_payload');
        const seen=new Set<string>();
        for(let i=0;i<itemRows.rows.length;i++){
          const item=itemRows.rows[i] as any, event=events[i];
          const quantity=Number(item.quantity);
          if(!event||typeof event.id!=='string'||seen.has(event.id)||event.referenceId!==p.saleId||event.locationId!==saleRow.location_id||event.productId!==item.product_id||event.type!=='sale_void'||Number(event.quantityDelta)!==quantity||(event.deviceId&&event.deviceId!==op.deviceId)) throw new Error('invalid_void_inventory_event');
          seen.add(event.id);
          await pool.query('select pg_advisory_xact_lock(hashtextextended($1,0))',['inventory:'+organizationId+':'+saleRow.location_id+':'+item.product_id]);
          const existingVoid=await pool.query('select id from inventory_events where id=$1 limit 1',[event.id]);
          if(existingVoid.rowCount) continue;
          await pool.query("insert into inventory_events (id,organization_id,location_id,product_id,event_type,quantity_delta,unit_cost_minor,reference_id,occurred_at,device_id,local_sequence,created_at,created_by) values ($1,$2,$3,$4,'sale_void',$5,$6,$7,$8,$9,$10,$11,$12)",[event.id,organizationId,saleRow.location_id,item.product_id,quantity,Number(item.unit_cost_minor),p.saleId,event.occurredAt??new Date().toISOString(),op.deviceId,event.localSequence+i+1,event.createdAt??new Date().toISOString(),user.id]);
          await change(pool,organizationId,'inventory_event',event.id);
        }
        const originalJournal=await pool.query(
          "select je.id,je.status,jl.account_id,jl.debit_minor,jl.credit_minor,jl.memo from journal_entries je join journal_lines jl on jl.journal_entry_id=je.id where je.organization_id=$1 and je.reference=$2 order by jl.id",
          [organizationId,'SALE-'+p.saleId]
        );
        if(!originalJournal.rowCount) throw new Error('sale_journal_missing');
        const voidJournalId=crypto.randomUUID();
        await pool.query(
          "insert into journal_entries (id,organization_id,reference,description,occurred_at,source_type,source_id,status,created_at,created_by) values ($1,$2,$3,$4,$5,'sale_void',$6,'posted',$7,$8)",
          [voidJournalId,organizationId,'VOID-SALE-'+p.saleId,'Void sale '+p.saleId,p.occurredAt??new Date().toISOString(),p.saleId,p.createdAt??new Date().toISOString(),user.id]
        );
        for(const line of originalJournal.rows as any[]){
          await pool.query(
            "insert into journal_lines (id,journal_entry_id,account_id,debit_minor,credit_minor,memo) values ($1,$2,$3,$4,$5,$6)",
            [crypto.randomUUID(),voidJournalId,line.account_id,line.credit_minor,line.debit_minor,line.memo??null]
          );
        }
        await pool.query("update journal_entries set status='voided' where id=$1",[originalJournal.rows[0].id]);
        await pool.query("update sales set status='voided' where id=$1 and organization_id=$2",[p.saleId,organizationId]);
        await audit(pool,organizationId,user.id,'sale.voided','sale',p.saleId,{status:'voided',reversalJournalEntryId:voidJournalId},String(p.reason).trim());
      } else if (op.entity === 'inventory_event') {
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
          if(!item||typeof item.id!=='string'||item.saleId!==sale.id||typeof item.productId!=='string') throw new Error('invalid_sale_item');
          const quantity=Number(item.quantity);
          if(!Number.isFinite(quantity)||quantity<=0||quantity>1000000||Number(quantity.toFixed(6))!==quantity) throw new Error('invalid_sale_item');
          if(!Number.isSafeInteger(item.unitPriceMinor)||item.unitPriceMinor<0||!Number.isSafeInteger(item.discountMinor)||item.discountMinor<0) throw new Error('invalid_sale_item');
          const gross=Math.round(item.unitPriceMinor*quantity);
          if(!Number.isSafeInteger(gross)||item.discountMinor>gross) throw new Error('invalid_sale_item');
          const product=await pool.query('select standard_cost_minor from products where id=$1 and organization_id=$2 and active=true limit 1',[item.productId,organizationId]);
          if(!product.rowCount) throw new Error('product_ownership_check_failed');
          const unitCost=Number(product.rows[0].standard_cost_minor);
          if(!Number.isSafeInteger(unitCost)||unitCost<0) throw new Error('invalid_product_cost');
          authoritativeSubtotal+=gross; authoritativeDiscount+=item.discountMinor; authoritativeCost+=Math.round(unitCost*quantity); productCosts.set(item.productId,unitCost);
          if(!Number.isSafeInteger(authoritativeSubtotal)||!Number.isSafeInteger(authoritativeDiscount)||!Number.isSafeInteger(authoritativeCost)) throw new Error('sale_total_overflow');
        }
        const authoritativeTotal=authoritativeSubtotal-authoritativeDiscount;
        if(authoritativeTotal<=0) throw new Error('invalid_sale_zero_total');
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
          const existingEvent = await pool.query('select 1 from inventory_events where id=$1 limit 1', [event.id]);
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
        const saleJournalId=crypto.randomUUID();
        const debitCode=sale.paymentMethod==='cash'?'1000':sale.paymentMethod==='credit'?'1100':'1010';
        const accountRows=await pool.query(
          "select code,id from ledger_accounts where organization_id=$1 and code in ('1000','1010','1100','1200','4000','5000') and active=true",
          [organizationId]
        );
        const accountIds=new Map(accountRows.rows.map((row:any)=>[String(row.code),String(row.id)]));
        for(const code of [debitCode,'1200','4000','5000']){
          if(!accountIds.has(code)) throw new Error('accounting_chart_incomplete');
        }
        await pool.query(
          "insert into journal_entries (id,organization_id,reference,description,occurred_at,source_type,source_id,status,created_at,created_by) values ($1,$2,$3,$4,$5,'sale',$6,'posted',$7,$8)",
          [saleJournalId,organizationId,'SALE-'+sale.id,'Sale '+sale.id,sale.occurredAt,sale.id,sale.createdAt??new Date().toISOString(),user.id]
        );
        const journalLines=[
          [crypto.randomUUID(),saleJournalId,accountIds.get(debitCode),authoritativeTotal,0],
          [crypto.randomUUID(),saleJournalId,accountIds.get('4000'),0,authoritativeTotal],
        ];
        if(authoritativeCost>0){
          journalLines.push([crypto.randomUUID(),saleJournalId,accountIds.get('5000'),authoritativeCost,0]);
          journalLines.push([crypto.randomUUID(),saleJournalId,accountIds.get('1200'),0,authoritativeCost]);
        }
        for(const line of journalLines){
          await pool.query(
            "insert into journal_lines (id,journal_entry_id,account_id,debit_minor,credit_minor) values ($1,$2,$3,$4,$5)",
            line
          );
        }
        await audit(pool,organizationId,user.id,'sale.created','sale',sale.id,{...sale,subtotalMinor:authoritativeSubtotal,discountMinor:authoritativeDiscount,totalMinor:authoritativeTotal,belowCost:authoritativeBelowCost,journalEntryId:saleJournalId});
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
        const expenseJournalId=crypto.randomUUID();
        const expenseDebitAccount=await pool.query("select id from ledger_accounts where organization_id=$1 and code='6000' and active=true limit 1",[organizationId]);
        const expenseCreditCode=expense.paymentMethod==='cash'?'1000':'1010';
        const expenseCreditAccount=await pool.query("select id from ledger_accounts where organization_id=$1 and code=$2 and active=true limit 1",[organizationId,expenseCreditCode]);
        if(!expenseDebitAccount.rowCount||!expenseCreditAccount.rowCount) throw new Error('accounting_chart_incomplete');
        await pool.query(
          "insert into journal_entries (id,organization_id,reference,description,occurred_at,source_type,source_id,status,created_at,created_by) values ($1,$2,$3,$4,$5,'expense',$6,'posted',$7,$8)",
          [expenseJournalId,organizationId,'EXPENSE-'+expense.id,expense.description,expense.occurredAt,expense.id,expense.createdAt??new Date().toISOString(),user.id]
        );
        await pool.query(
          "insert into journal_lines (id,journal_entry_id,account_id,debit_minor,credit_minor) values ($1,$2,$3,$4,0),($5,$2,$6,0,$4)",
          [crypto.randomUUID(),expenseJournalId,expenseDebitAccount.rows[0].id,expense.amountMinor,crypto.randomUUID(),expenseCreditAccount.rows[0].id]
        );

        await audit(pool,organizationId,user.id,'expense.created','expense',expense.id,expense);
        await change(pool,organizationId,'expense',expense.id);
      }

      await pool.query(`insert into sync_receipts (organization_id,device_id,local_sequence,entity_type,entity_id)
        values ($1,$2,$3,$4,$5) on conflict do nothing`, [organizationId,op.deviceId,op.localSequence,op.entity,op.entityId]);
      await pool.query(`insert into sync_operations (id,organization_id,device_id,entity_type,entity_id,operation_type,payload,created_at,processed_at,state)
        values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,now(),'processed')
        on conflict (id) do update set state='processed',processed_at=now(),error_code=null,error_message=null`, [op.id,organizationId,op.deviceId,op.entity,op.entityId,op.operation,JSON.stringify(op.payload),op.createdAt]);
      await pool.query('COMMIT');
      results.push({ id: op.id, ok: true });
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => undefined);
      const message = errorText(error);
      const safeError=safeOperationError(error);
      const conflict=safeError==='insufficient_stock';
      const retryable=safeError==='temporary_database_conflict';
      results.push({ id: op.id, ok: false, conflict, rejected: !conflict&&!retryable, error: safeError });
    } finally {
      await pool.end();
    }
  }
  return json(res, 200, { results });
}
