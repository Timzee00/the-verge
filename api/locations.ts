import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, transactionPool } from './_db.js';
import { json, method, requireUser } from './_http.js';

const OWNER_ROLES = new Set(['business_owner', 'platform_admin']);
const UUID = /^[0-9a-f-]{36}$/i;
const LOCATION_TYPES = new Set(['region', 'branch', 'warehouse']);

function optionalText(value: unknown, max: number, field: string): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const result = String(value).trim();
  if (result.length > max) throw new Error(`${field}_too_long`);
  return result;
}

function normalizeLocationType(value: unknown) {
  const type = String(value ?? 'branch');
  if (!LOCATION_TYPES.has(type)) throw new Error('invalid_location_type');
  return type;
}

function normalizeCode(value: unknown) {
  const code = optionalText(value, 20, 'code');
  if (code && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,19}$/.test(code)) throw new Error('invalid_location_code');
  return code?.toUpperCase() ?? null;
}

function mapLocation(row: any) {
  return {
    id: String(row.id), organizationId: String(row.organization_id), name: row.name,
    type: row.type, parentId: row.parent_id ?? undefined, code: row.code ?? '',
    active: Boolean(row.active), phone: row.phone ?? '', contactEmail: row.contact_email ?? '',
    addressLine1: row.address_line1 ?? '', addressLine2: row.address_line2 ?? '',
    city: row.city ?? '', state: row.state ?? '', postalCode: row.postal_code ?? '',
    timezone: row.timezone ?? 'Africa/Lagos',
  };
}

async function validateParent(client: any, organizationId: string, type: string, parentId: string | null) {
  if (type === 'region' && parentId) throw new Error('region_cannot_have_parent');
  if (!parentId) return;
  if (!UUID.test(parentId)) throw new Error('invalid_location_parent');
  const parent = await client.query(
    'select type,active from locations where id=$1 and organization_id=$2 limit 1',
    [parentId, organizationId],
  );
  if (!parent.rowCount || !parent.rows[0].active || parent.rows[0].type !== 'region') {
    throw new Error('parent_must_be_active_region');
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ['GET', 'POST', 'PATCH'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  const organizationId = String(req.method === 'GET' ? req.query.organizationId ?? '' : req.body?.organizationId ?? '');
  if (!UUID.test(organizationId)) return json(res, 400, { error: 'invalid_organization' });

  const sql = db();
  const memberships = await sql`
    select role from memberships
    where organization_id=${organizationId} and user_id=${user.id} and active=true limit 1
  `;
  if (!memberships.length) return json(res, 403, { error: 'forbidden' });
  const role = String(memberships[0].role);
  const isOwner = OWNER_ROLES.has(role);

  if (req.method === 'GET') {
    const rows = isOwner ? await sql`
      select id,organization_id,name,type,parent_id,code,active,phone,contact_email,
             address_line1,address_line2,city,state,postal_code,timezone
      from locations where organization_id=${organizationId}
      order by active desc, type, name
    ` : await sql`
      select l.id,l.organization_id,l.name,l.type,l.parent_id,l.code,l.active,l.phone,l.contact_email,
             l.address_line1,l.address_line2,l.city,l.state,l.postal_code,l.timezone
      from locations l
      join membership_locations ml on ml.organization_id=l.organization_id and ml.location_id=l.id
      where l.organization_id=${organizationId} and ml.user_id=${user.id} and l.active=true
      order by l.name
    `;
    return json(res, 200, { locations: rows.map(mapLocation), canManage: isOwner });
  }

  if (!isOwner) return json(res, 403, { error: 'owner_permission_required' });

  const body = req.body ?? {};
  const pool = transactionPool();
  try {
    await pool.query('BEGIN');

    if (req.method === 'POST') {
      const name = optionalText(body.name, 100, 'name');
      if (!name) { await pool.query('ROLLBACK'); return json(res, 400, { error: 'location_name_required' }); }
      const type = normalizeLocationType(body.type);
      const code = normalizeCode(body.code);
      const parentId = optionalText(body.parentId, 36, 'parent_id');
      await validateParent(pool, organizationId, type, parentId);
      const duplicateName = await pool.query(
        'select 1 from locations where organization_id=$1 and lower(name)=lower($2) limit 1',
        [organizationId, name],
      );
      if (duplicateName.rowCount) { await pool.query('ROLLBACK'); return json(res, 409, { error: 'location_name_in_use' }); }
      if (code) {
        const duplicateCode = await pool.query(
          'select 1 from locations where organization_id=$1 and upper(code)=upper($2) limit 1',
          [organizationId, code],
        );
        if (duplicateCode.rowCount) { await pool.query('ROLLBACK'); return json(res, 409, { error: 'location_code_in_use' }); }
      }

      const fields = [
        optionalText(body.phone, 40, 'phone'),
        body.contactEmail ? String(body.contactEmail).trim().toLowerCase() : null,
        optionalText(body.addressLine1, 160, 'address_line1'),
        optionalText(body.addressLine2, 160, 'address_line2'),
        optionalText(body.city, 100, 'city'),
        optionalText(body.state, 100, 'state'),
        optionalText(body.postalCode, 20, 'postal_code'),
      ];
      if (fields[1] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(fields[1]))) throw new Error('invalid_contact_email');
      const inserted = await pool.query(
        `insert into locations
          (id,organization_id,name,type,parent_id,code,phone,contact_email,address_line1,address_line2,city,state,postal_code)
         values (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         returning id,organization_id,name,type,parent_id,code,active,phone,contact_email,address_line1,address_line2,city,state,postal_code,timezone`,
        [organizationId,name,type,parentId,code,...fields],
      );
      await pool.query(
        `insert into audit_events
          (organization_id,actor_user_id,action,entity_type,entity_id,after_data,reason)
         values ($1,$2,'location.created','location',$3,$4::jsonb,'Owner created a business location')`,
        [organizationId,user.id,inserted.rows[0].id,JSON.stringify(inserted.rows[0])],
      );
      await pool.query('COMMIT');
      return json(res, 201, { location: mapLocation(inserted.rows[0]) });
    }

    const locationId = String(body.locationId ?? '');
    if (!UUID.test(locationId)) { await pool.query('ROLLBACK'); return json(res, 400, { error: 'invalid_location' }); }
    const existing = await pool.query(
      'select * from locations where id=$1 and organization_id=$2 for update',
      [locationId,organizationId],
    );
    if (!existing.rowCount) { await pool.query('ROLLBACK'); return json(res, 404, { error: 'location_not_found' }); }
    const current = existing.rows[0];
    const action = String(body.action ?? 'update');

    if (action === 'archive') {
      const activeCount = await pool.query(
        'select count(*)::int as count from locations where organization_id=$1 and active=true',
        [organizationId],
      );
      if (Number(activeCount.rows[0]?.count ?? 0) <= 1) {
        await pool.query('ROLLBACK'); return json(res, 409, { error: 'cannot_archive_last_location' });
      }
      const children = await pool.query(
        'select 1 from locations where organization_id=$1 and parent_id=$2 and active=true limit 1',
        [organizationId,locationId],
      );
      if (children.rowCount) { await pool.query('ROLLBACK'); return json(res, 409, { error: 'archive_child_locations_first' }); }
      const assigned = await pool.query(
        `select 1 from membership_locations ml join memberships m
           on m.organization_id=ml.organization_id and m.user_id=ml.user_id
         where ml.organization_id=$1 and ml.location_id=$2 and m.active=true limit 1`,
        [organizationId,locationId],
      );
      if (assigned.rowCount) { await pool.query('ROLLBACK'); return json(res, 409, { error: 'reassign_active_staff_first' }); }
      await pool.query('update locations set active=false where id=$1 and organization_id=$2', [locationId,organizationId]);
    } else if (action === 'restore') {
      const type = String(current.type);
      await validateParent(pool, organizationId, type, current.parent_id ? String(current.parent_id) : null);
      await pool.query('update locations set active=true where id=$1 and organization_id=$2', [locationId,organizationId]);
    } else if (action === 'update') {
      const name = Object.prototype.hasOwnProperty.call(body,'name') ? optionalText(body.name,100,'name') : current.name;
      if (!name) throw new Error('location_name_required');
      const type = Object.prototype.hasOwnProperty.call(body,'type') ? normalizeLocationType(body.type) : String(current.type);
      const parentId = Object.prototype.hasOwnProperty.call(body,'parentId')
        ? optionalText(body.parentId,36,'parent_id')
        : (current.parent_id ? String(current.parent_id) : null);
      await validateParent(pool,organizationId,type,parentId);
      if (type !== current.type) {
        const children = await pool.query('select 1 from locations where organization_id=$1 and parent_id=$2 and active=true limit 1',[organizationId,locationId]);
        if (children.rowCount) throw new Error('location_has_active_children');
      }
      const duplicateName = await pool.query(
        'select 1 from locations where organization_id=$1 and lower(name)=lower($2) and id<>$3 limit 1',
        [organizationId,name,locationId],
      );
      if (duplicateName.rowCount) { await pool.query('ROLLBACK'); return json(res,409,{error:'location_name_in_use'}); }
      const code = Object.prototype.hasOwnProperty.call(body,'code') ? normalizeCode(body.code) : current.code;
      if (code) {
        const duplicateCode = await pool.query(
          'select 1 from locations where organization_id=$1 and upper(code)=upper($2) and id<>$3 limit 1',
          [organizationId,code,locationId],
        );
        if (duplicateCode.rowCount) { await pool.query('ROLLBACK'); return json(res,409,{error:'location_code_in_use'}); }
      }
      const value = (key:string,column:string,max:number) =>
        Object.prototype.hasOwnProperty.call(body,key) ? optionalText(body[key],max,column) : current[column];
      const phone = value('phone','phone',40);
      const emailValue = Object.prototype.hasOwnProperty.call(body,'contactEmail')
        ? (body.contactEmail ? String(body.contactEmail).trim().toLowerCase() : null)
        : current.contact_email;
      if (emailValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(emailValue))) throw new Error('invalid_contact_email');
      const line1 = value('addressLine1','address_line1',160);
      const line2 = value('addressLine2','address_line2',160);
      const city = value('city','city',100);
      const state = value('state','state',100);
      const postal = value('postalCode','postal_code',20);
      const updated = await pool.query(
        `update locations set name=$3,type=$4,parent_id=$5,code=$6,phone=$7,contact_email=$8,
           address_line1=$9,address_line2=$10,city=$11,state=$12,postal_code=$13
         where id=$1 and organization_id=$2
         returning id,organization_id,name,type,parent_id,code,active,phone,contact_email,address_line1,address_line2,city,state,postal_code,timezone`,
        [locationId,organizationId,name,type,parentId,code,phone,emailValue,line1,line2,city,state,postal],
      );
      await pool.query(
        `insert into audit_events
          (organization_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
         values ($1,$2,'location.updated','location',$3,$4::jsonb,$5::jsonb,'Owner updated location details')`,
        [organizationId,user.id,locationId,JSON.stringify(current),JSON.stringify(updated.rows[0])],
      );
      await pool.query('COMMIT');
      return json(res,200,{location:mapLocation(updated.rows[0])});
    } else {
      await pool.query('ROLLBACK'); return json(res,400,{error:'invalid_location_action'});
    }

    await pool.query(
      `insert into audit_events
        (organization_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
       values ($1,$2,$3,'location',$4,$5::jsonb,$6::jsonb,'Owner changed location availability')`,
      [organizationId,user.id,`location.${action}`,locationId,JSON.stringify({active:current.active}),JSON.stringify({active:action==='archive'?false:true})],
    );
    const finalRow = await pool.query(
      `select id,organization_id,name,type,parent_id,code,active,phone,contact_email,address_line1,address_line2,city,state,postal_code,timezone
       from locations where id=$1 and organization_id=$2`,
      [locationId,organizationId],
    );
    await pool.query('COMMIT');
    return json(res,200,{location:mapLocation(finalRow.rows[0])});
  } catch (error: any) {
    await pool.query('ROLLBACK').catch(() => undefined);
    const message = String(error?.message ?? error);
    if (message.endsWith('_too_long') || ['invalid_location_type','invalid_location_code','region_cannot_have_parent','invalid_location_parent','parent_must_be_active_region','location_name_required','invalid_contact_email','location_has_active_children'].includes(message)) {
      return json(res,400,{error:message});
    }
    console.error('[locations] request failed',{name:error?.name,code:error?.code});
    return json(res,500,{error:'location_operation_failed'});
  } finally {
    await pool.end();
  }
}
