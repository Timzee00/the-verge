const ENDPOINT='https://api.resend.com/emails';

function baseUrl(){
  return String(process.env.APP_BASE_URL??'').trim().replace(/\/$/,'');
}
export function emailDeliveryConfigured(){
  return Boolean(process.env.RESEND_API_KEY&&process.env.AUTH_EMAIL_FROM&&baseUrl());
}
function escapeHtml(value:string){
  const map:Record<string,string>={ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' };
  return value.replace(/[&<>"']/g,ch=>map[ch]??ch);
}
export async function sendPasswordResetEmail(to:string,token:string){
  const apiKey=String(process.env.RESEND_API_KEY??'').trim();
  const from=String(process.env.AUTH_EMAIL_FROM??'').trim();
  const origin=baseUrl();
  if(!apiKey||!from||!origin)return false;
  const resetUrl=`${origin}/reset-password.html?token=${encodeURIComponent(token)}`;
  const response=await fetch(ENDPOINT,{
    method:'POST',
    headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      from,
      to:[to],
      subject:'Reset your THE VERGE password',
      text:`A password reset was requested for your THE VERGE account. Open this link within 30 minutes: ${resetUrl}\n\nIf you did not request this, ignore this email.`,
      html:`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827"><h2>Reset your THE VERGE password</h2><p>A password reset was requested for your account.</p><p><a href="${escapeHtml(resetUrl)}">Reset password</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p><p style="color:#6b7280">THE VERGE — Powered by Timzee Corp</p></div>`
    })
  });
  if(!response.ok)throw new Error(`email_provider_${response.status}`);
  return true;
}


export async function sendEmailVerificationEmail(to:string,token:string){
  const apiKey=String(process.env.RESEND_API_KEY??'').trim();
  const from=String(process.env.AUTH_EMAIL_FROM??'').trim();
  const origin=baseUrl();
  if(!apiKey||!from||!origin)return false;
  const verifyUrl=`${origin}/verify-email.html?token=${encodeURIComponent(token)}`;
  const response=await fetch(ENDPOINT,{
    method:'POST',
    headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},
    body:JSON.stringify({
      from,
      to:[to],
      subject:'Verify your THE VERGE email',
      text:`Verify the email address for your THE VERGE account by opening this link within 24 hours: ${verifyUrl}\n\nIf you did not create this account, you can ignore this email.`,
      html:`<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827"><h2>Verify your THE VERGE email</h2><p>Confirm this email address to secure your account and unlock sensitive account actions.</p><p><a href="${escapeHtml(verifyUrl)}">Verify email</a></p><p>This link expires in 24 hours. If you did not create this account, you can ignore this email.</p><p style="color:#6b7280">THE VERGE — Powered by Timzee Corp</p></div>`
    })
  });
  if(!response.ok)throw new Error(`email_provider_${response.status}`);
  return true;
}
