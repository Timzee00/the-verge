-- THE VERGE — reusable AI insight cache
-- Run after 009_saas_billing.sql.

create table if not exists ai_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  scope_key text not null default 'all',
  insight_kind text not null,
  source_change_seq bigint not null default 0,
  content text not null,
  model text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique(organization_id,scope_key,insight_kind,source_change_seq)
);
create index if not exists ai_insights_lookup_idx
  on ai_insights(organization_id,scope_key,insight_kind,source_change_seq,expires_at desc);
create index if not exists ai_insights_expiry_idx on ai_insights(expires_at);

comment on table ai_insights is
  'Short-lived grounded AI output cache. source_change_seq prevents reuse after synchronized business data changes.';
