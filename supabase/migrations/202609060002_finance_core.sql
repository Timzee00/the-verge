create table if not exists public.ledger_accounts (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 code text not null, name text not null, account_class text not null check(account_class in ('asset','liability','equity','revenue','expense')),
 normal_balance text not null check(normal_balance in ('debit','credit')), active boolean not null default true,
 unique(organization_id, code)
);
create table if not exists public.journal_entries (
 id uuid primary key, organization_id uuid not null references public.organizations(id) on delete cascade, reference text not null,
 description text not null, occurred_at timestamptz not null, source_type text not null, source_id uuid, status text not null default 'posted' check(status in ('posted','voided')),
 created_at timestamptz not null default now(), created_by uuid references auth.users(id) on delete set null, unique(organization_id, reference)
);
create table if not exists public.journal_lines (
 id uuid primary key, journal_entry_id uuid not null references public.journal_entries(id) on delete cascade,
 account_id uuid not null references public.ledger_accounts(id) on delete restrict, debit_minor bigint not null default 0 check(debit_minor>=0), credit_minor bigint not null default 0 check(credit_minor>=0),
 memo text, check((debit_minor>0) <> (credit_minor>0))
);
create index if not exists journal_entries_org_date on public.journal_entries(organization_id,occurred_at);
create index if not exists journal_lines_entry on public.journal_lines(journal_entry_id);
alter table public.ledger_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
create policy ledger_accounts_member_select on public.ledger_accounts for select using(public.is_org_member(organization_id));
create policy journal_entries_member_select on public.journal_entries for select using(public.is_org_member(organization_id));
create policy journal_lines_member_select on public.journal_lines for select using(exists(select 1 from public.journal_entries je where je.id=journal_entry_id and public.is_org_member(je.organization_id)));
