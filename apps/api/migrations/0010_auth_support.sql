-- 0010_auth_support [M1-AUTH]: identity tables the authentication flows need that 0007 does not have.
-- All are pre-authentication lookups: NO RLS by design (the tenant is not known yet), hashes and ids
-- only, classified `non-tenant` with a reason (app.schema_lint, 0008). ED-05 applies: the auth module
-- is the only code that touches them, so a later narrow role is a grants change.

-- Password reset: mirrors identity.invitation_token. The email link carries a random secret, only its
-- SHA-256 is stored; single use (used_at), short expiry (the app uses 1 hour).
create table identity.password_reset_token (
  token_hash bytea primary key,
  tenant_id  uuid not null,
  user_id    uuid not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, user_id) references app.user_account (tenant_id, id)
);
create index password_reset_token_user_idx on identity.password_reset_token (tenant_id, user_id);
comment on table identity.password_reset_token is
  'non-tenant: a reset link carries only a token; the hash resolves to (tenant, user) before any tenant context (hash + ids only)';

-- Pending second-factor challenge after a correct password (POST /v1/auth/login -> mfa_required ->
-- POST /v1/auth/mfa/verify). The challenge id handed to the client is a random secret; only its hash is
-- stored. Short lived, bounded attempts, single use: no session exists until it is consumed.
create table identity.mfa_challenge (
  token_hash  bytea primary key,
  tenant_id   uuid not null,
  user_id     uuid not null,
  expires_at  timestamptz not null,
  attempts    integer not null default 0 check (attempts >= 0),
  consumed_at timestamptz,
  ip          inet,
  user_agent  text,
  created_at  timestamptz not null default now(),
  foreign key (tenant_id, user_id) references app.user_account (tenant_id, id)
);
create index mfa_challenge_user_idx on identity.mfa_challenge (tenant_id, user_id);
create index mfa_challenge_expiry_idx on identity.mfa_challenge (expires_at);
comment on table identity.mfa_challenge is
  'non-tenant: the login challenge is verified before a session (and so a tenant context) exists (hash + ids only)';

-- Fixed-window counters for throttling logins, password resets and MFA attempts per IP / per account
-- (the M1 implementation of the backlog throttle; the store sits behind an interface so Redis can replace it).
-- `bucket` is a namespaced key such as 'login:ip:203.0.113.7' or 'login:acct:<sha256 of email>': never a raw secret.
create table identity.auth_throttle (
  bucket       text        not null check (length(bucket) <= 200),
  window_start timestamptz not null,
  hits         integer     not null default 0 check (hits >= 0),
  primary key (bucket, window_start)
);
create index auth_throttle_window_idx on identity.auth_throttle (window_start);
comment on table identity.auth_throttle is
  'non-tenant: request throttling counters keyed by IP or hashed account, read before authentication';

-- TOTP replay protection: the last accepted 30-second time step; a code from the same or an earlier step is rejected.
alter table identity.mfa_factor add column last_used_step bigint;

-- More event types for the control-plane security log.
alter table identity.security_event drop constraint security_event_event_type_check;
alter table identity.security_event add constraint security_event_event_type_check check (event_type in (
  'login_failed','api_key_invalid','session_invalid','tenant_inactive','other',
  'account_locked','mfa_failed','password_reset_requested','password_reset_failed',
  'invitation_token_invalid','csrf_rejected','throttled'));

grant select, insert, update, delete on identity.password_reset_token to app_user;
grant select, insert, update, delete on identity.mfa_challenge        to app_user;
grant select, insert, update, delete on identity.auth_throttle        to app_user;
