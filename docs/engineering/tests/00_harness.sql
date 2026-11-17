-- test harness (superuser): helper functions, SECURITY INVOKER, executed by app_user
CREATE SCHEMA tt;
GRANT USAGE ON SCHEMA tt TO app_user, app_owner;
CREATE FUNCTION tt.ok(p_name text, p_cond boolean, p_detail text DEFAULT '') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE NOTICE '% % | %', CASE WHEN p_cond THEN 'PASS' ELSE 'FAIL' END, p_name, p_detail;
END $$;
-- run p_sql, expect SQLSTATE p_state
CREATE FUNCTION tt.err(p_name text, p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RAISE NOTICE 'FAIL % | statement succeeded, expected SQLSTATE %', p_name, p_state;
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE = p_state THEN
    RAISE NOTICE 'PASS % | SQLSTATE % (%)', p_name, SQLSTATE, left(SQLERRM, 110);
  ELSE
    RAISE NOTICE 'FAIL % | expected SQLSTATE %, got % (%)', p_name, p_state, SQLSTATE, left(SQLERRM, 110);
  END IF;
END $$;
-- scalar query as integer
CREATE FUNCTION tt.n(p_sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint; BEGIN EXECUTE p_sql INTO v; RETURN v; END $$;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA tt TO app_user, app_owner;
ALTER ROLE app_user PASSWORD 'apppw';
ALTER ROLE app_owner PASSWORD 'ownerpw';
