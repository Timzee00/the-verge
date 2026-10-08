import type { VercelRequest,VercelResponse } from '@vercel/node';
import { transactionPool } from '../_db';
import { json,method,requireSameOrigin,requireUser } from '../_http';
import { consumeMonthlyUsage,refundMonthlyUsage } from '../_usage';

const SUGGESTED_TASKS=[
  'Give me today’s owner briefing and what needs attention first.',
  'What should I reorder now, and why?',
  'Which products are selling well or slowly over the last 30 days?',
  'Compare my branches and point out unusual performance.',
  'Where are expenses putting pressure on profit?'
];

function providerConfig(){
  const apiKey=String(process.env.AI_API_KEY??'').trim();
  const baseUrl=String(process.env.AI_BASE_URL??'https://openrouter.ai/api/v1').replace(/\/$/,'');
  const model=String(process.env.AI_MODEL??'openai/gpt-4.1-mini').trim();
  return apiKey?{apiKey,baseUrl,model}:null;
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['GET','POST']))return;
  const user=await requireUser(req,res);if(!user)return;
  const organizationId=String(req.method==='GET'?req.query.organizationId:req.body?.organizationId??'');
  if(!organizationId)return json(res,400,{error:'organizationId_required'});
  const pool=transactionPool();
  try{
    const member=await pool.query("select m.role,o.name,o.industry from memberships m join organizations o on o.id=m.organization_id where m.organization_id=$1 and m.user_id=$2 and m.active=true and o.status='active' limit 1",[organizationId,user.id]);
    if(!member.rowCount)return json(res,403,{error:'forbidden'});

    if(req.method==='GET'){
      const plan=await pool.query("select coalesce((select plan_code from subscriptions where organization_id=$1 and status in ('trialing','active','grace') and (current_period_end is null or current_period_end>now()) order by created_at desc limit 1),'free') as plan",[organizationId]);
      return json(res,200,{tasks:SUGGESTED_TASKS,configured:Boolean(providerConfig()),plan:String(plan.rows[0]?.plan??'free')});
    }
    if(!requireSameOrigin(req,res))return;
    const question=String(req.body?.question??'').trim().slice(0,800);
    if(!question)return json(res,400,{error:'question_required'});
    const locationId=String(req.body?.locationId??'').trim();
    if(locationId){
      const allowed=await pool.query("select 1 from locations l join memberships m on m.organization_id=l.organization_id and m.user_id=$2 and m.active=true left join membership_locations ml on ml.membership_id=m.id and ml.location_id=l.id and ml.active=true where l.id=$1 and l.organization_id=$3 and l.active=true and (m.role in ('business_owner','platform_admin') or ml.location_id is not null) limit 1",[locationId,user.id,organizationId]);
      if(!allowed.rowCount)return json(res,403,{error:'location_forbidden'});
    }

    const provider=providerConfig();
    if(!provider)return json(res,503,{error:'ai_provider_not_configured'});
    let reservation:any=null;
    try{
      reservation=await consumeMonthlyUsage(pool,organizationId,'aiMessages',1);

      const params:any[]=[organizationId];
      let locationFilter='';if(locationId){params.push(locationId);locationFilter=' and s.location_id=$2';}
      const sales=await pool.query(`select count(*)::int as sales_count,coalesce(sum(total_minor),0)::bigint as revenue_minor,coalesce(sum(discount_minor),0)::bigint as discount_minor from sales s where s.organization_id=$1 and s.status='completed' and s.occurred_at>=now()-interval '30 days'${locationFilter}`,params);
      const today=await pool.query(`select count(*)::int as sales_count,coalesce(sum(total_minor),0)::bigint as revenue_minor from sales s where s.organization_id=$1 and s.status='completed' and s.occurred_at>=date_trunc('day',now())${locationFilter}`,params);
      const expenses=await pool.query(`select coalesce(sum(amount_minor),0)::bigint as expense_minor,count(*)::int as expense_count from expenses e where e.organization_id=$1 and e.occurred_at>=now()-interval '30 days'${locationId?' and (e.location_id=$2 or e.location_id is null)':''}`,params);
      const topProducts=await pool.query(`select p.name,sum(si.quantity)::numeric as quantity,sum((si.unit_price_minor*si.quantity)-si.discount_minor)::bigint as revenue_minor from sale_items si join sales s on s.id=si.sale_id join products p on p.id=si.product_id where s.organization_id=$1 and s.status='completed' and s.occurred_at>=now()-interval '30 days'${locationFilter} group by p.id,p.name order by revenue_minor desc limit 12`,params);
      const stockParams:any[]=[organizationId];let stockLocation='';if(locationId){stockParams.push(locationId);stockLocation=' and ib.location_id=$2';}
      const lowStock=await pool.query(`select p.name,l.name as location,ib.quantity_on_hand,p.reorder_level from inventory_balances ib join products p on p.id=ib.product_id join locations l on l.id=ib.location_id where ib.organization_id=$1 and p.active=true and p.reorder_level is not null and ib.quantity_on_hand<=p.reorder_level${stockLocation} order by (p.reorder_level-ib.quantity_on_hand) desc limit 20`,stockParams);
      const branches=await pool.query("select l.name,l.id,count(s.id)::int as sales_count,coalesce(sum(s.total_minor),0)::bigint as revenue_minor from locations l left join sales s on s.location_id=l.id and s.status='completed' and s.occurred_at>=now()-interval '30 days' where l.organization_id=$1 and l.active=true group by l.id,l.name order by revenue_minor desc limit 30",[organizationId]);
      const lotReady=await pool.query("select to_regclass('public.inventory_lots') as inventory_lots");
      let expiry:any[]=[];
      if(lotReady.rows[0]?.inventory_lots){
        const ep:any[]=[organizationId];let ef='';if(locationId){ep.push(locationId);ef=' and il.location_id=$2';}
        const lots=await pool.query(`select p.name,il.batch_number,il.expiry_date,il.quantity_available,l.name as location,il.status from inventory_lots il join products p on p.id=il.product_id join locations l on l.id=il.location_id where il.organization_id=$1 and il.quantity_available>0 and il.expiry_date is not null and il.expiry_date<=current_date+interval '90 days'${ef} order by il.expiry_date asc limit 20`,ep);
        expiry=lots.rows;
      }

      const context={
        business:{name:member.rows[0].name,industry:member.rows[0].industry,scope:locationId||'all authorized locations'},
        period:'Last 30 days unless labelled today',
        today:today.rows[0],sales30d:sales.rows[0],expenses30d:expenses.rows[0],
        topProducts:topProducts.rows,lowStock:lowStock.rows,branches:branches.rows,expiryAlerts:expiry
      };
      const system=`You are THE VERGE Business Copilot by Timzee Corp. You advise an African business owner using only the supplied structured business data. Be concise, commercially useful and specific. Never invent numbers or claim access to data not supplied. Money values ending in _minor are kobo; convert them to Nigerian naira in the answer. Distinguish facts from recommendations. Do not give medical advice even if the business is a pharmacy; discuss inventory/operations only. Never instruct the user to manipulate accounting records dishonestly. If data is insufficient, say what is missing. End with 2-4 prioritized actions when appropriate.`;
      const response=await fetch(provider.baseUrl+'/chat/completions',{method:'POST',headers:{'Authorization':'Bearer '+provider.apiKey,'Content-Type':'application/json','HTTP-Referer':String(process.env.APP_BASE_URL??'https://the-verge.app'),'X-Title':'THE VERGE by Timzee Corp'},body:JSON.stringify({model:provider.model,temperature:0.2,max_tokens:900,messages:[{role:'system',content:system},{role:'user',content:'BUSINESS DATA\n'+JSON.stringify(context)+'\n\nOWNER QUESTION\n'+question}]})});
      if(!response.ok)throw new Error('ai_provider_failed');
      const data:any=await response.json();
      const answer=String(data?.choices?.[0]?.message?.content??'').trim();
      if(!answer)throw new Error('ai_provider_failed');
      return json(res,200,{answer,usage:{used:reservation.used,limit:reservation.limit,plan:reservation.plan},asOf:new Date().toISOString()});
    }catch(error:any){
      if(reservation)await refundMonthlyUsage(pool,organizationId,'aiMessages',1).catch(()=>undefined);
      const code=String(error?.message??error);
      if(code==='ai_not_in_plan'||code==='usage_limit_reached')return json(res,402,{error:code});
      if(code==='ai_provider_failed')return json(res,502,{error:'ai_provider_failed'});
      throw error;
    }
  }catch{return json(res,500,{error:'internal_error'});}
  finally{await pool.end();}
}
