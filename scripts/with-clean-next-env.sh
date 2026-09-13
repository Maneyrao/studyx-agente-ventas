#!/usr/bin/env bash
set -euo pipefail

readonly ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly MASK_DIR="$(mktemp -d /private/tmp/studyx-next-env-mask-XXXXXX)"
declare -a MASKED=()

restore_env_files() {
  for filename in "${MASKED[@]}"; do
    if [[ -e "${MASK_DIR}/${filename}" && ! -e "${ROOT}/${filename}" ]]; then
      mv "${MASK_DIR}/${filename}" "${ROOT}/${filename}"
    fi
  done
  rmdir "${MASK_DIR}" 2>/dev/null || true
}
trap restore_env_files EXIT INT TERM

for filename in .env .env.local .env.production .env.production.local .env.development .env.development.local; do
  if [[ -e "${ROOT}/${filename}" ]]; then
    mv "${ROOT}/${filename}" "${MASK_DIR}/${filename}"
    MASKED+=("${filename}")
  fi
done

cd "${ROOT}"
"$@"
