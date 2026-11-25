import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { db } from '../_db.js';
import { cleanEmail, hashToken, json, method, newToken } from '../_http.js';

const generic = { message: 'If an account matches that email address, a password reset link will be sent shortly.' };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ['POST'])) return;
  let email = '';
  try { email = cleanEmail(req.body?.email); }
  catch { return json(res, 200, generic); }

  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || '0.0.0.0';
  const sql = db();
  try {
    if (!process.env.BREVO_API_KEY || !process.env.BREVO_SENDER_EMAIL || !process.env.APP_BASE_URL) {
      console.error('[auth.forgot-password] email delivery is not configured');
      return json(res, 503, { message: 'Password recovery is temporarily unavailable. Contact your workspace administrator.' });
    }

    const emailHash = digest(email);
    const ipHash = digest(ip);
    const limits = await sql`
      select
        (select count(*)::int from password_reset_requests where email_hash = ${emailHash} and created_at > now() - interval '15 minutes') as email_count,
        (select count(*)::int from password_reset_requests where ip_hash = ${ipHash} and created_at > now() - interval '15 minutes') as ip_count`;
    await sql`insert into password_reset_requests (email_hash, ip_hash) values (${emailHash}, ${ipHash})`;
    if (Number(limits[0]?.email_count ?? 0) >= 3 || Number(limits[0]?.ip_count ?? 0) >= 10) return json(res, 200, generic);

    const users = await sql`select id, email from app_users where email = ${email} and status = 'active' limit 1`;
    if (!users.length) return json(res, 200, generic);

    const token = newToken();
    await sql`update password_reset_tokens set used_at = now() where user_id = ${users[0].id} and used_at is null`;
    await sql`insert into password_reset_tokens (user_id, token_hash, expires_at, request_ip) values (${users[0].id}, ${hashToken(token)}, now() + interval '30 minutes', ${ip})`;
    const resetUrl = new URL('/?reset=' + encodeURIComponent(token), process.env.APP_BASE_URL).toString();
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        sender: { email: process.env.BREVO_SENDER_EMAIL, name: 'The Verge' },
        to: [{ email: users[0].email }],
        subject: 'Reset your The Verge password',
        textContent: 'Use this link to reset your password. It expires in 30 minutes and can only be used once: ' + resetUrl + '\n\nIf you did not request this, ignore this email.',
        htmlContent: '<p>A password reset was requested for your The Verge account.</p><p><a href="' + resetUrl + '">Reset your password</a></p><p>This link expires in 30 minutes and can only be used once. If you did not request this, ignore this email.</p>'
      })
    });
    if (!response.ok) {
      console.error('[auth.forgot-password] email provider rejected request', { status: response.status });
      return json(res, 503, { message: 'Password recovery is temporarily unavailable. Try again later.' });
    }
    return json(res, 200, generic);
  } catch (error: any) {
    console.error('[auth.forgot-password] request failed', { name: error?.name, code: error?.code });
    return json(res, 503, { message: 'Password recovery is temporarily unavailable. Try again later.' });
  }
}
