alter table subscriptions add column if not exists approved_by uuid references app_users(id) on delete set null;
alter table subscriptions add column if not exists approval_request_id uuid;
alter table subscriptions add column if not exists billing_cycle_months integer not null default 1 check (billing_cycle_months between 1 and 24);
create table if not exists billing_upgrade_requests (
 id uuid primary key default gen_random_uuid(), reference_code text not null default ('TV-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))) unique, organization_id uuid not null references organizations(id) on delete cascade,
 requested_by uuid not null references app_users(id) on delete restrict,
 requested_plan text not null check (requested_plan in ('starter','pro','business','enterprise')),
 amount_minor bigint check (amount_minor is null or amount_minor>=0), currency char(3) not null default 'NGN',
 billing_cycle_months integer not null default 1 check (billing_cycle_months between 1 and 24),
 status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
 admin_note text, decided_by uuid references app_users(id) on delete set null, decided_at timestamptz, created_at timestamptz not null default now()
);
create unique index if not exists billing_upgrade_one_pending on billing_upgrade_requests(organization_id) where status='pending';
create index if not exists billing_upgrade_admin_queue on billing_upgrade_requests(status,created_at,id);
alter table subscriptions drop constraint if exists subscriptions_approval_request_fk;
alter table subscriptions add constraint subscriptions_approval_request_fk foreign key (approval_request_id) references billing_upgrade_requests(id) on delete set null;
create table if not exists organization_usage_monthly (
 organization_id uuid not null references organizations(id) on delete cascade, period_start date not null, metric text not null,
 used bigint not null default 0 check(used>=0), updated_at timestamptz not null default now(),
 primary key(organization_id,period_start,metric)
);
create index if not exists organization_usage_metric_idx on organization_usage_monthly(metric,period_start,organization_id);