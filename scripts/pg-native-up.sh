#!/usr/bin/env bash
#
# Disposable native PostgreSQL 17 + pgvector cluster for local verification.
#
# Docker is not available on this machine, so `supabase start` (and therefore
# `supabase db reset --local`, `supabase db lint --local` and `supabase test db`)
# cannot run. This script provides the equivalent substrate the integration
# suite needs: a throwaway PG17 cluster on an approved loopback port with every
# migration in `supabase/migrations/` applied in order.
#
# Approved ports come from `tests/helpers/db.ts` (55432-55435). Never point this
# at a shared or remote database: the cluster directory is created fresh and the
# script refuses to reuse an existing data directory.
#
# Usage:
#   scripts/pg-native-up.sh [port] [--seed]
#   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration
#   scripts/pg-native-down.sh [port]

set -euo pipefail

readonly PG17_BIN="/opt/homebrew/opt/postgresql@17/bin"
readonly TEST_DATABASE="studyx_test"
readonly TEST_USER="postgres"

PORT="${1:-55433}"
SEED="${2:-}"

case "${PORT}" in
  55432|55433|55434|55435) ;;
  *)
    echo "Refusing port ${PORT}: only 55432-55435 are approved disposable ports (tests/helpers/db.ts)." >&2
    exit 1
    ;;
esac

if [[ ! -x "${PG17_BIN}/initdb" ]]; then
  echo "PostgreSQL 17 is not installed at ${PG17_BIN}" >&2
  exit 1
fi

readonly CLUSTER="/private/tmp/studyx-pg17-${PORT}"

if [[ -f "${CLUSTER}/postmaster.pid" ]]; then
  echo "Cluster already running on port ${PORT} at ${CLUSTER}"
  echo "TEST_DATABASE_URL=postgresql://${TEST_USER}@127.0.0.1:${PORT}/${TEST_DATABASE}"
  exit 0
fi

rm -rf "${CLUSTER}"
mkdir -p "${CLUSTER}"

"${PG17_BIN}/initdb" -D "${CLUSTER}" --auth=trust --username="${TEST_USER}" >/dev/null

"${PG17_BIN}/pg_ctl" \
  -D "${CLUSTER}" \
  -l "${CLUSTER}/postgres.log" \
  -o "-p ${PORT} -k /private/tmp -c listen_addresses=127.0.0.1 -c max_connections=200" \
  -w start >/dev/null

"${PG17_BIN}/createdb" -h 127.0.0.1 -p "${PORT}" -U "${TEST_USER}" "${TEST_DATABASE}"

psql_run() {
  "${PG17_BIN}/psql" \
    -h 127.0.0.1 \
    -p "${PORT}" \
    -U "${TEST_USER}" \
    -d "${TEST_DATABASE}" \
    -v ON_ERROR_STOP=1 \
    --quiet \
    "$@"
}

# Supabase provisions these before running project migrations.
psql_run -c "CREATE SCHEMA IF NOT EXISTS extensions;" >/dev/null
psql_run -c "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;" >/dev/null
psql_run -c "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;" >/dev/null
psql_run -c "ALTER DATABASE ${TEST_DATABASE} SET search_path TO public, extensions;" >/dev/null

for migration_file in supabase/migrations/*.sql; do
  psql_run -f "${migration_file}" >/dev/null
done

if [[ "${SEED}" == "--seed" ]]; then
  psql_run -f supabase/seed/dev.sql >/dev/null
fi

table_count="$(psql_run -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")"

echo "cluster ready on 127.0.0.1:${PORT} (${table_count} public tables)"
echo "TEST_DATABASE_URL=postgresql://${TEST_USER}@127.0.0.1:${PORT}/${TEST_DATABASE}"
