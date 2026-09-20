-- The Verge — production hardening
-- Run after 002_auth_and_sync.sql.
-- Adds location-scoped memberships, append-only sync sequencing, and auth rate limiting.

create table if not exists membership_locations (
  membership_id uuid not null references memberships(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (membership_id, location_id)
);
create index if not exists membership_locations_location_idx on membership_locations(location_id, active);

insert into membership_locations (membership_id, location_id, active)
select m.id, l.id, true
from memberships m
join locations l on l.organization_id = m.organization_id
where m.active = true and l.active = true and m.role in ('business_owner','platform_admin')
on conflict (membership_id, location_id) do nothing;

create index if not exists inventory_events_org_seq_idx on inventory_events(organization_id, device_id, local_sequence);
create index if not exists sales_org_seq_idx on sales(organization_id, device_id, local_sequence);

create sequence if not exists sync_change_seq_seq;

create table if not exists sync_changes (
  change_seq bigint primary key default nextval('sync_change_seq_seq'),
  organization_id uuid not null references organizations(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  changed_at timestamptz not null default now(),
  unique (organization_id, change_seq)
);
create index if not exists sync_changes_org_seq_idx on sync_changes(organization_id, change_seq);

insert into sync_changes (organization_id, entity_type, entity_id, changed_at)
select organization_id, 'product', id, coalesce(updated_at, now()) from products
on conflict do nothing;
insert into sync_changes (organization_id, entity_type, entity_id, changed_at)
select organization_id, 'location', id, now() from locations
on conflict do nothing;
insert into sync_changes (organization_id, entity_type, entity_id, changed_at)
select organization_id, 'inventory_event', id, created_at from inventory_events
on conflict do nothing;
insert into sync_changes (organization_id, entity_type, entity_id, changed_at)
select organization_id, 'sale', id, created_at from sales
on conflict do nothing;
insert into sync_changes (organization_id, entity_type, entity_id, changed_at)
select organization_id, 'customer', id, created_at from customers
on conflict do nothing;
insert into sync_changes (organization_id, entity_type, entity_id, changed_at)
select organization_id, 'expense', id, created_at from expenses
on conflict do nothing;

create table if not exists auth_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  failures integer not null default 0 check (failures >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists auth_rate_limits_blocked_idx on auth_rate_limits(blocked_until);

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists app_users_touch_updated_at on app_users;
create trigger app_users_touch_updated_at before update on app_users
for each row execute function touch_updated_at();

drop trigger if exists organizations_touch_updated_at on organizations;
create trigger organizations_touch_updated_at before update on organizations
for each row execute function touch_updated_at();

drop trigger if exists memberships_touch_updated_at on memberships;
create trigger memberships_touch_updated_at before update on memberships
for each row execute function touch_updated_at();

drop trigger if exists products_touch_updated_at on products;
create trigger products_touch_updated_at before update on products
for each row execute function touch_updated_at();

drop trigger if exists customers_touch_updated_at on customers;
create trigger customers_touch_updated_at before update on customers
for each row execute function touch_updated_at();

create table if not exists api_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  created_by uuid references app_users(id) on delete set null,
  name text not null,
  key_prefix text not null,
  secret_hash text not null unique,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  check (cardinality(scopes) <= 20)
);
create index if not exists api_credentials_org_idx on api_credentials(organization_id,revoked_at,expires_at);

do $$ begin
  if not exists (select 1 from pg_constraint where conname='sales_total_math') then
    alter table sales add constraint sales_total_math check (total_minor = subtotal_minor - discount_minor);
  end if;
  if not exists (select 1 from pg_constraint where conname='sale_item_discount_bound') then
    alter table sale_items add constraint sale_item_discount_bound check (discount_minor <= unit_price_minor * quantity);
  end if;
end $$;

create or replace function enforce_inventory_scope() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from locations l
    where l.id = new.location_id and l.organization_id = new.organization_id and l.active = true
  ) then
    raise exception 'location_ownership_check_failed';
  end if;
  if not exists (
    select 1 from products p
    where p.id = new.product_id and p.organization_id = new.organization_id
  ) then
    raise exception 'product_ownership_check_failed';
  end if;
  if new.event_type in ('opening','purchase','return','sale_void','transfer_in','reservation','reservation_release') and new.quantity_delta <= 0 then
    raise exception 'invalid_inventory_direction';
  end if;
  if new.event_type in ('sale','damage','transfer_out') and new.quantity_delta >= 0 then
    raise exception 'invalid_inventory_direction';
  end if;
  return new;
end $$;

drop trigger if exists inventory_scope_guard on inventory_events;
create trigger inventory_scope_guard before insert or update on inventory_events
for each row execute function enforce_inventory_scope();


-- Seed the server chart for existing organizations; registration also seeds its new organization.
insert into ledger_accounts (organization_id,code,name,account_class,normal_balance,active)
select o.id, v.code, v.name, v.account_class, v.normal_balance, true
from organizations o
cross join (values
  ('1000','Cash','asset','debit'),
  ('1010','Bank','asset','debit'),
  ('1100','Accounts Receivable','asset','debit'),
  ('1200','Inventory','asset','debit'),
  ('2000','Accounts Payable','liability','credit'),
  ('3000','Owner Equity','equity','credit'),
  ('4000','Sales Revenue','revenue','credit'),
  ('5000','Cost of Goods Sold','expense','debit'),
  ('6000','Operating Expenses','expense','debit')
) as v(code,name,account_class,normal_balance)
on conflict (organization_id,code) do nothing;

create or replace function assert_journal_balanced() returns trigger language plpgsql as $$
declare
  debit_total bigint;
  credit_total bigint;
begin
  if exists(select 1 from journal_entries je where je.id=coalesce(new.journal_entry_id,old.journal_entry_id) and je.status='posted') then
    select coalesce(sum(debit_minor),0),coalesce(sum(credit_minor),0)
    into debit_total,credit_total
    from journal_lines
    where journal_entry_id=coalesce(new.journal_entry_id,old.journal_entry_id);
    if debit_total <> credit_total or (debit_total=0 and credit_total=0) then
      raise exception 'journal_not_balanced';
    end if;
  end if;
  return coalesce(new,old);
end $$;

drop trigger if exists journal_lines_balance_guard on journal_lines;
create constraint trigger journal_lines_balance_guard
after insert or update or delete on journal_lines
deferrable initially deferred
for each row execute function assert_journal_balanced();

drop trigger if exists journal_entries_balance_guard on journal_entries;
create constraint trigger journal_entries_balance_guard
after insert or update on journal_entries
deferrable initially deferred
for each row execute function assert_journal_balanced();
