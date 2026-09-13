import type { EntitlementCode, EntitlementGrant, PlanCode } from '../core/types.js';
export const PLAN_ENTITLEMENTS:Record<PlanCode,EntitlementCode[]>={
 free:['personal.finance','business.core','inventory.basic'],
 business:['personal.finance','business.core','inventory.basic','inventory.advanced','pos','multi_location','api.read','whatsapp'],
 pro:['personal.finance','business.core','inventory.basic','inventory.advanced','pos','multi_location','advanced_accounting','api.read','api.write','webhooks','whatsapp','ai.basic','ai.business_insights','industry.modules'],
 enterprise:['personal.finance','business.core','inventory.basic','inventory.advanced','pos','multi_location','advanced_accounting','api.read','api.write','webhooks','whatsapp','ai.basic','ai.business_insights','industry.modules']};
export function hasEntitlement(code:EntitlementCode, now:Date, grants:EntitlementGrant[]){return grants.some(g=>g.code===code&&g.active&&new Date(g.startsAt).getTime()<=now.getTime()&&(!g.expiresAt||new Date(g.expiresAt).getTime()>now.getTime()));}
