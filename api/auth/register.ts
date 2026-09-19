import type { VercelRequest, VercelResponse } from '@vercel/node';
import { transactionPool } from '../_db';
import { cleanEmail, cleanText, cleanPassword, isHttps, json, method, newToken, hashToken, setSessionCookie } from '../_http';
import { hashPassword } from '../_password';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ['POST'])) return;
  try {
    const email = cleanEmail(req.body?.email);
    const password = cleanPassword(req.body?.password);
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
      await pool.query("insert into user_sessions (user_id,token_hash,expires_at,ip_hint,user_agent) values ($1,$2,now()+interval '30 days',$3,$4)", [userId, hashToken(token), req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? null, req.headers['user-agent'] ?? null]);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      await pool.end();
    }
    setSessionCookie(res, token, 60 * 60 * 24 * 30, isHttps(req));
    return json(res, 201, { user: { id: userId, email, displayName }, organization: { id: orgId, name: organizationName, industry }, location: { id: locationId, name: locationName } });
  } catch (error: any) {
    const msg = String(error?.message ?? error); if (msg.includes('app_users_email_key')) return json(res,409,{error:'email_in_use'}); return json(res,400,{error:'invalid_registration'});
  }
}
