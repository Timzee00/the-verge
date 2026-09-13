import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ service: 'the-verge', status: 'ok', timestamp: new Date().toISOString() });
}
