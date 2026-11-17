-- roles
CREATE ROLE app_owner LOGIN PASSWORD 'ownerpw' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE app_user NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;  -- NOLOGIN first
ALTER ROLE app_user LOGIN PASSWORD 'userpw';                                   -- then LOGIN
ALTER DATABASE spike OWNER TO app_owner;
ALTER SCHEMA public OWNER TO app_owner;
GRANT CONNECT ON DATABASE spike TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

SET ROLE app_owner;

CREATE TABLE asset (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name      text NOT NULL
);
CREATE INDEX asset_tenant_idx ON asset (tenant_id);
ALTER TABLE asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON asset
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- partitioned audit log (policy on parent)
CREATE TABLE audit_log (
  id         bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id  uuid NOT NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  action     text NOT NULL,
  PRIMARY KEY (id, at)
) PARTITION BY RANGE (at);
CREATE TABLE audit_log_2026_11 PARTITION OF audit_log FOR VALUES FROM ('2026-11-01') TO ('2026-12-01');
CREATE TABLE audit_log_2026_12 PARTITION OF audit_log FOR VALUES FROM ('2026-12-01') TO ('2027-01-01');
CREATE TABLE audit_log_default PARTITION OF audit_log DEFAULT;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- views
CREATE VIEW asset_v_invoker WITH (security_invoker = true) AS SELECT id, tenant_id, name FROM asset;
CREATE VIEW asset_v_definer AS SELECT id, tenant_id, name FROM asset;   -- default: runs with owner rights

-- control table: same shape as asset but WITHOUT force (for test h)
CREATE TABLE asset_noforce (LIKE asset INCLUDING DEFAULTS);
ALTER TABLE asset_noforce ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON asset_noforce
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- hardened variant: NULLIF makes "setting was used earlier on this pooled connection" (empty string) behave like "unset"
CREATE TABLE asset_nullif (LIKE asset INCLUDING DEFAULTS);
ALTER TABLE asset_nullif ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_nullif FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON asset_nullif
  USING      (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- views over the NON-forced table: definer view (default) vs security_invoker view
CREATE VIEW noforce_v_definer AS SELECT id, tenant_id, name FROM asset_noforce;
CREATE VIEW noforce_v_invoker WITH (security_invoker = true) AS SELECT id, tenant_id, name FROM asset_noforce;

GRANT SELECT, INSERT, UPDATE, DELETE ON asset, audit_log, asset_v_invoker, asset_v_definer, asset_noforce, asset_nullif, noforce_v_definer, noforce_v_invoker TO app_user;
-- partitions: grant on audit_log_* too, so test (g) is about RLS rather than privileges
GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log_2026_11, audit_log_2026_12, audit_log_default TO app_user;
RESET ROLE;

-- seed as owner-with-FORCE would be blocked, so seed as superuser (bypasses RLS)
INSERT INTO asset (tenant_id, name)
SELECT t, 'asset-' || left(t::text,4) || '-' || g
FROM (VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid)) v(t), generate_series(1,5) g;
INSERT INTO asset_noforce SELECT * FROM asset;
INSERT INTO asset_nullif SELECT * FROM asset;
INSERT INTO audit_log (tenant_id, at, action) VALUES
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','2026-11-10','login'),
 ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','2026-11-11','create'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','2026-11-12','login'),
 ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','2026-12-02','delete');
