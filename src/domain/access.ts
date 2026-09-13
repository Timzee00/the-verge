import type { Permission, RoleCode } from '../core/types.js';

const ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  platform_owner: ['business.read','business.write','inventory.read','inventory.write','sales.write','sales.void','finance.read','finance.write','staff.manage','api.manage','billing.manage','security.manage'],
  platform_admin: ['business.read','business.write','inventory.read','inventory.write','sales.write','sales.void','finance.read','staff.manage','api.manage','billing.manage','security.manage'],
  support: ['business.read','inventory.read','finance.read'],
  billing_admin: ['business.read','finance.read','billing.manage'],
  security_admin: ['business.read','security.manage'],
  business_owner: ['business.read','business.write','inventory.read','inventory.write','sales.write','sales.void','finance.read','finance.write','staff.manage','api.manage'],
  manager: ['business.read','business.write','inventory.read','inventory.write','sales.write','sales.void','finance.read'],
  cashier: ['business.read','inventory.read','sales.write'],
  inventory_staff: ['business.read','inventory.read','inventory.write'],
  accountant: ['business.read','finance.read','finance.write'],
  staff: ['business.read'],
};

export function roleHasPermission(role: RoleCode, permission: Permission): boolean { return ROLE_PERMISSIONS[role]?.includes(permission) ?? false; }
export function permissionsForRole(role: RoleCode): Permission[] { return [...(ROLE_PERMISSIONS[role] ?? [])]; }
