import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from '../_db';
import { cleanEmail, cleanPassword, isHttps, json, method, newToken, hashToken, setSessionCookie } from '../_http';
import { verifyPassword } from '../_password';
export default async function handler(req: VercelRequest,res: VercelResponse){
 if(!method(req,res,['POST']))return;
 try{const email=cleanEmail(req.body?.email);const password=cleanPassword(req.body?.password);const sql=db();const rows=await sql`select u.id,u.email,u.display_name,u.status,c.password_hash from app_users u join user_credentials c on c.user_id=u.id where u.email=${email} limit 1`;const user=rows[0] as any;if(!user||user.status!=='active'||!(await verifyPassword(password,user.password_hash)))return json(res,401,{error:'invalid_credentials'});const token=newToken();await sql`insert into user_sessions (user_id,token_hash,expires_at,ip_hint,user_agent) values (${user.id},${hashToken(token)},now()+interval '30 days',${req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()??null},${req.headers['user-agent']??null})`;setSessionCookie(res,token,60*60*24*30,isHttps(req));return json(res,200,{user:{id:user.id,email:user.email,displayName:user.display_name}})}catch(error:any){return json(res,400,{error:String(error?.message??error)})}
}
