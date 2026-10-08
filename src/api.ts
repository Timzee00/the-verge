import type { Customer, Expense, InventoryEvent, Location, Product, Sale, SaleItem } from './core/types';

function safeServerError(code:unknown,status:number){
  const value=String(code??'');
  const messages:Record<string,string>={
    unauthorized:'Your session has expired. Sign in again.',
    forbidden:'You do not have permission to perform that action.',
    location_forbidden:'This device is not authorized for that location.',
    insufficient_stock:'There is not enough stock available for that sale.',
    too_many_attempts:'Too many sign-in attempts. Please wait a few minutes and try again.',
    email_in_use:'That email is already registered. Sign in instead.',
    invalid_credentials:'The email or password is incorrect.',
    invalid_batch:'The sync batch could not be accepted.',
    invalid_operation:'One of the queued changes is invalid.',
    invalid_payload:'One of the queued changes is incomplete.',
    invalid_sale_payload:'The sale data could not be verified.',
    sale_total_mismatch:'The sale totals changed before the server accepted them. Please review the sale.',
    below_cost_reason_required:'A reason is required for a below-cost sale.',
    server_not_ready:'THE VERGE server setup is not complete yet.',
    api_unauthorized:'That API credential is invalid or no longer active.',
    api_scope_forbidden:'That API credential does not have the required scope.',
    invalid_key_name:'Give the API key a valid name.',
    invalid_scopes:'Choose valid API scopes.',
    invalid_expiry:'The API key expiry is invalid or too far in the future.',
    already_revoked:'That API key has already been revoked.',
    keyId_required:'Select an API key first.',
    origin_forbidden:'The request origin was not accepted.',
    not_found:'That resource was not found.',
    api_key_limit:'This workspace has reached its active API credential limit. Revoke an unused credential first.',
    invalid_location_code:'Use 2–20 letters, numbers, hyphens or underscores for the store code.',
    invalid_location_email:'Enter a valid store email address.',
    invalid_location_type:'Choose store/branch or warehouse.',
    duplicate_location_code:'That store code is already used in this business.',
    duplicate_location_name:'That store name is already used in this business.',
    location_limit:'This business has reached its current location limit.',
    invalid_setup_action:'That setup action is not available.',
    email_verification_required:'Verify your email before creating API credentials.',
    email_delivery_unavailable:'Verification email is not configured on this deployment yet.',
    email_delivery_failed:'THE VERGE could not send the verification email right now. Try again shortly.',
    invalid_verification_token:'That verification link is invalid or has expired.',
  };
  if(messages[value])return messages[value];
  if(status>=500||value==='internal_error') return 'The Verge could not complete that request right now. Please try again.';
  if(value.startsWith('invalid_'))return 'The submitted data could not be accepted. Check the entry and try again.';
  return status===404?'The requested Verge service was not found.':'The request could not be completed.';
}

async function request<T>(path:string, init:RequestInit={}):Promise<T>{
  const res=await fetch(path,{...init,credentials:'include',headers:{'Content-Type':'application/json',...(init.headers??{})}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(safeServerError(data?.error,res.status));
  return data as T;
}

export type SessionOrg={id:string;name:string;base_currency:string;industry?:string;role:string};
export type SessionPayload={user:{id:string;email:string;displayName?:string;emailVerified:boolean};organizations:SessionOrg[];locations:Location[]};
export const api={
  me:()=>request<SessionPayload>('/api/auth/me'),
  login:(body:{email:string;password:string})=>request<{user:{id:string;email:string;displayName?:string}}>('/api/auth/login',{method:'POST',body:JSON.stringify(body)}),
  register:(body:{email:string;password:string;displayName:string;organizationName:string;industry:string;locationName:string})=>request<{user:{id:string;email:string;displayName:string};organization:{id:string;name:string;industry:string};location:{id:string;name:string}}>('/api/auth/register',{method:'POST',body:JSON.stringify(body)}),
  requestPasswordReset:(body:{email:string})=>request<{ok:boolean;message:string}>('/api/auth/request-password-reset',{method:'POST',body:JSON.stringify(body)}),
  requestEmailVerification:()=>request<{ok:boolean;verified:boolean;message:string}>('/api/auth/request-email-verification',{method:'POST',body:'{}'}),
  logout:()=>request<{ok:boolean}>('/api/auth/logout',{method:'POST'}),
  push:(organizationId:string,operations:unknown[])=>request<{results:Array<{id:string;ok:boolean;conflict?:boolean;error?:string;rejected?:boolean;deduplicated?:boolean}>}>('/api/sync/push',{method:'POST',body:JSON.stringify({organizationId,operations})}),
  keys:{
    list:(organizationId:string)=>request<{keys:Array<{id:string;name:string;keyPrefix:string;scopes:string[];createdAt:string;expiresAt?:string|null;revokedAt?:string|null;lastUsedAt?:string|null}>}>(`/api/keys?organizationId=${encodeURIComponent(organizationId)}`),
    create:(organizationId:string,body:{name:string;scopes:string[];expiresAt?:string|null})=>request<{key:{id:string;name:string;keyPrefix:string;scopes:string[];expiresAt?:string|null;secret:string}}>(`/api/keys?organizationId=${encodeURIComponent(organizationId)}`,{method:'POST',body:JSON.stringify(body)}),
    revoke:(organizationId:string,keyId:string)=>request<{ok:boolean}>(`/api/keys?organizationId=${encodeURIComponent(organizationId)}&keyId=${encodeURIComponent(keyId)}`,{method:'DELETE'}),
  },
  business:{
    updateProfile:(organizationId:string,body:{name:string;industry:string})=>request<{organization:SessionOrg}>('/api/business/setup',{method:'POST',body:JSON.stringify({action:'update_business',organizationId,...body})}),
    updateLocation:(organizationId:string,body:{locationId:string;name:string;code:string;type:'branch'|'warehouse';address?:string;phone?:string;email?:string;receiptName?:string;receiptFooter?:string})=>request<{location:Location}>('/api/business/setup',{method:'POST',body:JSON.stringify({action:'update_location',organizationId,...body})}),
    createLocation:(organizationId:string,body:{name:string;code:string;type:'branch'|'warehouse';address?:string})=>request<{location:Location}>('/api/business/setup',{method:'POST',body:JSON.stringify({action:'create_location',organizationId,...body})})
  },
  pull:(organizationId:string,cursor='0',cutoff='')=>request<{products:Product[];locations:Location[];inventoryEvents:InventoryEvent[];sales:Sale[];saleItems:SaleItem[];customers:Customer[];expenses:Expense[];serverTime:string;cutoff:string;nextCursor:string;hasMore:boolean}>(`/api/sync/pull?organizationId=${encodeURIComponent(organizationId)}&cursor=${encodeURIComponent(cursor)}${cutoff?`&cutoff=${encodeURIComponent(cutoff)}`:''}`)
};
