export type ID = string;
export type ISODate = string;
export type CurrencyCode = string;
export type SyncState = 'pending' | 'synced' | 'conflict' | 'rejected';

export interface Organization { id: ID; name: string; baseCurrency: CurrencyCode; createdAt: ISODate; active: boolean; }
export type LocationType = 'region'|'branch'|'warehouse';
export interface Location { id: ID; organizationId: ID; name: string; type: LocationType; parentId?: ID; active: boolean; }

export interface Product {
  id: ID; organizationId: ID; sku: string; barcode?: string; name: string; brand?: string; category?: string;
  unit: string; weightValue?: number; weightUnit?: string; imageUri?: string;
  standardCostMinor: number; retailPriceMinor: number; wholesalePriceMinor?: number; minimumPriceMinor?: number;
  reorderLevel?: number; active: boolean; trackBatch: boolean; trackExpiry: boolean; createdAt: ISODate; updatedAt: ISODate;
}

export type InventoryEventType = 'opening'|'purchase'|'sale'|'sale_void'|'return'|'damage'|'adjustment'|'transfer_out'|'transfer_in'|'reservation'|'reservation_release';
export interface InventoryEvent {
  id: ID; organizationId: ID; locationId: ID; productId: ID; type: InventoryEventType;
  quantityDelta: number; unitCostMinor?: number; referenceId?: ID; occurredAt: ISODate; deviceId: ID; localSequence: number; syncState: SyncState; createdAt: ISODate;
}
export interface StockReceipt { id: ID; organizationId: ID; locationId: ID; productId: ID; supplierId?: ID; quantity: number; unitCostMinor: number; batchNumber?: string; expiryDate?: ISODate; receivedAt: ISODate; deviceId: ID; }

export interface Customer { id: ID; organizationId: ID; name: string; phone?: string; email?: string; creditLimitMinor?: number; active: boolean; createdAt: ISODate; updatedAt: ISODate; }
export interface Supplier { id: ID; organizationId: ID; name: string; phone?: string; email?: string; active: boolean; createdAt: ISODate; updatedAt: ISODate; }
export interface Sale {
  id: ID; organizationId: ID; locationId: ID; customerId?: ID; subtotalMinor: number; discountMinor: number; totalMinor: number;
  paymentMethod: 'cash'|'bank'|'transfer'|'card'|'credit'; status: 'completed'|'voided'; belowCost: boolean; discountReason?: string;
  occurredAt: ISODate; deviceId: ID; localSequence: number; syncState: SyncState; createdAt: ISODate;
}
export interface SaleItem { id: ID; saleId: ID; productId: ID; quantity: number; unitPriceMinor: number; unitCostMinor: number; discountMinor: number; }
export interface Expense { id: ID; organizationId: ID; locationId?: ID; amountMinor: number; category: string; description: string; paymentMethod: 'cash'|'bank'|'transfer'|'card'; occurredAt: ISODate; deviceId: ID; syncState: SyncState; createdAt: ISODate; }

export type SyncEntity = 'inventory_event'|'sale'|'purchase'|'customer'|'expense'|'transfer'|'product'|'personal_transaction'|'payment'|'journal_entry';
export interface SyncOperation { id: ID; organizationId?: ID; deviceId: ID; entity: SyncEntity; entityId: ID; operation: 'create'|'void'; payload: unknown; createdAt: ISODate; attempts: number; state: SyncState; lastError?: string; nextAttemptAt?: ISODate; }

export type PersonalTransactionType = 'income'|'expense'|'transfer';
export interface PersonalAccount { id: ID; name: string; type: 'cash'|'bank'|'savings'|'other'; openingBalanceMinor: number; active: boolean; currency: CurrencyCode; }
export interface PersonalTransaction { id: ID; accountId: ID; type: PersonalTransactionType; amountMinor: number; category?: string; description: string; occurredAt: ISODate; createdAt: ISODate; syncState: SyncState; }
export interface Budget { id: ID; category: string; period: 'weekly'|'monthly'; limitMinor: number; active: boolean; }
export interface SavingsGoal { id: ID; name: string; targetMinor: number; currentMinor: number; deadline?: ISODate; active: boolean; }
export interface Debt { id: ID; direction: 'owed_to_me'|'i_owe'; name: string; principalMinor: number; paidMinor: number; dueDate?: ISODate; active: boolean; }

export type PlanCode = 'free'|'business'|'pro'|'enterprise';
export type EntitlementCode = 'personal.finance'|'business.core'|'inventory.basic'|'inventory.advanced'|'pos'|'multi_location'|'advanced_accounting'|'api.read'|'api.write'|'webhooks'|'whatsapp'|'ai.basic'|'ai.business_insights'|'industry.modules';
export interface EntitlementGrant { id: ID; subjectId: ID; code: EntitlementCode; source: 'plan'|'promotion'|'manual'|'system'; startsAt: ISODate; expiresAt?: ISODate; active: boolean; reason?: string; }

export type RoleCode = 'platform_owner'|'platform_admin'|'support'|'billing_admin'|'security_admin'|'business_owner'|'manager'|'cashier'|'inventory_staff'|'accountant'|'staff';
export type Permission = 'business.read'|'business.write'|'inventory.read'|'inventory.write'|'sales.write'|'sales.void'|'finance.read'|'finance.write'|'staff.manage'|'api.manage'|'billing.manage'|'security.manage';
export interface AccountProfile { id: ID; email: string; status: 'active'|'restricted'|'suspended'|'pending_deletion'|'deleted'; emailVerified: boolean; phoneVerified: boolean; createdAt: ISODate; }
export interface Membership { id: ID; organizationId: ID; userId: ID; role: RoleCode; active: boolean; }

export type AccountClass = 'asset'|'liability'|'equity'|'revenue'|'expense';
export interface LedgerAccount { id: ID; organizationId: ID; code: string; name: string; class: AccountClass; normalBalance: 'debit'|'credit'; active: boolean; }
export interface JournalEntry { id: ID; organizationId: ID; reference: string; description: string; occurredAt: ISODate; sourceType: 'sale'|'purchase'|'expense'|'transfer'|'opening'|'adjustment'|'other'; sourceId?: ID; status: 'posted'|'voided'; createdAt: ISODate; createdBy?: ID; syncState: SyncState; }
export interface JournalLine { id: ID; journalEntryId: ID; accountId: ID; debitMinor: number; creditMinor: number; memo?: string; }

export interface Subscription { id: ID; organizationId?: ID; userId?: ID; plan: PlanCode; status: 'trialing'|'active'|'past_due'|'canceled'|'expired'; currentPeriodEnd?: ISODate; createdAt: ISODate; }
export interface ConsentRecord { id: ID; userId?: ID; version: string; necessary: true; analytics: boolean; personalization: boolean; marketing: boolean; decidedAt: ISODate; source: 'banner'|'settings'|'account'; }
