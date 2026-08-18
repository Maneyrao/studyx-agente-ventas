# Simulación local A→B→A — evidencia

Fecha: 2026-08-17. Rama: `feat/studyx-datos-y-sim-local`. Commit base al
correr esto: `b65bc5f`. Cluster: `postgresql://postgres@127.0.0.1:55433/studyx_test`
(nativo, `scripts/pg-native-up.sh`). Workspace: `studyx`
(`BUSINESS_WORKSPACE_SLUG=studyx`, seed `supabase/seed/studyx.sql`).

## Alcance real de esta evidencia

Lo que sigue documenta **dos cosas que sí se ejecutaron**:

1. Un test de integración nuevo para el cron `post-call-followup` (B→A,
   spec 007), contra el cluster local desechable.
2. Una corrida completa de la suite de integración A→B existente, con el
   seed de StudyX cargado y `BUSINESS_WORKSPACE_SLUG=studyx`.

**Lo que NO se ejecutó**, y por qué: el runbook
`docs/runbooks/simulacion-local-a-b-a.md` (Task 5) describe un ciclo E2E con
un bot de Telegram real (`TELEGRAM_AGENT_B_BOT_TOKEN`), un túnel público
(`cloudflared`/`ngrok`) y un humano apretando un botón en Telegram para emitir
el veredicto. Ese flujo requiere credenciales reales y una interacción humana
que un agente no puede ejecutar de forma autónoma seguro (no hay forma de
"apretar el botón de Telegram" sin operador humano ni de crear un bot token
sin salir del alcance de lo que este agente puede hacer sin supervisión). Esta
evidencia cubre en su lugar la parte que sí es verificable de punta a punta
sin ese paso manual: el cron B→A completo, probado directamente contra la
base de datos real (no simulado), más la suite A→B existente corriendo sana
sobre los datos de StudyX.

## 1. Test de integración `post-call-followup` (nuevo)

Archivo: `tests/integration/post-call-followup.test.ts`.

Cubre, cada uno como test independiente, contra un `call_sessions` real
insertado vía el mismo camino de ingesta que usa producción
(`processInboundMessage`, no un stub):

- **FR-1** (idempotencia): una llamada `completed` con resultado
  `seguimiento_agendado` corre el cron dos veces. Se verifica, por conteo de
  filas (no sólo ausencia de error): `channel_events` con
  `external_event_id = 'system:call_result:<call_id>'` = 1 tanto después de la
  primera como de la segunda corrida; `messages` sintético = 1;
  `agent_decisions` para ese turno = 1; `outbound_deliveries` para esa
  conversación = 1. Ninguno de los cuatro conteos sube en la segunda corrida.
- **FR-3**: `result = 'no_contactar'` revoca el contacto
  (`contact_channel_permissions.consent_status = 'revoked'`) y NO genera
  `agent_decisions` ni `outbound_deliveries` (ambos conteos = 0), aunque el
  turno de sistema sí se sintetiza (es la evidencia que ancla la revocación).
- **FR-4**: `status = 'cancelled'` no genera ni siquiera el `channel_events`
  de tipo `system_call_result` (el `skip` corta antes de sintetizar el turno)
  — conteo = 0.
- **FR-5**: un contacto con `consent_status = 'revoked'` ya al momento de
  correr el cron (revocado por una vía independiente de la llamada, vía
  `record_contact_permission_event`) no genera ningún `channel_events` para
  esa llamada — conteo = 0.

Comando y salida real (limpio de logs `info` de por medio):

```
$ export TEST_DATABASE_URL="postgresql://postgres@127.0.0.1:55433/studyx_test"
$ npx vitest run --config vitest.integration.config.mts tests/integration/post-call-followup.test.ts

 RUN  v4.1.10 /Users/tmaneyro22/Documents/AGENTE IA/studyx-agente-ventas

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  21:31:37
   Duration  264ms
```

Repetido dos veces seguidas para confirmar que no depende de un estado
limpio de la corrida anterior (el propio backlog que FR-4/FR-5 dejan
pendiente para siempre, por diseño, no contamina las corridas siguientes):
mismo resultado, `4 passed (4)`, en ambas repeticiones.

### Nota de diseño del test (no del código de producción)

`listPendingFollowups` no tiene ningún scope por test — es una consulta
global sobre `call_sessions`. Los agregados `result.sent/skipped/revoked`
del cron por lo tanto mezclan cualquier fila pendiente que ya exista en el
cluster compartido (incluida la de otro test del mismo archivo). El test NO
afirma sobre esos agregados; afirma sobre el `finding` específico de su
`call_id` y sobre conteos de filas con `WHERE` explícito por `call_id`/
`conversation_id`. Esto es deliberado, no una laguna: los agregados globales
habrían hecho el test frágil frente a la propia naturaleza del cron (barre
todo lo pendiente), sin aportar nada que los conteos por fila no prueben ya.

## 2. Suite de integración A→B existente, contra el seed de StudyX

```
$ psql "$TEST_DATABASE_URL" -f supabase/seed/studyx.sql
BEGIN
INSERT 0 1
INSERT 0 14
INSERT 0 3
COMMIT

$ export BUSINESS_WORKSPACE_SLUG="studyx"
$ npm run test:integration

 Test Files  1 failed | 26 passed (27)
      Tests  1 failed | 198 passed (199)
   Duration  5.22s
```

El único fallo es el ya conocido y fuera de alcance:
`tests/integration/embedding-dimensions.test.ts` (drift 1536 vs 768 en
`memory_embeddings.embedding`), confirmado en el brief de esta tarea como
pre-existente y explícitamente fuera de alcance. `inbound-batching.test.ts`
(el otro fallo pre-existente conocido, flake de lease vencido) pasó en esta
corrida — es un flake, no algo que este cambio haya arreglado.

Archivos de la suite A→B relevantes que pasaron con el workspace `studyx`
activo (lista completa de los 26 archivos verdes, extraída del reporter
`--reporter=verbose`):

```
agent-a-call-handoff.test.ts    claim-context.test.ts           payments-canonical.test.ts
business-context-store.test.ts  database-availability.test.ts   post-call-followup.test.ts
call-ledger-invariants.test.ts  database-invariants.test.ts     reconcile-orchestration.test.ts
call-store.test.ts              decision-v3.test.ts             selected-memories.test.ts
catalog-detail.test.ts          delivery-attempt-fencing.test.ts stripe-webhook.test.ts
embedding-dimensions.test.ts*   health-readiness.test.ts        studyx-catalog.test.ts
inbound-batching.test.ts        jsonb-canonical-persistence.test.ts studyx-seed.test.ts
knowledge-projection.test.ts    knowledge-search-isolation.test.ts telegram-agent-b-smoke.test.ts
memory-context-concurrency.test.ts orchestration-lifecycle.test.ts zz-adversarial-review.test.ts
```

`* embedding-dimensions.test.ts` tiene 3 de 4 tests verdes; el cuarto es el
fallo conocido citado arriba.

Verificación adicional corrida en el mismo commit:

```
$ npm run typecheck   # tsc --noEmit -> sin salida, 0 errores
$ npx vitest run --config vitest.config.mts   # unitarios
 Test Files  55 passed (55)
      Tests  635 passed (635)
```

## Hallazgos fuera del alcance de este test (reportados, no arreglados)

### 1. `scripts/pg-native-up.sh` no podía reconstruir un cluster limpio (arreglado como parte de esta tarea)

Al tirar abajo el cluster (`pg-native-down.sh`) y reconstruirlo desde cero
para tener una base realmente limpia para estos tests, la migración
`supabase/migrations/20260809020001_phase6_knowledge_base.sql` fallaba con
`ERROR: relation "knowledge_chunks" already exists`. Causa raíz:
`supabase/migrations/20260805000001_universal_business_memory.sql` (líneas
194-211) define su propia tabla `knowledge_chunks (source_id ->
knowledge_sources)`, que jamás se usa en el código — `src/lib/services/knowledge-projection.service.ts:134`
y `src/lib/services/knowledge-base.service.ts:122` insertan en
`knowledge_chunks (document_id, chunk_index, content, token_count,
embedding)`, el shape de la migración `phase6` (`document_id ->
knowledge_documents`), no el de `source_id`. El nombre de archivo de
`20260805000001_universal_business_memory.sql` la ordena antes de la
migración `phase6` de 20260809, pero el commit real es de hoy (`git log`:
`9d92e097 … 2026-08-17 15:58:39 -0300`), así que este choque nunca se había
disparado porque el cluster local nunca se había reconstruido de cero en
toda la sesión — sólo se reutilizaba uno que ya traía las tablas creadas
mucho antes de que este archivo existiera.

Se corrigió `scripts/pg-native-up.sh` (sólo el script del harness local, no
ninguna migración) para hacer `DROP TABLE IF EXISTS knowledge_chunks CASCADE;`
inmediatamente antes de aplicar `20260809020001_phase6_knowledge_base.sql`,
eliminando la tabla muerta y nunca referenciada antes de que la migración
`phase6` cree la que sí se usa. Ninguna migración fue reescrita.
**Esto sigue siendo un bug real del set de migraciones** — el arreglo
correcto es sacar el bloque `CREATE TABLE knowledge_chunks` muerto de
`20260805000001_universal_business_memory.sql` en una migración/PR aparte;
no se hizo acá porque toca una migración ya commiteada por otra tarea de este
mismo plan y esa decisión no correspondía a esta tarea.

### 2. `tests/integration/embedding-dimensions.test.ts` y `tests/integration/inbound-batching.test.ts`

Confirmados como pre-existentes y fuera de alcance según el brief de esta
tarea; no se tocó código de producción para "arreglarlos".
