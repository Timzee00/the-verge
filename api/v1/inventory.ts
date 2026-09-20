import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from '../../_db';
import { json,method } from '../../_http';
import { requireApiCredential } from '../../_apiKey';

const PAGE_SIZE=100;

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['GET']))return;
  const organizationId=String(req.query.organizationId??'');
  if(!organizationId)return json(res,400,{error:'organizationId_required'});
  const credential=await requireApiCredential(req,res,organizationId,'inventory.read');
  if(!credential)return;

  const pageRaw=String(req.query.page??'1'),limitRaw=String(req.query.limit??'50');
  const page=Math.max(1,Math.min(10000,Number.isInteger(Number(pageRaw))?Number(pageRaw):1));
  const limit=Math.max(1,Math.min(PAGE_SIZE,Number.isInteger(Number(limitRaw))?Number(limitRaw):50));
  const offset=(page-1)*limit;
  const search=String(req.query.search??'').trim().slice(0,100);
  const barcode=String(req.query.barcode??'').trim().slice(0,80);
  try{
    const sql=db();
    const locationId=String(req.query.locationId??'').trim();
    if(locationId){
      const loc=await sql`select 1 from locations where id=${locationId} and organization_id=${organizationId} and active=true limit 1`;
      if(!loc.length)return json(res,404,{error:'location_not_found'});
    }
    const rows=await sql`
      select p.id,p.sku,p.barcode,p.name,p.brand,p.category,p.unit,
             p.weight_value as "weightValue",p.weight_unit as "weightUnit",
             p.standard_cost_minor as "standardCostMinor",p.retail_price_minor as "retailPriceMinor",
             p.wholesale_price_minor as "wholesalePriceMinor",p.minimum_price_minor as "minimumPriceMinor",
             p.reorder_level as "reorderLevel",p.active,
             p.created_at as "createdAt",p.updated_at as "updatedAt",
             ${locationId
               ? sql`coalesce((select sum(case when ie.event_type not in ('reservation','reservation_release') then ie.quantity_delta else 0 end) from inventory_events ie where ie.organization_id=p.organization_id and ie.product_id=p.id and ie.location_id=${locationId}),0)`
               : sql`null`} as "stock"
      from products p
      where p.organization_id=${organizationId}
        and (${search}='' or p.name ilike '%'||${search}||'%' or p.sku ilike '%'||${search}||'%')
        and (${barcode}='' or p.barcode=${barcode})
      order by p.name
      limit ${limit} offset ${offset}`;
    const normalize=(p:any)=>({...p,
      standardCostMinor:Number(p.standardCostMinor),
      retailPriceMinor:Number(p.retailPriceMinor),
      wholesalePriceMinor:p.wholesalePriceMinor==null?null:Number(p.wholesalePriceMinor),
      minimumPriceMinor:p.minimumPriceMinor==null?null:Number(p.minimumPriceMinor),
      weightValue:p.weightValue==null?null:Number(p.weightValue),
      reorderLevel:p.reorderLevel==null?null:Number(p.reorderLevel),
      stock:p.stock==null?null:Number(p.stock)
    });
    return json(res,200,{data:(rows as any[]).map(normalize),pagination:{page,limit,returned:rows.length,nextPage:rows.length===limit?page+1:null}});
  }catch{
    return json(res,500,{error:'internal_error'});
  }
}
