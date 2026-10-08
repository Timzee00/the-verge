import { useEffect,useState } from 'react';
import { api } from '../api';

function label(status?:string){
 const raw=String(status||'queued');
 const map:Record<string,string>={sent:'Sent',delivered:'Delivered',opened:'Opened',clicked:'Clicked',soft_bounce:'Soft bounce',hard_bounce:'Hard bounce',blocked:'Blocked',invalid:'Invalid email',deferred:'Deferred',spam:'Spam complaint',unsubscribed:'Unsubscribed',error:'Error',queued:'Queued',sending:'Sending',failed:'Failed'};
 return map[raw]??raw.replace(/_/g,' ');
}

export function CommunicationsCenter({organizationId}:{organizationId:string}){
 const [messages,setMessages]=useState<any[]>([]),[message,setMessage]=useState('');
 async function load(){if(!organizationId)return;try{setMessages((await api.communications.history(organizationId)).messages)}catch(e){setMessage(String(e).replace(/^Error:\s*/,''))}}
 useEffect(()=>{void load()},[organizationId]);
 return <><div className="page-head"><div><span className="eyebrow">COMMUNICATIONS</span><h1>See what was sent and what happened next.</h1><p>Transactional email status comes directly from Brevo webhooks, so you can see delivery, opens, clicks, bounces and unsubscribes without leaving THE VERGE.</p></div><button className="secondary" onClick={()=>void load()}>Refresh</button></div>{message&&<section className="panel"><strong>{message}</strong></section>}<section className="panel"><h2>Email activity</h2>{messages.length?messages.map(item=><div className="list-row" key={item.id}><div><strong>{item.customerName||item.recipient}</strong><span>{item.subject||item.templateCode} · {item.messageKind} · {item.sentAt?new Date(item.sentAt).toLocaleString('en-NG'):'Not sent yet'}</span></div><span className="chip">{label(item.deliveryStatus||item.status)}</span></div>):<div className="empty">No business email has been sent yet.</div>}</section></>;
}
