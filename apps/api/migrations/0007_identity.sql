-- 0007_identity [M1]: pre-authentication lookups. NO RLS by design (the tenant is not known yet).
-- Holds hashes and ids only; app_user is granted exactly what authentication needs, per table
-- (ED-05: a separate narrow role and pool take over before M4). Rows carry tenant_id and composite
-- FKs into app.*, so they cannot dangle across tenants. Every table is classified `non-tenant`
-- with an explicit reason in its table comment; app.schema_lint() (0008) enforces that.

create table identity.tenant_directory (
  tenant_id  uuid primary key references app.tenant (id),
  slug       text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  status     text not null default 'active' check (status in ('active','suspended','pending_deletion')),
  cell       text not null default 'us-1',
  created_at timestamptz not null default now()
);
comment on table identity.tenant_directory is
  'non-tenant: control-plane registry (slug -> tenant, status, cell); read before any tenant is known (login routing, scheduler tenant enumeration)';

-- Login by email: which tenants / accounts exist for this address. Same email may exist in several tenants.
create table identity.login_identity (
  tenant_id   uuid not null,
  user_id     uuid not null,
  email_lower text not null check (email_lower = lower(email_lower)),
  status      text not null default 'active' check (status in ('active','disabled')),
  primary key (tenant_id, user_id),
  unique (tenant_id, email_lower),
  foreign key (tenant_id, user_id) references app.user_account (tenant_id, id)
);
create index login_identity_email_idx on identity.login_identity (email_lower);
comment on table identity.login_identity is
  'non-tenant: email -> (tenant, user) lookup; the tenant is what login is trying to discover';

create table identity.credential (
  tenant_id           uuid not null,
  user_id             uuid not null,
  password_hash       text not null,                          -- argon2id PHC string
  must_change         boolean not null default false,
  failed_attempts     integer not null default 0 check (failed_attempts >= 0),
  locked_until        timestamptz,
  password_changed_at timestamptz not null default now(),
  primary key (tenant_id, user_id),
  foreign key (tenant_id, user_id) references app.user_account (tenant_id, id)
);
comment on table identity.credential is
  'non-tenant: password verification runs before the tenant context exists (hash + lockout state only)';

-- MFA-ready: TOTP and WebAuthn/passkey factors. Secrets are envelope-encrypted by the app (KeyProvider).
create table identity.mfa_factor (
  id                uuid primary key,
  tenant_id         uuid not null,
  user_id           uuid not null,
  type              text not null check (type in ('totp','webauthn')),
  label             text,
  secret_encrypted  bytea,                                    -- totp secret ciphertext
  credential_id     bytea,                                    -- webauthn credential id
  public_key        bytea,                                    -- webauthn public key
  sign_count        bigint not null default 0,
  confirmed_at      timestamptz,
  last_used_at      timestamptz,
  created_at        timestamptz not null default now(),
  foreign key (tenant_id, user_id) references app.user_account (tenant_id, id),
  check ((type = 'totp' and secret_encrypted is not null) or (type = 'webauthn' and credential_id is not null and public_key is not null))
);
create index mfa_factor_user_idx on identity.mfa_factor (tenant_id, user_id);
create unique index mfa_factor_webauthn_uq on identity.mfa_factor (credential_id) where credential_id is not null;
comment on table identity.mfa_factor is
  'non-tenant: second-factor verification is part of authentication, before the tenant transaction (encrypted secrets only)';

create table identity.mfa_recovery_code (
  id         uuid primary key,
  tenant_id  uuid not null,
  user_id    uuid not null,
  code_hash  bytea not null,
  used_at    timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, user_id) references app.user_account (tenant_id, id)
);
create index mfa_recovery_code_user_idx on identity.mfa_recovery_code (tenant_id, user_id) where used_at is null;
comment on table identity.mfa_recovery_code is
  'non-tenant: recovery-code verification is part of authentication (hashes only)';

-- Server-side browser sessions; the cookie holds a random token, only its SHA-256 is stored.
create table identity.session (
  id               uuid primary key,
  token_hash       bytea not null unique,
  tenant_id        uuid not null,
  user_id          uuid not null,
  auth_method      text not null check (auth_method in ('password','oidc','saml')),
  mfa_verified_at  timestamptz,
  created_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  idle_expires_at  timestamptz not null,
  expires_at       timestamptz not null,
  revoked_at       timestamptz,
  ip               inet,
  user_agent       text,
  foreign key (tenant_id, user_id) references app.user_account (tenant_id, id),
  check (idle_expires_at <= expires_at)
);
create index session_user_idx on identity.session (tenant_id, user_id) where revoked_at is null;
create index session_expiry_idx on identity.session (expires_at);
comment on table identity.session is
  'non-tenant: the session token hash must resolve to (tenant_id, user_id) before the tenant transaction can open';

-- API keys: Bearer secret = <prefix>.<secret>; lookup by prefix, compare SHA-256 of the secret.
-- Scopes / expiry / revocation live in app.api_key (RLS); revoking also deletes this row.
create table identity.api_key_lookup (
  key_prefix text primary key check (key_prefix ~ '^[A-Za-z0-9]{8,16}$'),
  key_hash   bytea not null,
  tenant_id  uuid not null,
  api_key_id uuid not null,
  foreign key (tenant_id, api_key_id) references app.api_key (tenant_id, id) on delete cascade
);
comment on table identity.api_key_lookup is
  'non-tenant: API-key authentication resolves prefix -> (hash, tenant, key id) before the tenant is known (hash + ids only)';

create table identity.invitation_token (
  token_hash    bytea primary key,
  tenant_id     uuid not null,
  invitation_id uuid not null,
  expires_at    timestamptz not null,
  foreign key (tenant_id, invitation_id) references app.invitation (tenant_id, id) on delete cascade
);
comment on table identity.invitation_token is
  'non-tenant: an invitation link carries only a token; the hash resolves to (tenant, invitation) before any tenant context (hash + ids only)';

-- OIDC login (Google / Microsoft): (provider, subject) -> account. Same subject may map in several tenants.
create table identity.external_identity (
  provider   text not null check (provider in ('google','microsoft','oidc')),
  subject    text not null,
  tenant_id  uuid not null,
  user_id    uuid not null,
  created_at timestamptz not null default now(),
  primary key (provider, subject, tenant_id),
  foreign key (tenant_id, user_id) references app.user_account (tenant_id, id)
);
create index external_identity_user_idx on identity.external_identity (tenant_id, user_id);
comment on table identity.external_identity is
  'non-tenant: SSO login maps (provider, subject) to an account before the tenant is known';

-- Control-plane security log (M1-TEN-08): failed logins and invalid API keys are recorded here, NOT in the
-- tenant audit log (the tenant may be unknown or hostile). Append-only for app_user.
create table identity.security_event (
  id         uuid primary key,
  at         timestamptz not null default now(),
  event_type text not null check (event_type in ('login_failed','api_key_invalid','session_invalid','tenant_inactive','other')),
  tenant_id  uuid,                                           -- when known; deliberately no FK (the claim may be forged)
  subject    text,                                           -- email (lower), key prefix, ...: never a secret
  ip         inet,
  user_agent text,
  request_id text,
  detail     jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object')
);
create index security_event_at_idx on identity.security_event (at desc, id desc);
create index security_event_subject_idx on identity.security_event (subject, at desc) where subject is not null;
comment on table identity.security_event is
  'non-tenant: control-plane security log for events with no trustworthy tenant (failed logins, invalid API keys)';

-- Grants (explicit, narrow, per table).
grant select, insert, update         on identity.tenant_directory   to app_user;
grant select, insert, update, delete on identity.login_identity     to app_user;
grant select, insert, update         on identity.credential         to app_user;
grant select, insert, update, delete on identity.mfa_factor         to app_user;
grant select, insert, update, delete on identity.mfa_recovery_code  to app_user;
grant select, insert, update, delete on identity.session            to app_user;
grant select, insert, delete         on identity.api_key_lookup     to app_user;
grant select, insert, delete         on identity.invitation_token   to app_user;
grant select, insert, delete         on identity.external_identity  to app_user;
grant select, insert                 on identity.security_event     to app_user;
