import type { VercelRequest,VercelResponse } from '@vercel/node';
import { transactionPool } from '../_db';
import { hashToken,json,method,requireSameOrigin } from '../_http';

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['POST']))return;
  if(!requireSameOrigin(req,res))return;
  const token=String(req.body?.token??'').trim();
  if(token.length<20||token.length>200)return json(res,400,{error:'invalid_verification_token'});

  const pool=transactionPool();
  try{
    await pool.query('BEGIN');
    const found=await pool.query(
      "select evt.id,evt.user_id from email_verification_tokens evt join app_users u on u.id=evt.user_id where evt.token_hash=$1 and evt.consumed_at is null and evt.expires_at>now() and u.status='active' limit 1 for update",
      [hashToken(token)]
    );
    if(!found.rowCount){
      await pool.query('ROLLBACK');
      return json(res,400,{error:'invalid_verification_token'});
    }
    const row=found.rows[0] as any;
    await pool.query('update app_users set email_verified_at=coalesce(email_verified_at,now()) where id=$1',[row.user_id]);
    await pool.query('update email_verification_tokens set consumed_at=now() where user_id=$1 and consumed_at is null',[row.user_id]);
    await pool.query(
      "insert into audit_events(actor_user_id,action,entity_type,entity_id,after_data,reason) values($1,'auth.email_verified','user',$1,$2::jsonb,'email_link')",
      [row.user_id,JSON.stringify({verified:true})]
    );
    await pool.query('COMMIT');
    return json(res,200,{ok:true,verified:true});
  }catch(error){
    await pool.query('ROLLBACK').catch(()=>undefined);
    console.error('email_verification_failed',String((error as any)?.message??error));
    return json(res,500,{error:'internal_error'});
  }finally{
    await pool.end();
  }
}
