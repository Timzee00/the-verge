-- THE VERGE — email verification
-- Run after 008_business_modules.sql.

create table if not exists email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_verification_tokens_user_expiry_idx
  on email_verification_tokens(user_id,expires_at desc);

create index if not exists email_verification_tokens_expiry_idx
  on email_verification_tokens(expires_at)
  where consumed_at is null;
