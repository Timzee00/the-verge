import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, transactionPool } from './_db.js';
import { json, method, requireUser } from './_http.js';
import { postPurchaseReceiptJournal, postTransferJournal } from './_accounting.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_ROLES = new Set(['business_owner','platform_admin']);
const MANAGE_ROLES = new Set(['business_owner','platform_admin','manager']);
const PROCUREMENT_ROLES = new Set(['business_owner','platform_admin','manager','inventory_staff']);

function optionalText(value: unknown,max:number,field:string):string|null {
  if(value===undefined||value===null||String(value).trim()==='')return null;
  const result=String(value).trim();
  if(result.length>max)throw new Error(field+'_too_long');
  return result;
}
function emailValue(value:unknown):string|null {
  const email=optionalText(value,320,'email')?.toLowerCase()??null;
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('invalid_email');
  return email;
}
function positiveInteger(value:unknown,field:string):number {
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<=0)throw new Error('invalid_'+field);
  return number;
}
function nonNegativeMinor(value:unknown,field:string):number {
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<0)throw new Error('invalid_'+field);
  return number;
}
function safeMultiply(a:number,b:number,field:string):number {
  const result=a*b;
  if(!Number.isSafeInteger(result))throw new Error(field+'_overflow');
  return result;
}
function reference(prefix:string,id:string) {
  const date=new Date().toISOString().slice(0,10).replace(/-/g,'');
  return prefix+'-'+date+'-'+id.replace(/-/g,'').slice(0,6).toUpperCase();
}
function canAccessLocation(role:string,assigned:Set<string>,locationId:string) {
  return OWNER_ROLES.has(role)||assigned.has(locationId);
}
function mapSupplier(row:any) {
  return {id:String(row.id),organizationId:String(row.organization_id),name:row.name,phone:row.phone??'',email:row.email??'',addressLine1:row.address_line1??'',addressLine2:row.address_line2??'',city:row.city??'',state:row.state??'',taxIdentifier:row.tax_identifier??'',notes:row.notes??'',active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at};
}
function mapOrder(row:any) {
  return {id:String(row.id),organizationId:String(row.organization_id),supplierId:String(row.supplier_id),supplierName:row.supplier_name,locationId:String(row.location_id),locationName:row.location_name,reference:row.reference,status:row.status,notes:row.notes??'',orderedAt:row.ordered_at,expectedAt:row.expected_at??null,createdAt:row.created_at,updatedAt:row.updated_at};
}
function mapOrderItem(row:any) {
  return {id:String(row.id),purchaseOrderId:String(row.purchase_order_id),productId:String(row.product_id),productName:row.product_name,sku:row.sku,quantityOrdered:Number(row.quantity_ordered),quantityReceived:Number(row.quantity_received),unitCostMinor:Number(row.unit_cost_minor)};
}
function mapReceipt(row:any) {
  return {id:String(row.id),purchaseOrderId:String(row.purchase_order_id),supplierId:String(row.supplier_id),locationId:String(row.location_id),totalCostMinor:Number(row.total_cost_minor),receivedAt:row.received_at};
}
function mapTransfer(row:any) {
  return {id:String(row.id),organizationId:String(row.organization_id),reference:row.reference,fromLocationId:String(row.from_location_id),fromLocationName:row.from_location_name,toLocationId:String(row.to_location_id),toLocationName:row.to_location_name,status:row.status,notes:row.notes??'',createdAt:row.created_at,dispatchedAt:row.dispatched_at??null,receivedAt:row.received_at??null};
}
function mapTransferItem(row:any) {
  return {id:String(row.id),transferId:String(row.transfer_id),productId:String(row.product_id),productName:row.product_name,sku:row.sku,quantity:Number(row.quantity),unitCostMinor:Number(row.unit_cost_minor)};
}

export async function handleProcurement(req:VercelRequest,res:VercelResponse) {
  if(!method(req,res,['GET','POST']))return;
  const user=await requireUser(req,res);if(!user)return;
  const organizationId=String(req.method==='GET'?req.query.organizationId??'':req.body?.organizationId??'');
  if(!UUID.test(organizationId))return json(res,400,{error:'invalid_organization'});

  const sql=db();
  const memberships=await sql`select role from memberships where organization_id=${organizationId} and user_id=${user.id} and active=true limit 1`;
  if(!memberships.length)return json(res,403,{error:'forbidden'});
  const role=String(memberships[0].role);
  if(!PROCUREMENT_ROLES.has(role))return json(res,403,{error:'procurement_permission_required'});
  const assignedRows=OWNER_ROLES.has(role)?[]:await sql`select location_id from membership_locations where organization_id=${organizationId} and user_id=${user.id}`;
  const assigned=new Set<string>(assignedRows.map((row:any)=>String(row.location_id)));
  const hasLocationAccess=(id:string)=>canAccessLocation(role,assigned,id);

  if(req.method==='GET') {
    const suppliers=await sql`
      select id,organization_id,name,phone,email,address_line1,address_line2,city,state,tax_identifier,notes,active,created_at,updated_at
      from suppliers where organization_id=${organizationId} order by active desc,name limit 500
    `;
    const orders=OWNER_ROLES.has(role)?await sql`
      select po.*,s.name as supplier_name,l.name as location_name
      from purchase_orders po join suppliers s on s.id=po.supplier_id join locations l on l.id=po.location_id
      where po.organization_id=${organizationId} order by po.ordered_at desc,po.id desc limit 100
    `:assigned.size?await sql`
      select po.*,s.name as supplier_name,l.name as location_name
      from purchase_orders po join suppliers s on s.id=po.supplier_id join locations l on l.id=po.location_id
      where po.organization_id=${organizationId} and po.location_id=any(${[...assigned]}::uuid[])
      order by po.ordered_at desc,po.id desc limit 100
    `:[];
    const orderIds=orders.map((item:any)=>item.id);
    const orderItems=orderIds.length?await sql`
      select poi.*,p.name as product_name,p.sku
      from purchase_order_items poi join products p on p.id=poi.product_id
      where poi.purchase_order_id=any(${orderIds}::uuid[])
      order by p.name,poi.id
    `:[];
    const receipts=OWNER_ROLES.has(role)?await sql`
      select id,purchase_order_id,supplier_id,location_id,total_cost_minor,received_at
      from purchase_receipts where organization_id=${organizationId}
      order by received_at desc,id desc limit 100
    `:assigned.size?await sql`
      select id,purchase_order_id,supplier_id,location_id,total_cost_minor,received_at
      from purchase_receipts where organization_id=${organizationId} and location_id=any(${[...assigned]}::uuid[])
      order by received_at desc,id desc limit 100
    `:[];
    const transfers=OWNER_ROLES.has(role)?await sql`
      select st.*,fl.name as from_location_name,tl.name as to_location_name
      from stock_transfers st join locations fl on fl.id=st.from_location_id join locations tl on tl.id=st.to_location_id
      where st.organization_id=${organizationId} order by st.created_at desc,st.id desc limit 100
    `:assigned.size?await sql`
      select st.*,fl.name as from_location_name,tl.name as to_location_name
      from stock_transfers st join locations fl on fl.id=st.from_location_id join locations tl on tl.id=st.to_location_id
      where st.organization_id=${organizationId}
        and (st.from_location_id=any(${[...assigned]}::uuid[]) or st.to_location_id=any(${[...assigned]}::uuid[]))
      order by st.created_at desc,st.id desc limit 100
    `:[];
    const transferIds=transfers.map((item:any)=>item.id);
    const transferItems=transferIds.length?await sql`
      select sti.*,p.name as product_name,p.sku
      from stock_transfer_items sti join products p on p.id=sti.product_id
      where sti.transfer_id=any(${transferIds}::uuid[])
      order by p.name,sti.id
    `:[];
    return json(res,200,{
      suppliers:suppliers.map(mapSupplier),purchaseOrders:orders.map(mapOrder),
      purchaseOrderItems:orderItems.map(mapOrderItem),purchaseReceipts:receipts.map(mapReceipt),
      transfers:transfers.map(mapTransfer),transferItems:transferItems.map(mapTransferItem),
      canManage:MANAGE_ROLES.has(role),
    });
  }

  const body=req.body??{};
  const action=String(body.action??'');
  if(action==='create_supplier'||action==='update_supplier'||action==='archive_supplier'||action==='restore_supplier') {
    if(!MANAGE_ROLES.has(role))return json(res,403,{error:'supplier_manage_permission_required'});
    const pool=transactionPool();
    try {
      await pool.query('BEGIN');
      if(action==='create_supplier') {
        const name=optionalText(body.name,140,'supplier_name');
        if(!name)throw new Error('supplier_name_required');
        const fields=[
          optionalText(body.phone,40,'phone'),emailValue(body.email),
          optionalText(body.addressLine1,160,'address_line1'),optionalText(body.addressLine2,160,'address_line2'),
          optionalText(body.city,100,'city'),optionalText(body.state,100,'state'),
          optionalText(body.taxIdentifier,60,'tax_identifier'),optionalText(body.notes,500,'notes'),
        ];
        const inserted=await pool.query(
          `insert into suppliers (id,organization_id,name,phone,email,address_line1,address_line2,city,state,tax_identifier,notes,created_by)
           values (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           returning id,organization_id,name,phone,email,address_line1,address_line2,city,state,tax_identifier,notes,active,created_at,updated_at`,
          [organizationId,name,...fields,user.id],
        );
        await pool.query(`insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,after_data,reason)
          values ($1,$2,'supplier.created','supplier',$3,$4::jsonb,'Owner created supplier')`,
          [organizationId,user.id,inserted.rows[0].id,JSON.stringify(inserted.rows[0])]);
        await pool.query('COMMIT');
        return json(res,201,{supplier:mapSupplier(inserted.rows[0])});
      }

      const supplierId=String(body.supplierId??'');
      if(!UUID.test(supplierId))throw new Error('invalid_supplier');
      const found=await pool.query('select * from suppliers where id=$1 and organization_id=$2 for update',[supplierId,organizationId]);
      if(!found.rowCount)throw new Error('supplier_not_found');
      const before=found.rows[0];
      let after:any;
      if(action==='archive_supplier'||action==='restore_supplier') {
        after=(await pool.query(
          `update suppliers set active=$3,updated_at=now() where id=$1 and organization_id=$2
           returning id,organization_id,name,phone,email,address_line1,address_line2,city,state,tax_identifier,notes,active,created_at,updated_at`,
          [supplierId,organizationId,action==='restore_supplier'],
        )).rows[0];
      } else {
        const name=Object.prototype.hasOwnProperty.call(body,'name')?optionalText(body.name,140,'supplier_name'):before.name;
        if(!name)throw new Error('supplier_name_required');
        const value=(key:string,column:string,max:number)=>Object.prototype.hasOwnProperty.call(body,key)?optionalText(body[key],max,column):before[column];
        const phone=value('phone','phone',40);
        const email=Object.prototype.hasOwnProperty.call(body,'email')?emailValue(body.email):before.email;
        const line1=value('addressLine1','address_line1',160);
        const line2=value('addressLine2','address_line2',160);
        const city=value('city','city',100);
        const state=value('state','state',100);
        const tax=value('taxIdentifier','tax_identifier',60);
        const notes=value('notes','notes',500);
        after=(await pool.query(
          `update suppliers set name=$3,phone=$4,email=$5,address_line1=$6,address_line2=$7,city=$8,state=$9,tax_identifier=$10,notes=$11,updated_at=now()
           where id=$1 and organization_id=$2
           returning id,organization_id,name,phone,email,address_line1,address_line2,city,state,tax_identifier,notes,active,created_at,updated_at`,
          [supplierId,organizationId,name,phone,email,line1,line2,city,state,tax,notes],
        )).rows[0];
      }
      await pool.query(`insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
        values ($1,$2,$3,'supplier',$4,$5::jsonb,$6::jsonb,'Supplier details changed')`,
        [organizationId,user.id,'supplier.'+action,supplierId,JSON.stringify(before),JSON.stringify(after)]);
      await pool.query('COMMIT');
      return json(res,200,{supplier:mapSupplier(after)});
    } catch(error:any) {
      await pool.query('ROLLBACK').catch(()=>undefined);
      if(error?.code==='23505')return json(res,409,{error:'supplier_name_in_use'});
      const message=String(error?.message??error);
      if(message.endsWith('_too_long')||['supplier_name_required','invalid_email','invalid_supplier','supplier_not_found'].includes(message))return json(res,400,{error:message});
      console.error('[procurement.supplier]',{name:error?.name,code:error?.code});
      return json(res,500,{error:'supplier_operation_failed'});
    } finally { await pool.end(); }
  }

  if(action==='create_purchase_order') {
    if(!MANAGE_ROLES.has(role))return json(res,403,{error:'purchase_order_permission_required'});
    const supplierId=String(body.supplierId??''),locationId=String(body.locationId??'');
    const rawItems=Array.isArray(body.items)?body.items:[];
    if(!UUID.test(supplierId)||!UUID.test(locationId)||!rawItems.length||rawItems.length>100) return json(res,400,{error:'invalid_purchase_order'});
    if(!hasLocationAccess(locationId))return json(res,403,{error:'location_access_denied'});
    const pool=transactionPool();
    try {
      await pool.query('BEGIN');
      const supplier=await pool.query('select id,name from suppliers where id=$1 and organization_id=$2 and active=true limit 1 for share',[supplierId,organizationId]);
      if(!supplier.rowCount)throw new Error('supplier_not_available');
      const location=await pool.query('select id from locations where id=$1 and organization_id=$2 and active=true limit 1',[locationId,organizationId]);
      if(!location.rowCount)throw new Error('location_not_available');
      const productIds=new Set<string>();
      const validated:any[]=[];
      for(const raw of rawItems) {
        const productId=String(raw?.productId??'');
        if(!UUID.test(productId)||productIds.has(productId))throw new Error('invalid_or_duplicate_order_product');
        productIds.add(productId);
        const quantity=positiveInteger(raw.quantityOrdered,'order_quantity');
        const unitCostMinor=nonNegativeMinor(raw.unitCostMinor,'unit_cost');
        const product=await pool.query('select id from products where id=$1 and organization_id=$2 and active=true limit 1',[productId,organizationId]);
        if(!product.rowCount)throw new Error('product_not_available');
        validated.push({productId,quantity,unitCostMinor});
      }
      const orderId=crypto.randomUUID();
      const orderReference=reference('PO',orderId);
      const notes=optionalText(body.notes,500,'notes');
      const expectedAt=body.expectedAt?String(body.expectedAt):null;
      if(expectedAt&&!/^\d{4}-\d{2}-\d{2}$/.test(expectedAt))throw new Error('invalid_expected_date');
      const inserted=await pool.query(
        `insert into purchase_orders (id,organization_id,supplier_id,location_id,reference,status,notes,expected_at,created_by)
         values ($1,$2,$3,$4,$5,'ordered',$6,$7,$8)
         returning id,reference,status,ordered_at`,
        [orderId,organizationId,supplierId,locationId,orderReference,notes,expectedAt,user.id],
      );
      for(const item of validated)await pool.query(
        `insert into purchase_order_items (id,purchase_order_id,product_id,quantity_ordered,quantity_received,unit_cost_minor)
         values (gen_random_uuid(),$1,$2,$3,0,$4)`,
        [orderId,item.productId,item.quantity,item.unitCostMinor],
      );
      await pool.query(`insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,after_data,reason)
        values ($1,$2,'purchase_order.created','purchase_order',$3,$4::jsonb,'Owner or manager placed a supplier purchase order')`,
        [organizationId,user.id,orderId,JSON.stringify({reference:orderReference,supplierId,locationId,items:validated})]);
      await pool.query('COMMIT');
      return json(res,201,{purchaseOrder:{id:orderId,reference:inserted.rows[0].reference,status:inserted.rows[0].status,orderedAt:inserted.rows[0].ordered_at}});
    } catch(error:any) {
      await pool.query('ROLLBACK').catch(()=>undefined);
      const message=String(error?.message??error);
      if(message.endsWith('_too_long')||['invalid_or_duplicate_order_product','invalid_order_quantity','invalid_unit_cost','product_not_available','supplier_not_available','location_not_available','invalid_expected_date'].includes(message))return json(res,400,{error:message});
      console.error('[procurement.purchase_order]',{name:error?.name,code:error?.code});
      return json(res,500,{error:'purchase_order_create_failed'});
    } finally { await pool.end(); }
  }

  if(action==='receive_purchase_order') {
    if(!['business_owner','platform_admin','manager','inventory_staff'].includes(role))return json(res,403,{error:'receiving_permission_required'});
    const orderId=String(body.purchaseOrderId??''),receiptId=String(body.idempotencyKey??'');
    const rawItems=Array.isArray(body.items)?body.items:[];
    if(!UUID.test(orderId)||!UUID.test(receiptId)||!rawItems.length||rawItems.length>100)return json(res,400,{error:'invalid_purchase_receipt'});
    const pool=transactionPool();
    try {
      await pool.query('BEGIN');
      const orderResult=await pool.query(
        `select po.*,s.name as supplier_name
         from purchase_orders po join suppliers s on s.id=po.supplier_id
         where po.id=$1 and po.organization_id=$2 for update of po`,
        [orderId,organizationId],
      );
      if(!orderResult.rowCount)throw new Error('purchase_order_not_found');
      const order=orderResult.rows[0];
      const locationId=String(order.location_id);
      if(!hasLocationAccess(locationId))throw new Error('location_access_denied');
      if(!['ordered','partially_received'].includes(String(order.status)))throw new Error('purchase_order_not_receivable');
      const requested=new Map<string,number>();
      for(const raw of rawItems) {
        const itemId=String(raw?.purchaseOrderItemId??'');
        if(!UUID.test(itemId)||requested.has(itemId))throw new Error('invalid_receipt_item');
        requested.set(itemId,positiveInteger(raw.quantityReceived,'received_quantity'));
      }
      const duplicate=await pool.query('select id,purchase_order_id from purchase_receipts where id=$1 limit 1',[receiptId]);
      if(duplicate.rowCount) {
        if(String(duplicate.rows[0].purchase_order_id)!==orderId)throw new Error('receipt_id_collision');
        const priorLines=await pool.query('select purchase_order_item_id,quantity_received from purchase_receipt_items where purchase_receipt_id=$1',[receiptId]);
        const priorMap=new Map<string,number>(priorLines.rows.map((row:any)=>[String(row.purchase_order_item_id),Number(row.quantity_received)]));
        if(priorMap.size!==requested.size||[...requested.entries()].some(([itemId,quantity])=>priorMap.get(itemId)!==quantity))throw new Error('receipt_idempotency_payload_mismatch');
        await pool.query('COMMIT');
        return json(res,200,{receipt:{id:receiptId,deduplicated:true}});
      }
      const orderItemIds=[...requested.keys()];
      const items=await pool.query(
        `select poi.id,poi.product_id,poi.quantity_ordered,poi.quantity_received,poi.unit_cost_minor,p.name as product_name
         from purchase_order_items poi join products p on p.id=poi.product_id
         where poi.purchase_order_id=$1 and poi.id=any($2::uuid[]) for update of poi`,
        [orderId,orderItemIds],
      );
      if(items.rows.length!==requested.size)throw new Error('receipt_item_not_in_order');
      const receivedAt=new Date().toISOString();
      const receiptLines:any[]=[];
      let totalCost=0;
      for(const item of items.rows) {
        const quantity=requested.get(String(item.id))!;
        const remaining=Number(item.quantity_ordered)-Number(item.quantity_received);
        if(quantity<=0||quantity>remaining)throw new Error('received_quantity_exceeds_remaining');
        const unitCost=Number(item.unit_cost_minor);
        if(!Number.isSafeInteger(unitCost)||unitCost<0)throw new Error('invalid_purchase_cost');
        const lineCost=safeMultiply(quantity,unitCost,'purchase_receipt_cost');
        totalCost+=lineCost;
        if(!Number.isSafeInteger(totalCost))throw new Error('purchase_receipt_total_overflow');
        receiptLines.push({purchaseOrderItemId:String(item.id),productId:String(item.product_id),productName:item.product_name,quantity,unitCost,lineCost});
      }
      const receipt=await pool.query(
        `insert into purchase_receipts (id,organization_id,purchase_order_id,supplier_id,location_id,total_cost_minor,received_by,received_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
        [receiptId,organizationId,orderId,order.supplier_id,locationId,totalCost,user.id,receivedAt],
      );
      for(const item of receiptLines) {
        await pool.query(
          `insert into purchase_receipt_items (id,purchase_receipt_id,purchase_order_item_id,product_id,quantity_received,unit_cost_minor)
           values (gen_random_uuid(),$1,$2,$3,$4,$5)`,
          [receiptId,item.purchaseOrderItemId,item.productId,item.quantity,item.unitCost],
        );
        await pool.query(
          `update purchase_order_items set quantity_received=quantity_received+$2 where id=$1`,
          [item.purchaseOrderItemId,item.quantity],
        );
        await pool.query(
          `insert into inventory_events
            (id,organization_id,location_id,product_id,event_type,quantity_delta,unit_cost_minor,reference_id,occurred_at,device_id,local_sequence,created_at,created_by)
           values (gen_random_uuid(),$1,$2,$3,'purchase',$4,$5,$6,$7,'server-procurement',0,$7,$8)`,
          [organizationId,locationId,item.productId,item.quantity,item.unitCost,receiptId,receivedAt,user.id],
        );
      }
      const progress=await pool.query(
        'select bool_and(quantity_received=quantity_ordered) as complete from purchase_order_items where purchase_order_id=$1',
        [orderId],
      );
      const complete=Boolean(progress.rows[0]?.complete);
      const totalReceived=await pool.query('select sum(quantity_received) as received from purchase_order_items where purchase_order_id=$1',[orderId]);
      const anyReceived=Number(totalReceived.rows[0]?.received??0)>0;
      const status=complete?'received':anyReceived?'partially_received':'ordered';
      await pool.query('update purchase_orders set status=$2,updated_at=now() where id=$1',[orderId,status]);
      if(totalCost>0) {
        await postPurchaseReceiptJournal(pool,{
          organizationId,locationId,sourceId:receiptId,occurredAt:receivedAt,createdBy:user.id,
          totalCostMinor:totalCost,supplierName:String(order.supplier_name),
        });
      }
      await pool.query(`insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,after_data,reason)
        values ($1,$2,'purchase_order.received','purchase_order',$3,$4::jsonb,'Supplier delivery received and inventory updated')`,
        [organizationId,user.id,orderId,JSON.stringify({receiptId,totalCostMinor:totalCost,status,items:receiptLines})]);
      await pool.query('COMMIT');
      return json(res,201,{receipt:{id:receipt.rows[0].id,purchaseOrderId:orderId,totalCostMinor:totalCost,receivedAt,status}});
    } catch(error:any) {
      await pool.query('ROLLBACK').catch(()=>undefined);
      const message=String(error?.message??error);
      if(['purchase_order_not_found','location_access_denied','purchase_order_not_receivable','receipt_id_collision','receipt_idempotency_payload_mismatch','invalid_receipt_item','invalid_received_quantity','receipt_item_not_in_order','received_quantity_exceeds_remaining','invalid_purchase_cost','purchase_receipt_cost_overflow','purchase_receipt_total_overflow'].includes(message))return json(res,400,{error:message});
      if(error?.code==='23505')return json(res,409,{error:'purchase_receipt_conflict'});
      console.error('[procurement.purchase_receipt]',{name:error?.name,code:error?.code});
      return json(res,500,{error:'purchase_receipt_failed'});
    } finally { await pool.end(); }
  }

  if(action==='create_transfer') {
    if(!MANAGE_ROLES.has(role))return json(res,403,{error:'transfer_manage_permission_required'});
    const fromLocationId=String(body.fromLocationId??''),toLocationId=String(body.toLocationId??'');
    const rawItems=Array.isArray(body.items)?body.items:[];
    if(!UUID.test(fromLocationId)||!UUID.test(toLocationId)||fromLocationId===toLocationId||!rawItems.length||rawItems.length>100)return json(res,400,{error:'invalid_transfer'});
    if(!hasLocationAccess(fromLocationId)||!hasLocationAccess(toLocationId))return json(res,403,{error:'location_access_denied'});
    const pool=transactionPool();
    try {
      await pool.query('BEGIN');
      const locations=await pool.query(
        'select id from locations where organization_id=$1 and active=true and id=any($2::uuid[])',
        [organizationId,[fromLocationId,toLocationId]],
      );
      if(locations.rows.length!==2)throw new Error('transfer_location_not_available');
      const productIds=new Set<string>();
      const items:any[]=[];
      for(const raw of rawItems) {
        const productId=String(raw?.productId??'');
        if(!UUID.test(productId)||productIds.has(productId))throw new Error('invalid_or_duplicate_transfer_product');
        productIds.add(productId);
        const quantity=positiveInteger(raw.quantity,'transfer_quantity');
        const product=await pool.query('select id from products where id=$1 and organization_id=$2 and active=true limit 1',[productId,organizationId]);
        if(!product.rowCount)throw new Error('product_not_available');
        items.push({productId,quantity});
      }
      const transferId=crypto.randomUUID();
      const transferReference=reference('ST',transferId);
      const notes=optionalText(body.notes,500,'notes');
      await pool.query(
        `insert into stock_transfers (id,organization_id,reference,from_location_id,to_location_id,status,notes,created_by)
         values ($1,$2,$3,$4,$5,'draft',$6,$7)`,
        [transferId,organizationId,transferReference,fromLocationId,toLocationId,notes,user.id],
      );
      for(const item of items)await pool.query(
        'insert into stock_transfer_items (id,transfer_id,product_id,quantity,unit_cost_minor) values (gen_random_uuid(),$1,$2,$3,0)',
        [transferId,item.productId,item.quantity],
      );
      await pool.query(`insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,after_data,reason)
        values ($1,$2,'stock_transfer.created','stock_transfer',$3,$4::jsonb,'Owner or manager created a draft stock transfer')`,
        [organizationId,user.id,transferId,JSON.stringify({reference:transferReference,fromLocationId,toLocationId,items})]);
      await pool.query('COMMIT');
      return json(res,201,{transfer:{id:transferId,reference:transferReference,status:'draft'}});
    } catch(error:any) {
      await pool.query('ROLLBACK').catch(()=>undefined);
      const message=String(error?.message??error);
      if(message.endsWith('_too_long')||['invalid_transfer','invalid_or_duplicate_transfer_product','invalid_transfer_quantity','product_not_available','transfer_location_not_available'].includes(message))return json(res,400,{error:message});
      console.error('[procurement.transfer_create]',{name:error?.name,code:error?.code});
      return json(res,500,{error:'transfer_create_failed'});
    } finally { await pool.end(); }
  }

  if(action==='dispatch_transfer'||action==='receive_transfer') {
    if(!['business_owner','platform_admin','manager','inventory_staff'].includes(role))return json(res,403,{error:'transfer_operation_permission_required'});
    const transferId=String(body.transferId??'');
    if(!UUID.test(transferId))return json(res,400,{error:'invalid_transfer_id'});
    const stage=action==='dispatch_transfer'?'dispatch':'receive';
    const pool=transactionPool();
    try {
      await pool.query('BEGIN');
      const result=await pool.query('select * from stock_transfers where id=$1 and organization_id=$2 for update',[transferId,organizationId]);
      if(!result.rowCount)throw new Error('transfer_not_found');
      const transfer=result.rows[0];
      const relevantLocation=stage==='dispatch'?String(transfer.from_location_id):String(transfer.to_location_id);
      if(!hasLocationAccess(relevantLocation))throw new Error('location_access_denied');
      if(stage==='dispatch'&&transfer.status!=='draft') {
        const prior=await pool.query('select id from stock_transfer_events where transfer_id=$1 and action=\'dispatched\' limit 1',[transferId]);
        if(prior.rowCount) {
          await pool.query('COMMIT');
          return json(res,200,{transfer:{id:transferId,status:transfer.status,deduplicated:true}});
        }
        throw new Error('transfer_not_dispatchable');
      }
      if(stage==='receive'&&transfer.status!=='dispatched') {
        const prior=await pool.query('select id from stock_transfer_events where transfer_id=$1 and action=\'received\' limit 1',[transferId]);
        if(prior.rowCount) {
          await pool.query('COMMIT');
          return json(res,200,{transfer:{id:transferId,status:transfer.status,deduplicated:true}});
        }
        throw new Error('transfer_not_receivable');
      }
      const lines=await pool.query(
        `select sti.id,sti.product_id,sti.quantity,sti.unit_cost_minor,p.standard_cost_minor,p.active
         from stock_transfer_items sti join products p on p.id=sti.product_id
         where sti.transfer_id=$1 order by sti.product_id for update of sti`,
        [transferId],
      );
      if(!lines.rows.length)throw new Error('transfer_has_no_items');
      const productIds=lines.rows.map((line:any)=>String(line.product_id)).sort();
      for(const productId of productIds)await pool.query(
        'select pg_advisory_xact_lock(hashtextextended($1,0))',
        [`inventory:${organizationId}:${transfer.from_location_id}:${productId}`],
      );
      const eventId=crypto.randomUUID();
      let totalCost=0;
      const normalized:any[]=[];
      for(const line of lines.rows) {
        const quantity=Number(line.quantity);
        if(!Number.isSafeInteger(quantity)||quantity<=0||!line.active)throw new Error('transfer_product_not_available');
        const unitCost=stage==='dispatch'?Number(line.standard_cost_minor):Number(line.unit_cost_minor);
        if(!Number.isSafeInteger(unitCost)||unitCost<0)throw new Error('invalid_transfer_cost');
        const amount=safeMultiply(quantity,unitCost,'transfer_value');
        totalCost+=amount;
        if(!Number.isSafeInteger(totalCost))throw new Error('transfer_value_overflow');
        normalized.push({productId:String(line.product_id),quantity,unitCost});
      }
      if(stage==='dispatch') {
        for(const line of normalized) {
          const stock=await pool.query(
            `select
              coalesce(sum(case when event_type not in ('reservation','reservation_release') then quantity_delta else 0 end),0) as stock,
              coalesce(sum(case when event_type='reservation' then quantity_delta when event_type='reservation_release' then -abs(quantity_delta) else 0 end),0) as reserved
             from inventory_events where organization_id=$1 and location_id=$2 and product_id=$3`,
            [organizationId,transfer.from_location_id,line.productId],
          );
          const onHand=Number(stock.rows[0]?.stock??0);
          const reserved=Number(stock.rows[0]?.reserved??0);
          const available=onHand-reserved;
          if(!Number.isSafeInteger(available)||available<line.quantity)throw new Error('insufficient_transfer_stock');
          await pool.query(
            'update stock_transfer_items set unit_cost_minor=$3 where transfer_id=$1 and product_id=$2',
            [transferId,line.productId,line.unitCost],
          );
        }
      }
      await pool.query(
        'insert into stock_transfer_events (id,transfer_id,action,actor_user_id) values ($1,$2,$3,$4)',
        [eventId,transferId,stage==='dispatch'?'dispatched':'received',user.id],
      );
      for(const line of normalized) {
        const type=stage==='dispatch'?'transfer_out':'transfer_in';
        const delta=stage==='dispatch'?-line.quantity:line.quantity;
        const locationId=stage==='dispatch'?String(transfer.from_location_id):String(transfer.to_location_id);
        await pool.query(
          `insert into inventory_events
            (id,organization_id,location_id,product_id,event_type,quantity_delta,unit_cost_minor,reference_id,occurred_at,device_id,local_sequence,created_at,created_by)
           values (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,now(),'server-transfer',0,now(),$8)`,
          [organizationId,locationId,line.productId,type,delta,line.unitCost,eventId,user.id],
        );
      }
      const occurredAt=new Date().toISOString();
      if(totalCost>0) {
        await postTransferJournal(pool,{
          organizationId,
          locationId:stage==='dispatch'?String(transfer.from_location_id):String(transfer.to_location_id),
          sourceId:eventId,occurredAt,createdBy:user.id,transferCostMinor:totalCost,
          reference:String(transfer.reference),stage,
        });
      }
      const nextStatus=stage==='dispatch'?'dispatched':'received';
      await pool.query(
        `update stock_transfers set status=$2,updated_at=$3,
          ${stage==='dispatch'?'dispatched_at=$3,dispatched_by=$4':'received_at=$3,received_by=$4'}
         where id=$1`,
        [transferId,nextStatus,occurredAt,user.id],
      );
      await pool.query(`insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,after_data,reason)
        values ($1,$2,$3,'stock_transfer',$4,$5::jsonb,'Transfer stage recorded with inventory and accounting events')`,
        [organizationId,user.id,'stock_transfer.'+stage,transferId,JSON.stringify({eventId,status:nextStatus,totalCostMinor:totalCost})]);
      await pool.query('COMMIT');
      return json(res,200,{transfer:{id:transferId,status:nextStatus,eventId,totalCostMinor:totalCost}});
    } catch(error:any) {
      await pool.query('ROLLBACK').catch(()=>undefined);
      const message=String(error?.message??error);
      const invalid=['transfer_not_found','location_access_denied','transfer_not_dispatchable','transfer_not_receivable','transfer_has_no_items','transfer_product_not_available','invalid_transfer_cost','transfer_value_overflow','insufficient_transfer_stock'];
      if(invalid.includes(message))return json(res,400,{error:message});
      if(error?.code==='23505')return json(res,409,{error:'transfer_stage_already_recorded'});
      console.error('[procurement.transfer]',{name:error?.name,code:error?.code});
      return json(res,500,{error:'transfer_operation_failed'});
    } finally { await pool.end(); }
  }

  return json(res,400,{error:'invalid_procurement_action'});
}
