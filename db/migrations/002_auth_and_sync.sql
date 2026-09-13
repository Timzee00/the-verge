-- The Verge — pilot authentication and sync foundation
-- Run after 001_core.sql.

create table if not exists user_credentials (
  user_id uuid primary key references app_users(id) on delete cascade,
  password_hash text not null,
  updated_at timestamptz not null default now()
);

create table if not exists user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ip_hint inet,
  user_agent text
);
create index if not exists user_sessions_user_idx on user_sessions(user_id, expires_at);

create table if not exists sync_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  device_id text not null,
  local_sequence bigint not null,
  entity_type text not null,
  entity_id uuid not null,
  processed_at timestamptz not null default now(),
  unique(device_id, local_sequence),
  unique(organization_id, entity_type, entity_id)
);
create index if not exists sync_receipts_org_time on sync_receipts(organization_id, processed_at);

alter table organizations add column if not exists industry text;
alter table locations add column if not exists code text;
alter table memberships add column if not exists updated_at timestamptz not null default now();

create table if not exists customers (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  credit_limit_minor bigint,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customers_org_idx on customers(organization_id,name);

create table if not exists sales (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete restrict,
  customer_id uuid references customers(id) on delete set null,
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  payment_method text not null check (payment_method in ('cash','bank','transfer','card','credit')),
  status text not null check (status in ('completed','voided')),
  below_cost boolean not null default false,
  discount_reason text,
  occurred_at timestamptz not null,
  device_id text not null,
  local_sequence bigint not null,
  created_at timestamptz not null default now(),
  created_by uuid references app_users(id) on delete set null,
  unique(organization_id,device_id,local_sequence)
);
create table if not exists sale_items (
  id uuid primary key,
  sale_id uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  quantity numeric not null check (quantity > 0),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  unit_cost_minor bigint not null check (unit_cost_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0)
);
create index if not exists sales_org_time on sales(organization_id,occurred_at);
create table if not exists expenses (
  id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  location_id uuid references locations(id) on delete set null,
  amount_minor bigint not null check (amount_minor > 0),
  category text not null,
  description text not null,
  payment_method text not null check (payment_method in ('cash','bank','transfer','card')),
  occurred_at timestamptz not null,
  device_id text not null,
  created_at timestamptz not null default now(),
  created_by uuid references app_users(id) on delete set null
);
