import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from '../_db';
import { cleanEmail,hashToken,json,method,newToken,requireSameOrigin } from '../_http';
import { sendPasswordResetEmail } from '../_email';

const GENERIC={ok:true,message:'If that account exists, a password reset email will be sent.'};

function clientAddress(req:VercelRequest){
  return req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()||'unknown';
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['POST']))return;
  if(!requireSameOrigin(req,res))return;
  try{
    const email=cleanEmail(req.body?.email);
    const sql=db();
    const readiness=await sql`select to_regclass('public.password_reset_tokens') as password_reset_tokens,to_regclass('public.auth_rate_limits') as auth_rate_limits`;
    if(!(readiness[0] as any)?.password_reset_tokens||!(readiness[0] as any)?.auth_rate_limits)return json(res,503,{error:'server_not_ready'});

    const rateKey=hashToken(`password-reset:${email}:${clientAddress(req)}`);
    const rate=await sql`
      insert into auth_rate_limits(key_hash,window_started_at,failures,blocked_until,updated_at)
      values(${rateKey},date_trunc('hour',now()),1,null,now())
      on conflict(key_hash) do update set
        window_started_at=case when auth_rate_limits.window_started_at<date_trunc('hour',now()) then date_trunc('hour',now()) else auth_rate_limits.window_started_at end,
        failures=case when auth_rate_limits.window_started_at<date_trunc('hour',now()) then 1 else auth_rate_limits.failures+1 end,
        updated_at=now()
      returning failures`;
    if(Number((rate[0] as any)?.failures??0)>5){
      res.setHeader('Retry-After','3600');
      return json(res,202,GENERIC);
    }

    const users=await sql`select id,email from app_users where email=${email} and status='active' limit 1`;
    const user=users[0] as any;
    if(!user)return json(res,202,GENERIC);

    const token=newToken();
    await sql`delete from password_reset_tokens where user_id=${user.id} and (consumed_at is not null or expires_at<=now())`;
    await sql`insert into password_reset_tokens(user_id,token_hash,expires_at,requested_ip) values(${user.id},${hashToken(token)},now()+interval '30 minutes',${clientAddress(req)})`;
    try{
      await sendPasswordResetEmail(String(user.email),token);
    }catch{
      console.error('password_reset_email_failed');
    }
    return json(res,202,GENERIC);
  }catch{
    return json(res,202,GENERIC);
  }
}
