# Fix de evidencia de prompt — Tasks 2.11 y 2.12

Base: `501c8b8603d4d8d867ecbe11626dd4cde95c82ba`. Alcance: cerrar el P1 de `task-2.11-2.12-independent-rereview.md` y completar la composición del manifiesto para turnos sin request al modelo. Sólo se usó PostgreSQL local en `127.0.0.1:55433`; no hubo APIs, DB remota ni despliegue.

## Resultado

- `lastPromptSha256` empieza en `null` y cambia únicamente justo antes de una invocación real a `model.generate`.
- El trace conserva, en orden, `model_request_prompt_sha256s`. Una excepción del provider cuenta como request observado porque el hash se registra al entrar al provider.
- Si el deadline vence entre el rechazo inicial y la reparación, el fallback de integridad conserva el SHA del primer request. No proyecta el SHA de una reparación que no empezó.
- Si el deadline vence antes del primer `generate`, el fallback de presupuesto devuelve `prompt_sha256: null` y un trace sin requests.
- Decisiones aceptadas o reparadas y fallbacks de integridad exigen SHA no nulo. Un fallback de presupuesto acepta `null` únicamente cuando el trace prueba cero requests; si hubo al menos uno, exige el último SHA observado.
- El commit valida la correlación fallback, SHA efectivo y trace antes de abrir la transacción. Las variantes inválidas dejan cero decisiones, cero outbounds y la versión de estado intacta.
- `ReleaseManifestV1` representa la ausencia explícita con `null`. Parser y generador distinguen `null` de `undefined` o campo ausente: estos últimos siguen fallando. Un `promptSha256: null` explícito tampoco se reemplaza con `AGENT_A_PROMPT_SHA256` del entorno.
- La ruta de diagnóstico ya clasifica `observed_prompt_sha256: null` como `unavailable` y, con rollout activo, el endpoint queda `degraded`; la regresión existente se incluyó en los gates focales.

## TDD RED → GREEN

### Evidencia ligada a requests reales

```bash
npm exec -- vitest run tests/unit/agent-core/repair-and-fallback.test.ts
```

RED: 3 fallos discriminantes. El deadline entre rechazo y repair devolvía el SHA proyectado del repair; el deadline anterior al primer request devolvía un SHA proyectado en vez de `null`; el trace no exponía los requests observados.

GREEN: 15/15. Los tests calculan los hashes desde los argumentos capturados por el mock del provider. Cubren decisión inicial, reparación, ambos deadlines y excepción del provider.

### Manifiesto con ausencia explícita

```bash
npm exec -- vitest run tests/unit/agent-core/release-manifest.test.ts \
  tests/unit/scripts/release-manifest-agent-loop.test.ts
```

RED: el parser y el constructor rechazaban `null`; el generador reemplazaba un `null` explícito con el SHA del entorno.

GREEN: parser, constructor y generador preservan `null`; `undefined` y campo ausente se rechazan. La batería relacionada terminó 22/22.

### Frontera durable

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npm exec -- vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-prompt-binding.test.ts
```

RED: tres casos inválidos llegaban a persistirse: budget `null` con request, integrity `null` y decisión aceptada `null`.

GREEN: 10/10. También cubre first attempt, repair, provider exception, fallback con y sin request, replay idéntico y SHA ajeno sin efectos durables.

## Gates finales

```bash
npm exec -- vitest run \
  tests/unit/agent-core/loop.test.ts \
  tests/unit/agent-core/repair-and-fallback.test.ts \
  tests/unit/agent-core/release-manifest.test.ts \
  tests/unit/agent-core/no-host-imports.test.ts \
  tests/unit/observability/prompt-parity.test.ts \
  tests/unit/scripts/release-manifest-agent-loop.test.ts
# PASS: 6 archivos, 77 tests
```

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npm exec -- vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-prompt-binding.test.ts \
  tests/integration/agent-loop-exactly-once.test.ts \
  tests/integration/agent-loop-concurrency.test.ts \
  tests/integration/agent-loop-fallback-commit.test.ts \
  tests/integration/agent-loop-fallback-recovery.test.ts \
  tests/integration/agent-loop-commit-regressions.test.ts \
  tests/integration/agent-loop-delivery-failure.test.ts \
  tests/integration/agent-loop-prepare-crash.test.ts
# PASS: 8 archivos, 28 tests
```

```bash
npm run test:unit
# PASS: 189 archivos; 2975 passed, 7 skipped, 7 todo

npm run typecheck
# PASS

(cd agent-core && npx tsc --noEmit)
# PASS

npm run lint
# PASS
```

El gate integral de integración no está verde en el HEAD base: produjo 58/60 archivos, 437 tests aprobados, 1 omitido y 6 fallos en `orchestration-lifecycle.test.ts` y `reconcile-orchestration.test.ts`. Para separar causalidad, se creó un worktree detached en `501c8b8` sin este fix y se corrieron esas dos suites solas; reprodujo los mismos tres fallos estables que el árbol modificado (65 aprobados, 3 fallidos): dos expectativas de egress/contexto comercial y una de expiración de lease. Ninguna de esas rutas fue modificada aquí. La batería Agent Loop focal se repitió después y permaneció 28/28 verde.

## Archivos

- `agent-core/src/loop.ts`
- `agent-core/src/domain/release-manifest.ts`
- `scripts/generate-release-manifest.mjs`
- `src/features/conversation/application/commit-agent-turn-v3.ts`
- `tests/helpers/agent-turn-fixtures.ts`
- `tests/integration/agent-loop-fallback-commit.test.ts`
- `tests/integration/agent-loop-fallback-recovery.test.ts`
- `tests/integration/agent-loop-prompt-binding.test.ts`
- `tests/unit/agent-core/release-manifest.test.ts`
- `tests/unit/agent-core/repair-and-fallback.test.ts`
- `tests/unit/scripts/release-manifest-agent-loop.test.ts`

## Ruling

El P1 queda cerrado. El runtime no atribuye un SHA a un request que no ocurrió; cada resultado persistible lleva el último SHA observado o `null` con prueba explícita de cero requests. El binding durable, la generación del manifiesto, el replay y diagnostics conservan esa distinción sin relajar las rutas que sí requieren evidencia no nula.
