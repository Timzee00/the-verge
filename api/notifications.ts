import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from './_db';
import { json,method,requireSameOrigin,requireUser } from './_http';

const EVENTS=['owner.daily_summary','owner.weekly_summary','inventory.low_stock','inventory.expiry','security.account'] as const;

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(!method(req,res,['GET','POST']))return;
 const user=await requireUser(req,res);if(!user)return;
 const organizationId=String(req.method==='GET'?req.query.organizationId:req.body?.organizationId??'');
 if(!organizationId)return json(res,400,{error:'organizationId_required'});
 const sql=db();
 const member=await sql`select role from memberships where organization_id=${organizationId} and user_id=${user.id} and active=true limit 1`;
 if(!member.length)return json(res,403,{error:'forbidden'});
 if(req.method==='GET'){
   const rows=await sql`select event_code as "eventCode",enabled,digest from notification_preferences where organization_id=${organizationId} and user_id=${user.id} and channel='email'`;
   const saved=new Map((rows as any[]).map(r=>[r.eventCode,r]));
   return json(res,200,{preferences:EVENTS.map(eventCode=>saved.get(eventCode)??{eventCode,enabled:eventCode==='security.account',digest:eventCode.includes('weekly')?'weekly':eventCode.includes('daily')?'daily':'instant'})});
 }
 if(!requireSameOrigin(req,res))return;
 const eventCode=String(req.body?.eventCode??'') as typeof EVENTS[number];
 if(!EVENTS.includes(eventCode))return json(res,400,{error:'invalid_notification_event'});
 const enabled=Boolean(req.body?.enabled);
 const digest=String(req.body?.digest??'instant');
 if(!['instant','daily','weekly','off'].includes(digest))return json(res,400,{error:'invalid_digest'});
 await sql`insert into notification_preferences(organization_id,user_id,channel,event_code,enabled,digest,updated_at)
   values(${organizationId},${user.id},'email',${eventCode},${enabled},${digest},now())
   on conflict(organization_id,user_id,channel,event_code) do update set enabled=excluded.enabled,digest=excluded.digest,updated_at=now()`;
 return json(res,200,{ok:true});
}
