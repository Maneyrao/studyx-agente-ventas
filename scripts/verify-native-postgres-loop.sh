#!/usr/bin/env bash

set -euo pipefail

readonly PG17_BIN="/opt/homebrew/opt/postgresql@17/bin"
readonly TEST_DATABASE="studyx_test"
readonly TEST_USER="postgres"

if [[ ! -x "${PG17_BIN}/initdb" ]]; then
  echo "PostgreSQL 17 is not installed at ${PG17_BIN}" >&2
  exit 1
fi

active_cluster=""

stop_active_cluster() {
  if [[ -n "${active_cluster}" ]] && [[ -f "${active_cluster}/postmaster.pid" ]]; then
    "${PG17_BIN}/pg_ctl" -D "${active_cluster}" -m fast stop >/dev/null 2>&1 || true
  fi
}

trap stop_active_cluster EXIT

for iteration in 1 2 3; do
  port=$((55432 + iteration))
  active_cluster="$(mktemp -d "/private/tmp/studyx-pg17-loop-${iteration}.XXXXXX")"

  echo "migration loop ${iteration}/3 on port ${port}"

  "${PG17_BIN}/initdb" \
    -D "${active_cluster}" \
    --auth=trust \
    --username="${TEST_USER}" >/dev/null

  "${PG17_BIN}/pg_ctl" \
    -D "${active_cluster}" \
    -l "${active_cluster}/postgres.log" \
    -o "-p ${port} -k /private/tmp" \
    start >/dev/null

  "${PG17_BIN}/createdb" \
    -h /private/tmp \
    -p "${port}" \
    -U "${TEST_USER}" \
    "${TEST_DATABASE}"

  "${PG17_BIN}/psql" \
    -h /private/tmp \
    -p "${port}" \
    -U "${TEST_USER}" \
    -d "${TEST_DATABASE}" \
    -v ON_ERROR_STOP=1 \
    -c 'CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;' \
    >/dev/null

  for migration_file in supabase/migrations/*.sql; do
    "${PG17_BIN}/psql" \
      -h /private/tmp \
      -p "${port}" \
      -U "${TEST_USER}" \
      -d "${TEST_DATABASE}" \
      -v ON_ERROR_STOP=1 \
      -f "${migration_file}" \
      >/dev/null
  done

  "${PG17_BIN}/psql" \
    -h /private/tmp \
    -p "${port}" \
    -U "${TEST_USER}" \
    -d "${TEST_DATABASE}" \
    -v ON_ERROR_STOP=1 \
    -f supabase/seed/dev.sql \
    >/dev/null

  "${PG17_BIN}/psql" \
    -h /private/tmp \
    -p "${port}" \
    -U "${TEST_USER}" \
    -d "${TEST_DATABASE}" \
    -v ON_ERROR_STOP=1 \
    -c "SELECT count(*) AS migrations_ready FROM pg_tables WHERE schemaname = 'public';" \
    >/dev/null

  "${PG17_BIN}/pg_ctl" -D "${active_cluster}" -m fast stop >/dev/null
  echo "migration loop ${iteration}/3 passed; cluster retained at ${active_cluster}"
  active_cluster=""
done

echo "all three isolated PostgreSQL migration loops passed"

