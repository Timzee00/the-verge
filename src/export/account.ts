import { localDB } from '../db/local';
import type { AccountExportEnvelope } from '../domain/export';
export type ExportSection='products'|'inventoryEvents'|'personalAccounts'|'personalTransactions'|'budgets'|'savingsGoals'|'debts'|'entitlements'|'memberships'|'ledgerAccounts'|'journalEntries'|'journalLines'|'subscriptions'|'consents';
export const EXPORT_SECTIONS:ExportSection[]=['products','inventoryEvents','personalAccounts','personalTransactions','budgets','savingsGoals','debts','entitlements','memberships','ledgerAccounts','journalEntries','journalLines','subscriptions','consents'];
const USER_SCOPED=new Set<ExportSection>(['personalAccounts','personalTransactions','budgets','savingsGoals','debts','consents']);

export async function exportAccount(sections:ExportSection[], userId?:string):Promise<Blob>{
 const data:Record<string,unknown>={};
 for(const section of sections){
   if(USER_SCOPED.has(section) && userId){
     const table:any=(localDB as any)[section];
     data[section]=await table.where('userId').equals(userId).toArray();
   } else if(USER_SCOPED.has(section)){
     data[section]=[];
   } else {
     data[section]=await (localDB as any)[section].toArray();
   }
 }
 const envelope:AccountExportEnvelope={format:'the-verge-account',version:3,exportedAt:new Date().toISOString(),sections,data};
 return new Blob([JSON.stringify(envelope,null,2)],{type:'application/json'});
}
