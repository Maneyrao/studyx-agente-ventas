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
readonly PREFLIGHT_ONLY="$([[ "${MODO}" == "--preflight-only" ]] && echo true || echo false)"

readonly RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly PUERTO=55435
readonly API_PORT="${STUDYX_EVAL_API_PORT:-3217}"
readonly EVAL_ROOT="${RAIZ}/.eval"
readonly DB_URL="postgresql://postgres@127.0.0.1:${PUERTO}/studyx_test"
readonly API_BASE_URL="http://127.0.0.1:${API_PORT}"

cd "${RAIZ}"

if [[ ! -f "${EVAL_ROOT}/.env.local" ]]; then
  echo "Falta ${EVAL_ROOT}/.env.local (ver docs/operaciones/evaluacion-aislada.md)" >&2
  exit 1
fi

# Una key inyectada sólo para este proceso (por ejemplo desde un gestor de
# secretos o el portapapeles) tiene precedencia sobre la plantilla local. No
# se escribe en disco ni se imprime. El resto del entorno sigue siendo
# reconstruido y validado por el guard de aislamiento.
readonly SESSION_DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-}"

# `env -i` no alcanza: bash reexporta lo suyo. Se construye el entorno a mano
# y se deja fuera TODO lo que no está en el archivo de evaluación, que es
# justamente cómo se apagan Telegram, Stripe, Sheets y Retell.
set -a
# shellcheck disable=SC1091
source "${EVAL_ROOT}/.env.local"
set +a
if [[ -n "${SESSION_DEEPSEEK_API_KEY}" ]]; then
  export DEEPSEEK_API_KEY="${SESSION_DEEPSEEK_API_KEY}"
fi
export DATABASE_URL="${DB_URL}"
export TEST_DATABASE_URL="${DB_URL}"
export STUDYX_LOCAL_CREDENTIALS_ROOT="${EVAL_ROOT}"
export STUDYX_EVAL_API_BASE_URL="${API_BASE_URL}"
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

# Nunca se reutiliza un proceso que ya estaba escuchando. Aunque devolviera
# /api/ready=200, podría ser otro checkout o una versión anterior del agente.
node -e '
  const server = require("node:net").createServer();
  server.once("error", () => process.exit(1));
  server.listen(Number(process.argv[1]), "127.0.0.1", () => server.close(() => process.exit(0)));
' "${API_PORT}" || {
  echo "EVAL_API_PORT_IN_USE: ${API_PORT}" >&2
  exit 1
}

if [[ "${PREFLIGHT_ONLY}" == "true" ]]; then
  echo "preflight aislado verificado; no se iniciaron servicios" >&2
  exit 0
fi

scripts/pg-native-down.sh "${PUERTO}" >/dev/null 2>&1 || true
scripts/pg-native-up.sh "${PUERTO}" --seed >/dev/null
echo "cluster limpio en 127.0.0.1:${PUERTO}" >&2

npm run build >/dev/null 2>&1
readonly RELEASE_SHA="$(git rev-parse HEAD)"
export STUDYX_RELEASE_SHA="${RELEASE_SHA}"
npm run start -- --hostname 127.0.0.1 --port "${API_PORT}" >"${EVAL_ROOT}/api-${ETIQUETA}.log" 2>&1 &
readonly API_PID=$!
trap 'kill "${API_PID}" 2>/dev/null || true' EXIT

API_READY=false
for _ in $(seq 1 60); do
  if ! kill -0 "${API_PID}" 2>/dev/null; then
    echo "EVAL_API_EXITED_BEFORE_READY" >&2
    exit 1
  fi
  if curl -sf "${API_BASE_URL}/api/ready" >/dev/null 2>&1; then
    API_READY=true
    break
  fi
  sleep 1
done

if [[ "${API_READY}" != "true" ]]; then
  echo "EVAL_API_READY_TIMEOUT" >&2
  exit 1
fi

# El 200 no alcanza: se prueba que responde el commit de este worktree y que
# su readiness estructurada es positiva antes de enviar el primer caso.
npx tsx -e '
  import { assertEvaluationApiIdentityV1 } from "./scripts/lib/eval-isolation";
  void (async () => {
    const base = process.env.STUDYX_EVAL_API_BASE_URL;
    const expectedCommit = process.env.STUDYX_RELEASE_SHA;
    if (!base || !expectedCommit) throw new Error("EVAL_API_IDENTITY_ENV_MISSING");
    const [healthResponse, readinessResponse] = await Promise.all([
      fetch(`${base}/api/health`),
      fetch(`${base}/api/ready`),
    ]);
    assertEvaluationApiIdentityV1({
      expectedCommit,
      health: await healthResponse.json(),
      readiness: await readinessResponse.json(),
    });
    console.error("API aislada verificada: commit exacto y readiness positiva");
  })();
'

for i in $(seq 1 "${REPETICIONES}"); do
  echo "=== ${ETIQUETA} corrida ${i}/${REPETICIONES} ===" >&2
  npx tsx scripts/run-agent-a-conversations.ts \
    --suite "${SUITE}" \
    --transport local \
    --api-base-url "${API_BASE_URL}" \
    --strict-brain-provider deepseek \
    --verify-db \
    --database-url "${DB_URL}" \
    --run-id "${ETIQUETA}-${i}" \
    || echo "corrida ${i} con casos fallidos (se conserva el reporte)" >&2
done
