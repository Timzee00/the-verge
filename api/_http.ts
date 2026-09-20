import { createHash, randomBytes } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_db';

export const json = (res: VercelResponse, status: number, body: unknown) => {
  res.status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .setHeader('Cache-Control', 'no-store')
    .setHeader('X-Content-Type-Options', 'nosniff')
    .setHeader('Referrer-Policy', 'same-origin')
    .json(body);
};

export function requireSameOrigin(req: VercelRequest, res: VercelResponse) {
  const origin = String(req.headers.origin ?? '').trim();
  if (!origin) return true;
  try {
    const expectedHost = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0].trim();
    const actual = new URL(origin);
    if (!expectedHost || actual.host !== expectedHost) {
      json(res, 403, { error: 'origin_forbidden' });
      return false;
    }
    return true;
  } catch {
    json(res, 403, { error: 'origin_forbidden' });
    return false;
  }
}

export const method = (req: VercelRequest, res: VercelResponse, allowed: string[]) => {
  if (!allowed.includes(req.method ?? '')) {
    res.setHeader('Allow', allowed.join(', '));
    json(res, 405, { error: 'method_not_allowed' });
    return false;
  }
  return true;
};

export const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function isHttps(req: VercelRequest) {
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  return forwarded === 'https' || process.env.VERCEL === '1';
}

export function parseCookies(req: VercelRequest) {
  const rawHeader = req.headers.cookie;
  const raw = Array.isArray(rawHeader) ? rawHeader.join(';') : (rawHeader ?? '');
  const result: Record<string, string> = {};
  for (const part of raw.split(';')) {
    if (!part.trim()) continue;
    const i = part.indexOf('=');
    const key = i >= 0 ? part.slice(0, i).trim() : part.trim();
    const value = i >= 0 ? part.slice(i + 1).trim() : '';
    try { result[key] = decodeURIComponent(value); } catch { result[key] = value; }
  }
  return result;
}

export function setSessionCookie(res: VercelResponse, token: string, maxAgeSeconds: number, secure: boolean) {
  res.setHeader('Set-Cookie', `verge_session=${encodeURIComponent(token)}; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=${maxAgeSeconds}`);
}

export function clearSessionCookie(res: VercelResponse, secure: boolean) {
  res.setHeader('Set-Cookie', `verge_session=; Path=/; HttpOnly;${secure ? ' Secure;' : ''} SameSite=Lax; Max-Age=0`);
}

export async function requireUser(req: VercelRequest, res: VercelResponse) {
  const token = parseCookies(req).verge_session;
  if (!token) { json(res, 401, { error: 'unauthorized' }); return null; }
  const sql = db();
  const rows = await sql`
    select u.id, u.email, u.display_name, u.status, u.email_verified_at,
           s.id as session_id
    from user_sessions s
    join app_users u on u.id = s.user_id
    where s.token_hash = ${hashToken(token)}
      and s.revoked_at is null
      and s.expires_at > now()
    limit 1`;
  const user = rows[0] as any;
  if (!user || user.status !== 'active') { json(res, 401, { error: 'unauthorized' }); return null; }
  await sql`update user_sessions set last_seen_at = now() where id = ${user.session_id}`;
  return user;
}

export function cleanEmail(value: unknown) {
  const email = String(value ?? '').trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email address');
  return email;
}

export function cleanPassword(value: unknown) {
  const password = String(value ?? '');
  if (password.length < 10) throw new Error('Password must be at least 10 characters');
  if (password.length > 200) throw new Error('Password is too long');
  return password;
}

export function cleanText(value: unknown, max: number) {
  const text = String(value ?? '').trim();
  if (!text || text.length > max) throw new Error('Invalid text value');
  return text;
}
