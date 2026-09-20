import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from './_db';
import { hashToken, json, method, newToken, requireSameOrigin, requireUser } from './_http';

const ROLE_ALLOW=new Set(['business_owner','platform_admin']);
const ALLOWED_SCOPES=new Set(['inventory.read','inventory.write','sales.read','sales.write','customers.read','customers.write','finance.read','finance.write','webhooks.manage']);
const MAX_DAYS=365;

async function membershipFor(sql:any,organizationId:string,userId:string){
  const rows=await sql`select m.id as membership_id,m.role,o.status from memberships m join organizations o on o.id=m.organization_id where m.organization_id=${organizationId} and m.user_id=${userId} and m.active=true limit 1`;
  return rows[0] as any;
}
function cleanName(value:unknown){
  const name=String(value??'').trim();
  if(!name||name.length>80)throw new Error('invalid_key_name');
  return name;
}
function cleanScopes(value:unknown){
  const scopes=Array.isArray(value)?value.map(String):[];
  const unique=[...new Set(scopes)];
  if(!unique.length||unique.length>20||unique.some(scope=>!ALLOWED_SCOPES.has(scope)))throw new Error('invalid_scopes');
  return unique;
}
function cleanExpiry(value:unknown){
  if(value==null||value==='')return null;
  const date=new Date(String(value));
  if(Number.isNaN(date.getTime()))throw new Error('invalid_expiry');
  const max=Date.now()+MAX_DAYS*86400000;
  if(date.getTime()<=Date.now()||date.getTime()>max)throw new Error('invalid_expiry');
  return date.toISOString();
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['GET','POST','DELETE']))return;
  const user=await requireUser(req,res);if(!user)return;
  const organizationId=String(req.query.organizationId??req.body?.organizationId??'');
  if(!organizationId)return json(res,400,{error:'organizationId_required'});
  const sql=db();
  const membership=await membershipFor(sql,organizationId,user.id);
  if(!membership||String(membership.status)!=='active'||!ROLE_ALLOW.has(String(membership.role)))return json(res,403,{error:'forbidden'});

  try{
    if(req.method==='GET'){
      const rows=await sql`select id,name,key_prefix as "keyPrefix",scopes,created_at as "createdAt",expires_at as "expiresAt",revoked_at as "revokedAt",last_used_at as "lastUsedAt" from api_credentials where organization_id=${organizationId} order by created_at desc`;
      return json(res,200,{keys:rows});
    }

    if(!requireSameOrigin(req,res))return;

    if(req.method==='POST'){
      const name=cleanName(req.body?.name);
      const scopes=cleanScopes(req.body?.scopes);
      const expiresAt=cleanExpiry(req.body?.expiresAt);
      const secret=newToken();
      const prefix=`vga_${secret.slice(0,10)}`;
      const id=crypto.randomUUID();
      await sql`insert into api_credentials (id,organization_id,created_by,name,key_prefix,secret_hash,scopes,expires_at) values (${id},${organizationId},${user.id},${name},${prefix},${hashToken(secret)},${scopes},${expiresAt})`;
      await sql`insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,after_data,reason) values (${organizationId},${user.id},'api_credential.created','api_credential',${id},${JSON.stringify({name,scopes,expiresAt,keyPrefix:prefix})}::jsonb,null)`;
      return json(res,201,{key:{id,name,keyPrefix:prefix,scopes,expiresAt,secret}});
    }

    const keyId=String(req.query.keyId??req.body?.keyId??'');
    if(!keyId)return json(res,400,{error:'keyId_required'});
    const found=await sql`select id,name,revoked_at as "revokedAt" from api_credentials where id=${keyId} and organization_id=${organizationId} limit 1`;
    if(!found.length)return json(res,404,{error:'not_found'});
    if(found[0].revokedAt)return json(res,409,{error:'already_revoked'});
    await sql`update api_credentials set revoked_at=now() where id=${keyId} and organization_id=${organizationId} and revoked_at is null`;
    await sql`insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,after_data,reason) values (${organizationId},${user.id},'api_credential.revoked','api_credential',${keyId},${JSON.stringify({revoked:true})}::jsonb,'manual_revocation')`;
    return json(res,200,{ok:true});
  }catch(error){
    const code=String((error as any)?.message??'');
    if(['invalid_key_name','invalid_scopes','invalid_expiry','keyId_required'].includes(code))return json(res,400,{error:code});
    return json(res,500,{error:'internal_error'});
  }
}
