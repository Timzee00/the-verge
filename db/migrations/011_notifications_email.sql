-- THE VERGE — business email and notification foundation
-- Run after 010_ai_insight_cache.sql.

create table if not exists notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  channel text not null check (channel in ('email','in_app','whatsapp')),
  event_code text not null,
  enabled boolean not null default true,
  digest text not null default 'instant' check (digest in ('instant','daily','weekly','off')),
  updated_at timestamptz not null default now(),
  unique (organization_id,user_id,channel,event_code)
);
create index if not exists notification_preferences_lookup
  on notification_preferences(organization_id,user_id,channel,event_code,enabled);

create table if not exists outbound_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
  customer_id uuid references customers(id) on delete set null,
  channel text not null check (channel in ('email','whatsapp')),
  message_kind text not null check (message_kind in ('transactional','operational','marketing','security')),
  template_code text not null,
  recipient text not null,
  subject text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','sending','sent','failed','cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbound_messages_queue_idx
  on outbound_messages(status,next_attempt_at,created_at)
  where status in ('queued','failed');

create table if not exists customer_communication_preferences (
  organization_id uuid not null references organizations(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  email_transactional boolean not null default true,
  email_marketing boolean not null default false,
  whatsapp_transactional boolean not null default true,
  whatsapp_marketing boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (organization_id,customer_id)
);

comment on table outbound_messages is
  'Asynchronous delivery queue for customer and staff communications. Transactional and marketing traffic remain distinct.';
