#!/usr/bin/env bash
#
# Stop and delete a disposable cluster created by scripts/pg-native-up.sh.

set -euo pipefail

readonly PG17_BIN="/opt/homebrew/opt/postgresql@17/bin"

PORT="${1:-55433}"
readonly CLUSTER="/private/tmp/studyx-pg17-${PORT}"

if [[ -f "${CLUSTER}/postmaster.pid" ]]; then
  "${PG17_BIN}/pg_ctl" -D "${CLUSTER}" -m fast stop >/dev/null 2>&1 || true
fi

rm -rf "${CLUSTER}"
echo "cluster on port ${PORT} stopped and removed"
