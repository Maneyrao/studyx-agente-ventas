# Revisión final independiente — Tasks 2.11 y 2.12

Candidato vigente: `03f6279b0dc1cb8b11f3788c9025ca1280134b25`. La revisión cubre el cierre principal `1f1c490d76ef0bd3ebc871366fc45996bcdfa6af` y el follow-up `03f6279` que reemplaza `node:crypto` por SHA-256 portable y amplía la detección de ofertas naturales de llamada. Los commits intermedios del rango `1f1c490..03f6279` agregan cobertura de Task 2.14 y documentación de 2.6/2.7; no cambian los dos contratos residuales de este informe.

## Veredictos

- **Spec compliance: FAIL.** El candidato resuelve los fallos del provider, la reparación única, el fallback completo, el SHA exacto de cada request, la validación temprana del manifiesto y diagnostics conservador. Persisten dos incumplimientos de composición: la variante fallback que devuelve el loop no es asignable directamente al commit y el SHA devuelto por el loop no está ligado obligatoriamente al manifiesto persistido.
- **Code quality: FAIL.** Todos los gates comprometidos quedan verdes en `03f6279`, incluida la suite completa, y el SHA portable pasó vectores independientes. Aun así, el límite loop→commit requiere cast/adaptación manual y el commit acepta evidencia SHA de otro turno; ambas son fallas de contrato en el camino que debería convertirse en autoritativo.
- **P0:** ninguno.
- **Findings:** 2 P1, 1 P2.

La revisión se hizo en una worktree detached limpia de `03f6279`. Se usó únicamente PostgreSQL local en `127.0.0.1:55433`; no se leyó `.env.local`, no se llamaron APIs, no hubo red remota ni gasto.

## Findings

### P1 — El fallback del loop no entra al commit sin cast

`AgentTurnWithIntegrityResultV3` mantiene una sola variante fallback con `reason` como unión y `rejection` nullable (`agent-core/src/loop.ts:155-170`). `FallbackInputV3` sí expresa la correlación correcta como unión discriminada: integridad exige rechazo y presupuesto exige `null` (`src/features/conversation/application/commit-agent-turn-v3.ts:117-136`). TypeScript no puede demostrar que ambas propiedades están correlacionadas.

Un probe de compilación intentó el puente directo:

```ts
if (result.outcome === 'fallback') {
  void commitAgentTurnV3(db, {
    turn_id,
    trace_id,
    fallback: result,
    release_manifest: manifest,
  });
}
```

`tsc` produjo `TS2322`: `AgentTurnWithIntegrityResultV3` no es asignable a `FallbackInputV3`. El caller real necesitaría reconstruir el objeto, ramificar de nuevo o hacer una aserción. Para cumplir “loop → commit sin cast”, el resultado del loop debe separar también las dos razones en variantes discriminadas, o debe existir un adaptador productivo tipado que conserve esa correlación.

### P1 — El SHA exacto se calcula, pero el commit acepta y persiste el SHA válido de otro turno

El cálculo es correcto. `modelPromptSha256V3` canoniza instrucciones, conversación, tools y `force_final` (`agent-core/src/loop.ts:190-214`). El primer intento conserva el request realmente enviado (`:253-266`) y la reparación hashea su request forzado con la decisión rechazada y el rechazo developer (`:333-347`). Las pruebas confirman el hash del primer intento y el de reparación.

La garantía se pierde al componer:

- `bindTurnPromptSha256V1` sólo aparece en su definición y tests; ningún camino productivo lo llama.
- `runAgentTurnWithIntegrityV3` y `commitAgentTurnV3` tampoco tienen un caller productivo común todavía.
- `commitAgentTurnV3` recibe únicamente `release_manifest`; valida su forma en `:481`, pero no recibe `result.prompt_sha256` para comparar.
- `generateReleaseManifest` admite `options.promptSha256` o `AGENT_A_PROMPT_SHA256` (`scripts/generate-release-manifest.mjs:186-191`), sin probar que provenga del turno que se commitea.

Un probe local ejecutó un turno, obtuvo el hash real `H`, entregó al commit un manifiesto válido con otro hash `S` y consultó la fila. El commit aceptó la decisión y persistió `S`, con `S !== H`. La validación de 64 hex impide evidencia mal formada, pero no evidencia perteneciente a otro request.

La composición autoritativa debe ligar internamente `result.prompt_sha256` al manifiesto antes de cualquier efecto. La integración debe cubrir primer intento, reparación y fallback, más el adversarial que rechaza un digest bien formado pero ajeno al resultado.

### P2 — La identidad del modelo tiene dos fuentes configurables sin control de paridad

El manifiesto identifica correctamente `studyx-agent-a-brain-v21`, `deepseek-direct` y `deepseek-v4-flash` por defecto. Sin embargo, el Brain de Botpress elige el modelo desde `configuration.agentABrainDeepSeekModel` (`botpress-agent/agent.config.ts:29`; `botpress-agent/src/workflows/processInboundTurn.ts:625-628`), mientras el generador usa `DEEPSEEK_MODEL` del proceso de release (`scripts/generate-release-manifest.mjs:174-176`). Los defaults coinciden, pero un override válido puede hacer que el manifiesto describa un modelo distinto del ejecutado.

Cuando se cablee el provider V3, su identidad efectiva debe viajar con el resultado o validarse contra el manifiesto antes del commit. Un test con valores distintos en ambas fuentes debe fallar cerrado o degradar la paridad.

## Correcciones confirmadas en `03f6279`

- **Aislamiento de Agent Core:** PASS. `loop.ts` ya no importa `node:crypto`; usa `agent-core/src/domain/sha256.ts` por import relativo. El guard `no-host-imports` y la suite completa pasan.
- **SHA-256 portable:** PASS. Los tres vectores comprometidos y 14 comparaciones independientes contra `node:crypto` coinciden, incluyendo vacío, ASCII, Unicode y longitudes de 55, 56, 63, 64, 65, 119, 120, 127, 128 y 129 bytes/caracteres de borde.
- **Ofertas naturales de llamada:** PASS. El guard reconoce formas como “puedo armarte/ofrecerte/explicarte/contarte/asesorarte”; los tres tests de métricas que estaban rojos en `1f1c490` pasan y la suite completa ya no registra ese falso negativo.

## Comportamiento de Tasks 2.11/2.12 confirmado

- **Provider falla en el primer intento:** PASS. Produce fallback `AGENT_LOOP_BUDGET_EXHAUSTED`, rechazo `null`, respuesta técnica completa y no filtra el texto de la excepción.
- **Provider falla durante la reparación:** PASS. Produce fallback `AGENT_LOOP_INTEGRITY_FAILED`, conserva el primer rechazo y no filtra la excepción.
- **Una sola reparación y deadline compartido:** PASS. La reparación es una única generación final, sin tools y sin tercera llamada.
- **Hilo y traza:** PASS. La segunda generación recibe la conversación del primer intento, la decisión rechazada y el rechazo developer; hashes, rechazos y tools quedan disponibles para persistencia durable.
- **Fallback:** PASS. Se commitea atómicamente como respuesta técnica completa, sin texto rechazado, acciones, memorias, preparaciones ni patches comerciales; el contador y la revisión humana siguen la política prevista.
- **Hash por request:** PASS en cálculo. El resultado aceptado o fallback informa el digest del último request efectivo. La persistencia sólo es correcta si el caller enlaza manualmente ese valor.
- **Manifiesto antes de efectos:** PASS. `parseReleaseManifestV1` corre antes del payload hash y antes de abrir la transacción (`commit-agent-turn-v3.ts:477-490`). El adversarial comprometido deja cero decisiones y cero mensajes.
- **Identidad base:** PASS. La versión se lee del prompt Brain V21; provider es DeepSeek y el modelo configurado tiene default `deepseek-v4-flash`.
- **Diagnostics:** PASS. Rollout apagado informa `legacy`. Con rollout activo, falta del expected/observed, digest inválido o consulta fallida produce `unavailable`; una divergencia produce `mismatch`. La ruta traduce ambos estados a `agent_loop_prompt_parity.status = degraded` y conserva HTTP 200.

## Pruebas y comandos exactos

```bash
# Focales, incluidos aislamiento, SHA y medición de llamadas
npx vitest run --config vitest.config.mts \
  tests/unit/agent-core/sha256.test.ts \
  tests/unit/agent-core/no-host-imports.test.ts \
  tests/unit/agent-core/repair-and-fallback.test.ts \
  tests/unit/conversation/technical-fallback.test.ts \
  tests/unit/agent-core/release-manifest.test.ts \
  tests/unit/observability/prompt-parity.test.ts \
  tests/unit/scripts/release-manifest-agent-loop.test.ts \
  tests/unit/scripts/release-manifest.test.ts \
  tests/unit/conversation/turn-metrics.test.ts \
  tests/unit/scripts/agent-a-conversation-runner.test.ts
# PASS: 9 archivos, 156 tests

npm run test:unit
# PASS: 188 archivos, 2 skipped; 2965 tests, 7 skipped, 7 todo

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-fallback-commit.test.ts \
  tests/integration/agent-loop-commit-regressions.test.ts \
  tests/integration/human-review-derivation.test.ts \
  tests/integration/pending-human-reviews.test.ts \
  tests/integration/agent-loop-concurrency.test.ts \
  tests/integration/agent-loop-fallback-recovery.test.ts \
  tests/integration/agent-loop-prepare-crash.test.ts
# PASS: 7 archivos, 21 tests

npm run typecheck
# PASS en el árbol limpio

npm run lint
# PASS

git diff --check 1f1c490..03f6279
git diff --check 03f6279^..03f6279
# PASS ambos
```

Probe portable ejecutado desde la raíz detached:

```bash
node_modules/.bin/tsx -e '<comparar sha256TextHexV1 con createHash("sha256") para 14 entradas>'
# PASS: portable_sha256_vectors_ok=14
```

Probes efímeros eliminados al terminar:

```text
tests/__tmp_loop_commit_type_probe.ts + npm run typecheck
  FAIL esperado del probe: TS2322 al pasar fallback: result sin cast

tests/integration/__tmp_prompt_binding_probe.test.ts
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/__tmp_prompt_binding_probe.test.ts
  PASS del adversarial: el commit aceptó y persistió un SHA válido distinto del devuelto por el loop
```

## Ruling

`03f6279` cierra el fallo de aislamiento y la medición de ofertas de llamada que mantenían rojo el gate completo de `1f1c490`. Tasks 2.11 y 2.12 todavía no pueden declararse cerradas: falta hacer consumible sin cast la salida fallback y ligar de forma obligatoria el SHA del request al manifiesto que se persiste. La doble autoridad del nombre de modelo queda como P2 para resolver antes de activar el rollout real.
