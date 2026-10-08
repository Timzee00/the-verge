import type { EntitlementCode, EntitlementGrant, PlanCode } from '../core/types.js';
import { PLAN_CATALOG } from './plans.js';
export const PLAN_ENTITLEMENTS:Record<PlanCode,EntitlementCode[]>=Object.fromEntries(Object.entries(PLAN_CATALOG).map(([code,plan])=>[code,plan.entitlements])) as Record<PlanCode,EntitlementCode[]>;
export function hasEntitlement(code:EntitlementCode,now:Date,grants:EntitlementGrant[]){return grants.some(g=>g.code===code&&g.active&&new Date(g.startsAt).getTime()<=now.getTime()&&(!g.expiresAt||new Date(g.expiresAt).getTime()>now.getTime()));}
