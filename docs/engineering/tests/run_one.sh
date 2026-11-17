#!/bin/bash
# usage: run_one.sh <pgversion>   -> container atdec<ver>
export MSYS_NO_PATHCONV=1
V=$1; N=atdec$V
HERE="$(cd "$(dirname "$0")" && pwd -W 2>/dev/null || pwd)"; LOGDIR="${LOGDIR:-${TMPDIR:-/tmp}/atdec-logs}"; mkdir -p "$LOGDIR"; L="$LOGDIR/log_$V"
SP="$HERE"
SCHEMA="$HERE/../schema.sql"
docker rm -f $N >/dev/null 2>&1
docker run -d --name $N -e POSTGRES_PASSWORD=x postgres:$V >/dev/null
for i in $(seq 1 60); do docker exec $N pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break; sleep 1; done
sleep 3
docker exec $N pg_isready -U postgres -h 127.0.0.1
docker exec $N psql -U postgres -Atc "select version()"
docker cp "$SCHEMA" $N:/tmp/schema.sql
for f in 00_harness 10_setup 20_fresh_conn 30_tests 40_owner; do docker cp "$SP/$f.sql" $N:/tmp/$f.sql; done
echo "=== apply schema.sql"
docker exec $N psql -v ON_ERROR_STOP=1 -U postgres -f /tmp/schema.sql 2>&1 | grep -v "^$" | tail -15
echo "=== harness + setup"
docker exec $N psql -v ON_ERROR_STOP=1 -U postgres -f /tmp/00_harness.sql 2>&1 | tail -3
docker exec -e PGPASSWORD=apppw $N psql -h 127.0.0.1 -v ON_ERROR_STOP=1 -U app_user -d postgres -f /tmp/10_setup.sql 2>&1 | tail -5
echo "=== fresh connection tests (app_user)"
docker exec -e PGPASSWORD=apppw $N psql -h 127.0.0.1 -U app_user -d postgres -f /tmp/20_fresh_conn.sql > $L.fresh.log 2>&1
echo "=== main tests (app_user)"
docker exec -e PGPASSWORD=apppw $N psql -h 127.0.0.1 -U app_user -d postgres -f /tmp/30_tests.sql > $L.main.log 2>&1
echo "=== owner tests (app_owner)"
docker exec -e PGPASSWORD=ownerpw $N psql -h 127.0.0.1 -U app_owner -d postgres -f /tmp/40_owner.sql > $L.owner.log 2>&1
cat $L.fresh.log $L.main.log $L.owner.log > $L.all.log
echo "PASS=$(grep -c 'NOTICE:  PASS' $L.all.log) FAIL=$(grep -c 'FAIL' $L.all.log) ERRORS=$(grep -c 'ERROR' $L.all.log)"
