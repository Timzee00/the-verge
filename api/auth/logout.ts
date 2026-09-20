import type { VercelRequest,VercelResponse } from '@vercel/node';
import { db } from '../_db';
import { clearSessionCookie,hashToken,isHttps,json,method,parseCookies,requireSameOrigin } from '../_http';

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['POST']))return;
  if(!requireSameOrigin(req,res))return;
  const token=parseCookies(req).verge_session;
  if(token)await db()`update user_sessions set revoked_at=now() where token_hash=${hashToken(token)} and revoked_at is null`;
  clearSessionCookie(res,isHttps(req));
  return json(res,200,{ok:true});
}
