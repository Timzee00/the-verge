import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from '../_db';
import { json,method,requireUser } from '../_http';

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['GET']))return;
  const user=await requireUser(req,res);if(!user)return;
  const sql=db();
  const orgs=await sql`select o.id,o.name,o.base_currency,o.industry,m.role,m.id as membership_id from memberships m join organizations o on o.id=m.organization_id where m.user_id=${user.id} and m.active=true and o.status='active' order by o.created_at`;
  const locations=orgs.length
    ? await sql`select l.id,l.organization_id,l.name,l.type,l.parent_id,l.active from locations l join memberships m on m.organization_id=l.organization_id and m.user_id=${user.id} and m.active=true left join membership_locations ml on ml.location_id=l.id and ml.membership_id=m.id and ml.active=true where l.active=true and (m.role='platform_admin' or ml.location_id is not null) order by l.organization_id,l.name`
    : [];
  return json(res,200,{
    user:{id:user.id,email:user.email,displayName:user.display_name},
    organizations:orgs.map((o:any)=>({id:o.id,name:o.name,base_currency:o.base_currency,industry:o.industry,role:o.role})),
    locations
  });
}
