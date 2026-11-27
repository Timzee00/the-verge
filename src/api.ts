import type { Customer, Expense, InventoryEvent, Location, Product, SaleItem } from './core/types';

async function request<T>(path:string, init:RequestInit={}):Promise<T>{
  const res=await fetch(path,{...init,credentials:'include',headers:{'Content-Type':'application/json',...(init.headers??{})}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.error??data?.message??`Request failed (${res.status})`);
  return data as T;
}

export type SessionOrg={id:string;name:string;base_currency:string;industry?:string;role:string};
export type StaffLocation={id:string;name:string;type:string};
export type StaffMember={userId:string;email:string;displayName?:string|null;role:string;active:boolean;joinedAt?:string;locationIds:string[];locationNames:string[]};
export type SessionPayload={user:{id:string;email:string;displayName?:string};organizations:SessionOrg[];locations:Location[]};
export const api={
  me:()=>request<SessionPayload>('/api/auth/me'),
  login:(body:{email:string;password:string})=>request<{user:{id:string;email:string;displayName?:string}}>('/api/auth/login',{method:'POST',body:JSON.stringify(body)}),
  register:(body:{email:string;password:string;displayName:string;organizationName:string;industry:string;locationName:string})=>request<{user:{id:string;email:string;displayName:string};organization:{id:string;name:string;industry:string};location:{id:string;name:string}}>('/api/auth/register',{method:'POST',body:JSON.stringify(body)}),
  logout:()=>request<{ok:boolean}>('/api/auth/logout',{method:'POST'}),
  forgotPassword:(body:{email:string})=>request<{message:string}>('/api/auth/forgot-password',{method:'POST',body:JSON.stringify(body)}),
  resetPassword:(body:{token:string;password:string})=>request<{ok:boolean;message:string}>('/api/auth/reset-password',{method:'POST',body:JSON.stringify(body)}),
  push:(organizationId:string,operations:unknown[])=>request<{results:Array<{id:string;ok:boolean;conflict?:boolean;error?:string;rejected?:boolean;deduplicated?:boolean}>}>('/api/sync/push',{method:'POST',body:JSON.stringify({organizationId,operations})}),
  pull:(organizationId:string,since:string,cursor?:string)=>request<{products:Product[];locations:Location[];inventoryEvents:InventoryEvent[];sales:any[];saleItems:SaleItem[];customers:Customer[];expenses:Expense[];serverTime:string;nextCursor:string;hasMore:boolean}>(`/api/sync/pull?organizationId=${encodeURIComponent(organizationId)}&since=${encodeURIComponent(since)}${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`),
  staffList:(organizationId:string)=>request<{staff:StaffMember[];locations:StaffLocation[]}>(`/api/staff?organizationId=${encodeURIComponent(organizationId)}`),
  addStaff:(body:{organizationId:string;email:string;role:string;locationIds:string[]})=>request<{staff:Partial<StaffMember>}>('/api/staff',{method:'POST',body:JSON.stringify(body)}),
  updateStaff:(body:{organizationId:string;userId:string;action:'deactivate'|'reactivate'|'change_role'|'assign_locations';role?:string;locationIds?:string[]})=>request<{staff:Partial<StaffMember>}>('/api/staff',{method:'PATCH',body:JSON.stringify(body)})
};
