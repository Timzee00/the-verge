-- THE VERGE — Brevo transactional delivery events
-- Run after 011_notifications_email.sql.

alter table outbound_messages add column if not exists delivery_status text;
alter table outbound_messages add column if not exists delivered_at timestamptz;
alter table outbound_messages add column if not exists opened_at timestamptz;
alter table outbound_messages add column if not exists clicked_at timestamptz;
alter table outbound_messages add column if not exists bounced_at timestamptz;
alter table outbound_messages add column if not exists unsubscribed_at timestamptz;
alter table outbound_messages add column if not exists complaint_at timestamptz;

create table if not exists email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  outbound_message_id uuid references outbound_messages(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  provider text not null default 'brevo',
  provider_message_id text,
  provider_webhook_id bigint,
  event_type text not null,
  recipient text,
  occurred_at timestamptz not null,
  reason text,
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists email_delivery_events_message_idx
  on email_delivery_events(outbound_message_id,occurred_at desc);
create index if not exists email_delivery_events_org_idx
  on email_delivery_events(organization_id,occurred_at desc);

comment on table email_delivery_events is
  'Immutable Brevo transactional email events. dedupe_key prevents repeated webhook delivery from creating duplicates.';
