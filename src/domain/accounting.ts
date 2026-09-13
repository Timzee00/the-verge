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
