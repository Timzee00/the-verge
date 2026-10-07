-- THE VERGE — account recovery
-- Run after 004_scale_foundation.sql.

create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  requested_ip inet,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_expiry_idx
  on password_reset_tokens(user_id,expires_at desc);

create index if not exists password_reset_tokens_expiry_idx
  on password_reset_tokens(expires_at)
  where consumed_at is null;
