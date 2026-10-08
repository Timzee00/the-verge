import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db,transactionPool } from '../_db';
import { cleanText,json,method,requireSameOrigin,requireUser } from '../_http';
import { assertPlanCapacity } from '../_plans';

const OWNER_ROLES=new Set(['business_owner','platform_admin']);
const MANAGER_ROLES=new Set(['business_owner','manager','platform_admin']);
const LOCATION_TYPES=new Set(['branch','warehouse']);

function optionalText(value:unknown,max:number){
  const text=String(value??'').trim();
  if(!text)return null;
  if(text.length>max)throw new Error('invalid_text');
  return text;
}
function locationCode(value:unknown){
  const code=String(value??'').trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9_-]{1,19}$/.test(code))throw new Error('invalid_location_code');
  return code;
}
function emailOrNull(value:unknown){
  const email=optionalText(value,320);
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('invalid_location_email');
  return email;
}
async function getMembership(sql:any,organizationId:string,userId:string){
  const rows=await sql`
    select m.id as membership_id,m.role,o.status
    from memberships m
    join organizations o on o.id=m.organization_id
    where m.organization_id=${organizationId}
      and m.user_id=${userId}
      and m.active=true
    limit 1`;
  return rows[0] as any;
}
async function canManageLocation(sql:any,membershipId:string,role:string,locationId:string,organizationId:string){
  if(role==='platform_admin'||role==='business_owner')return true;
  const rows=await sql`
    select 1
    from membership_locations ml
    join locations l on l.id=ml.location_id
    where ml.membership_id=${membershipId}
      and ml.location_id=${locationId}
      and ml.active=true
      and l.organization_id=${organizationId}
      and l.active=true
    limit 1`;
  return Boolean(rows.length);
}
function locationPayload(row:any){
  return {
    id:String(row.id),
    organizationId:String(row.organization_id),
    name:String(row.name),
    type:String(row.type),
    parentId:row.parent_id?String(row.parent_id):undefined,
    code:row.code?String(row.code):undefined,
    active:Boolean(row.active),
    address:row.address?String(row.address):undefined,
    phone:row.phone?String(row.phone):undefined,
    email:row.email?String(row.email):undefined,
    receiptName:row.receipt_name?String(row.receipt_name):undefined,
    receiptFooter:row.receipt_footer?String(row.receipt_footer):undefined,
    setupCompletedAt:row.setup_completed_at?new Date(row.setup_completed_at).toISOString():undefined
  };
}
function duplicateError(error:any){
  if(String(error?.code)!=='23505')return null;
  const constraint=String(error?.constraint??'');
  if(constraint.includes('organization_id_name'))return 'duplicate_location_name';
  return 'duplicate_location_code';
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['POST']))return;
  if(!requireSameOrigin(req,res))return;
  const user=await requireUser(req,res);if(!user)return;

  try{
    const organizationId=String(req.body?.organizationId??'');
    const action=String(req.body?.action??'');
    if(!organizationId)return json(res,400,{error:'organizationId_required'});

    const sql=db();
    const ready=await sql`
      select
        to_regclass('public.membership_locations') as membership_locations,
        (
          select count(*)=6
          from information_schema.columns
          where table_schema='public' and table_name='locations'
            and column_name in ('address','phone','email','receipt_name','receipt_footer','setup_completed_at')
        ) as store_setup_ready`;
    if(!(ready[0] as any)?.membership_locations||!(ready[0] as any)?.store_setup_ready)return json(res,503,{error:'server_not_ready'});

    const member=await getMembership(sql,organizationId,user.id);
    if(!member||String(member.status)!=='active')return json(res,403,{error:'forbidden'});
    const role=String(member.role);
    const membershipId=String(member.membership_id);

    if(action==='update_business'){
      if(!OWNER_ROLES.has(role))return json(res,403,{error:'forbidden'});
      const name=cleanText(req.body?.name,120);
      const industry=cleanText(req.body?.industry,80);
      const pool=transactionPool();
      try{
        await pool.query('BEGIN');
        const saved=await pool.query(
          "update organizations set name=$1,industry=$2 where id=$3 and status='active' returning id,name,base_currency,industry",
          [name,industry,organizationId]
        );
        if(!saved.rowCount){await pool.query('ROLLBACK');return json(res,404,{error:'not_found'});}
        await pool.query(
          "insert into audit_events(organization_id,actor_user_id,action,entity_type,entity_id,after_data) values($1,$2,'business.profile_updated','organization',$1,$3::jsonb)",
          [organizationId,user.id,JSON.stringify({name,industry})]
        );
        await pool.query('COMMIT');
        const row=saved.rows[0] as any;
        return json(res,200,{organization:{id:row.id,name:row.name,base_currency:row.base_currency,industry:row.industry,role}});
      }catch(error){
        await pool.query('ROLLBACK').catch(()=>undefined);
        throw error;
      }finally{await pool.end();}
    }

    if(action==='update_location'){
      if(!MANAGER_ROLES.has(role))return json(res,403,{error:'forbidden'});
      const locationId=String(req.body?.locationId??'');
      if(!locationId)return json(res,400,{error:'location_required'});
      if(!(await canManageLocation(sql,membershipId,role,locationId,organizationId)))return json(res,403,{error:'location_forbidden'});

      const name=cleanText(req.body?.name,100);
      const code=locationCode(req.body?.code);
      const type=String(req.body?.type??'branch');
      if(!LOCATION_TYPES.has(type))return json(res,400,{error:'invalid_location_type'});
      const address=optionalText(req.body?.address,240);
      const phone=optionalText(req.body?.phone,40);
      const email=emailOrNull(req.body?.email);
      const receiptName=optionalText(req.body?.receiptName,100)??name;
      const receiptFooter=optionalText(req.body?.receiptFooter,240);

      const pool=transactionPool();
      try{
        await pool.query('BEGIN');
        const saved=await pool.query(
          `update locations
             set name=$1,code=$2,type=$3,address=$4,phone=$5,email=$6,receipt_name=$7,receipt_footer=$8,
                 setup_completed_at=coalesce(setup_completed_at,now())
           where id=$9 and organization_id=$10 and active=true
           returning *`,
          [name,code,type,address,phone,email,receiptName,receiptFooter,locationId,organizationId]
        );
        if(!saved.rowCount){await pool.query('ROLLBACK');return json(res,404,{error:'not_found'});}
        await pool.query("insert into sync_changes(organization_id,entity_type,entity_id,changed_at) values($1,'location',$2,now())",[organizationId,locationId]);
        await pool.query(
          "insert into audit_events(organization_id,actor_user_id,action,entity_type,entity_id,after_data) values($1,$2,'location.setup_updated','location',$3,$4::jsonb)",
          [organizationId,user.id,locationId,JSON.stringify({name,code,type,address,phone,email,receiptName,receiptFooter})]
        );
        await pool.query('COMMIT');
        return json(res,200,{location:locationPayload(saved.rows[0])});
      }catch(error:any){
        await pool.query('ROLLBACK').catch(()=>undefined);
        const duplicate=duplicateError(error);if(duplicate)return json(res,409,{error:duplicate});
        throw error;
      }finally{await pool.end();}
    }

    if(action==='create_location'){
      try{const capPool=transactionPool();try{await assertPlanCapacity(capPool,organizationId,'locations');}finally{await capPool.end();}}catch(error:any){if(String(error?.code)==='PLAN_LIMIT')return json(res,403,{error:'location_limit_reached',plan:error.plan,limit:error.limit});throw error;}
      if(!OWNER_ROLES.has(role))return json(res,403,{error:'forbidden'});
      const count=await sql`select count(*)::int as count from locations where organization_id=${organizationId} and active=true`;
      if(Number((count[0] as any)?.count??0)>=250)return json(res,409,{error:'location_limit'});

      const name=cleanText(req.body?.name,100);
      const code=locationCode(req.body?.code);
      const type=String(req.body?.type??'branch');
      if(!LOCATION_TYPES.has(type))return json(res,400,{error:'invalid_location_type'});
      const address=optionalText(req.body?.address,240);
      const id=crypto.randomUUID();

      const pool=transactionPool();
      try{
        await pool.query('BEGIN');
        const inserted=await pool.query(
          `insert into locations(id,organization_id,name,type,code,address,active)
           values($1,$2,$3,$4,$5,$6,true)
           returning *`,
          [id,organizationId,name,type,code,address]
        );
        await pool.query(
          `insert into membership_locations(membership_id,location_id,active)
           select m.id,$1,true
           from memberships m
           where m.organization_id=$2 and m.active=true and m.role in ('business_owner','platform_admin')
           on conflict(membership_id,location_id) do update set active=true`,
          [id,organizationId]
        );
        await pool.query("insert into sync_changes(organization_id,entity_type,entity_id,changed_at) values($1,'location',$2,now())",[organizationId,id]);
        await pool.query(
          "insert into audit_events(organization_id,actor_user_id,action,entity_type,entity_id,after_data) values($1,$2,'location.created','location',$3,$4::jsonb)",
          [organizationId,user.id,id,JSON.stringify({name,code,type,address})]
        );
        await pool.query('COMMIT');
        return json(res,201,{location:locationPayload(inserted.rows[0])});
      }catch(error:any){
        await pool.query('ROLLBACK').catch(()=>undefined);
        const duplicate=duplicateError(error);if(duplicate)return json(res,409,{error:duplicate});
        throw error;
      }finally{await pool.end();}
    }

    return json(res,400,{error:'invalid_setup_action'});
  }catch(error:any){
    const message=String(error?.message??'');
    if(message==='invalid_location_code'||message==='invalid_location_email'||message==='invalid_text'||message==='Invalid text value')return json(res,400,{error:message==='Invalid text value'?'invalid_payload':message});
    console.error('business_setup_failed',message);
    return json(res,500,{error:'internal_error'});
  }
}
