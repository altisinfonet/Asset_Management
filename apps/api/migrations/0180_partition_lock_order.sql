-- 0180_partition_lock_order [ED-29 verification; AUDIT B.27]: `app.ensure_partitions` can no longer
-- deadlock with a write.
-- Creating a partition is DDL. For `asset_history` it takes ACCESS EXCLUSIVE on the parent and then
-- SHARE ROW EXCLUSIVE on `app.asset` (the partition clones the foreign key). A custody action takes the
-- locks the other way round: it updates `app.asset`, then inserts into `asset_history` (and `audit_log`).
-- When both met, Postgres aborted one of them; when the victim was the custody action, a user's check-in
-- answered 500 (the "deadlock" flake of AUDIT B.13 / B.22: the e2e test that creates far-future
-- partitions ran next to custody tests).
-- Now the function first works out whether anything is missing and, if so, takes EVERY lock it will need
-- in one go and with NOWAIT: the tables the partitioned parents reference (SHARE ROW EXCLUSIVE), then the
-- parents and their default partitions (ACCESS EXCLUSIVE). It never waits while holding a lock, so it
-- cannot be part of a deadlock cycle; when a lock is taken it fails at once with 55P03
-- (lock_not_available), having done nothing, and `ensurePartitions` (src/db/maintenance.ts) tries again
-- after a pause. The body below the lock step is the definition of 0006, unchanged.
-- Migration range 0180-0189 belongs to this change.

create or replace function app.ensure_partitions(p_from date, p_months integer) returns integer
language plpgsql set search_path = pg_catalog as $$
declare
  v_parent  text;
  v_start   date;
  v_name    text;
  v_created integer := 0;
  v_guard   text := app.tenant_guard();
  v_missing boolean := false;
  v_refs    text;
  v_parents text;
begin
  if p_months < 0 or p_months > 120 then
    raise exception 'p_months must be between 0 and 120';
  end if;

  -- 1. anything to do? (an idempotent call takes no lock at all)
  for v_parent in
    select c.relname::text from pg_class c
     where c.relnamespace = 'app'::regnamespace and c.relkind = 'p'
  loop
    if to_regclass('app.' || quote_ident(v_parent || '_default')) is null then
      v_missing := true;
    end if;
    for i in 0 .. p_months - 1 loop
      v_start := (date_trunc('month', p_from) + make_interval(months => i))::date;
      if to_regclass('app.' || quote_ident(v_parent || '_' || to_char(v_start, 'YYYY_MM'))) is null then
        v_missing := true;
      end if;
    end loop;
  end loop;
  if not v_missing then
    return 0;
  end if;

  -- 2. every lock up front, never waiting: referenced tables first (the order writers use), then the
  --    parents and their existing default partitions
  select string_agg(format('%I.%I', n.nspname, r.relname), ', ' order by n.nspname, r.relname)
    into v_refs
    from (select distinct con.confrelid
            from pg_constraint con
            join pg_class p on p.oid = con.conrelid
           where con.contype = 'f' and p.relkind = 'p' and p.relnamespace = 'app'::regnamespace
             and con.confrelid <> con.conrelid) f
    join pg_class r on r.oid = f.confrelid
    join pg_namespace n on n.oid = r.relnamespace;
  if v_refs is not null then
    execute format('lock table %s in share row exclusive mode nowait', v_refs);
  end if;
  select string_agg(format('app.%I', c.relname), ', ' order by c.relname)
    into v_parents
    from pg_class c
   where c.relnamespace = 'app'::regnamespace
     and (c.relkind = 'p'
          or (c.relispartition and c.relname like '%\_default'
              and exists (select 1 from pg_inherits i join pg_class p on p.oid = i.inhparent
                           where i.inhrelid = c.oid and p.relkind = 'p'
                             and c.relname = p.relname || '_default')));
  if v_parents is not null then
    execute format('lock table %s in access exclusive mode nowait', v_parents);
  end if;

  -- 3. the partitions (as in 0006)
  for v_parent in
    select c.relname::text from pg_class c
     where c.relnamespace = 'app'::regnamespace and c.relkind = 'p' order by c.relname
  loop
    for i in 0 .. p_months - 1 loop
      v_start := (date_trunc('month', p_from) + make_interval(months => i))::date;
      v_name  := v_parent || '_' || to_char(v_start, 'YYYY_MM');
      if to_regclass('app.' || quote_ident(v_name)) is null then
        execute format('create table app.%I partition of app.%I for values from (%L) to (%L)',
                       v_name, v_parent,
                       to_char(v_start, 'YYYY-MM-DD') || ' 00:00:00+00',
                       to_char((v_start + interval '1 month')::date, 'YYYY-MM-DD') || ' 00:00:00+00');
        execute format('alter table app.%I enable row level security', v_name);
        execute format('alter table app.%I force row level security', v_name);
        execute format('create policy tenant_isolation on app.%I using (tenant_id = %s) with check (tenant_id = %s)',
                       v_name, v_guard, v_guard);
        v_created := v_created + 1;
      end if;
    end loop;
    v_name := v_parent || '_default';
    if to_regclass('app.' || quote_ident(v_name)) is null then
      execute format('create table app.%I partition of app.%I default', v_name, v_parent);
      execute format('alter table app.%I enable row level security', v_name);
      execute format('alter table app.%I force row level security', v_name);
      execute format('create policy tenant_isolation on app.%I using (tenant_id = %s) with check (tenant_id = %s)',
                     v_name, v_guard, v_guard);
      v_created := v_created + 1;
    end if;
  end loop;
  return v_created;
end
$$;
revoke all on function app.ensure_partitions(date, integer) from public;
