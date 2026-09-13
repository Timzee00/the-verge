-- The Verge — core PostgreSQL schema
-- Apply through a controlled migration process. Do not paste secrets into this file.

create extension if not exists pgcrypto;

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(), email text not null unique, display_name text,
  status text not null default 'active' check (status in ('active','restricted','suspended','pending_deletion','deleted')),
  email_verified_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(), name text not null, base_currency char(3) not null default 'NGN',
  status text not null default 'active' check (status in ('active','suspended','pending_deletion','deleted')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete restrict,
  role text not null check (role in ('business_owner','platform_admin','manager','cashier','inventory_staff','accountant','staff')),
  active boolean not null default true, created_at timestamptz not null default now(), unique (organization_id,user_id)
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
  name text not null, type text not null check (type in ('region','branch','warehouse')),
  parent_id uuid references locations(id) on delete set null, active boolean not null default true, unique (organization_id,name)
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
  sku text not null, barcode text, name text not null, brand text, category text, unit text not null default 'piece',
  weight_value numeric, weight_unit text, image_url text,
  standard_cost_minor bigint not null default 0 check (standard_cost_minor >= 0),
  retail_price_minor bigint not null default 0 check (retail_price_minor >= 0),
  wholesale_price_minor bigint check (wholesale_price_minor is null or wholesale_price_minor >= 0),
  minimum_price_minor bigint check (minimum_price_minor is null or minimum_price_minor >= 0),
  reorder_level numeric check (reorder_level is null or reorder_level >= 0),
  active boolean not null default true, track_batch boolean not null default false, track_expiry boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (organization_id,sku)
);
create unique index if not exists products_org_barcode_unique on products(organization_id,barcode) where barcode is not null;

create table if not exists inventory_events (
  id uuid primary key, organization_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete restrict, product_id uuid not null references products(id) on delete restrict,
  event_type text not null check (event_type in ('opening','purchase','sale','sale_void','return','damage','adjustment','transfer_out','transfer_in','reservation','reservation_release')),
  quantity_delta numeric not null check (quantity_delta <> 0), unit_cost_minor bigint check (unit_cost_minor is null or unit_cost_minor >= 0),
  reference_id uuid, occurred_at timestamptz not null, device_id text not null, local_sequence bigint not null,
  created_at timestamptz not null default now(), created_by uuid references app_users(id) on delete set null,
  unique(device_id,local_sequence)
);
create index if not exists inventory_events_lookup on inventory_events(organization_id,location_id,product_id,occurred_at,id);

create table if not exists sync_operations (
  id uuid primary key, organization_id uuid not null references organizations(id) on delete cascade,
  device_id text not null, entity_type text not null, entity_id uuid not null,
  operation_type text not null check (operation_type in ('create','void')), payload jsonb not null,
  created_at timestamptz not null, processed_at timestamptz,
  state text not null default 'pending' check (state in ('pending','processed','conflict','rejected')),
  error_code text, error_message text
);
create index if not exists sync_pending_lookup on sync_operations(organization_id,state,created_at);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid references organizations(id) on delete cascade,
  actor_user_id uuid references app_users(id) on delete set null, action text not null,
  entity_type text, entity_id uuid, before_data jsonb, after_data jsonb, reason text, created_at timestamptz not null default now()
);
create index if not exists audit_events_org_time on audit_events(organization_id,created_at);

create table if not exists ledger_accounts (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
  code text not null, name text not null,
  account_class text not null check (account_class in ('asset','liability','equity','revenue','expense')),
  normal_balance text not null check (normal_balance in ('debit','credit')), active boolean not null default true,
  unique(organization_id,code)
);

create table if not exists journal_entries (
  id uuid primary key, organization_id uuid not null references organizations(id) on delete cascade,
  reference text not null, description text not null, occurred_at timestamptz not null,
  source_type text not null, source_id uuid, status text not null default 'posted' check (status in ('posted','voided')),
  created_at timestamptz not null default now(), created_by uuid references app_users(id) on delete set null,
  unique(organization_id,reference)
);
create table if not exists journal_lines (
  id uuid primary key, journal_entry_id uuid not null references journal_entries(id) on delete cascade,
  account_id uuid not null references ledger_accounts(id) on delete restrict,
  debit_minor bigint not null default 0 check (debit_minor >= 0), credit_minor bigint not null default 0 check (credit_minor >= 0),
  memo text, check ((debit_minor > 0) <> (credit_minor > 0))
);
create index if not exists journal_entries_org_date on journal_entries(organization_id,occurred_at);
create index if not exists journal_lines_entry on journal_lines(journal_entry_id);

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references organizations(id) on delete cascade,
  plan_code text not null, status text not null check (status in ('trialing','active','past_due','grace','canceled','expired')),
  provider text, provider_customer_ref text, provider_subscription_ref text,
  current_period_start timestamptz, current_period_end timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists entitlements (
  id uuid primary key default gen_random_uuid(), organization_id uuid references organizations(id) on delete cascade,
  user_id uuid references app_users(id) on delete cascade, capability text not null,
  effect text not null check (effect in ('allow','deny')), source text not null check (source in ('plan','grant','override','system')),
  starts_at timestamptz not null default now(), expires_at timestamptz, reason text,
  created_by uuid references app_users(id) on delete set null, created_at timestamptz not null default now(),
  check (organization_id is not null or user_id is not null)
);
create index if not exists entitlements_lookup on entitlements(organization_id,user_id,capability,starts_at,expires_at);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(), organization_id uuid references organizations(id) on delete set null,
  user_id uuid references app_users(id) on delete set null, amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null default 'NGN', plan_code text, provider text not null, provider_reference text not null,
  status text not null check (status in ('initiated','processing','pending','confirmed','failed','reversed','refunded','disputed')),
  provider_status text, webhook_received_at timestamptz, verified_at timestamptz,
  reconciliation_status text not null default 'unreconciled' check (reconciliation_status in ('unreconciled','matched','mismatch','under_review','resolved')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(provider,provider_reference)
);
create index if not exists payments_org_status on payments(organization_id,status,created_at);

create table if not exists consent_records (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references app_users(id) on delete cascade,
  consent_type text not null check (consent_type in ('analytics','marketing','cookies','terms','privacy')),
  policy_version text, granted boolean not null, method text not null, created_at timestamptz not null default now(), withdrawn_at timestamptz
);
create index if not exists consent_user_type on consent_records(user_id,consent_type,created_at);

create table if not exists export_jobs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references app_users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade, selection jsonb not null,
  status text not null default 'queued' check (status in ('queued','processing','ready','expired','failed')),
  download_expires_at timestamptz, created_at timestamptz not null default now(), completed_at timestamptz
);
create index if not exists export_jobs_user_status on export_jobs(user_id,status,created_at);
