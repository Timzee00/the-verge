import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../_db.js'; import { json, method, requireUser } from '../_http.js';
export default async function handler(req:VercelRequest,res:VercelResponse){if(!method(req,res,['GET']))return;const user=await requireUser(req,res);if(!user)return;const sql=db();const orgs=await sql`select o.id,o.name,o.base_currency,o.industry,m.role from memberships m join organizations o on o.id=m.organization_id where m.user_id=${user.id} and m.active=true and o.status='active' order by o.created_at`;const locations=orgs.length?await sql`
 select distinct l.id,l.organization_id,l.name,l.type,l.parent_id,l.active
 from locations l
 join memberships m on m.organization_id=l.organization_id and m.user_id=${user.id} and m.active=true
 left join membership_locations ml on ml.organization_id=m.organization_id and ml.user_id=m.user_id and ml.location_id=l.id
 where l.active=true and (m.role in ('business_owner','platform_admin') or ml.location_id is not null)
 order by l.name
`:[];return json(res,200,{user:{id:user.id,email:user.email,displayName:user.display_name},organizations:orgs,locations})}
