import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from '../_db';
import { cleanEmail, cleanPassword, hashToken, isHttps, json, method, newToken, setSessionCookie } from '../_http';
import { verifyPassword } from '../_password';

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 8;
const BLOCK_MINUTES = 15;

function clientAddress(req: VercelRequest) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || null;
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['POST']))return;
  try{
    const email=cleanEmail(req.body?.email);
    const password=cleanPassword(req.body?.password);
    const sql=db();
    const ipHint=clientAddress(req);
    const key=hashToken(`login:${email}:${ipHint??'unknown'}`);

    const limit=await sql`select blocked_until, failures, window_started_at from auth_rate_limits where key_hash=${key} limit 1`;
    const row=limit[0] as any;
    if(row?.blocked_until && new Date(String(row.blocked_until)).getTime()>Date.now()){
      res.setHeader('Retry-After',String(Math.max(1,Math.ceil((new Date(String(row.blocked_until)).getTime()-Date.now())/1000))));
      return json(res,429,{error:'too_many_attempts'});
    }

    if(row?.window_started_at && new Date(String(row.window_started_at)).getTime()+WINDOW_MINUTES*60_000<Date.now()){
      await sql`update auth_rate_limits set failures=0, window_started_at=now(), blocked_until=null, updated_at=now() where key_hash=${key}`;
    }

    const rows=await sql`select u.id,u.email,u.display_name,u.status,c.password_hash from app_users u join user_credentials c on c.user_id=u.id where u.email=${email} limit 1`;
    const user=rows[0] as any;
    const valid=Boolean(user&&user.status==='active'&&await verifyPassword(password,user.password_hash));

    if(!valid){
      await sql`
        insert into auth_rate_limits (key_hash,window_started_at,failures,blocked_until,updated_at)
        values (${key},now(),1,null,now())
        on conflict (key_hash) do update set
          failures=case
            when auth_rate_limits.window_started_at+make_interval(mins=>${WINDOW_MINUTES}) < now() then 1
            else auth_rate_limits.failures+1
          end,
          window_started_at=case
            when auth_rate_limits.window_started_at+make_interval(mins=>${WINDOW_MINUTES}) < now() then now()
            else auth_rate_limits.window_started_at
          end,
          blocked_until=case
            when (
              case
                when auth_rate_limits.window_started_at+make_interval(mins=>${WINDOW_MINUTES}) < now() then 1
                else auth_rate_limits.failures+1
              end
            ) >= ${MAX_FAILURES}
            then now()+make_interval(mins=>${BLOCK_MINUTES})
            else auth_rate_limits.blocked_until
          end,
          updated_at=now()
      `;
      return json(res,401,{error:'invalid_credentials'});
    }

    await sql`delete from auth_rate_limits where key_hash=${key}`;
    const token=newToken();
    await sql`insert into user_sessions (user_id,token_hash,expires_at,ip_hint,user_agent) values (${user.id},${hashToken(token)},now()+interval '30 days',${ipHint},${req.headers['user-agent']??null})`;
    setSessionCookie(res,token,60*60*24*30,isHttps(req));
    return json(res,200,{user:{id:user.id,email:user.email,displayName:user.display_name}});
  }catch{
    return json(res,500,{error:'internal_error'});
  }
}
