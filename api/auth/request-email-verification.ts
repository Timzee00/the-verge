import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from '../_db';
import { emailDeliveryConfigured,sendEmailVerificationEmail } from '../_email';
import { hashToken,json,method,newToken,requireSameOrigin,requireUser } from '../_http';

function clientAddress(req:VercelRequest){
  return req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()||'unknown';
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['POST']))return;
  if(!requireSameOrigin(req,res))return;
  const user=await requireUser(req,res);if(!user)return;
  if(user.email_verified_at)return json(res,200,{ok:true,verified:true,message:'Your email is already verified.'});

  const sql=db();
  const readiness=await sql`select to_regclass('public.email_verification_tokens') as email_verification_tokens,to_regclass('public.auth_rate_limits') as auth_rate_limits`;
  if(!(readiness[0] as any)?.email_verification_tokens||!(readiness[0] as any)?.auth_rate_limits)return json(res,503,{error:'server_not_ready'});
  if(!emailDeliveryConfigured())return json(res,503,{error:'email_delivery_unavailable'});

  const rateKey=hashToken(`verify-email:${user.id}:${clientAddress(req)}`);
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
    return json(res,429,{error:'too_many_attempts'});
  }

  const token=newToken();
  const tokenHash=hashToken(token);
  await sql`delete from email_verification_tokens where user_id=${user.id} and (consumed_at is not null or expires_at<=now())`;
  await sql`update email_verification_tokens set consumed_at=now() where user_id=${user.id} and consumed_at is null and expires_at>now()`;
  await sql`insert into email_verification_tokens(user_id,token_hash,expires_at) values(${user.id},${tokenHash},now()+interval '24 hours')`;
  try{
    await sendEmailVerificationEmail(String(user.email),token);
  }catch{
    await sql`delete from email_verification_tokens where token_hash=${tokenHash}`;
    console.error('email_verification_send_failed');
    return json(res,503,{error:'email_delivery_failed'});
  }
  return json(res,202,{ok:true,verified:false,message:'Verification email sent. The link expires in 24 hours.'});
}
