import type { AccountClass, JournalLine, LedgerAccount } from '../core/types.js';

export function assertBalanced(lines: Pick<JournalLine, 'debitMinor'|'creditMinor'>[]): void {
  if (lines.length < 2) throw new Error('A journal entry must contain at least two lines');
  let debit = 0; let credit = 0;
  for (const line of lines) {
    if (!Number.isSafeInteger(line.debitMinor) || !Number.isSafeInteger(line.creditMinor) || line.debitMinor < 0 || line.creditMinor < 0) {
      throw new Error('Journal amounts must be non-negative safe integers');
    }
    if ((line.debitMinor > 0) === (line.creditMinor > 0)) throw new Error('Each journal line must have either a debit or a credit');
    debit += line.debitMinor; credit += line.creditMinor;
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) throw new Error('Journal amount overflow');
  }
  if (debit !== credit) throw new Error(`Unbalanced journal: debits=${debit}, credits=${credit}`);
}

export const DEFAULT_CHART: Array<Pick<LedgerAccount,'code'|'name'|'class'|'normalBalance'>> = [
  { code:'1000', name:'Cash', class:'asset', normalBalance:'debit' },
  { code:'1010', name:'Bank', class:'asset', normalBalance:'debit' },
  { code:'1100', name:'Accounts Receivable', class:'asset', normalBalance:'debit' },
  { code:'1200', name:'Inventory', class:'asset', normalBalance:'debit' },
  { code:'1210', name:'Inventory in Transit', class:'asset', normalBalance:'debit' },
  { code:'2000', name:'Accounts Payable', class:'liability', normalBalance:'credit' },
  { code:'3000', name:'Owner Equity', class:'equity', normalBalance:'credit' },
  { code:'4000', name:'Sales Revenue', class:'revenue', normalBalance:'credit' },
  { code:'5000', name:'Cost of Goods Sold', class:'expense', normalBalance:'debit' },
  { code:'6000', name:'Operating Expenses', class:'expense', normalBalance:'debit' },
];

export function accountNetEffect(account: Pick<LedgerAccount,'normalBalance'>, debitMinor:number, creditMinor:number): number {
  return account.normalBalance === 'debit' ? debitMinor - creditMinor : creditMinor - debitMinor;
}

export function accountClassLabel(value: AccountClass): string { return value.charAt(0).toUpperCase() + value.slice(1); }

export interface ExpensePostingInput {
  expenseAccountId: string;
  paymentAccountId: string;
  amountMinor: number;
}

/** Canonical double-entry effect of an operating expense. */
export function buildExpenseJournalLines(input: ExpensePostingInput): Array<Omit<JournalLine, 'id' | 'journalEntryId'>> {
  if (!input.expenseAccountId || !input.paymentAccountId || input.expenseAccountId === input.paymentAccountId) {
    throw new Error('Expense posting requires two different ledger accounts');
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Expense amount must be a positive safe integer');
  }
  const lines = [
    { accountId: input.expenseAccountId, debitMinor: input.amountMinor, creditMinor: 0 },
    { accountId: input.paymentAccountId, debitMinor: 0, creditMinor: input.amountMinor },
  ];
  assertBalanced(lines);
  return lines;
}

export interface SupplierPaymentPostingInput {
  payableAccountId: string;
  paymentAccountId: string;
  amountMinor: number;
}

/** Supplier settlement reduces accounts payable and the selected cash/bank asset. */
export function buildSupplierPaymentJournalLines(input: SupplierPaymentPostingInput): Array<Omit<JournalLine, 'id' | 'journalEntryId'>> {
  if (!input.payableAccountId || !input.paymentAccountId || input.payableAccountId === input.paymentAccountId) {
    throw new Error('Supplier payment requires payable and payment accounts');
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Supplier payment amount must be a positive safe integer');
  }
  const lines = [
    { accountId: input.payableAccountId, debitMinor: input.amountMinor, creditMinor: 0 },
    { accountId: input.paymentAccountId, debitMinor: 0, creditMinor: input.amountMinor },
  ];
  assertBalanced(lines);
  return lines;
}

export interface PurchasePostingInput {
  inventoryAccountId: string;
  payableAccountId: string;
  totalCostMinor: number;
}

/** A supplier receipt increases inventory and the amount owed to the supplier. */
export function buildPurchaseJournalLines(input: PurchasePostingInput): Array<Omit<JournalLine, 'id' | 'journalEntryId'>> {
  if (!input.inventoryAccountId || !input.payableAccountId || input.inventoryAccountId === input.payableAccountId) {
    throw new Error('Purchase posting requires inventory and payable accounts');
  }
  if (!Number.isSafeInteger(input.totalCostMinor) || input.totalCostMinor <= 0) {
    throw new Error('Purchase amount must be a positive safe integer');
  }
  const lines = [
    { accountId: input.inventoryAccountId, debitMinor: input.totalCostMinor, creditMinor: 0 },
    { accountId: input.payableAccountId, debitMinor: 0, creditMinor: input.totalCostMinor },
  ];
  assertBalanced(lines);
  return lines;
}

export interface OpeningInventoryPostingInput {
  inventoryAccountId: string;
  equityAccountId: string;
  amountMinor: number;
}

/** Initial stock is an asset introduced against opening owner equity. */
export function buildOpeningInventoryJournalLines(input: OpeningInventoryPostingInput): Array<Omit<JournalLine, 'id' | 'journalEntryId'>> {
  if (!input.inventoryAccountId || !input.equityAccountId || input.inventoryAccountId === input.equityAccountId) {
    throw new Error('Opening inventory requires inventory and equity accounts');
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error('Opening inventory value must be a positive safe integer');
  }
  const lines = [
    { accountId: input.inventoryAccountId, debitMinor: input.amountMinor, creditMinor: 0 },
    { accountId: input.equityAccountId, debitMinor: 0, creditMinor: input.amountMinor },
  ];
  assertBalanced(lines);
  return lines;
}

export interface TransferPostingInput {
  inventoryAccountId: string;
  inTransitAccountId: string;
  transferCostMinor: number;
  stage: 'dispatch'|'receive';
}

/** Move stock value through an in-transit asset without changing total inventory value. */
export function buildTransferJournalLines(input: TransferPostingInput): Array<Omit<JournalLine, 'id' | 'journalEntryId'>> {
  if (!input.inventoryAccountId || !input.inTransitAccountId || input.inventoryAccountId === input.inTransitAccountId) {
    throw new Error('Transfer posting requires distinct inventory and transit accounts');
  }
  if (!Number.isSafeInteger(input.transferCostMinor) || input.transferCostMinor <= 0) {
    throw new Error('Transfer value must be a positive safe integer');
  }
  const lines = input.stage === 'dispatch'
    ? [
        { accountId: input.inTransitAccountId, debitMinor: input.transferCostMinor, creditMinor: 0 },
        { accountId: input.inventoryAccountId, debitMinor: 0, creditMinor: input.transferCostMinor },
      ]
    : [
        { accountId: input.inventoryAccountId, debitMinor: input.transferCostMinor, creditMinor: 0 },
        { accountId: input.inTransitAccountId, debitMinor: 0, creditMinor: input.transferCostMinor },
      ];
  assertBalanced(lines);
  return lines;
}

export interface SalePostingInput {
  cashOrReceivableAccountId: string;
  revenueAccountId: string;
  inventoryAccountId: string;
  cogsAccountId: string;
  saleAmountMinor: number;
  costAmountMinor: number;
  creditSale: boolean;
}

/** Canonical double-entry effect of a product sale, including COGS. */
export function buildSaleJournalLines(input: SalePostingInput): Array<Omit<JournalLine, 'id' | 'journalEntryId'>> {
  if (!Number.isSafeInteger(input.saleAmountMinor) || input.saleAmountMinor <= 0) throw new Error('Sale amount must be a positive safe integer');
  if (!Number.isSafeInteger(input.costAmountMinor) || input.costAmountMinor < 0) throw new Error('Cost amount must be a non-negative safe integer');
  if (input.costAmountMinor > input.saleAmountMinor && !input.creditSale) {
    // A loss is allowed; this branch is intentionally not a rejection. Negative gross profit is valid business activity.
  }
  const lines = [
    { accountId: input.cashOrReceivableAccountId, debitMinor: input.saleAmountMinor, creditMinor: 0 },
    { accountId: input.revenueAccountId, debitMinor: 0, creditMinor: input.saleAmountMinor },
  ];
  if (input.costAmountMinor > 0) {
    lines.push(
      { accountId: input.cogsAccountId, debitMinor: input.costAmountMinor, creditMinor: 0 },
      { accountId: input.inventoryAccountId, debitMinor: 0, creditMinor: input.costAmountMinor },
    );
  }
  assertBalanced(lines);
  return lines;
}
