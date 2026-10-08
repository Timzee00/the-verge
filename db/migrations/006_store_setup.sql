-- THE VERGE — guided business and store setup
-- Run after 005_account_recovery.sql.

alter table locations add column if not exists address text;
alter table locations add column if not exists phone text;
alter table locations add column if not exists email text;
alter table locations add column if not exists receipt_name text;
alter table locations add column if not exists receipt_footer text;
alter table locations add column if not exists setup_completed_at timestamptz;

-- Backfill a stable code where older rows do not have one.
update locations
set code=upper('LOC-' || left(replace(id::text,'-',''),6))
where code is null or btrim(code)='';

-- Preserve the first occurrence of an existing code and make later duplicates unique
-- so the migration remains safe for legacy multi-location workspaces.
with ranked as (
  select id,code,
         row_number() over (
           partition by organization_id,upper(code)
           order by id
         ) as duplicate_rank
  from locations
  where code is not null
)
update locations l
set code=left(upper(r.code),12) || '-' || left(replace(l.id::text,'-',''),6)
from ranked r
where r.id=l.id and r.duplicate_rank>1;

create unique index if not exists locations_org_code_unique
  on locations(organization_id,upper(code))
  where code is not null;

create index if not exists locations_org_active_idx
  on locations(organization_id,active,name);

comment on column locations.setup_completed_at is
  'Set when an owner or authorized manager explicitly saves the store/location setup form.';
