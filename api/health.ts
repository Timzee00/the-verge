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
      to_regclass('public.api_credentials') as api_credentials,
      to_regclass('public.inventory_balances') as inventory_balances,
      to_regclass('public.password_reset_tokens') as password_reset_tokens,
      to_regclass('public.billing_upgrade_requests') as billing_upgrade_requests,
      to_regclass('public.organization_usage_monthly') as organization_usage_monthly,
      to_regclass('public.ai_insights') as ai_insights,
      to_regclass('public.email_verification_tokens') as email_verification_tokens,
      (
        select count(*)=6
        from information_schema.columns
        where table_schema='public' and table_name='locations'
          and column_name in ('address','phone','email','receipt_name','receipt_footer','setup_completed_at')
      ) as location_setup`;
    const row=rows[0] as any;
    const required=['app_users','organizations','memberships','locations','membership_locations','sync_changes','auth_rate_limits','api_credentials','inventory_balances','password_reset_tokens','email_verification_tokens','location_setup'];
    const missing=required.filter(name=>!row?.[name]);
    const ready=missing.length===0;
    const mailConfigured=Boolean(process.env.RESEND_API_KEY&&process.env.AUTH_EMAIL_FROM&&process.env.APP_BASE_URL);
    return json(res,ready?200:503,{service:'the-verge',status:ready?'ok':'degraded',database:'connected',schemaReady:ready,mailConfigured,missing});
  }catch{
    return json(res,503,{service:'the-verge',status:'degraded',database:'unavailable',schemaReady:false});
  }
}
