import { localDB } from '../db/local';
import type { AccountExportEnvelope } from '../domain/export';
export type ExportSection='products'|'inventoryEvents'|'personalAccounts'|'personalTransactions'|'budgets'|'savingsGoals'|'debts'|'entitlements'|'memberships'|'ledgerAccounts'|'journalEntries'|'journalLines'|'subscriptions'|'consents';
export const EXPORT_SECTIONS:ExportSection[]=['products','inventoryEvents','personalAccounts','personalTransactions','budgets','savingsGoals','debts','entitlements','memberships','ledgerAccounts','journalEntries','journalLines','subscriptions','consents'];
export async function exportAccount(sections:ExportSection[]):Promise<Blob>{
 const data:Record<string,unknown>={};
 for(const section of sections) data[section]=await (localDB as any)[section].toArray();
 const envelope:AccountExportEnvelope={format:'the-verge-account',version:2,exportedAt:new Date().toISOString(),sections,data};
 return new Blob([JSON.stringify(envelope,null,2)],{type:'application/json'});
}
