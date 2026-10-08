import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from '../_db';
import { json,method,requireSameOrigin,requireUser } from '../_http';
import { enqueueCustomerEmail,processEmailQueue } from '../_mailQueue';

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(!method(req,res,['POST']))return;if(!requireSameOrigin(req,res))return;
 const user=await requireUser(req,res);if(!user)return;
 const organizationId=String(req.body?.organizationId??''),saleId=String(req.body?.saleId??'');
 if(!organizationId||!saleId)return json(res,400,{error:'invalid_payload'});
 const sql=db();
 const rows=await sql`select s.id,s.total_minor,s.customer_id,l.receipt_name,l.name as location_name,o.name as business_name
   from sales s join locations l on l.id=s.location_id join organizations o on o.id=s.organization_id
   join memberships m on m.organization_id=s.organization_id and m.user_id=${user.id} and m.active=true
   left join membership_locations ml on ml.membership_id=m.id and ml.location_id=s.location_id and ml.active=true
   where s.id=${saleId} and s.organization_id=${organizationId} and s.status='completed'
     and (m.role in ('business_owner','platform_admin') or ml.location_id is not null) limit 1`;
 const sale=rows[0] as any;if(!sale)return json(res,404,{error:'not_found'});
 if(!sale.customer_id)return json(res,400,{error:'sale_customer_required'});
 const queued=await enqueueCustomerEmail({organizationId,customerId:String(sale.customer_id),templateCode:'sale_receipt',subject:`Receipt from ${String(sale.receipt_name??sale.business_name)}`,payload:{businessName:String(sale.receipt_name??sale.business_name),receiptId:String(sale.id).slice(0,8).toUpperCase(),totalMinor:Number(sale.total_minor)},kind:'transactional'});
 if(!queued.queued)return json(res,400,{error:queued.reason});
 const processed=await processEmailQueue(5);
 return json(res,200,{ok:true,queued,processed});
}
