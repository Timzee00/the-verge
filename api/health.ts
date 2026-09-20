import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from './_db';
import { json,method } from './_http';

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['GET']))return;
  try{
    const sql=db();
    const rows=await sql`select
      to_regclass('public.app_users') as app_users,
      to_regclass('public.organizations') as organizations,
      to_regclass('public.memberships') as memberships,
      to_regclass('public.locations') as locations,
      to_regclass('public.membership_locations') as membership_locations,
      to_regclass('public.sync_changes') as sync_changes,
      to_regclass('public.auth_rate_limits') as auth_rate_limits,
      to_regclass('public.api_credentials') as api_credentials`;
    const row=rows[0] as any;
    const required=['app_users','organizations','memberships','locations','membership_locations','sync_changes','auth_rate_limits','api_credentials'];
    const missing=required.filter(name=>!row?.[name]);
    const ready=missing.length===0;
    return json(res,ready?200:503,{service:'the-verge',status:ready?'ok':'degraded',database:'connected',schemaReady:ready,missing});
  }catch{
    return json(res,503,{service:'the-verge',status:'degraded',database:'unavailable',schemaReady:false});
  }
}
