-- THE VERGE — guided business and store setup
-- Run after 005_account_recovery.sql.

alter table locations add column if not exists address text;
alter table locations add column if not exists phone text;
alter table locations add column if not exists email text;
alter table locations add column if not exists receipt_name text;
alter table locations add column if not exists receipt_footer text;
alter table locations add column if not exists setup_completed_at timestamptz;

-- Normalize legacy codes and avoid six-character UUID collisions.
with normalized as (
  select id,organization_id,upper(btrim(coalesce(code,''))) as normalized_code
  from locations
), ranked as (
  select id,normalized_code,
    row_number() over (partition by organization_id,normalized_code order by id) as duplicate_rank
  from normalized
), to_fix as (
  select id from ranked
  where normalized_code !~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'
     or duplicate_rank > 1
)
update locations l
set code='LOC-' || replace(l.id::text,'-','')
from to_fix f
where f.id=l.id;

-- Legacy UUID-derived codes can exceed the UI's 20-character editable convention.
-- Owners should choose a shorter store code on their first explicit setup save.
create unique index if not exists locations_org_code_unique
  on locations(organization_id,upper(code))
  where code is not null;

create index if not exists locations_org_active_idx
  on locations(organization_id,active,name);

comment on column locations.setup_completed_at is
  'Set when an owner or authorized manager explicitly saves the store/location setup form.';
