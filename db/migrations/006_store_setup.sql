-- THE VERGE — guided business and store setup
-- Run after 005_account_recovery.sql.

alter table locations add column if not exists address text;
alter table locations add column if not exists phone text;
alter table locations add column if not exists email text;
alter table locations add column if not exists receipt_name text;
alter table locations add column if not exists receipt_footer text;
alter table locations add column if not exists setup_completed_at timestamptz;

create unique index if not exists locations_org_code_unique
  on locations(organization_id,upper(code))
  where code is not null;

create index if not exists locations_org_active_idx
  on locations(organization_id,active,name);

comment on column locations.setup_completed_at is
  'Set when an owner or authorized manager explicitly saves the store/location setup form.';
