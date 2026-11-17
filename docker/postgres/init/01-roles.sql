-- Runs once on first start of an empty data directory (docker-entrypoint-initdb.d), against the
-- POSTGRES_DB database (`app`). DEV ONLY: dummy credentials. Mirrors the production RLS model:
--   migrator  owns the schema, runs migrations (DIRECT connection)
--   app       runtime role: no ownership, NOSUPERUSER, NOBYPASSRLS (so RLS always applies)
create role migrator login password 'dev' nosuperuser nocreaterole nocreatedb;
create role app login password 'dev' nosuperuser nocreaterole nocreatedb nobypassrls;

alter database app owner to migrator;
revoke all on database app from public;
grant connect on database app to app;

alter schema public owner to migrator;
revoke all on schema public from public;
grant usage on schema public to app;

-- Objects created by migrator are usable by app (data access only, never DDL).
alter default privileges for role migrator in schema public
  grant select, insert, update, delete on tables to app;
alter default privileges for role migrator in schema public
  grant usage, select on sequences to app;

create extension if not exists pg_trgm;
