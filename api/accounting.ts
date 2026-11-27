import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_db.js';
import { json, method, requireUser } from './_http.js';

const FINANCE_ROLES = new Set(['business_owner', 'platform_admin', 'manager', 'accountant']);
const OWNER_ROLES = new Set(['business_owner', 'platform_admin']);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ['GET'])) return;
  const user = await requireUser(req, res);
  if (!user) return;

  const organizationId = String(req.query.organizationId ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return json(res, 400, { error: 'invalid_organization' });

  const sql = db();
  const memberships = await sql`
    select role from memberships
    where organization_id=${organizationId} and user_id=${user.id} and active=true
    limit 1
  `;
  if (!memberships.length) return json(res, 403, { error: 'forbidden' });
  const role = String(memberships[0].role);
  if (!FINANCE_ROLES.has(role)) return json(res, 403, { error: 'finance_permission_required' });

  const organizationWide = OWNER_ROLES.has(role);
  const assigned = organizationWide ? [] : await sql`
    select location_id from membership_locations
    where organization_id=${organizationId} and user_id=${user.id}
  `;
  const locationIds = assigned.map((row: any) => String(row.location_id));

  const ledgerAccounts = await sql`
    select id, organization_id as "organizationId", code, name,
           account_class as class, normal_balance as "normalBalance", active
    from ledger_accounts
    where organization_id=${organizationId} and active=true
    order by code
  `;

  const journals = !organizationWide && !locationIds.length ? [] : organizationWide
    ? await sql`
        select id, organization_id as "organizationId", location_id as "locationId",
               reference, description, occurred_at as "occurredAt",
               source_type as "sourceType", source_id as "sourceId", status,
               created_at as "createdAt", created_by as "createdBy"
        from journal_entries
        where organization_id=${organizationId}
        order by occurred_at desc, id desc
        limit 200
      `
    : await sql`
        select id, organization_id as "organizationId", location_id as "locationId",
               reference, description, occurred_at as "occurredAt",
               source_type as "sourceType", source_id as "sourceId", status,
               created_at as "createdAt", created_by as "createdBy"
        from journal_entries
        where organization_id=${organizationId} and location_id=any(${locationIds}::uuid[])
        order by occurred_at desc, id desc
        limit 200
      `;

  const journalIds = journals.map((entry: any) => entry.id);
  const journalLines = journalIds.length ? await sql`
    select jl.id, jl.journal_entry_id as "journalEntryId", jl.account_id as "accountId",
           jl.debit_minor as "debitMinor", jl.credit_minor as "creditMinor", jl.memo,
           la.code as "accountCode", la.name as "accountName"
    from journal_lines jl
    join ledger_accounts la on la.id=jl.account_id and la.organization_id=${organizationId}
    where jl.journal_entry_id=any(${journalIds}::uuid[])
    order by jl.journal_entry_id, la.code, jl.id
  ` : [];

  return json(res, 200, { ledgerAccounts, journals, journalLines, truncated: journals.length === 200 });
}
