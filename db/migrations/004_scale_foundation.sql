-- THE VERGE — scale foundation
-- Run after 003_production_hardening.sql.
-- Adds a materialized current-stock projection while preserving inventory_events as the immutable source of truth.

create table if not exists inventory_balances (
  organization_id uuid not null references organizations(id) on delete cascade,
  location_id uuid not null references locations(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  quantity_on_hand numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (organization_id,location_id,product_id)
);

insert into inventory_balances (organization_id,location_id,product_id,quantity_on_hand,updated_at)
select organization_id,location_id,product_id,
       coalesce(sum(case when event_type not in ('reservation','reservation_release') then quantity_delta else 0 end),0),
       now()
from inventory_events
group by organization_id,location_id,product_id
on conflict (organization_id,location_id,product_id)
do update set quantity_on_hand=excluded.quantity_on_hand,updated_at=now();

create or replace function project_inventory_balance() returns trigger language plpgsql as $$
begin
  if new.event_type in ('reservation','reservation_release') then
    return new;
  end if;
  insert into inventory_balances(organization_id,location_id,product_id,quantity_on_hand,updated_at)
  values(new.organization_id,new.location_id,new.product_id,new.quantity_delta,now())
  on conflict(organization_id,location_id,product_id)
  do update set quantity_on_hand=inventory_balances.quantity_on_hand+excluded.quantity_on_hand,updated_at=now();
  return new;
end $$;

drop trigger if exists inventory_balance_projection on inventory_events;
create trigger inventory_balance_projection
after insert on inventory_events
for each row execute function project_inventory_balance();

create or replace function reject_inventory_event_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'inventory_events are immutable; write a compensating event instead' using errcode='55000';
end $$;

drop trigger if exists inventory_events_immutable on inventory_events;
create trigger inventory_events_immutable
before update or delete on inventory_events
for each row execute function reject_inventory_event_mutation();

create index if not exists inventory_balances_org_product_idx
  on inventory_balances(organization_id,product_id,location_id);

create index if not exists sync_changes_org_entity_seq_idx
  on sync_changes(organization_id,entity_type,change_seq);

comment on table inventory_balances is 'Fast current-stock projection. inventory_events remains the authoritative immutable ledger.';
