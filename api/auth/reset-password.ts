import type { VercelRequest,VercelResponse } from '@vercel/node';
import { transactionPool } from '../_db';
import { cleanPassword,hashToken,json,method,requireSameOrigin } from '../_http';
import { hashPassword } from '../_password';

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['POST']))return;
  if(!requireSameOrigin(req,res))return;
  const token=String(req.body?.token??'').trim();
  if(token.length<20||token.length>200)return json(res,400,{error:'invalid_reset_token'});
  let password:string;
  try{password=cleanPassword(req.body?.password);}catch{return json(res,400,{error:'invalid_password'});}
  const passwordHash=await hashPassword(password);
  const pool=transactionPool();
  try{
    await pool.query('BEGIN');
    const found=await pool.query(
      "select prt.id,prt.user_id from password_reset_tokens prt join app_users u on u.id=prt.user_id where prt.token_hash=$1 and prt.consumed_at is null and prt.expires_at>now() and u.status='active' limit 1 for update",
      [hashToken(token)]
    );
    if(!found.rowCount){
      await pool.query('ROLLBACK');
      return json(res,400,{error:'invalid_reset_token'});
    }
    const row=found.rows[0] as any;
    await pool.query('update user_credentials set password_hash=$1,updated_at=now() where user_id=$2',[passwordHash,row.user_id]);
    await pool.query('update password_reset_tokens set consumed_at=now() where id=$1',[row.id]);
    await pool.query('update user_sessions set revoked_at=now() where user_id=$1 and revoked_at is null',[row.user_id]);
    await pool.query("insert into audit_events(actor_user_id,action,entity_type,entity_id,after_data,reason) values($1,'auth.password_reset','user',$1,$2::jsonb,'self_service')",[row.user_id,JSON.stringify({sessionsRevoked:true})]);
    await pool.query('COMMIT');
    return json(res,200,{ok:true});
  }catch{
    await pool.query('ROLLBACK').catch(()=>undefined);
    return json(res,500,{error:'internal_error'});
  }finally{
    await pool.end();
  }
}
