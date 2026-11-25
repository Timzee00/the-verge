import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from '../_db.js';
import { json,method,requireUser } from '../_http.js';

type Position={at:string;id:string};
type Cursor={snapshot:string;products:Position;events:Position;sales:Position};
const ZERO_ID='00000000-0000-0000-0000-000000000000';
export default async function handler(req:VercelRequest,res:VercelResponse){
 if(!method(req,res,['GET']))return;
 const user=await requireUser(req,res); if(!user)return;
 const organizationId=String(req.query.organizationId??''); const since=String(req.query.since??'1970-01-01T00:00:00.000Z');
 if(!organizationId)return json(res,400,{error:'organizationId_required'});
 let cursor:Cursor;
 try{cursor=req.query.cursor?JSON.parse(String(req.query.cursor)) as Cursor:{snapshot:new Date().toISOString(),products:{at:since,id:ZERO_ID},events:{at:since,id:ZERO_ID},sales:{at:since,id:ZERO_ID}};}catch{return json(res,400,{error:'invalid_cursor'});}
 if(!cursor.snapshot||!cursor.products?.at||!cursor.events?.at||!cursor.sales?.at)return json(res,400,{error:'invalid_cursor'});
 const sql=db(); const membership=await sql`select 1 from memberships where organization_id=${organizationId} and user_id=${user.id} and active=true limit 1`; if(!membership.length)return json(res,403,{error:'forbidden'});
 const limit=500;
 const productRows=await sql`select id,organization_id,sku,barcode,name,brand,category,unit,weight_value as "weightValue",weight_unit as "weightUnit",image_url as "imageUri",standard_cost_minor as "standardCostMinor",retail_price_minor as "retailPriceMinor",wholesale_price_minor as "wholesalePriceMinor",minimum_price_minor as "minimumPriceMinor",reorder_level as "reorderLevel",active,track_batch as "trackBatch",track_expiry as "trackExpiry",created_at as "createdAt",updated_at as "updatedAt" from products where organization_id=${organizationId} and updated_at<=${cursor.snapshot}::timestamptz and (updated_at>${cursor.products.at}::timestamptz or (updated_at=${cursor.products.at}::timestamptz and id>${cursor.products.id}::uuid)) order by updated_at,id limit ${limit+1}`;
 const eventRows=await sql`select id,organization_id as "organizationId",location_id as "locationId",product_id as "productId",event_type as type,quantity_delta as "quantityDelta",unit_cost_minor as "unitCostMinor",reference_id as "referenceId",occurred_at as "occurredAt",device_id as "deviceId",local_sequence as "localSequence",created_at as "createdAt" from inventory_events where organization_id=${organizationId} and created_at<=${cursor.snapshot}::timestamptz and (created_at>${cursor.events.at}::timestamptz or (created_at=${cursor.events.at}::timestamptz and id>${cursor.events.id}::uuid)) order by created_at,id limit ${limit+1}`;
 const saleRows=await sql`select id,organization_id as "organizationId",location_id as "locationId",customer_id as "customerId",subtotal_minor as "subtotalMinor",discount_minor as "discountMinor",total_minor as "totalMinor",payment_method as "paymentMethod",status,below_cost as "belowCost",discount_reason as "discountReason",occurred_at as "occurredAt",device_id as "deviceId",local_sequence as "localSequence",created_at as "createdAt" from sales where organization_id=${organizationId} and created_at<=${cursor.snapshot}::timestamptz and (created_at>${cursor.sales.at}::timestamptz or (created_at=${cursor.sales.at}::timestamptz and id>${cursor.sales.id}::uuid)) order by created_at,id limit ${limit+1}`;
 const productsMore=productRows.length>limit,eventsMore=eventRows.length>limit,salesMore=saleRows.length>limit;
 const products=productRows.slice(0,limit),inventoryEvents=eventRows.slice(0,limit),sales=saleRows.slice(0,limit);
 const next:Cursor={snapshot:cursor.snapshot,products:productsMore?{at:String(products[products.length-1]!.updatedAt),id:String(products[products.length-1]!.id)}:cursor.products,events:eventsMore?{at:String(inventoryEvents[inventoryEvents.length-1]!.createdAt),id:String(inventoryEvents[inventoryEvents.length-1]!.id)}:cursor.events,sales:salesMore?{at:String(sales[sales.length-1]!.createdAt),id:String(sales[sales.length-1]!.id)}:cursor.sales};
 const locations=await sql`select id,organization_id as "organizationId",name,type,parent_id as "parentId",active from locations where organization_id=${organizationId} and active=true order by name`;
 return json(res,200,{products,locations,inventoryEvents,sales,serverTime:cursor.snapshot,nextCursor:JSON.stringify(next),hasMore:productsMore||eventsMore||salesMore});
}
