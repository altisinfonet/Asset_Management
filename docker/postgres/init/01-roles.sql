-- Bootstrap (superuser) for the application database. Runs once on first start of an empty data
-- directory (docker-entrypoint-initdb.d, against POSTGRES_DB), and in CI / BYO Postgres via:
--
--   psql -h <host> -U postgres -d <db> -v ON_ERROR_STOP=1 -f docker/postgres/init/01-roles.sql
--
-- Roles (names match docs/engineering/schema.sql and the schema lint; see ADR 0001):
--   app_owner  owns the database and every object, runs migrations over a DIRECT connection.
--              Plain role (not superuser, no BYPASSRLS): FORCE RLS binds it too.
--   app_user   runtime role (api / worker / scheduler, through PgBouncer): owns nothing, no DDL,
--              NOBYPASSRLS, no default privileges; every grant is explicit in a migration.
--
-- Passwords default to the DEV value `dev`. Override with psql variables, never commit real ones:
--   -v app_owner_password=... -v app_user_password=...
-- Idempotent: safe to re-run (CI, BYO Postgres). Schemas `app` / `identity` and the grants on
-- them are created by the migrations (they run as app_owner), not here.

\if :{?app_owner_password}
\else
  \set app_owner_password dev
\endif
\if :{?app_user_password}
\else
  \set app_user_password dev
\endif

select format('create role app_owner login password %L nosuperuser nobypassrls nocreatedb nocreaterole noreplication', :'app_owner_password')
 where not exists (select 1 from pg_roles where rolname = 'app_owner') \gexec
select format('create role app_user login password %L nosuperuser nobypassrls nocreatedb nocreaterole noreplication noinherit', :'app_user_password')
 where not exists (select 1 from pg_roles where rolname = 'app_user') \gexec

select format('alter role app_owner password %L', :'app_owner_password') \gexec
select format('alter role app_user password %L', :'app_user_password') \gexec

-- The owner owns the database (so it can create schemas and trusted extensions); nobody else
-- connects by default.
select format('alter database %I owner to app_owner', current_database()) \gexec
select format('revoke all on database %I from public', current_database()) \gexec
select format('grant connect on database %I to app_user', current_database()) \gexec

-- Extension objects (gin_trgm_ops, ...) live in `public`; keep it readable but not writable.
alter schema public owner to app_owner;
revoke all on schema public from public;
grant usage on schema public to app_user;

-- pg_trgm: fuzzy search on tag / serial / name. btree_gin: GIN indexes that lead with tenant_id.
create extension if not exists pg_trgm   schema public;
create extension if not exists btree_gin schema public;

-- Unqualified names resolve to the application schemas first (the migrations still qualify).
alter role app_owner set search_path = app, identity, public;
alter role app_user  set search_path = app, identity, public;

-- NOTE: no ALTER DEFAULT PRIVILEGES anywhere. Defaults would also cover new partitions, which
-- must never be granted to app_user (docs/03_system_architecture.md 5.3). Grants are explicit.
