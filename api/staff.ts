import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, transactionPool } from './_db.js';
import { cleanEmail, json, method, requireUser } from './_http.js';

const ASSIGNABLE_ROLES = new Set(['manager', 'cashier', 'inventory_staff', 'accountant', 'staff']);
const OWNER_ROLES = new Set(['business_owner', 'platform_admin']);

async function requireOwner(userId: string, organizationId: string) {
  const sql = db();
  const rows = await sql`select role from memberships
    where organization_id=${organizationId} and user_id=${userId} and active=true limit 1`;
  return rows.length && OWNER_ROLES.has(String(rows[0].role));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ['GET', 'POST', 'PATCH'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  const organizationId = String(req.method === 'GET' ? req.query.organizationId ?? '' : req.body?.organizationId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return json(res, 400, { error: 'invalid_organization' });
  if (!await requireOwner(user.id, organizationId)) return json(res, 403, { error: 'owner_permission_required' });

  if (req.method === 'GET') {
    const sql = db();
    const staff = await sql`
      select m.user_id as "userId", u.email, u.display_name as "displayName",
             m.role, m.active, m.created_at as "joinedAt",
             coalesce(array_agg(ml.location_id) filter (where ml.location_id is not null), '{}') as "locationIds",
             coalesce(array_agg(l.name order by l.name) filter (where l.name is not null), '{}') as "locationNames"
      from memberships m
      join app_users u on u.id=m.user_id
      left join membership_locations ml on ml.organization_id=m.organization_id and ml.user_id=m.user_id
      left join locations l on l.id=ml.location_id and l.organization_id=m.organization_id
      where m.organization_id=${organizationId} and m.role not in ('business_owner','platform_admin')
      group by m.user_id,u.email,u.display_name,m.role,m.active,m.created_at
      order by m.active desc, u.display_name nulls last, u.email
    `;
    const locations = await sql`
      select id,name,type from locations
      where organization_id=${organizationId} and active=true
      order by name
    `;
    return json(res, 200, { staff, locations });
  }

  const targetUserId = String(req.body?.userId ?? '');
  const pool = transactionPool();
  try {
    await pool.query('BEGIN');
    if (req.method === 'POST') {
      let email: string;
      try { email = cleanEmail(req.body?.email); }
      catch { await pool.query('ROLLBACK'); return json(res, 400, { error: 'invalid_email' }); }
      const role = String(req.body?.role ?? 'cashier');
      const locationIds = Array.isArray(req.body?.locationIds) ? [...new Set(req.body.locationIds.map(String))] : [];
      if (!ASSIGNABLE_ROLES.has(role)) { await pool.query('ROLLBACK'); return json(res, 400, { error: 'invalid_staff_role' }); }
      if (!locationIds.length || locationIds.some(id=>! /^[0-9a-f-]{36}$/i.test(id))) { await pool.query('ROLLBACK'); return json(res, 400, { error: 'at_least_one_location_required' }); }
      const validLocations = await pool.query('select id from locations where organization_id=$1 and active=true and id=any($2::uuid[])', [organizationId,locationIds]);
      if (validLocations.rowCount !== locationIds.length) { await pool.query('ROLLBACK'); return json(res, 400, { error: 'invalid_staff_location' }); }
      const found = await pool.query('select id,email,display_name,status from app_users where lower(email)=lower($1) limit 1 for update', [email]);
      if (!found.rowCount || found.rows[0].status !== 'active') {
        await pool.query('ROLLBACK');
        return json(res, 404, { error: 'account_not_found', message: 'This person must create an active Verge account before you can add them.' });
      }
      const target = found.rows[0];
      if (target.id === user.id) { await pool.query('ROLLBACK'); return json(res, 400, { error: 'cannot_add_self' }); }
      const prior = await pool.query('select role,active from memberships where organization_id=$1 and user_id=$2 for update', [organizationId,target.id]);
      if (prior.rowCount && ['business_owner','platform_admin'].includes(String(prior.rows[0].role))) {
        await pool.query('ROLLBACK'); return json(res, 409, { error: 'protected_membership' });
      }
      await pool.query(`
        insert into memberships (id,organization_id,user_id,role,active)
        values (gen_random_uuid(),$1,$2,$3,true)
        on conflict (organization_id,user_id)
        do update set role=excluded.role,active=true,updated_at=now()
      `, [organizationId,target.id,role]);
      await pool.query('delete from membership_locations where organization_id=$1 and user_id=$2', [organizationId,target.id]);
      for (const locationId of locationIds) {
        await pool.query('insert into membership_locations (organization_id,user_id,location_id) values ($1,$2,$3)', [organizationId,target.id,locationId]);
      }
      await pool.query(`
        insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
        values ($1,$2,$3,'membership',$4,$5::jsonb,$6::jsonb,'Owner-managed staff access')
      `, [organizationId,user.id,prior.rowCount?'staff.membership_updated':'staff.member_added',target.id,prior.rowCount?JSON.stringify(prior.rows[0]):null,JSON.stringify({email:target.email,role,active:true})]);
      await pool.query('COMMIT');
      return json(res, prior.rowCount ? 200 : 201, { staff: { userId:target.id,email:target.email,displayName:target.display_name,role,active:true,locationIds } });
    }

    if (!/^[0-9a-f-]{36}$/i.test(targetUserId) || targetUserId===user.id) {
      await pool.query('ROLLBACK'); return json(res, 400, { error: 'invalid_staff_member' });
    }
    const current = await pool.query('select role,active from memberships where organization_id=$1 and user_id=$2 for update', [organizationId,targetUserId]);
    if (!current.rowCount || ['business_owner','platform_admin'].includes(String(current.rows[0].role))) {
      await pool.query('ROLLBACK'); return json(res, 404, { error: 'staff_member_not_found' });
    }

    const action = String(req.body?.action ?? 'deactivate');
    if (action === 'assign_locations') {
      const locationIds = Array.isArray(req.body?.locationIds) ? [...new Set(req.body.locationIds.map(String))] : [];
      if (!locationIds.length || locationIds.some(id=>! /^[0-9a-f-]{36}$/i.test(id))) { await pool.query('ROLLBACK'); return json(res, 400, { error: 'at_least_one_location_required' }); }
      const validLocations = await pool.query('select id from locations where organization_id=$1 and active=true and id=any($2::uuid[])', [organizationId,locationIds]);
      if (validLocations.rowCount !== locationIds.length) { await pool.query('ROLLBACK'); return json(res, 400, { error: 'invalid_staff_location' }); }
      await pool.query('delete from membership_locations where organization_id=$1 and user_id=$2', [organizationId,targetUserId]);
      for (const locationId of locationIds) await pool.query('insert into membership_locations (organization_id,user_id,location_id) values ($1,$2,$3)', [organizationId,targetUserId,locationId]);
      await pool.query(`insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,reason) values ($1,$2,'staff.locations_changed','membership',$3,$4::jsonb,$5::jsonb,'Owner-managed location access')`, [organizationId,user.id,targetUserId,JSON.stringify({locationAssignments:'previous'}),JSON.stringify({locationIds})]);
      await pool.query('COMMIT');
      return json(res,200,{staff:{userId:targetUserId,locationIds}});
    }
    let nextRole = String(current.rows[0].role);
    let nextActive = Boolean(current.rows[0].active);
    if (action === 'deactivate') nextActive = false;
    else if (action === 'reactivate') nextActive = true;
    else if (action === 'change_role') {
      nextRole = String(req.body?.role ?? '');
      if (!ASSIGNABLE_ROLES.has(nextRole)) { await pool.query('ROLLBACK'); return json(res, 400, { error: 'invalid_staff_role' }); }
    } else {
      await pool.query('ROLLBACK'); return json(res, 400, { error: 'invalid_staff_action' });
    }
    await pool.query('update memberships set role=$3,active=$4,updated_at=now() where organization_id=$1 and user_id=$2', [organizationId,targetUserId,nextRole,nextActive]);
    await pool.query(`
      insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
      values ($1,$2,$3,'membership',$4,$5::jsonb,$6::jsonb,'Owner-managed staff access')
    `, [organizationId,user.id,`staff.${action}`,targetUserId,JSON.stringify(current.rows[0]),JSON.stringify({role:nextRole,active:nextActive})]);
    await pool.query('COMMIT');
    return json(res, 200, { staff: { userId:targetUserId,role:nextRole,active:nextActive } });
  } catch (error: any) {
    await pool.query('ROLLBACK').catch(() => undefined);
    console.error('[staff] request failed', { name:error?.name, code:error?.code });
    return json(res, 500, { error: 'staff_operation_failed' });
  } finally {
    await pool.end();
  }
}
