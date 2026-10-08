-- THE VERGE — capability-based multi-business architecture
-- Run after 007_retail_pharmacy_foundation.sql.
-- Core tools stay universal; vertical modules are enabled from the business type
-- and may later be overridden manually without losing user choices.

create table if not exists organization_modules (
  organization_id uuid not null references organizations(id) on delete cascade,
  module_code text not null,
  enabled boolean not null default true,
  source text not null default 'preset' check (source in ('core','preset','manual','plan','system')),
  updated_at timestamptz not null default now(),
  primary key (organization_id,module_code)
);
create index if not exists organization_modules_enabled_idx
  on organization_modules(organization_id,enabled,module_code);

create or replace function seed_organization_modules(p_org uuid,p_industry text) returns void
language plpgsql as $$
declare
  kind text:=lower(btrim(coalesce(p_industry,'other')));
  core text[]:=array[
    'pos','inventory','customers','suppliers','purchasing','expenses','accounting','reports',
    'staff','multi_location','offline_sync','receipts','audit','exports','notifications'
  ];
  extras text[];
begin
  extras:=case kind
    when 'retail / general' then array['barcode','variants','loyalty','credit_debt','online_store']
    when 'supermarket' then array['barcode','variants','loyalty','credit_debt','online_store','wholesale','batch_expiry']
    when 'pharmacy' then array['barcode','loyalty','credit_debt','batch_expiry','pharmacy_controls','prescriptions']
    when 'hospital / clinic' then array['clinic_records','appointments','pharmacy_controls','batch_expiry','credit_debt']
    when 'printing shop' then array['print_jobs','jobs','production','credit_debt']
    when 'restaurant / food' then array['restaurant_tables','kitchen_display','menu_modifiers','loyalty','online_store','batch_expiry']
    when 'fashion' then array['barcode','variants','loyalty','online_store']
    when 'student business' then array['barcode','online_store','credit_debt']
    when 'real estate' then array['property_crm','appointments','credit_debt']
    when 'services' then array['appointments','jobs','credit_debt']
    else array['credit_debt']
  end;

  insert into organization_modules(organization_id,module_code,enabled,source)
  select p_org,x,true,'core' from unnest(core) x
  on conflict(organization_id,module_code) do update
    set enabled=true,source=case when organization_modules.source='manual' then 'manual' else 'core' end,updated_at=now();

  delete from organization_modules
  where organization_id=p_org and source='preset' and not (module_code=any(extras));

  insert into organization_modules(organization_id,module_code,enabled,source)
  select p_org,x,true,'preset' from unnest(extras) x
  on conflict(organization_id,module_code) do update
    set enabled=case when organization_modules.source='manual' then organization_modules.enabled else true end,
        source=case when organization_modules.source='manual' then 'manual' else 'preset' end,
        updated_at=now();
end $$;

create or replace function organizations_seed_modules_trigger() returns trigger language plpgsql as $$
begin
  perform seed_organization_modules(new.id,new.industry);
  return new;
end $$;

drop trigger if exists organizations_seed_modules on organizations;
create trigger organizations_seed_modules
after insert or update of industry on organizations
for each row execute function organizations_seed_modules_trigger();

do $$
declare r record;
begin
  for r in select id,industry from organizations loop
    perform seed_organization_modules(r.id,r.industry);
  end loop;
end $$;

comment on table organization_modules is
  'Enabled capabilities per business. Core and industry presets are automatic; manual overrides survive later business-type changes.';
