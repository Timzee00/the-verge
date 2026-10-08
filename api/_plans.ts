type PlanLimits={products:number|null;locations:number|null;staff:number|null;aiMessages:number;whatsappMessages:number};
const LIMITS:Record<string,PlanLimits>={
 free:{products:100,locations:1,staff:2,aiMessages:0,whatsappMessages:0},
 starter:{products:1000,locations:1,staff:5,aiMessages:25,whatsappMessages:0},
 pro:{products:5000,locations:3,staff:10,aiMessages:150,whatsappMessages:1000},
 business:{products:null,locations:20,staff:50,aiMessages:500,whatsappMessages:5000},
 enterprise:{products:null,locations:null,staff:null,aiMessages:5000,whatsappMessages:50000}
};
export async function effectivePlan(sql:any,organizationId:string){
 const result=await sql.query("select plan_code,current_period_end from subscriptions where organization_id=$1 and status in ('trialing','active','grace') and (current_period_end is null or current_period_end>now()) order by created_at desc limit 1",[organizationId]);
 const code=String(result.rows?.[0]?.plan_code??'free');return {code,limits:LIMITS[code]??LIMITS.free};
}
export async function assertPlanCapacity(sql:any,organizationId:string,kind:'products'|'locations'|'staff'){
 const plan=await effectivePlan(sql,organizationId),limit=plan.limits[kind];if(limit==null)return plan;
 const table=kind==='products'?'products':kind==='locations'?'locations':'memberships';
 const result=await sql.query(`select count(*)::int as count from ${table} where organization_id=$1 ${kind==='products'?'and active=true':kind==='locations'?'and active=true':'and active=true'}`,[organizationId]);
 if(Number(result.rows?.[0]?.count??0)>=limit){const error:any=new Error('plan_limit_'+kind);error.code='PLAN_LIMIT';error.plan=plan.code;error.limit=limit;throw error;}return plan;
}
export function planLimitMessage(kind:string){return kind==='products'?'product_limit_reached':kind==='locations'?'location_limit_reached':'staff_limit_reached';}
