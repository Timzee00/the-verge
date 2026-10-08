import { useEffect,useState } from 'react';
import { api } from '../api';

export function BusinessAssistant({organizationId,locationId,businessName}:{organizationId:string;locationId:string;businessName:string}){
 const [info,setInfo]=useState<{tasks:string[];previewTasks:string[];configured:boolean;plan:string;used:number;limit:number;advanced:boolean}|null>(null);
 const [question,setQuestion]=useState(''),[answer,setAnswer]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[usage,setUsage]=useState<{used:number;limit:number;plan:string}|null>(null);
 useEffect(()=>{if(!organizationId)return;void api.ai.info(organizationId).then(setInfo).catch(e=>setError(String(e).replace(/^Error:\s*/,'')))},[organizationId]);
 async function ask(text=question){
  const q=text.trim();if(!q||busy)return;setBusy(true);setError('');setQuestion(q);
  try{const result=await api.ai.ask(organizationId,q,locationId||undefined);setAnswer(result.answer);setUsage(result.usage);}
  catch(e){setError(String(e).replace(/^Error:\s*/,''));}finally{setBusy(false)}
 }
 const currentUsed=usage?.used??info?.used??0,currentLimit=usage?.limit??info?.limit??0;const usageLabel=currentLimit>0?' · '+currentUsed+'/'+currentLimit+' AI requests used this month':'';
 return <><div className="page-head"><div><span className="eyebrow">THE VERGE AI</span><h1>Your business copilot, grounded in {businessName}.</h1><p>Ask about real sales, stock, expenses, branch performance and operational priorities. The copilot reads business data but cannot silently edit stock, prices, customers or accounting records.</p></div><span className={info?.configured?'status good':'status'}>{info?.configured?'AI ready':'AI setup needed'}</span></div>
 <div className="two-col"><section className="panel"><span className="eyebrow">GOOD TASKS</span><h2>Use AI for decisions, not decoration.</h2><div className="assistant-task-grid">{(info?.tasks??[]).map(task=><button className="assistant-task" key={task} disabled={busy} onClick={()=>void ask(task)}>{task}</button>)}</div>{info&&!info.advanced&&<div className="assistant-premium-preview"><strong>Pro intelligence also includes</strong>{(info.previewTasks??[]).filter(task=>!(info.tasks??[]).includes(task)).map(task=><span key={task}>{task}</span>)}</div>}<p className="muted">Current plan: <strong>{(usage?.plan??info?.plan??'free').toUpperCase()}</strong>{usageLabel}</p></section>
 <section className="panel"><span className="eyebrow">ASK THE COPILOT</span><h2>What do you need to know?</h2><textarea className="assistant-input" value={question} onChange={e=>setQuestion(e.target.value)} maxLength={800} rows={7} placeholder="Example: What should I reorder this week, and which branch needs attention?"/><div className="form-actions"><button className="primary" disabled={busy||!question.trim()||!info?.configured||!(info?.limit??0)} onClick={()=>void ask()}>{busy?'Analyzing business data…':'Analyze my business'}</button></div>{!info?.configured&&<p className="muted">Timzee Corp has not configured the AI provider for this deployment yet.</p>}{info&&info.limit===0&&<p className="muted">AI Copilot starts on the Starter plan. Upgrade in Plans & Billing to activate it.</p>}{error&&<p className="field-error">{error}</p>}</section></div>
 <section className="panel assistant-answer"><span className="eyebrow">COPILOT RESPONSE</span>{answer?<div className="assistant-response">{answer.split('\n').map((line,i)=><p key={i}>{line||' '}</p>)}</div>:<div className="empty">Your grounded business analysis will appear here. THE VERGE does not send customer phone numbers or private customer profiles to the AI for these business-insight tasks.</div>}</section>
 </>;
}
