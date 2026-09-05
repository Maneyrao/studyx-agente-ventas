# Re-review independiente — cierre Tasks 2.6/2.7 (`7d8ae09`)

## Veredictos

- **Spec compliance: PASS.** Los dos P1 y el P2 de la revisión anterior están cerrados.
- **Code quality: PASS.** No encontré findings P0, P1 ni P2 abiertos.
- **Compatibilidad workflow V21: PASS con evidencia local.** El camino existente queda idéntico cuando el campo falta o vale `false`; no se reejecutó una conversación paga ni un despliegue remoto.

La revisión se hizo en un worktree detached limpio del commit completo
`7d8ae093231633f0ff9595764c8201f63399efbd`. No se editó source, no se leyó
`.env.local`, no se llamó a modelos o APIs y la única base utilizada fue
`postgresql://postgres@127.0.0.1:55433/studyx_test`.

## Findings

### P0

Ninguno.

### P1

Ninguno.

### P2

Ninguno.

## Finding 2.6/P1 — kill switch: cerrado

`agent.config.ts` declara exactamente
`agentAAgentLoopV3KillSwitch: z.boolean().default(false)`. El build ADK generó
la definición efectiva `z.default(z.boolean(), false)` y el tipo de
configuración booleano. Esto preserva una configuración remota vieja que omita
el campo; además, el workflow sólo activa el freno con comparación estricta
`=== true`, de modo que `undefined` también cae al comportamiento anterior.

Después de ganar el claim, `processInboundTurn` calcula el freno y reemplaza el
contexto que usarán todas las ramas siguientes por `owned`. Con el freno activo,
el último spread fija `agent_loop_v3_mode: 'off'`, por lo que ni un modo DB
`shadow` ni `authoritative` puede prevalecer. La búsqueda de usos posteriores
confirma que el claim crudo no vuelve a consumirse; router, contexto, decisiones
y commits usan `owned`.

La prueba de workflow cubre las dos direcciones discriminantes sobre un claim
`authoritative`: `true → off` y `false → authoritative`. No se limita a leer la
configuración: ejecuta el handler completo y observa el modo efectivo publicado
por el evento de rollout.

## Compatibilidad V21: preservada

Cuando el campo falta o es `false`, `owned` conserva la misma referencia
`claimed`; no cambia features, contexto, decisión, política, plannerless V2,
persistencia ni entrega. El único comportamiento adicional es un log estructurado
sin texto ni identidad del cliente (`trace_id`, `turn_id`, modos y booleano).

La suite completa de `processInboundTurn` pasó, incluida la ruta plannerless V21
con `agentAPlannerlessV2Enabled=true`, y también pasó el contrato de prompt que
fija `studyx-agent-a-brain-v21`. Esta evidencia descarta una regresión local del
workflow. No certifica una publicación ni una conversación live posterior al
commit, que deliberadamente quedaron fuera por la prohibición de API paga y
mutaciones remotas.

## Finding 2.7/P1 — frontera `search_catalog`: cerrado

La nueva ruta `GET /api/agent/tools/v1/search-catalog`:

- resuelve exclusivamente `BUSINESS_WORKSPACE_SLUG` mediante la configuración
  canónica;
- delega en `searchCatalogToolV1` y devuelve su `ToolResultV1` sin transformar
  el envelope;
- degrada una configuración o lectura fallida al mismo envelope completo con
  `CATALOG_UNAVAILABLE`;
- permanece debajo de `/api/agent/`, por lo que el proxy exige clave interna,
  key id, timestamp, HMAC, trace, request id e idempotency key.

La integración real cubre 41 offerings, sanitización, ausencia de links/metadata
protegida, los siete campos comunes en éxito y fallo, 401 sin credencial y paso
con firma local válida. El commit no modifica `/api/agent/tools/catalog` ni
`botpress-agent/src/actions/lookupCatalog.ts`, así que el consumidor legacy
conserva su schema y URL. No hace falta una acción Botpress huérfana antes de que
la tarea de integración del `ToolExecutor` consuma esta frontera versionada.

## Finding 2.6/P2 — auditoría `updated_at`: cerrado

La migración 00003 crea/reemplaza una función dedicada, con `search_path`
fijado y sin `SECURITY DEFINER`, y recrea un único trigger `BEFORE UPDATE`. Usa
`clock_timestamp()`: el test demuestra que el valor avanza aun cuando INSERT y
UPDATE ocurren en la misma transacción, donde `now()` habría conservado el
timestamp original.

El probe corre con `SET LOCAL ROLE orchestrator_role`, por lo que también prueba
el permiso efectivo de runtime. Permanecen los grants mínimos de tabla
(`SELECT, INSERT, UPDATE`), RLS y la policy existentes; no se agregó `DELETE`,
`TRUNCATE` ni acceso a `anon`/`authenticated`. La migración se aplicó dos veces
con `ON_ERROR_STOP=1`, y la suite confirmó que el trigger sigue presente después
de una doble reaplicación.

## Evidencia ejecutada

```bash
npm run build --prefix botpress-agent
# PASS; la definición generada conserva default(false)

npm exec -- vitest run --config vitest.config.mts \
  tests/unit/botpress/agent-loop-v3-kill-switch-config.test.ts \
  tests/unit/botpress/process-inbound-turn-hot-path.test.ts \
  tests/unit/botpress/agent-a-brain-prompt.test.ts \
  tests/unit/orchestration/agent-loop-rollout.test.ts \
  tests/unit/orchestration/claim-batch.test.ts \
  tests/unit/orchestration/claim-route-agent-loop-rollout.test.ts \
  tests/unit/conversation/agent-tools-read.test.ts \
  tests/contract/botpress-response-parity.test.ts
# PASS: 8 archivos, 194 tests

psql postgresql://postgres@127.0.0.1:55433/studyx_test \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260905000003_agent_loop_rollout_v3.sql
# PASS dos veces

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npm exec -- vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-migrations.test.ts \
  tests/integration/agent-loop-rollout-claim.test.ts \
  tests/integration/agent-tools-read-routes.test.ts \
  tests/integration/business-context-store.test.ts \
  tests/integration/catalog-detail.test.ts
# PASS: 5 archivos, 32 tests

npm run typecheck
npm run typecheck --prefix botpress-agent
npm exec -- eslint <archivos raíz del commit> --max-warnings=0
git diff 7d8ae09^..7d8ae09 --check
# PASS / PASS / PASS / PASS
```

## Conclusión

`7d8ae09` cierra los tres findings sin alterar el contrato legacy ni el camino
V21 cuando el freno está desactivado. El commit queda aprobado dentro del alcance
local revisado.
