import type { VercelRequest, VercelResponse } from '@vercel/node';
import { transactionPool } from '../_db.js';
import { cleanPassword, hashToken, json, method } from '../_http.js';
import { hashPassword } from '../_password.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ['POST'])) return;
  const token = String(req.body?.token ?? '');
  let password = '';
  try { password = cleanPassword(req.body?.password); }
  catch (error: any) { return json(res, 400, { error: String(error?.message ?? 'invalid_password') }); }
  if (token.length < 32 || token.length > 256) return json(res, 400, { error: 'invalid_or_expired_token' });

  const passwordHash = await hashPassword(password);
  const pool = transactionPool();
  try {
    await pool.query('BEGIN');
    const result = await pool.query(
      'select id,user_id from password_reset_tokens where token_hash=$1 and used_at is null and expires_at > now() for update',
      [hashToken(token)]
    );
    if (!result.rowCount) {
      await pool.query('ROLLBACK');
      return json(res, 400, { error: 'invalid_or_expired_token' });
    }
    const reset = result.rows[0];
    await pool.query('update user_credentials set password_hash=$1, updated_at=now() where user_id=$2', [passwordHash, reset.user_id]);
    await pool.query('update password_reset_tokens set used_at=now() where user_id=$1 and used_at is null', [reset.user_id]);
    await pool.query('update user_sessions set revoked_at=now() where user_id=$1 and revoked_at is null', [reset.user_id]);
    await pool.query('COMMIT');
    return json(res, 200, { ok: true, message: 'Password updated. Sign in with your new password.' });
  } catch (error: any) {
    await pool.query('ROLLBACK').catch(() => undefined);
    console.error('[auth.reset-password] request failed', { name: error?.name, code: error?.code });
    return json(res, 500, { error: 'password_reset_failed' });
  } finally {
    await pool.end();
  }
}
