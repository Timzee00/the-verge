import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db, transactionPool } from '../_db';
import { cleanEmail, cleanText, cleanPassword, isHttps, json, method, newToken, hashToken, setSessionCookie } from '../_http';
import { hashPassword } from '../_password';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ['POST'])) return;
  try {
    const readiness = await db`select to_regclass('public.membership_locations') as membership_locations, to_regclass('public.sync_changes') as sync_changes, to_regclass('public.auth_rate_limits') as auth_rate_limits`;
    if (!readiness[0] || !readiness[0].membership_locations || !readiness[0].sync_changes || !readiness[0].auth_rate_limits) return json(res, 503, { error: 'server_not_ready' });
    const email = cleanEmail(req.body?.email);
    const password = cleanPassword(req.body?.password);
    const ipHint = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || 'unknown';
    const rateKey = hashToken(`register:${ipHint}`);
    const rateRows = await db()`select failures,window_started_at,blocked_until from auth_rate_limits where key_hash=${rateKey} limit 1`;
    const rate = rateRows[0] as any;
    const nowMs = Date.now();
    if (rate?.blocked_until && new Date(String(rate.blocked_until)).getTime() > nowMs) {
      res.setHeader('Retry-After',String(Math.max(1,Math.ceil((new Date(String(rate.blocked_until)).getTime()-nowMs)/1000))));
      return json(res,429,{error:'too_many_attempts'});
    }
    const windowStart = rate?.window_started_at ? new Date(String(rate.window_started_at)).getTime() : 0;
    const failures = windowStart && windowStart + 60*60_000 > nowMs ? Number(rate?.failures ?? 0) + 1 : 1;
    if (failures >= 5) {
      await db()`insert into auth_rate_limits (key_hash,window_started_at,failures,blocked_until,updated_at) values (${rateKey},now(),${failures},now()+interval '1 hour',now()) on conflict (key_hash) do update set window_started_at=now(),failures=${failures},blocked_until=now()+interval '1 hour',updated_at=now()`;
      res.setHeader('Retry-After','3600');
      return json(res,429,{error:'too_many_attempts'});
    }
    await db()`insert into auth_rate_limits (key_hash,window_started_at,failures,blocked_until,updated_at) values (${rateKey},now(),${failures},null,now()) on conflict (key_hash) do update set failures=${failures},updated_at=now()`;
    const displayName = cleanText(req.body?.displayName, 100);
    const organizationName = cleanText(req.body?.organizationName, 120);
    const industry = cleanText(req.body?.industry ?? 'Retail / General', 80);
    const locationName = cleanText(req.body?.locationName, 100);
    const passwordHash = await hashPassword(password);
    const userId = crypto.randomUUID(); const orgId = crypto.randomUUID(); const locationId = crypto.randomUUID(); const membershipId = crypto.randomUUID(); const token = newToken();
    const pool = transactionPool();
    try {
      await pool.query('BEGIN');
      await pool.query('insert into app_users (id,email,display_name,email_verified_at) values ($1,$2,$3,null)', [userId, email, displayName]);
      await pool.query('insert into user_credentials (user_id,password_hash) values ($1,$2)', [userId, passwordHash]);
      await pool.query("insert into organizations (id,name,base_currency,industry) values ($1,$2,'NGN',$3)", [orgId, organizationName, industry]);
      await pool.query("insert into locations (id,organization_id,name,type,code) values ($1,$2,$3,'branch','MAIN')", [locationId, orgId, locationName]);
      await pool.query("insert into memberships (id,organization_id,user_id,role,active) values ($1,$2,$3,'business_owner',true)", [membershipId, orgId, userId]);
      await pool.query("insert into membership_locations (membership_id,location_id,active) values ($1,$2,true)", [membershipId, locationId]);
      await pool.query("insert into sync_changes (organization_id,entity_type,entity_id,changed_at) values ($1,'location',$2,now())", [orgId, locationId]);
      await pool.query("insert into user_sessions (user_id,token_hash,expires_at,ip_hint,user_agent) values ($1,$2,now()+interval '30 days',$3,$4)", [userId, hashToken(token), req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? null, req.headers['user-agent'] ?? null]);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await pool.end();
    }
    await db()\`delete from auth_rate_limits where key_hash=\${rateKey}\`;\n    setSessionCookie(res, token, 60 * 60 * 24 * 30, isHttps(req));
    return json(res, 201, { user: { id: userId, email, displayName }, organization: { id: orgId, name: organizationName, industry }, location: { id: locationId, name: locationName } });
  } catch (error: any) {
    const msg = String(error?.message ?? error); if (msg.includes('app_users_email_key')) return json(res,409,{error:'email_in_use'}); if (msg.includes('server_not_ready')) return json(res,503,{error:'server_not_ready'}); return json(res,400,{error:'invalid_registration'});
  }
}
