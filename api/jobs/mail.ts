import type { VercelRequest,VercelResponse } from '@vercel/node';
import { json,method } from '../_http';
import { processEmailQueue } from '../_mailQueue';

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!method(req,res,['POST']))return;
  const secret=String(process.env.MAIL_WORKER_SECRET??'').trim();
  const auth=String(req.headers.authorization??'');
  if(!secret||auth!==`Bearer ${secret}`)return json(res,401,{error:'worker_unauthorized'});
  try{return json(res,200,await processEmailQueue(50));}
  catch{return json(res,500,{error:'internal_error'});}
}
