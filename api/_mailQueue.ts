import { db,transactionPool } from './_db';
import { sendBusinessEmail } from './_email';

export async function enqueueCustomerEmail(input:{organizationId:string;customerId:string;templateCode:string;subject:string;payload:Record<string,unknown>;kind:'transactional'|'marketing'}){
  const sql=db();
  const rows=await sql`select c.email,coalesce(p.email_transactional,true) as email_transactional,coalesce(p.email_marketing,false) as email_marketing
    from customers c left join customer_communication_preferences p on p.organization_id=c.organization_id and p.customer_id=c.id
    where c.id=${input.customerId} and c.organization_id=${input.organizationId} and c.active=true limit 1`;
  const customer=rows[0] as any;
  if(!customer?.email)return {queued:false,reason:'customer_email_missing'};
  if(input.kind==='marketing'&&!customer.email_marketing)return {queued:false,reason:'marketing_consent_required'};
  if(input.kind==='transactional'&&customer.email_transactional===false)return {queued:false,reason:'transactional_email_disabled'};
  const inserted=await sql`insert into outbound_messages(organization_id,customer_id,channel,message_kind,template_code,recipient,subject,payload)
    values(${input.organizationId},${input.customerId},'email',${input.kind},${input.templateCode},${String(customer.email)},${input.subject},${JSON.stringify(input.payload)}::jsonb)
    returning id`;
  return {queued:true,id:String((inserted[0] as any).id)};
}

export async function enqueueUserEmail(input:{organizationId:string;userId:string;templateCode:string;subject:string;payload:Record<string,unknown>;kind:'operational'|'security'}){
  const sql=db();
  const rows=await sql`select u.email from app_users u join memberships m on m.user_id=u.id and m.organization_id=${input.organizationId} and m.active=true
    where u.id=${input.userId} and u.status='active' limit 1`;
  const user=rows[0] as any;if(!user?.email)return {queued:false,reason:'user_email_missing'};
  const inserted=await sql`insert into outbound_messages(organization_id,user_id,channel,message_kind,template_code,recipient,subject,payload)
    values(${input.organizationId},${input.userId},'email',${input.kind},${input.templateCode},${String(user.email)},${input.subject},${JSON.stringify(input.payload)}::jsonb)
    returning id`;
  return {queued:true,id:String((inserted[0] as any).id)};
}

function render(template:string,payload:any){
  const brand=String(payload?.businessName??'THE VERGE');
  if(template==='sale_receipt'){
    const total=Number(payload?.totalMinor??0)/100;
    const receipt=String(payload?.receiptId??'');
    return {text:`${brand} receipt ${receipt}\nTotal: NGN ${total.toLocaleString('en-NG',{minimumFractionDigits:2})}\nThank you for your business.`,
      html:`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827"><h2>${brand}</h2><p>Receipt <strong>${receipt}</strong></p><p>Total: <strong>₦${total.toLocaleString('en-NG',{minimumFractionDigits:2})}</strong></p><p>Thank you for your business.</p><p style="color:#6b7280">Sent with THE VERGE by Timzee Corp</p></div>`};
  }
  if(template==='owner_digest'){
    return {text:String(payload?.text??''),html:`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827"><h2>${brand} business summary</h2><p>${String(payload?.text??'').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p><p style="color:#6b7280">THE VERGE — Powered by Timzee Corp</p></div>`};
  }
  return {text:String(payload?.text??''),html:undefined};
}

export async function processEmailQueue(limit=20){
  const pool=transactionPool();
  try{
    await pool.query('BEGIN');
    const claimed=await pool.query(`select id,recipient,subject,template_code,payload from outbound_messages
      where channel='email' and status in ('queued','failed') and next_attempt_at<=now() and attempts<5
      order by created_at asc for update skip locked limit $1`,[Math.max(1,Math.min(100,limit))]);
    const ids=claimed.rows.map((r:any)=>r.id);
    if(ids.length)await pool.query("update outbound_messages set status='sending',attempts=attempts+1 where id=any($1::uuid[])",[ids]);
    await pool.query('COMMIT');
    let sent=0,failed=0;
    for(const row of claimed.rows as any[]){
      try{
        const body=render(String(row.template_code),row.payload??{});
        const providerId=await sendBusinessEmail({to:String(row.recipient),subject:String(row.subject??'THE VERGE'),text:body.text,html:body.html});
        if(!providerId)throw new Error('business_email_not_configured');
        await pool.query("update outbound_messages set status='sent',provider_message_id=$2,sent_at=now(),last_error=null where id=$1",[row.id,providerId]);sent++;
      }catch(error:any){
        await pool.query("update outbound_messages set status='failed',last_error=$2,next_attempt_at=now()+make_interval(mins=>least(60,power(2,attempts)::int)) where id=$1",[row.id,String(error?.message??error).slice(0,500)]);failed++;
      }
    }
    return {claimed:claimed.rowCount,sent,failed};
  }finally{await pool.end();}
}
