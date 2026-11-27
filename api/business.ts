import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, transactionPool } from './_db.js';
import { cleanEmail, json, method, requireUser } from './_http.js';
import { handleLocations } from './_locations-handler.js';
import { handleAccounting } from './_accounting-handler.js';

const OWNER_ROLES = new Set(['business_owner', 'platform_admin']);
const UUID = /^[0-9a-f-]{36}$/i;

function optionalText(value: unknown, max: number, field: string): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const valueText = String(value).trim();
  if (valueText.length > max) throw new Error(`${field}_too_long`);
  return valueText;
}

function validateWebsite(value: unknown): string | null {
  const candidate = optionalText(value, 240, 'website');
  if (!candidate) return null;
  const normalized = /^https:\/\//i.test(candidate) ? candidate : `https://${candidate}`;
  let parsed: URL;
  try { parsed = new URL(normalized); } catch { throw new Error('invalid_website'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname.includes('.')) throw new Error('invalid_website');
  return parsed.toString();
}

function mapBusiness(row: any) {
  return {
    id: String(row.id), name: String(row.name), baseCurrency: String(row.base_currency).trim(),
    industry: row.industry ?? '', legalName: row.legal_name ?? '',
    contactEmail: row.contact_email ?? '', phone: row.phone ?? '',
    addressLine1: row.address_line1 ?? '', addressLine2: row.address_line2 ?? '',
    city: row.city ?? '', state: row.state ?? '', postalCode: row.postal_code ?? '',
    website: row.website ?? '', taxIdentifier: row.tax_identifier ?? '',
    logoUrl: row.logo_url ?? '', updatedAt: row.updated_at,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const resource = String(req.query.resource ?? req.body?.resource ?? 'profile');
  if (resource === 'locations') return handleLocations(req, res);
  if (resource === 'accounting') return handleAccounting(req, res);
  if (resource !== 'profile') return json(res, 400, { error: 'invalid_business_resource' });
  if (!method(req, res, ['GET', 'PATCH'])) return;
  const user = await requireUser(req, res);
  if (!user) return;
  const organizationId = String(req.method === 'GET' ? req.query.organizationId ?? '' : req.body?.organizationId ?? '');
  if (!UUID.test(organizationId)) return json(res, 400, { error: 'invalid_organization' });

  const sql = db();
  const membership = await sql`
    select role from memberships
    where organization_id=${organizationId} and user_id=${user.id} and active=true limit 1
  `;
  if (!membership.length) return json(res, 403, { error: 'forbidden' });

  if (req.method === 'GET') {
    const rows = await sql`
      select id,name,base_currency,industry,legal_name,contact_email,phone,
             address_line1,address_line2,city,state,postal_code,website,
             tax_identifier,logo_url,updated_at
      from organizations where id=${organizationId} and status='active' limit 1
    `;
    if (!rows.length) return json(res, 404, { error: 'business_not_found' });
    return json(res, 200, { business: mapBusiness(rows[0]), canManage: OWNER_ROLES.has(String(membership[0].role)) });
  }

  if (!OWNER_ROLES.has(String(membership[0].role))) return json(res, 403, { error: 'owner_permission_required' });

  try {
    const body = req.body ?? {};
    const values: unknown[] = [];
    const assignments: string[] = [];
    const fields: Array<[string, string, (value: unknown) => unknown]> = [
      ['name','name',value=>optionalText(value,120,'name')],
      ['industry','industry',value=>optionalText(value,80,'industry')],
      ['legalName','legal_name',value=>optionalText(value,160,'legal_name')],
      ['contactEmail','contact_email',value=>value===''||value===null?null:cleanEmail(value)],
      ['phone','phone',value=>optionalText(value,40,'phone')],
      ['addressLine1','address_line1',value=>optionalText(value,160,'address_line1')],
      ['addressLine2','address_line2',value=>optionalText(value,160,'address_line2')],
      ['city','city',value=>optionalText(value,100,'city')],
      ['state','state',value=>optionalText(value,100,'state')],
      ['postalCode','postal_code',value=>optionalText(value,20,'postal_code')],
      ['website','website',validateWebsite],
      ['taxIdentifier','tax_identifier',value=>optionalText(value,60,'tax_identifier')],
      ['logoUrl','logo_url',value=>optionalText(value,500,'logo_url')],
    ];

    for (const [inputKey, column, validate] of fields) {
      if (!Object.prototype.hasOwnProperty.call(body, inputKey)) continue;
      const normalized = validate(body[inputKey]);
      if (inputKey === 'name' && !normalized) throw new Error('name_required');
      values.push(normalized);
      assignments.push(`${column}=$${values.length}`);
    }
    if (!assignments.length) return json(res, 400, { error: 'no_business_fields_provided' });

    const pool = transactionPool();
    try {
      await pool.query('BEGIN');
      const beforeResult = await pool.query(
        'select id,name,industry,legal_name,contact_email,phone,address_line1,address_line2,city,state,postal_code,website,tax_identifier,logo_url from organizations where id=$1 and status=\'active\' for update',
        [organizationId],
      );
      if (!beforeResult.rowCount) {
        await pool.query('ROLLBACK');
        return json(res, 404, { error: 'business_not_found' });
      }
      values.push(organizationId);
      const updated = await pool.query(
        `update organizations set ${assignments.join(',')}, updated_at=now() where id=$${values.length}
         returning id,name,base_currency,industry,legal_name,contact_email,phone,address_line1,address_line2,city,state,postal_code,website,tax_identifier,logo_url,updated_at`,
        values,
      );
      await pool.query(
        `insert into audit_events
          (organization_id,actor_user_id,action,entity_type,entity_id,before_data,after_data,reason)
         values ($1,$2,'business.profile_updated','organization',$1,$3::jsonb,$4::jsonb,'Owner updated business profile')`,
        [organizationId,user.id,JSON.stringify(beforeResult.rows[0]),JSON.stringify(updated.rows[0])],
      );
      await pool.query('COMMIT');
      return json(res, 200, { business: mapBusiness(updated.rows[0]) });
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await pool.end();
    }
  } catch (error: any) {
    const message = String(error?.message ?? error);
    if (message === 'Invalid email address' || message.endsWith('_too_long') || ['name_required','invalid_website'].includes(message)) {
      return json(res, 400, { error: message });
    }
    console.error('[business.patch] request failed', { name: error?.name, code: error?.code });
    return json(res, 500, { error: 'business_update_failed' });
  }
}
