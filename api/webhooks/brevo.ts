import { createHash,timingSafeEqual } from 'node:crypto';
import type { VercelRequest,VercelResponse } from '@vercel/node';
import { transactionPool } from '../_db';
import { json,method } from '../_http';

function safeEqual(a:string,b:string){
  const ab=Buffer.from(a),bb=Buffer.from(b);return ab.length===bb.length&&timingSafeEqual(ab,bb);
}
function headerSecret(req:VercelRequest){
  const raw=req.headers['x-verge-webhook-secret'];
  return Array.isArray(raw)?raw[0]??'':String(raw??'');
}
function normalizeEvent(value:unknown){
  const raw=String(value??'').trim();
  const map:Record<string,string>={
    request:'sent',sent:'sent',delivered:'delivered',opened:'opened',unique_opened:'opened',uniqueOpened:'opened',
    click:'clicked',clicked:'clicked',soft_bounce:'soft_bounce',softBounce:'soft_bounce',hard_bounce:'hard_bounce',hardBounce:'hard_bounce',
    blocked:'blocked',invalid:'invalid',error:'error',deferred:'deferred',spam:'spam',unsubscribed:'unsubscribed',proxy_open:'opened',unique_proxy_open:'opened'
  };
  return map[raw]??raw.toLowerCase();
}
function eventTime(body:any){
  const seconds=Number(body?.ts_event??body?.ts); if(Number.isFinite(seconds)&&seconds>0)return new Date(seconds*1000);
  const ms=Number(body?.ts_epoch); if(Number.isFinite(ms)&&ms>0)return new Date(ms);
  const parsed=Date.parse(String(body?.date??'')); return Number.isFinite(parsed)?new Date(parsed):new Date();
}
function dedupe(body:any,event:string,messageId:string,occurred:Date){
  const raw=[body?.id??'',messageId,event,occurred.toISOString(),body?.email??'',body?.reason??''].join('|');
  return createHash('sha256').update(raw).digest('hex');
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['POST']))return;
  const expected=String(process.env.BREVO_WEBHOOK_SECRET??'').trim();
  if(!expected||!safeEqual(headerSecret(req),expected))return json(res,401,{error:'webhook_unauthorized'});

  const events=Array.isArray(req.body)?req.body:[req.body];
  const pool=transactionPool();
  try{
    let accepted=0,duplicates=0,unmatched=0;
    for(const body of events){
      if(!body||typeof body!=='object')continue;
      const event=normalizeEvent(body.event);
      const providerMessageId=String(body['message-id']??body.messageId??'').trim();
      const recipient=String(body.email??'').trim().toLowerCase()||null;
      const occurred=eventTime(body);
      const dedupeKey=dedupe(body,event,providerMessageId,occurred);
      await pool.query('BEGIN');
      try{
        let message:any=null;
        if(providerMessageId){
          const found=await pool.query("select id,organization_id,customer_id from outbound_messages where provider_message_id=$1 order by created_at desc limit 1",[providerMessageId]);
          message=found.rows[0]??null;
        }
        if(!message&&recipient){
          const found=await pool.query("select id,organization_id,customer_id from outbound_messages where lower(recipient)=lower($1) and sent_at is not null and sent_at>=now()-interval '7 days' order by abs(extract(epoch from (sent_at-$2::timestamptz))) asc limit 1",[recipient,occurred.toISOString()]);
          message=found.rows[0]??null;
        }
        const inserted=await pool.query(
          "insert into email_delivery_events(outbound_message_id,organization_id,provider_message_id,provider_webhook_id,event_type,recipient,occurred_at,reason,payload,dedupe_key) values($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) on conflict(dedupe_key) do nothing returning id",
          [message?.id??null,message?.organization_id??null,providerMessageId||null,Number.isFinite(Number(body.id))?Number(body.id):null,event,recipient,occurred.toISOString(),String(body.reason??body?.message??'').slice(0,500)||null,JSON.stringify(body),dedupeKey]
        );
        if(!inserted.rowCount){duplicates++;await pool.query('ROLLBACK');continue;}
        if(!message){unmatched++;await pool.query('COMMIT');continue;}
        const updates:Record<string,string>={
          sent:"delivery_status='sent'",
          delivered:"delivery_status='delivered',delivered_at=coalesce(delivered_at,$2)",
          opened:"delivery_status=case when delivery_status in ('clicked','spam','unsubscribed') then delivery_status else 'opened' end,opened_at=coalesce(opened_at,$2)",
          clicked:"delivery_status=case when delivery_status in ('spam','unsubscribed') then delivery_status else 'clicked' end,clicked_at=coalesce(clicked_at,$2)",
          soft_bounce:"delivery_status='soft_bounce',bounced_at=coalesce(bounced_at,$2)",
          hard_bounce:"delivery_status='hard_bounce',bounced_at=coalesce(bounced_at,$2)",
          blocked:"delivery_status='blocked',bounced_at=coalesce(bounced_at,$2)",
          invalid:"delivery_status='invalid',bounced_at=coalesce(bounced_at,$2)",
          error:"delivery_status='error'",
          deferred:"delivery_status='deferred'",
          spam:"delivery_status='spam',complaint_at=coalesce(complaint_at,$2)",
          unsubscribed:"delivery_status='unsubscribed',unsubscribed_at=coalesce(unsubscribed_at,$2)"
        };
        if(updates[event])await pool.query(`update outbound_messages set ${updates[event]} where id=$1`,[message.id,occurred.toISOString()]);
        if(message.customer_id&&event==='unsubscribed')await pool.query("insert into customer_communication_preferences(organization_id,customer_id,email_marketing,updated_at) values($1,$2,false,now()) on conflict(organization_id,customer_id) do update set email_marketing=false,updated_at=now()",[message.organization_id,message.customer_id]);
        if(message.customer_id&&['spam','hard_bounce','invalid','blocked'].includes(event))await pool.query("insert into customer_communication_preferences(organization_id,customer_id,email_transactional,email_marketing,updated_at) values($1,$2,false,false,now()) on conflict(organization_id,customer_id) do update set email_transactional=false,email_marketing=false,updated_at=now()",[message.organization_id,message.customer_id]);
        await pool.query('COMMIT');accepted++;
      }catch(error){await pool.query('ROLLBACK').catch(()=>undefined);throw error;}
    }
    return json(res,200,{ok:true,accepted,duplicates,unmatched});
  }catch{return json(res,500,{error:'internal_error'});}
  finally{await pool.end();}
}
