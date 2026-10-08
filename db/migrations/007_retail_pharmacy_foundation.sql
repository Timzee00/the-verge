-- THE VERGE — supermarket/pharmacy inventory foundation
-- Run after 006_store_setup.sql.

alter table products add column if not exists product_kind text not null default 'general'
  check (product_kind in ('general','food','medicine','medical_device'));
alter table products add column if not exists gtin text;
alter table products add column if not exists nafdac_reg_no text;
alter table products add column if not exists generic_name text;
alter table products add column if not exists dosage_form text;
alter table products add column if not exists strength text;
alter table products add column if not exists prescription_required boolean not null default false;
alter table products add column if not exists controlled boolean not null default false;
alter table products add column if not exists storage_condition text;

create unique index if not exists products_org_gtin_unique
  on products(organization_id,gtin) where gtin is not null and btrim(gtin)<>'';

create table if not exists inventory_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete restrict,
  product_id uuid not null references products(id) on delete restrict,
  supplier_id uuid references suppliers(id) on delete set null,
  batch_number text not null,
  manufacture_date date,
  expiry_date date,
  quantity_received numeric not null check (quantity_received > 0),
  quantity_available numeric not null check (quantity_available >= 0),
  unit_cost_minor bigint not null check (unit_cost_minor >= 0),
  received_at timestamptz not null default now(),
  status text not null default 'active'
    check (status in ('active','quarantined','recalled','expired','depleted')),
  created_at timestamptz not null default now(),
  check (expiry_date is null or manufacture_date is null or expiry_date > manufacture_date),
  unique (organization_id,location_id,product_id,batch_number)
);

create index if not exists inventory_lots_fefo_idx
  on inventory_lots(organization_id,location_id,product_id,expiry_date,status)
  where quantity_available > 0;

create index if not exists inventory_lots_expiry_idx
  on inventory_lots(organization_id,expiry_date,status)
  where quantity_available > 0 and expiry_date is not null;

create or replace function set_inventory_lot_status() returns trigger language plpgsql as $$
begin
  if new.status in ('quarantined','recalled') then return new; end if;
  if new.quantity_available <= 0 then new.status='depleted';
  elsif new.expiry_date is not null and new.expiry_date < current_date then new.status='expired';
  else new.status='active';
  end if;
  return new;
end $$;

drop trigger if exists inventory_lot_status_guard on inventory_lots;
create trigger inventory_lot_status_guard
before insert or update of quantity_available,expiry_date,status on inventory_lots
for each row execute function set_inventory_lot_status();

comment on table inventory_lots is
  'Batch/lot-level stock for FEFO rotation, expiry control, quarantine and recall traceability.';
