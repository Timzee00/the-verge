import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from '../_db';
import { json,method,requireUser } from '../_http';
export default async function handler(req:VercelRequest,res:VercelResponse){
 if(!method(req,res,['GET']))return;
 const user=await requireUser(req,res); if(!user)return;
 const organizationId=String(req.query.organizationId??''); const since=String(req.query.since??'1970-01-01T00:00:00.000Z');
 if(!organizationId)return json(res,400,{error:'organizationId_required'});
 const sql=db(); const membership=await sql`select 1 from memberships where organization_id=${organizationId} and user_id=${user.id} and active=true limit 1`; if(!membership.length)return json(res,403,{error:'forbidden'});
 const products=await sql`select id,organization_id,sku,barcode,name,brand,category,unit,weight_value as "weightValue",weight_unit as "weightUnit",image_url as "imageUri",standard_cost_minor as "standardCostMinor",retail_price_minor as "retailPriceMinor",wholesale_price_minor as "wholesalePriceMinor",minimum_price_minor as "minimumPriceMinor",reorder_level as "reorderLevel",active,track_batch as "trackBatch",track_expiry as "trackExpiry",created_at as "createdAt",updated_at as "updatedAt" from products where organization_id=${organizationId} and updated_at>${since} order by updated_at limit 500`;
 const locations=await sql`select id,organization_id as "organizationId",name,type,parent_id as "parentId",active from locations where organization_id=${organizationId} and active=true order by name`;
 const inventoryEvents=await sql`select id,organization_id as "organizationId",location_id as "locationId",product_id as "productId",event_type as type,quantity_delta as "quantityDelta",unit_cost_minor as "unitCostMinor",reference_id as "referenceId",occurred_at as "occurredAt",device_id as "deviceId",local_sequence as "localSequence",created_at as "createdAt" from inventory_events where organization_id=${organizationId} and occurred_at>${since} order by occurred_at limit 1000`;
 const sales=await sql`select id,organization_id as "organizationId",location_id as "locationId",customer_id as "customerId",subtotal_minor as "subtotalMinor",discount_minor as "discountMinor",total_minor as "totalMinor",payment_method as "paymentMethod",status,below_cost as "belowCost",discount_reason as "discountReason",occurred_at as "occurredAt",device_id as "deviceId",local_sequence as "localSequence",created_at as "createdAt" from sales where organization_id=${organizationId} and occurred_at>${since} order by occurred_at limit 500`;
 return json(res,200,{products,locations,inventoryEvents,sales,serverTime:new Date().toISOString()});
}
