type QueryClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

const ACCOUNT_SEEDS = [
  { code: '1000', name: 'Cash', accountClass: 'asset', normalBalance: 'debit' },
  { code: '1010', name: 'Bank', accountClass: 'asset', normalBalance: 'debit' },
  { code: '1100', name: 'Accounts Receivable', accountClass: 'asset', normalBalance: 'debit' },
  { code: '1200', name: 'Inventory', accountClass: 'asset', normalBalance: 'debit' },
  { code: '2000', name: 'Accounts Payable', accountClass: 'liability', normalBalance: 'credit' },
  { code: '3000', name: 'Owner Equity', accountClass: 'equity', normalBalance: 'credit' },
  { code: '4000', name: 'Sales Revenue', accountClass: 'revenue', normalBalance: 'credit' },
  { code: '5000', name: 'Cost of Goods Sold', accountClass: 'expense', normalBalance: 'debit' },
  { code: '6000', name: 'Operating Expenses', accountClass: 'expense', normalBalance: 'debit' },
] as const;

type JournalLineInput = { accountId: string; debitMinor: number; creditMinor: number; memo?: string };

function assertJournal(lines: JournalLineInput[]) {
  if (!Array.isArray(lines) || lines.length < 2) throw new Error('journal_requires_two_lines');
  let debit = 0;
  let credit = 0;
  for (const line of lines) {
    if (!line.accountId ||
      !Number.isSafeInteger(line.debitMinor) || line.debitMinor < 0 ||
      !Number.isSafeInteger(line.creditMinor) || line.creditMinor < 0 ||
      ((line.debitMinor > 0) === (line.creditMinor > 0))) {
      throw new Error('invalid_journal_line');
    }
    debit += line.debitMinor;
    credit += line.creditMinor;
    if (!Number.isSafeInteger(debit) || !Number.isSafeInteger(credit)) throw new Error('journal_overflow');
  }
  if (debit !== credit) throw new Error('journal_unbalanced');
}

export async function ensureAccountingAccounts(client: QueryClient, organizationId: string) {
  for (const account of ACCOUNT_SEEDS) {
    await client.query(
      `insert into ledger_accounts
         (id, organization_id, code, name, account_class, normal_balance, active)
       values (gen_random_uuid(), $1, $2, $3, $4, $5, true)
       on conflict (organization_id, code) do nothing`,
      [organizationId, account.code, account.name, account.accountClass, account.normalBalance],
    );
  }

  const result = await client.query(
    'select id, code, account_class, normal_balance, active from ledger_accounts where organization_id=$1 and code=any($2::text[])',
    [organizationId, ACCOUNT_SEEDS.map(item => item.code)],
  );
  const byCode = new Map<string, any>(result.rows.map(row => [String(row.code), row]));
  const ids: Record<string, string> = {};
  for (const seed of ACCOUNT_SEEDS) {
    const account = byCode.get(seed.code);
    if (!account || !account.active ||
      account.account_class !== seed.accountClass ||
      account.normal_balance !== seed.normalBalance) {
      throw new Error('accounting_chart_configuration_invalid');
    }
    ids[seed.code] = String(account.id);
  }
  return ids;
}

export async function createPostedJournal(
  client: QueryClient,
  input: {
    organizationId: string;
    locationId: string;
    sourceType: 'sale' | 'expense';
    sourceId: string;
    description: string;
    occurredAt: string;
    createdBy: string;
    lines: JournalLineInput[];
  },
) {
  assertJournal(input.lines);
  const accountIds = [...new Set(input.lines.map(line => line.accountId))];
  const owned = await client.query(
    'select id from ledger_accounts where organization_id=$1 and id=any($2::uuid[]) and active=true',
    [input.organizationId, accountIds],
  );
  if (owned.rows.length !== accountIds.length) throw new Error('journal_account_ownership_failed');

  const reference = `${input.sourceType.toUpperCase()}-${input.sourceId.replace(/-/g, '').slice(0, 12).toUpperCase()}`;
  const inserted = await client.query(
    `insert into journal_entries
       (id, organization_id, location_id, reference, description, occurred_at,
        source_type, source_id, status, created_by)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'posted', $8)
     on conflict (organization_id, source_type, source_id)
       where source_id is not null
     do nothing
     returning id`,
    [input.organizationId, input.locationId, reference, input.description, input.occurredAt, input.sourceType, input.sourceId, input.createdBy],
  );
  if (!inserted.rows.length) {
    const existing = await client.query(
      `select id, status from journal_entries
       where organization_id=$1 and source_type=$2 and source_id=$3 limit 1`,
      [input.organizationId, input.sourceType, input.sourceId],
    );
    if (!existing.rows.length || existing.rows[0].status !== 'posted') throw new Error('journal_source_already_posted_or_voided');
    return { id: String(existing.rows[0].id), created: false };
  }

  const journalId = String(inserted.rows[0].id);
  for (const line of input.lines) {
    await client.query(
      `insert into journal_lines
         (id, journal_entry_id, account_id, debit_minor, credit_minor, memo)
       values (gen_random_uuid(), $1, $2, $3, $4, $5)`,
      [journalId, line.accountId, line.debitMinor, line.creditMinor, line.memo ?? null],
    );
  }
  await client.query(
    `insert into audit_events
       (organization_id, actor_user_id, action, entity_type, entity_id, after_data, reason)
     values ($1, $2, 'accounting.journal_posted', 'journal_entry', $3, $4::jsonb, 'Automatic posting from verified source transaction')`,
    [input.organizationId, input.createdBy, journalId, JSON.stringify({ sourceType: input.sourceType, sourceId: input.sourceId, reference })],
  );
  return { id: journalId, created: true };
}

export async function postSaleJournal(
  client: QueryClient,
  input: {
    organizationId: string; locationId: string; sourceId: string; occurredAt: string; createdBy: string;
    paymentMethod: 'cash'|'bank'|'transfer'|'card'|'credit'; totalMinor: number;
    items: Array<{ quantity: number; unitCostMinor: number }>;
  },
) {
  if (!Number.isSafeInteger(input.totalMinor) || input.totalMinor <= 0) throw new Error('sale_amount_must_be_positive');
  let costMinor = 0;
  for (const item of input.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 ||
      !Number.isSafeInteger(item.unitCostMinor) || item.unitCostMinor < 0) throw new Error('invalid_sale_cost');
    costMinor += item.quantity * item.unitCostMinor;
    if (!Number.isSafeInteger(costMinor)) throw new Error('sale_cost_overflow');
  }

  const accounts = await ensureAccountingAccounts(client, input.organizationId);
  const tenderCode = input.paymentMethod === 'cash' ? '1000' : input.paymentMethod === 'credit' ? '1100' : '1010';
  const lines: JournalLineInput[] = [
    { accountId: accounts[tenderCode], debitMinor: input.totalMinor, creditMinor: 0, memo: 'Sale proceeds' },
    { accountId: accounts['4000'], debitMinor: 0, creditMinor: input.totalMinor, memo: 'Net sales revenue' },
  ];
  if (costMinor > 0) {
    lines.push(
      { accountId: accounts['5000'], debitMinor: costMinor, creditMinor: 0, memo: 'Cost of goods sold' },
      { accountId: accounts['1200'], debitMinor: 0, creditMinor: costMinor, memo: 'Inventory relieved at recorded cost' },
    );
  }
  return createPostedJournal(client, {
    organizationId: input.organizationId, locationId: input.locationId, sourceType: 'sale',
    sourceId: input.sourceId, description: `Sale ${input.sourceId.slice(0, 8)}`,
    occurredAt: input.occurredAt, createdBy: input.createdBy, lines,
  });
}

export async function postExpenseJournal(
  client: QueryClient,
  input: {
    organizationId: string; locationId: string; sourceId: string; occurredAt: string; createdBy: string;
    paymentMethod: 'cash'|'bank'|'transfer'|'card'; amountMinor: number; category: string; description: string;
  },
) {
  if (!input.locationId || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new Error('invalid_expense_posting');
  const accounts = await ensureAccountingAccounts(client, input.organizationId);
  const paymentCode = input.paymentMethod === 'cash' ? '1000' : '1010';
  return createPostedJournal(client, {
    organizationId: input.organizationId, locationId: input.locationId, sourceType: 'expense',
    sourceId: input.sourceId, description: `${input.category}: ${input.description}`.slice(0, 240),
    occurredAt: input.occurredAt, createdBy: input.createdBy,
    lines: [
      { accountId: accounts['6000'], debitMinor: input.amountMinor, creditMinor: 0, memo: input.category },
      { accountId: accounts[paymentCode], debitMinor: 0, creditMinor: input.amountMinor, memo: `Paid by ${input.paymentMethod}` },
    ],
  });
}
