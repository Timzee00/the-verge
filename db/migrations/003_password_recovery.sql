-- Password recovery tokens are stored as hashes and can only be consumed once.
create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  request_ip inet,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_tokens_user_created
  on password_reset_tokens(user_id, created_at desc);
create index if not exists password_reset_tokens_expiry
  on password_reset_tokens(expires_at) where used_at is null;

create table if not exists password_reset_requests (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists password_reset_requests_email_time
  on password_reset_requests(email_hash, created_at desc);
create index if not exists password_reset_requests_ip_time
  on password_reset_requests(ip_hash, created_at desc);
