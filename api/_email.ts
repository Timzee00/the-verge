const ENDPOINT='https://api.resend.com/emails';

function baseUrl(){
  return String(process.env.APP_BASE_URL??'').trim().replace(/\/$/,'');
}
export function emailDeliveryConfigured(){
  return Boolean(process.env.RESEND_API_KEY&&process.env.AUTH_EMAIL_FROM&&baseUrl());
}
function escapeHtml(value:string){
  return value.replace(/[&<>"']/g,ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]??ch));
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
