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
  const rows=await sql`select id,organization_id as "organizationId",created_by as "createdBy",scopes from api_credentials where organization_id=${organizationId} and secret_hash=${hashToken(secret)} and revoked_at is null and (expires_at is null or expires_at>now()) limit 1`;
  const key=rows[0] as any;
  if(!key){json(res,401,{error:'api_unauthorized'});return null;}
  const scopes=Array.isArray(key.scopes)?key.scopes.map(String):[];
  if(!scopes.includes(requiredScope)&&!scopes.includes('api.write')){json(res,403,{error:'api_scope_forbidden'});return null;}
  await sql`update api_credentials set last_used_at=now() where id=${key.id}`;
  return {id:String(key.id),organizationId:String(key.organizationId),createdBy:key.createdBy?String(key.createdBy):null,scopes};
}
