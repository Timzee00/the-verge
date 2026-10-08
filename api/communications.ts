import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from './_db';
import { json,method,requireUser } from './_http';

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(!method(req,res,['GET']))return;
 const user=await requireUser(req,res);if(!user)return;
 const organizationId=String(req.query.organizationId??'');
 if(!organizationId)return json(res,400,{error:'organizationId_required'});
 const sql=db();
 const member=await sql`select 1 from memberships where organization_id=${organizationId} and user_id=${user.id} and active=true limit 1`;
 if(!member.length)return json(res,403,{error:'forbidden'});
 const rows=await sql`select om.id,om.message_kind as "messageKind",om.template_code as "templateCode",om.recipient,om.subject,om.status,
   om.delivery_status as "deliveryStatus",om.sent_at as "sentAt",om.delivered_at as "deliveredAt",om.opened_at as "openedAt",
   om.clicked_at as "clickedAt",om.bounced_at as "bouncedAt",om.unsubscribed_at as "unsubscribedAt",om.complaint_at as "complaintAt",
   c.name as "customerName"
   from outbound_messages om left join customers c on c.id=om.customer_id
   where om.organization_id=${organizationId} and om.channel='email'
   order by om.created_at desc limit 100`;
 return json(res,200,{messages:rows});
}
