import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './_db.js';
import { json, method } from './_http.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!method(req, res, ['GET'])) return;

  try {
    const rows = await db()`select 1 as ok`;
    if (Number(rows[0]?.ok) !== 1) throw new Error('Database readiness query returned an unexpected result');

    return json(res, 200, {
      service: 'the-verge',
      status: 'ready',
      checks: { database: 'ok' },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[health.ready] database unavailable', {
      name: error?.name,
      code: error?.code,
    });
    return json(res, 503, {
      service: 'the-verge',
      status: 'not_ready',
      checks: { database: 'unavailable' },
      timestamp: new Date().toISOString(),
    });
  }
}
