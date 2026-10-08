import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from '../_db';
import { json,method } from '../_http';
import { enqueueUserEmail,processEmailQueue } from '../_mailQueue';

function money(minor:unknown){return '₦'+(Number(minor??0)/100).toLocaleString('en-NG',{minimumFractionDigits:2,maximumFractionDigits:2});}

export default async function handler(req:VercelRequest,res:VercelResponse){
 if(!method(req,res,['POST']))return;
 const secret=String(process.env.MAIL_WORKER_SECRET??'').trim(),auth=String(req.headers.authorization??'');
 if(!secret||auth!==`Bearer ${secret}`)return json(res,401,{error:'worker_unauthorized'});
 const sql=db();
 try{
  const prefs=await sql`select np.organization_id,np.user_id,np.event_code,np.digest,o.name as business_name,
      coalesce((select plan_code from subscriptions s where s.organization_id=np.organization_id and s.status in ('trialing','active','grace') and (s.current_period_end is null or s.current_period_end>now()) order by s.created_at desc limit 1),'free') as plan
    from notification_preferences np join organizations o on o.id=np.organization_id
    where np.channel='email' and np.enabled=true and np.digest<>'off' and o.status='active'
    order by np.organization_id,np.user_id limit 1000`;
  let queued=0,skipped=0;
  const today=new Date().toISOString().slice(0,10);
  const isoDay=new Date().getUTCDay();
  for(const pref of prefs as any[]){
    const event=String(pref.event_code),plan=String(pref.plan);
    const branding=await sql`select 1 from entitlements where organization_id=${pref.organization_id} and capability='branding.remove' and effect='allow' and starts_at<=now() and (expires_at is null or expires_at>now()) limit 1`;
    if(plan==='free'&&event!=='security.account'){skipped++;continue;}
    if(event==='owner.weekly_summary'&&isoDay!==1){skipped++;continue;}
    if(!['owner.daily_summary','owner.weekly_summary','inventory.low_stock','inventory.expiry'].includes(event)){skipped++;continue;}
    let text='',subject='';
    if(event==='owner.daily_summary'||event==='owner.weekly_summary'){
      const interval=event==='owner.weekly_summary'?'7 days':'1 day';
      const sales=await sql`select count(*)::int as count,coalesce(sum(total_minor),0)::bigint as revenue from sales where organization_id=${pref.organization_id} and status='completed' and occurred_at>=now()-${interval}::interval`;
      const expenses=await sql`select coalesce(sum(amount_minor),0)::bigint as total from expenses where organization_id=${pref.organization_id} and occurred_at>=now()-${interval}::interval`;
      const low=await sql`select count(*)::int as count from inventory_balances ib join products p on p.id=ib.product_id where ib.organization_id=${pref.organization_id} and p.active=true and p.reorder_level is not null and ib.quantity_on_hand<=p.reorder_level`;
      text=`${event==='owner.weekly_summary'?'Weekly':'Daily'} summary for ${pref.business_name}: ${sales[0]?.count??0} completed sales, revenue ${money((sales[0] as any)?.revenue)}, recorded expenses ${money((expenses[0] as any)?.total)}, and ${(low[0] as any)?.count??0} products at or below reorder level.`;
      subject=`${pref.business_name} — ${event==='owner.weekly_summary'?'weekly review':'daily summary'}`;
    }else if(event==='inventory.low_stock'){
      const rows=await sql`select p.name,l.name as location,ib.quantity_on_hand,p.reorder_level from inventory_balances ib join products p on p.id=ib.product_id join locations l on l.id=ib.location_id where ib.organization_id=${pref.organization_id} and p.active=true and p.reorder_level is not null and ib.quantity_on_hand<=p.reorder_level order by (p.reorder_level-ib.quantity_on_hand) desc limit 15`;
      if(!rows.length){skipped++;continue;}
      text='Low-stock priorities:\n'+(rows as any[]).map(r=>`• ${r.name} — ${r.location}: ${r.quantity_on_hand} available (reorder level ${r.reorder_level})`).join('\n');
      subject=`${pref.business_name} — low-stock alert`;
    }else{
      const ready=await sql`select to_regclass('public.inventory_lots') as lots`;if(!(ready[0] as any)?.lots){skipped++;continue;}
      const rows=await sql`select p.name,l.name as location,il.batch_number,il.expiry_date,il.quantity_available from inventory_lots il join products p on p.id=il.product_id join locations l on l.id=il.location_id where il.organization_id=${pref.organization_id} and il.quantity_available>0 and il.expiry_date is not null and il.expiry_date<=current_date+interval '30 days' and il.status not in ('depleted','recalled') order by il.expiry_date asc limit 15`;
      if(!rows.length){skipped++;continue;}
      text='Expiry attention:\n'+(rows as any[]).map(r=>`• ${r.name} — batch ${r.batch_number}, ${r.location}, expires ${String(r.expiry_date).slice(0,10)}, qty ${r.quantity_available}`).join('\n');
      subject=`${pref.business_name} — expiry alert`;
    }
    const period=event==='owner.weekly_summary'?today.slice(0,7)+'-w':today;
    const result=await enqueueUserEmail({organizationId:String(pref.organization_id),userId:String(pref.user_id),templateCode:'owner_digest',subject,payload:{businessName:String(pref.business_name),text,showPlatformBranding:!branding.length},kind:'operational',dedupeKey:`${event}:${pref.user_id}:${period}`});
    if(result.queued)queued++;else skipped++;
  }
  const delivered=await processEmailQueue(50);
  return json(res,200,{preferences:prefs.length,queued,skipped,delivered});
 }catch{return json(res,500,{error:'internal_error'});}
}
