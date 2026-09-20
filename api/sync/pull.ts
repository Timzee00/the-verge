import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from '../_db';
import { json,method,requireUser } from '../_http';

const PAGE_SIZE = 500;
const PLATFORM_ROLES = new Set(['platform_admin']);

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['GET']))return;
  const user=await requireUser(req,res); if(!user)return;
  const organizationId=String(req.query.organizationId??'');
  const sinceRaw=String(req.query.since??'0');
  const cutoffRaw=String(req.query.cutoff??'');
  const pageRaw=String(req.query.page??'0');
  const page=Number.isInteger(Number(pageRaw))&&Number(pageRaw)>=0?Number(pageRaw):0;
  if(!organizationId)return json(res,400,{error:'organizationId_required'});
  const sql=db();

  const membership=await sql`select m.id as membership_id,m.role,o.status from memberships m join organizations o on o.id=m.organization_id where m.organization_id=${organizationId} and m.user_id=${user.id} and m.active=true limit 1`;
  if(!membership.length||String(membership[0].status)!=='active')return json(res,403,{error:'forbidden'});
  const role=String(membership[0].role);
  const membershipId=String(membership[0].membership_id);

  const requestedCursor=/^\d+$/.test(sinceRaw)?sinceRaw:'0';
  const cutoffRow=cutoffRaw&&/^\d+$/.test(cutoffRaw)
    ? [{cutoff:cutoffRaw}]
    : await sql`select coalesce(max(change_seq),0) as cutoff from sync_changes where organization_id=${organizationId}`;
  const stableCutoff=String((cutoffRow[0] as any)?.cutoff??'0');

  const changes=await sql`select change_seq,entity_type,entity_id from sync_changes
    where organization_id=${organizationId} and change_seq>${requestedCursor} and change_seq<=${stableCutoff}
    order by change_seq limit ${PAGE_SIZE} offset ${page*PAGE_SIZE}`;

  const ids:Record<string,string[]>={};
  for(const row of changes as any[]){ const kind=String(row.entity_type); (ids[kind]??=[]).push(String(row.entity_id)); }
  const inList=(values:string[])=>values.reduce((acc,value)=>acc?sql`${acc}, ${value}`:sql`${value}`,null as any);
  const products=ids.product?.length?await sql`select id,organization_id,sku,barcode,name,brand,category,unit,weight_value as "weightValue",weight_unit as "weightUnit",image_url as "imageUri",standard_cost_minor as "standardCostMinor",retail_price_minor as "retailPriceMinor",wholesale_price_minor as "wholesalePriceMinor",minimum_price_minor as "minimumPriceMinor",reorder_level as "reorderLevel",active,track_batch as "trackBatch",track_expiry as "trackExpiry",created_at as "createdAt",updated_at as "updatedAt" from products where organization_id=${organizationId} and id in (${inList(ids.product)}) order by id`:[];
  const locations=ids.location?.length?(PLATFORM_ROLES.has(role)
    ? await sql`select id,organization_id as "organizationId",name,type,parent_id as "parentId",active from locations where organization_id=${organizationId} and id in (${inList(ids.location)}) order by name`
    : await sql`select l.id,l.organization_id as "organizationId",l.name,l.type,l.parent_id as "parentId",l.active from locations l join membership_locations ml on ml.location_id=l.id where l.organization_id=${organizationId} and l.id in (${inList(ids.location)}) and ml.membership_id=${membershipId} and ml.active=true order by l.name`):[];

  const inventoryEvents=ids.inventory_event?.length?(PLATFORM_ROLES.has(role)
    ? await sql`select id,organization_id as "organizationId",location_id as "locationId",product_id as "productId",event_type as type,quantity_delta as "quantityDelta",unit_cost_minor as "unitCostMinor",reference_id as "referenceId",occurred_at as "occurredAt",device_id as "deviceId",local_sequence as "localSequence",created_at as "createdAt" from inventory_events where organization_id=${organizationId} and id in (${inList(ids.inventory_event)}) order by occurred_at,id`
    : await sql`select id,organization_id as "organizationId",location_id as "locationId",product_id as "productId",event_type as type,quantity_delta as "quantityDelta",unit_cost_minor as "unitCostMinor",reference_id as "referenceId",occurred_at as "occurredAt",device_id as "deviceId",local_sequence as "localSequence",created_at as "createdAt" from inventory_events where organization_id=${organizationId} and id in (${inList(ids.inventory_event)}) and location_id in (select ml.location_id from membership_locations ml where ml.membership_id=${membershipId} and ml.active=true) order by occurred_at,id`):[];

  const sales=ids.sale?.length?(PLATFORM_ROLES.has(role)
    ? await sql`select id,organization_id as "organizationId",location_id as "locationId",customer_id as "customerId",subtotal_minor as "subtotalMinor",discount_minor as "discountMinor",total_minor as "totalMinor",payment_method as "paymentMethod",status,below_cost as "belowCost",discount_reason as "discountReason",occurred_at as "occurredAt",device_id as "deviceId",local_sequence as "localSequence",created_at as "createdAt" from sales where organization_id=${organizationId} and id in (${inList(ids.sale)}) order by occurred_at,id`
    : await sql`select id,organization_id as "organizationId",location_id as "locationId",customer_id as "customerId",subtotal_minor as "subtotalMinor",discount_minor as "discountMinor",total_minor as "totalMinor",payment_method as "paymentMethod",status,below_cost as "belowCost",discount_reason as "discountReason",occurred_at as "occurredAt",device_id as "deviceId",local_sequence as "localSequence",created_at as "createdAt" from sales where organization_id=${organizationId} and id in (${inList(ids.sale)}) and location_id in (select ml.location_id from membership_locations ml where ml.membership_id=${membershipId} and ml.active=true) order by occurred_at,id`):[];

  const saleIds=(sales as any[]).map(s=>String(s.id));
  const saleItems=saleIds.length?await sql`select id,sale_id as "saleId",product_id as "productId",quantity,unit_price_minor as "unitPriceMinor",unit_cost_minor as "unitCostMinor",discount_minor as "discountMinor" from sale_items where sale_id in (${inList(saleIds)}) order by sale_id,id`:[];
  const customers=ids.customer?.length?await sql`select id,organization_id as "organizationId",name,phone,email,credit_limit_minor as "creditLimitMinor",active,created_at as "createdAt",updated_at as "updatedAt" from customers where organization_id=${organizationId} and id in (${inList(ids.customer)}) order by name`:[];
  const expenses=ids.expense?.length?(PLATFORM_ROLES.has(role)
    ? await sql`select id,organization_id as "organizationId",location_id as "locationId",amount_minor as "amountMinor",category,description,payment_method as "paymentMethod",occurred_at as "occurredAt",device_id as "deviceId",created_at as "createdAt" from expenses where organization_id=${organizationId} and id in (${inList(ids.expense)})`
    : await sql`select id,organization_id as "organizationId",location_id as "locationId",amount_minor as "amountMinor",category,description,payment_method as "paymentMethod",occurred_at as "occurredAt",device_id as "deviceId",created_at as "createdAt" from expenses where organization_id=${organizationId} and id in (${inList(ids.expense)}) and (location_id is null or location_id in (select ml.location_id from membership_locations ml where ml.membership_id=${membershipId} and ml.active=true))`):[];

  const hasMore=changes.length===PAGE_SIZE;
  return json(res,200,{products,locations,inventoryEvents,sales,saleItems,customers,expenses,serverTime:new Date().toISOString(),cutoff:stableCutoff,hasMore});
}
