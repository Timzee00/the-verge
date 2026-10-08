import { effectivePlan } from './_plans';
export async function consumeMonthlyUsage(sql:any,organizationId:string,metric:'aiMessages'|'whatsappMessages',amount=1){
 if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('invalid_usage_amount');
 const plan=await effectivePlan(sql,organizationId);const limit=plan.limits[metric];if(limit<=0)throw new Error(metric==='aiMessages'?'ai_not_in_plan':'whatsapp_not_in_plan');
 const key=metric==='aiMessages'?'ai_messages':'whatsapp_messages';
 const result=await sql.query(`insert into organization_usage_monthly(organization_id,period_start,metric,used,updated_at)
 values($1,date_trunc('month',now())::date,$2,$3,now())
 on conflict(organization_id,period_start,metric) do update set used=organization_usage_monthly.used+excluded.used,updated_at=now()
 where organization_usage_monthly.used+excluded.used<=$4 returning used`,[organizationId,key,amount,limit]);
 if(!result.rowCount)throw new Error('usage_limit_reached');return {used:Number(result.rows[0].used),limit,plan:plan.code};
}
