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
             m.role, m.active, m.created_at as "joinedAt"
      from memberships m
      join app_users u on u.id=m.user_id
      where m.organization_id=${organizationId} and m.role not in ('business_owner','platform_admin')
      order by m.active desc, u.display_name nulls last, u.email
    `;
    return json(res, 200, { staff });
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
      if (!ASSIGNABLE_ROLES.has(role)) { await pool.query('ROLLBACK'); return json(res, 400, { error: 'invalid_staff_role' }); }
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
      await pool.query(`
        insert into audit_events (organization_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
        values ($1,$2,$3,'membership',$4,$5::jsonb,$6::jsonb,'Owner-managed staff access')
      `, [organizationId,user.id,prior.rowCount?'staff.membership_updated':'staff.member_added',target.id,prior.rowCount?JSON.stringify(prior.rows[0]):null,JSON.stringify({email:target.email,role,active:true})]);
      await pool.query('COMMIT');
      return json(res, prior.rowCount ? 200 : 201, { staff: { userId:target.id,email:target.email,displayName:target.display_name,role,active:true } });
    }

    if (!/^[0-9a-f-]{36}$/i.test(targetUserId) || targetUserId===user.id) {
      await pool.query('ROLLBACK'); return json(res, 400, { error: 'invalid_staff_member' });
    }
    const current = await pool.query('select role,active from memberships where organization_id=$1 and user_id=$2 for update', [organizationId,targetUserId]);
    if (!current.rowCount || ['business_owner','platform_admin'].includes(String(current.rows[0].role))) {
      await pool.query('ROLLBACK'); return json(res, 404, { error: 'staff_member_not_found' });
    }

    const action = String(req.body?.action ?? 'deactivate');
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
