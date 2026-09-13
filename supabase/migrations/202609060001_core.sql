create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_currency text not null default 'NGN',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('business_owner','manager','cashier','inventory_staff','accountant','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id,user_id)
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type text not null check (type in ('region','branch','warehouse')),
  parent_id uuid references public.locations(id) on delete set null,
  active boolean not null default true
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sku text not null,
  barcode text,
  name text not null,
  brand text,
  category text,
  unit text not null default 'piece',
  weight_value numeric,
  weight_unit text,
  image_url text,
  standard_cost_minor bigint not null check (standard_cost_minor >= 0),
  retail_price_minor bigint not null check (retail_price_minor >= 0),
  wholesale_price_minor bigint check (wholesale_price_minor is null or wholesale_price_minor >= 0),
  minimum_price_minor bigint check (minimum_price_minor is null or minimum_price_minor >= 0),
  reorder_level numeric,
  active boolean not null default true,
  track_batch boolean not null default false,
  track_expiry boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);

create unique index if not exists products_org_barcode_unique on public.products(organization_id, barcode) where barcode is not null;

create table if not exists public.inventory_events (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  event_type text not null check (event_type in ('opening','purchase','sale','sale_void','return','damage','adjustment','transfer_out','transfer_in','reservation','reservation_release')),
  quantity_delta numeric not null check (quantity_delta <> 0),
  unit_cost_minor bigint,
  reference_id uuid,
  occurred_at timestamptz not null,
  device_id text not null,
  local_sequence bigint not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists inventory_events_org_location_product on public.inventory_events(organization_id,location_id,product_id,occurred_at);

create table if not exists public.sync_operations (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id text not null,
  entity_type text not null,
  entity_id uuid not null,
  operation_type text not null check (operation_type in ('create','void')),
  payload jsonb not null,
  created_at timestamptz not null,
  processed_at timestamptz,
  state text not null default 'pending' check (state in ('pending','processed','conflict','rejected')),
  error_code text,
  error_message text,
  unique (id)
);

create index if not exists sync_operations_pending_idx on public.sync_operations(organization_id,state,created_at);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.locations enable row level security;
alter table public.products enable row level security;
alter table public.inventory_events enable row level security;
alter table public.sync_operations enable row level security;
alter table public.audit_events enable row level security;

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.memberships m where m.organization_id=target_org and m.user_id=auth.uid() and m.active);
$$;

create policy organizations_member_select on public.organizations for select using (public.is_org_member(id));
create policy memberships_self_or_org_select on public.memberships for select using (user_id=auth.uid() or public.is_org_member(organization_id));
create policy locations_member_select on public.locations for select using (public.is_org_member(organization_id));
create policy products_member_select on public.products for select using (public.is_org_member(organization_id));
create policy inventory_member_select on public.inventory_events for select using (public.is_org_member(organization_id));
create policy sync_member_select on public.sync_operations for select using (public.is_org_member(organization_id));
create policy audit_member_select on public.audit_events for select using (public.is_org_member(organization_id));

-- Writes should be exposed through server-side RPC/endpoints where permission checks,
-- idempotency and conflict validation can be enforced atomically.
