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

# Supabase provisions these before running project migrations. A hosted/CLI
# Supabase project always has the platform's built-in `anon`/`authenticated`
# roles; several migrations (e.g. 20260805000001_universal_business_memory.sql)
# unconditionally REVOKE/GRANT against them. Without creating them here first,
# migrations fail with "role anon does not exist" on a genuinely fresh cluster.
psql_run -c "CREATE SCHEMA IF NOT EXISTS extensions;" >/dev/null
psql_run -c "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;" >/dev/null
psql_run -c "CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;" >/dev/null
psql_run -c "ALTER DATABASE ${TEST_DATABASE} SET search_path TO public, extensions;" >/dev/null
psql_run -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF; END \$\$;" >/dev/null
psql_run -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END \$\$;" >/dev/null

for migration_file in supabase/migrations/*.sql; do
  # KNOWN BUG (discovered 2026-08-17, not fixed here): the migration filename
  # timestamp of 20260805000001_universal_business_memory.sql sorts it before
  # 20260809020001_phase6_knowledge_base.sql, but it was actually authored
  # 2026-08-17. It defines its OWN `knowledge_chunks (source_id -> knowledge_sources)`,
  # which collides with (and is dead code next to) the real, application-used
  # `knowledge_chunks (document_id -> knowledge_documents)` from the phase6
  # migration -- src/lib/services/knowledge-projection.service.ts and
  # knowledge-base.service.ts both INSERT INTO knowledge_chunks (document_id, ...),
  # never source_id. Every fresh apply of supabase/migrations/*.sql in order
  # fails here with "relation knowledge_chunks already exists" -- this has
  # nothing to do with post-call-followup; it silently blocked EVERY fresh
  # rebuild of the disposable cluster today because the cluster was never
  # actually torn down and rebuilt from empty until now. Dropping the unused,
  # never-referenced table here (local disposable DB only, never touches the
  # migration files or DATABASE_URL) unblocks the loop without rewriting an
  # applied migration. The real fix belongs in a follow-up: remove the dead
  # CREATE TABLE block from 20260805000001_universal_business_memory.sql.
  if [[ "$(basename "${migration_file}")" == "20260809020001_phase6_knowledge_base.sql" ]]; then
    psql_run -c "DROP TABLE IF EXISTS knowledge_chunks CASCADE;" >/dev/null
  fi
  psql_run -f "${migration_file}" >/dev/null
done

if [[ "${SEED}" == "--seed" ]]; then
  psql_run -f supabase/seed/dev.sql >/dev/null
fi

table_count="$(psql_run -tAc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public';")"

echo "cluster ready on 127.0.0.1:${PORT} (${table_count} public tables)"
echo "TEST_DATABASE_URL=postgresql://${TEST_USER}@127.0.0.1:${PORT}/${TEST_DATABASE}"
