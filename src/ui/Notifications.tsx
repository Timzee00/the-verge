import { useEffect,useState } from 'react';
import { api } from '../api';

const LABELS:Record<string,{title:string;detail:string}>={
 'owner.daily_summary':{title:'Daily owner summary',detail:'A concise email with sales, stock and attention items.'},
 'owner.weekly_summary':{title:'Weekly business review',detail:'A weekly operating summary for owners and managers.'},
 'inventory.low_stock':{title:'Low-stock alerts',detail:'Email when important products need reordering.'},
 'inventory.expiry':{title:'Expiry alerts',detail:'Near-expiry and expiry-risk notices for applicable inventory.'},
 'security.account':{title:'Security alerts',detail:'Important account and security notices.'}
};

export function NotificationSettings({organizationId}:{organizationId:string}){
 const [prefs,setPrefs]=useState<Array<{eventCode:string;enabled:boolean;digest:string}>>([]),[message,setMessage]=useState(''),[busy,setBusy]=useState('');
 useEffect(()=>{if(!organizationId)return;void api.notifications.get(organizationId).then(r=>setPrefs(r.preferences)).catch(e=>setMessage(String(e).replace(/^Error:\s*/,'')))},[organizationId]);
 async function toggle(pref:{eventCode:string;enabled:boolean;digest:string},enabled:boolean){
  setBusy(pref.eventCode);setMessage('');try{await api.notifications.save(organizationId,pref.eventCode,enabled,pref.digest);setPrefs(current=>current.map(p=>p.eventCode===pref.eventCode?{...p,enabled}:p));setMessage('Email preference saved.');}catch(e){setMessage(String(e).replace(/^Error:\s*/,''))}finally{setBusy('')}
 }
 async function digest(pref:{eventCode:string;enabled:boolean;digest:string},value:string){
  setBusy(pref.eventCode);setMessage('');try{await api.notifications.save(organizationId,pref.eventCode,pref.enabled,value);setPrefs(current=>current.map(p=>p.eventCode===pref.eventCode?{...p,digest:value}:p));setMessage('Email frequency saved.');}catch(e){setMessage(String(e).replace(/^Error:\s*/,''))}finally{setBusy('')}
 }
 return <section className="panel"><span className="eyebrow">EMAIL NOTIFICATIONS</span><h2>Choose what THE VERGE should send you.</h2><p className="muted">Operational email is separate from customer marketing. Marketing mail will require customer opt-in before it can be sent.</p>{message&&<p className="muted">{message}</p>}<div className="notification-list">{prefs.map(pref=>{const meta=LABELS[pref.eventCode]??{title:pref.eventCode,detail:''};return <div className="notification-row" key={pref.eventCode}><div><strong>{meta.title}</strong><span>{meta.detail}</span></div><div className="row-actions"><label className="switch-label"><input type="checkbox" checked={pref.enabled} disabled={busy===pref.eventCode} onChange={e=>void toggle(pref,e.target.checked)}/>Enabled</label><select aria-label={meta.title+' frequency'} value={pref.digest} disabled={busy===pref.eventCode||!pref.enabled} onChange={e=>void digest(pref,e.target.value)}><option value="instant">Instant</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="off">Off</option></select></div></div>})}</div></section>;
}
