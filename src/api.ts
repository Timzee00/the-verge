import type { InventoryEvent, Location, Product } from './core/types';

async function request<T>(path:string, init:RequestInit={}):Promise<T>{
  const res=await fetch(path,{...init,credentials:'include',headers:{'Content-Type':'application/json',...(init.headers??{})}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error??`Request failed (${res.status})`);
  return data as T;
}

export type SessionOrg={id:string;name:string;base_currency:string;industry?:string;role:string};
export type SessionPayload={user:{id:string;email:string;displayName?:string};organizations:SessionOrg[];locations:Location[]};
export const api={
  me:()=>request<SessionPayload>('/api/auth/me'),
  login:(body:{email:string;password:string})=>request<{user:{id:string;email:string;displayName?:string}}>('/api/auth/login',{method:'POST',body:JSON.stringify(body)}),
  register:(body:{email:string;password:string;displayName:string;organizationName:string;industry:string;locationName:string})=>request<{user:{id:string;email:string;displayName:string};organization:{id:string;name:string;industry:string};location:{id:string;name:string}}>('/api/auth/register',{method:'POST',body:JSON.stringify(body)}),
  logout:()=>request<{ok:boolean}>('/api/auth/logout',{method:'POST'}),
  push:(organizationId:string,operations:unknown[])=>request<{results:Array<{id:string;ok:boolean;conflict?:boolean;error?:string;rejected?:boolean;deduplicated?:boolean}>}>('/api/sync/push',{method:'POST',body:JSON.stringify({organizationId,operations})}),
  pull:(organizationId:string,since:string)=>request<{products:Product[];locations:Location[];inventoryEvents:InventoryEvent[];sales:any[];serverTime:string}>(`/api/sync/pull?organizationId=${encodeURIComponent(organizationId)}&since=${encodeURIComponent(since)}`)
};
