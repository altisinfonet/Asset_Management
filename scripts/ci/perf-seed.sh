#!/usr/bin/env bash
# Seeds the performance dataset (M1-CI-05): PERF_ASSETS assets (default 50,000) in EACH demo tenant
# (Acme and Globex), so "2 x 50,000 assets, a second large tenant present" holds when
# scripts/ci/perf-check.mjs measures the registry budgets as the demo Viewer of Acme.
#
#   scripts/ci/perf-seed.sh                              # 2 x 50,000 into the stack of COMPOSE_PROJECT=ci-perf
#   COMPOSE_PROJECT=atm1 PERF_ASSETS=2000 scripts/ci/perf-seed.sh
#
# Environment (all optional):
#   COMPOSE_PROJECT   compose project of the running stack      (default: ci-perf)
#   PERF_ASSETS       assets per tenant                         (default: 50000)
#   PERF_TENANTS      space separated demo tenant slugs         (default: "acme globex")
#
# One INSERT .. SELECT generate_series per tenant, run as the Postgres superuser inside the postgres
# container (RLS does not apply to it, so every row carries its tenant_id explicitly). It reuses the
# tenant's own demo categories, models, vendors and status labels, so the rows are valid registry data.
# Idempotent: tags are `PERF-000001 ...`; a second run adds nothing (it tops up to PERF_ASSETS).
# Ends with VACUUM ANALYZE so the planner statistics are those of a settled table.
set -euo pipefail
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/../.."
PROJECT="${COMPOSE_PROJECT:-ci-perf}"
N="${PERF_ASSETS:-50000}"
TENANTS="${PERF_TENANTS:-acme globex}"
compose() { docker compose -p "$PROJECT" "$@"; }
psql_() { compose exec -T postgres psql -U postgres -d app -v ON_ERROR_STOP=1 -X -q "$@"; }

for slug in $TENANTS; do
  tenant="$(psql_ -At -c "select tenant_id from identity.tenant_directory where slug = '$slug'")"
  [ -n "$tenant" ] || { echo "[perf-seed] no demo tenant '$slug' (is SEED_DEMO_DATA on?)" >&2; exit 1; }
  echo "[perf-seed] $slug ($tenant): topping up to $N perf assets"
  psql_ -v tenant="$tenant" -v n="$N" <<'SQL'
select set_config('app.tenant_id', :'tenant', false) as _ \gset
with have as (
  select count(*)::int as c from app.asset where tenant_id = :'tenant'::uuid and asset_tag like 'PERF-%'
), pairs as (
  -- model -> its category; the asset takes both, so the pair is always consistent
  select array_agg(id order by id) as models, array_agg(category_id order by id) as cats
    from app.asset_model where tenant_id = :'tenant'::uuid and archived_at is null
), vend as (
  select array_agg(id order by id) as v from app.vendor where tenant_id = :'tenant'::uuid and archived_at is null
), st as (
  select array_agg(id order by id) as s from app.status_label where tenant_id = :'tenant'::uuid and archived_at is null
)
insert into app.asset (id, tenant_id, company_id, asset_tag, name, serial, category_id, model_id, vendor_id, status_id,
                       purchase_date, purchase_cost_minor, currency, warranty_end, order_number, notes, custom_data,
                       created_at, updated_at, archived_at)
select gen_random_uuid(), :'tenant'::uuid,
       (select id from app.company where tenant_id = :'tenant'::uuid and is_default limit 1),
       'PERF-' || lpad(g::text, 6, '0'),
       (array['ThinkPad','Latitude','MacBook','EliteBook','UltraSharp','iPhone','Catalyst','LaserJet'])[1 + g % 8] || ' device ' || g,
       'SN' || upper(substr(md5(g::text), 1, 10)),
       pairs.cats[1 + g % cardinality(pairs.cats)], pairs.models[1 + g % cardinality(pairs.models)],
       vend.v[1 + g % cardinality(vend.v)], st.s[1 + (g * 31) % cardinality(st.s)],
       date '2022-01-01' + (g % 1400), 50000 + (g % 200) * 500, 'USD', date '2025-01-01' + (g % 1000),
       'PO-' || (1000 + g % 400),
       case when g % 10 = 0 then 'Imaged with the standard build; asset sticker on the lid.' else null end,
       jsonb_build_object('os', (array['macOS','Windows 11','Ubuntu'])[1 + g % 3], 'cost_center', 'CC-' || (g % 20)),
       now() - (g * 13 || ' seconds')::interval, now() - (g * 13 || ' seconds')::interval,
       case when g % 33 = 0 then now() else null end
  from have, pairs, vend, st, generate_series(have.c + 1, :n::int) g
 where cardinality(pairs.models) > 0;
SQL
done

echo "[perf-seed] analyzing"
psql_ -c 'vacuum (analyze) app.asset' -c 'vacuum (analyze) app.asset_model' -c 'vacuum (analyze) app.status_label'
for slug in $TENANTS; do
  c="$(psql_ -At -c "select count(*) from app.asset a join identity.tenant_directory d on d.tenant_id = a.tenant_id where d.slug = '$slug' and a.asset_tag like 'PERF-%'")"
  echo "[perf-seed] $slug: $c perf assets"
done
