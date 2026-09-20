import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from './_db';
import { hashToken, json } from './_http';

export type ApiCredentialContext={id:string;organizationId:string;createdBy:string|null;scopes:string[]};

function bearer(req:VercelRequest){
  const header=String(req.headers.authorization??'');
  if(!/^Bearer\s+/i.test(header))return '';
  return header.replace(/^Bearer\s+/i,'').trim();
}

export async function requireApiCredential(req:VercelRequest,res:VercelResponse,organizationId:string,requiredScope:string){
  const secret=bearer(req);
  if(!secret||secret.length<20){json(res,401,{error:'api_unauthorized'});return null;}
  const sql=db();
  const rows=await sql`select k.id,k.organization_id as "organizationId",k.created_by as "createdBy",k.scopes,o.status from api_credentials k join organizations o on o.id=k.organization_id where k.organization_id=${organizationId} and k.secret_hash=${hashToken(secret)} and k.revoked_at is null and (k.expires_at is null or k.expires_at>now()) and o.status='active' limit 1`;
  const key=rows[0] as any;
  if(!key){json(res,401,{error:'api_unauthorized'});return null;}
  const scopes=Array.isArray(key.scopes)?key.scopes.map(String):[];
  if(!scopes.includes(requiredScope)&&!scopes.includes('api.write')){json(res,403,{error:'api_scope_forbidden'});return null;}
  const now=Date.now();
  const current=await sql`select window_started_at,requests from api_key_rate_limits where api_credential_id=${key.id} limit 1`;
  const state=current[0] as any;
  const windowStart=state?.window_started_at?new Date(String(state.window_started_at)).getTime():0;
  const requests=windowStart && now-windowStart<60_000 ? Number(state?.requests??0)+1 : 1;
  if(requests>600){json(res,429,{error:'api_rate_limited'});return null;}
  await sql`insert into api_key_rate_limits(api_credential_id,window_started_at,requests,updated_at) values(${key.id},now(),${requests},now()) on conflict(api_credential_id) do update set window_started_at=case when api_key_rate_limits.window_started_at+interval '1 minute'<now() then now() else api_key_rate_limits.window_started_at end,requests=case when api_key_rate_limits.window_started_at+interval '1 minute'<now() then 1 else api_key_rate_limits.requests+1 end,updated_at=now()`;
  await sql`update api_credentials set last_used_at=now() where id=${key.id}`;
  return {id:String(key.id),organizationId:String(key.organizationId),createdBy:key.createdBy?String(key.createdBy):null,scopes};
}
