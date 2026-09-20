import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from './_db';
import { json,method,requireSameOrigin,requireUser } from './_http';

const MANAGERS=new Set(['business_owner','platform_admin']);
export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['GET','POST','DELETE']))return;
  const user=await requireUser(req,res);if(!user)return;
  const organizationId=String(req.query.organizationId??req.body?.organizationId??'');
  if(!organizationId)return json(res,400,{error:'organizationId_required'});
  const sql=db();
  const actorRows=await sql`select m.id,m.role,o.status from memberships m join organizations o on o.id=m.organization_id where m.organization_id=${organizationId} and m.user_id=${user.id} and m.active=true limit 1`;
  const actor=actorRows[0] as any;
  if(!actor||String(actor.status)!=='active'||!MANAGERS.has(String(actor.role)))return json(res,403,{error:'forbidden'});

  if(req.method==='GET'){
    const members=await sql`select m.id,m.user_id as "userId",u.email,u.display_name as "displayName",m.role,m.active from memberships m join app_users u on u.id=m.user_id where m.organization_id=${organizationId} order by case when m.role='business_owner' then 0 else 1 end,u.display_name,u.email`;
    const assignments=await sql`select ml.membership_id as "membershipId",l.id as "locationId",l.name from membership_locations ml join locations l on l.id=ml.location_id where l.organization_id=${organizationId} and ml.active=true order by l.name`;
    const byMember=new Map<string,Array<{id:string;name:string}>>();
    for(const a of assignments as any[]){const list=byMember.get(String(a.membershipId))??[];list.push({id:String(a.locationId),name:String(a.name)});byMember.set(String(a.membershipId),list);}
    return json(res,200,{members:(members as any[]).map(m=>({...m,locations:byMember.get(String(m.id))??[]}))});
  }
  if(!requireSameOrigin(req,res))return;
  const membershipId=String(req.body?.membershipId??req.query.membershipId??'');
  const locationId=String(req.body?.locationId??req.query.locationId??'');
  if(!membershipId||!locationId)return json(res,400,{error:'membership_and_location_required'});

  const target=await sql`select m.id,m.user_id as "userId",m.role,m.active,l.id as "locationId",l.active as "locationActive" from memberships m join locations l on l.organization_id=m.organization_id where m.id=${membershipId} and l.id=${locationId} and m.organization_id=${organizationId} limit 1`;
  if(!target.length||!target[0].active||!target[0].locationActive)return json(res,404,{error:'not_found'});

  if(req.method==='POST'){
    await sql`insert into membership_locations (membership_id,location_id,active) values (${membershipId},${locationId},true) on conflict (membership_id,location_id) do update set active=true`;
    await sql`insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,after_data,reason) values (${organizationId},${user.id},'membership_location.assigned','membership_location',${membershipId},${JSON.stringify({membershipId,locationId})}::jsonb,'manual_assignment')`;
    return json(res,200,{ok:true});
  }

  const targetRole=String(target[0].role);
  if(MANAGERS.has(targetRole)){
    const count=await sql`select count(*)::int as count from membership_locations where membership_id=${membershipId} and active=true`;
    if(Number(count[0]?.count??0)<=1)return json(res,409,{error:'owner_location_required'});
  }
  await sql`update membership_locations set active=false where membership_id=${membershipId} and location_id=${locationId}`;
  await sql`insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,after_data,reason) values (${organizationId},${user.id},'membership_location.revoked','membership_location',${membershipId},${JSON.stringify({membershipId,locationId,active:false})}::jsonb,'manual_revocation')`;
  return json(res,200,{ok:true});
}
