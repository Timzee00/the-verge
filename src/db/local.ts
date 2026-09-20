import Dexie, { type Table } from 'dexie';
import type { Budget, Debt, EntitlementGrant, InventoryEvent, JournalEntry, JournalLine, LedgerAccount, PersonalAccount, PersonalTransaction, Product, SavingsGoal, SyncOperation, Membership, Subscription, ConsentRecord, Customer, Supplier, Sale, SaleItem, Expense } from '../core/types';
export interface LocalMeta { key:string; value:string; }
export class FinanceOSDB extends Dexie {
  organizations!: Table<import('../core/types').Organization,string>; locations!: Table<import('../core/types').Location,string>; products!: Table<Product,string>; inventoryEvents!: Table<InventoryEvent,string>; syncOperations!: Table<SyncOperation,string>; customers!: Table<Customer,string>; suppliers!: Table<Supplier,string>; sales!: Table<Sale,string>; saleItems!: Table<SaleItem,string>; expenses!: Table<Expense,string>;
  personalAccounts!: Table<PersonalAccount,string>; personalTransactions!: Table<PersonalTransaction,string>; budgets!: Table<Budget,string>; savingsGoals!: Table<SavingsGoal,string>; debts!: Table<Debt,string>;
  entitlements!: Table<EntitlementGrant,string>; memberships!: Table<Membership,string>; ledgerAccounts!: Table<LedgerAccount,string>; journalEntries!: Table<JournalEntry,string>; journalLines!: Table<JournalLine,string>;
  subscriptions!: Table<Subscription,string>; consents!: Table<ConsentRecord,string>; meta!: Table<LocalMeta,string>;
  constructor(){
    super('the-verge-local');
    this.version(7).stores({
      organizations:'id, name, active', locations:'id, organizationId, name, type, parentId, active', products:'id, organizationId, sku, barcode, category, active, updatedAt', customers:'id, organizationId, name, phone, active', suppliers:'id, organizationId, name, phone, active', sales:'id, organizationId, locationId, customerId, occurredAt, status, syncState, [organizationId+occurredAt]', saleItems:'id, saleId, productId', expenses:'id, organizationId, locationId, category, occurredAt, syncState',
      inventoryEvents:'id, organizationId, locationId, productId, type, occurredAt, syncState, [locationId+productId], localSequence',
      syncOperations:'id, organizationId, deviceId, entity, entityId, state, createdAt, nextAttemptAt',
      personalAccounts:'id, userId, type, active', personalTransactions:'id, userId, accountId, type, category, occurredAt, syncState',
      budgets:'id, userId, category, period, active', savingsGoals:'id, userId, active, deadline', debts:'id, userId, direction, dueDate, active',
      entitlements:'id, subjectId, code, active, startsAt, expiresAt', memberships:'id, organizationId, userId, role, active',
      ledgerAccounts:'id, organizationId, code, class, active', journalEntries:'id, organizationId, occurredAt, sourceType, status, syncState', journalLines:'id, journalEntryId, accountId',
      subscriptions:'id, organizationId, userId, plan, status, currentPeriodEnd', consents:'id, userId, version, decidedAt', meta:'key'
    });
  }
}
export const localDB=new FinanceOSDB();
