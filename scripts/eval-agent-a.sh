#!/usr/bin/env bash
#
# Evaluación local aislada del Agente A.
#
# Levanta un cluster desechable, arranca la API contra ÉL —nunca contra la
# Supabase de producción de `.env.local`— y corre una suite N veces con un
# juego de flags.
#
# El aislamiento no depende de que quien corre esto se acuerde:
# `scripts/lib/eval-isolation.ts` inspecciona el entorno y aborta si la base
# no es un cluster desechable en loopback, si hay alguna credencial de efecto
# externo cargada, o si falta la clave del modelo bajo evaluación.
#
# Uso:
#   scripts/eval-agent-a.sh <suite> <repeticiones> <etiqueta> [--repair]
#
# Ejemplo:
#   scripts/eval-agent-a.sh studyx-agent-a-conversational-baseline 3 base
#   scripts/eval-agent-a.sh studyx-agent-a-conversational-baseline 3 rep --repair

set -euo pipefail

readonly SUITE="${1:?falta la suite}"
readonly REPETICIONES="${2:?faltan las repeticiones}"
readonly ETIQUETA="${3:?falta la etiqueta}"
readonly MODO="${4:-}"

readonly RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PUERTO=55435
readonly EVAL_ROOT="${RAIZ}/.eval"
readonly DB_URL="postgresql://postgres@127.0.0.1:${PUERTO}/studyx_test"

cd "${RAIZ}"

if [[ ! -f "${EVAL_ROOT}/.env.local" ]]; then
  echo "Falta ${EVAL_ROOT}/.env.local (ver docs/operaciones/evaluacion-aislada.md)" >&2
  exit 1
fi

# `env -i` no alcanza: bash reexporta lo suyo. Se construye el entorno a mano
# y se deja fuera TODO lo que no está en el archivo de evaluación, que es
# justamente cómo se apagan Telegram, Stripe, Sheets y Retell.
set -a
# shellcheck disable=SC1091
source "${EVAL_ROOT}/.env.local"
set +a
export DATABASE_URL="${DB_URL}"
export TEST_DATABASE_URL="${DB_URL}"
export STUDYX_LOCAL_CREDENTIALS_ROOT="${EVAL_ROOT}"
export GEMINI_API_KEY=""
export GROQ_API_KEY=""
export OPENAI_API_KEY=""

if [[ "${MODO}" == "--repair" ]]; then
  export AGENT_A_CONTEXT_SCOPING=true
  export AGENT_A_REPAIR_ENABLED=true
  export AGENT_A_STATE_ASSERTIONS=true
fi

npx tsx -e '
  import { assertIsolatedEvaluationEnvironmentV1 } from "./scripts/lib/eval-isolation";
  assertIsolatedEvaluationEnvironmentV1(process.env);
  console.error("aislamiento verificado: cluster desechable, sin credenciales externas");
'

scripts/pg-native-down.sh "${PUERTO}" >/dev/null 2>&1 || true
scripts/pg-native-up.sh "${PUERTO}" --seed >/dev/null
echo "cluster limpio en 127.0.0.1:${PUERTO}" >&2

npm run build >/dev/null 2>&1
npm run start -- --port 3000 >"${EVAL_ROOT}/api-${ETIQUETA}.log" 2>&1 &
readonly API_PID=$!
trap 'kill "${API_PID}" 2>/dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -sf http://127.0.0.1:3000/api/ready >/dev/null 2>&1; then break; fi
  sleep 1
done

for i in $(seq 1 "${REPETICIONES}"); do
  echo "=== ${ETIQUETA} corrida ${i}/${REPETICIONES} ===" >&2
  npx tsx scripts/run-agent-a-conversations.ts \
    --suite "${SUITE}" \
    --transport local \
    --strict-brain-provider deepseek \
    --verify-db \
    --database-url "${DB_URL}" \
    --run-id "${ETIQUETA}-${i}" \
    || echo "corrida ${i} con casos fallidos (se conserva el reporte)" >&2
done
