# Ledger — StudyX MVP orquestador de ventas

Sesión iniciada: 2026-08-11. Coordinador: Opus. Este archivo es la fuente de
reanudación después de una compactación de contexto. Se actualiza al cerrar cada
tarea, no al planificarla.

## Baseline Git (inmutable, registrado antes de tocar nada)

- Rama: `snapshot/wip-full`
- HEAD: `646045d350001612d984cb9c70eca57360f10887`
  (`chore(supabase): unblock live remote + Phase 5 live smoke`)
- Stash list: vacío.
- Prohibido en toda la sesión: `reset`, `checkout`, `clean`, `stash`, push,
  PR, deploy, migración remota, envío real de WhatsApp.
- `.env.local.bak-2026-08-10` NO se abre, no se lee y no se versiona.

### Archivos modificados preexistentes (trabajo del usuario / otros agentes)

```
 M .mcp.json
 M CLAUDE.md
 M botpress-agent/agent.config.ts
 M botpress-agent/src/workflows/processInboundTurn.ts
 M package.json                                   (elimina dependencia openai)
 M src/app/api/cron/retry-embeddings/route.ts
 M src/lib/config.ts
 D src/lib/embeddings/openai.ts
 M src/lib/services/knowledge-base.service.ts
 M src/lib/services/memory.service.ts
 M src/lib/services/message.service.ts
 M src/lib/services/summary.service.ts
 M tests/contract/call-event-schema.test.ts
 M tests/contract/canonical-envelope.test.ts
 M tests/unit/botpress/gemini-transcription.test.ts
 M tests/unit/services/knowledge-base-service.test.ts
```

### Archivos sin versionar preexistentes

```
?? .env.local.bak-2026-08-10                      (NO ABRIR)
?? botpress-agent/agent.json
?? docs/evidence/
?? scripts/run-pilot.mjs
?? src/lib/embeddings/gemini.ts
?? supabase/migrations/20260810010001_embeddings_gemini_768.sql
```

Tema del WIP preexistente: migración OpenAI → Gemini para embeddings
(1536 → 768 dimensiones) y resumen versionado.

## Baseline de verificación (ejecutado 2026-08-11, antes de escribir código)

| Gate | Comando | Resultado |
|---|---|---|
| Tipos root | `npm run typecheck` | ✅ exit 0 |
| Lint root | `npm run lint` | ✅ exit 0 |
| Unitarias root | `npm run test` | ✅ 19 archivos / 233 tests |
| Tipos Botpress | `cd botpress-agent && npm run typecheck` | ✅ exit 0 |
| Check Botpress | `cd botpress-agent && npm run check` | ✅ exit 0 |
| Integración | `npm run test:integration` (cluster nativo) | ❌ 9 fallidos / 16 pasados |
| `test:db:reset-loop` | requiere `supabase db reset --local` | ⛔ BLOCKED_EXTERNAL (sin Docker) |
| `test:db:lint` | requiere Supabase local | ⛔ BLOCKED_EXTERNAL (sin Docker) |
| `test:db:invariants` | requiere pgTAP en Supabase local | ⛔ BLOCKED_EXTERNAL (sin Docker) |

## Entorno: no hay Docker

`docker`, `podman`, `colima`, `orbstack`, `lima` y `nerdctl` están ausentes.
`supabase status` falla contra `unix:///var/run/docker.sock`. El puerto 54322
está cerrado.

Sustituto encontrado y habilitado: **PostgreSQL 17.10 nativo + pgvector 0.8.6**
en `/opt/homebrew`. `tests/helpers/db.ts` ya acepta los puertos 55432-55435 en
`127.0.0.1`, así que la suite de integración corre sin Docker.

- `scripts/pg-native-up.sh [puerto]` — cluster desechable con todas las
  migraciones aplicadas en orden. **Creado en esta sesión.**
- `scripts/pg-native-down.sh [puerto]` — lo destruye. **Creado en esta sesión.**
- `scripts/verify-native-postgres-loop.sh` — ya existía; equivale a
  `test:db:reset-loop` (3 clusters limpios desde cero).

Resultado del primer arranque: 26 migraciones aplicadas limpias, 18 tablas
públicas. El loop de migración desde cero **no** está bloqueado; lo que queda
bloqueado es específicamente `supabase db lint` y `supabase test db` (pgTAP).

## Hallazgos de la auditoría (FASE 0)

### BUG-01 — CRÍTICO — doble codificación de parámetros `jsonb`

postgres.js 3.4.9 infiere el tipo del parámetro a partir del cast que sigue al
slot. Cuando el cast es `::jsonb`, serializa el valor JS con su propio
`JSON.stringify`. Pasarle un string ya serializado guarda un **string JSON**,
no el documento.

Reproducción mínima (cluster nativo, driver del proyecto):

```
SELECT jsonb_typeof(${JSON.stringify([])}::jsonb)  -> 'string'   ❌
SELECT jsonb_typeof(${sql.json([])})               -> 'array'    ✅
SELECT jsonb_typeof('[]'::jsonb)                   -> 'array'    ✅
SELECT jsonb_typeof(${JSON.stringify([])}::text::jsonb) -> 'array' ✅
```

Consecuencia dura: `agent_decisions.memory_candidates` tiene
`CHECK (jsonb_typeof(memory_candidates) = 'array')`, así que **todo commit de
decisión falla con 23514**. Esto rompe el camino principal completo
(ingest → decisión → outbound). Es la causa de 8 de los 9 fallos de integración.

Consecuencia silenciosa: `messages.metadata`, `audit_log.payload`,
`channel_events.payload`, `channel_threads.metadata`, `outbox_events.payload` y
la evidencia de opt-out se guardan como strings JSON en vez de objetos. No
disparan constraint, pero corrompen la trazabilidad (invariante 7).

Sitios afectados (7):

- `src/lib/audit/logger.ts:33`
- `src/lib/services/message.service.ts:78`
- `src/lib/services/decision.service.ts:235`
- `src/lib/services/decision.service.ts:310`
- `src/lib/services/ingestion.service.ts:228`
- `src/lib/services/ingestion.service.ts:266`
- `src/lib/services/ingestion.service.ts:329`

Los casts `::extensions.vector` NO están afectados: postgres.js no reconoce ese
tipo, manda texto y el servidor lo parsea correctamente.

Estado: pendiente de corrección.

### BUG-02 — test de aislamiento de embeddings quedó en 1536 dimensiones

`tests/integration/database-invariants.test.ts` construye
`(ARRAY[1] || array_fill(0, ARRAY[1535]))::extensions.vector` para verificar que
la FK compuesta rechaza un embedding de otro contacto. La migración sin versionar
`20260810010001_embeddings_gemini_768.sql` cambió la columna a `vector(768)`, así
que el INSERT muere por dimensión antes de llegar a la FK y la aserción `23503`
nunca se evalúa. La FK compuesta `message_embeddings_message_contact_fk` sí
existe y es correcta; el test es el que quedó desactualizado.

Estado: pendiente de corrección.

### Deuda contractual detectada (no son bugs, son huecos del plan)

| # | Hueco | Evidencia en código |
|---|---|---|
| G-01 | No existe batching durable | No hay `inbound_batches` en `supabase/migrations/`; `processInboundTurn` va directo de ingest a decisión |
| G-02 | No existe claim ni lease de lote | No hay ruta `/api/agent/batches/*` ni action `claimBatch` |
| G-03 | Contexto se construye en ingest, no en claim | `ingestion.service.ts:403-603` hace búsqueda semántica y KB dentro de `processInboundMessage` |
| G-04 | Memoria no es selectiva | `message.service.ts` encola embedding para todo mensaje no trivial (`ingestion.service.ts:367`, `decision.service.ts:265`) |
| G-05 | No existe `selected_memories` | Ninguna migración la crea |
| G-06 | Next.js devuelve `knowledge_base` pero Botpress lo ignora | `IngestContext` lo incluye (`ingestion.service.ts:76`); `IngestResponseSchema` de Botpress no lo declara (`contracts.ts:173-178`) y `buildInstructions` no lo usa |
| G-07 | Decision v3 existe pero está desconectada | `decision-v3.ts` completo y testeado; `decision.service.ts:189` sólo llama `parseDecisionV2`; `agent_decisions` tiene `CHECK (schema_version = 2)` |
| G-08 | Catálogo desconectado del workflow | `/api/agent/tools/catalog` existe; ninguna action de Botpress lo consume |
| G-09 | No hay reconciliador | No existe `/api/cron/reconcile-orchestration` ni `reconcile-orchestration.ts` |
| G-10 | No hay `/api/health` ni `/api/ready` | Ausentes de `src/app/api/` |
| G-11 | Sin adapter WhatsApp | Sólo `emulator.channel.ts` y `telegram.channel.ts` |
| G-12 | `apiBaseUrl` por defecto es `http://localhost:3000` | `agent.config.ts:14` — inalcanzable desde Botpress Cloud |
| G-13 | `automationEnabled` por defecto false | `agent.config.ts:23` — decisión deliberada del plan, se mantiene |
| G-14 | Audio no está detrás de un puerto | `transcribeAudio` se invoca directo desde el workflow |

### Contradicciones plan vs código (el código manda, la desviación queda registrada)

1. El plan piloto nombra `botpress-agent/src/conversations/emulator.ts`; el
   archivo real es `botpress-agent/src/conversations/router.ts` con adapters en
   `src/channels/`. El código es mejor: un único handler wildcard, como exige
   `.claude/rules/botpress.md`. Se sigue el código.
2. El plan piloto congela Decision **v2**; la consigna de esta sesión pide migrar
   a **v3**. `decision-v3.ts` ya está implementado y probado, y es un superconjunto
   estricto de v2. Se migra a v3 de forma versionada y aditiva.
3. El plan piloto pide `emulatorIdentity.ts`; la identidad ya vive en
   `src/channels/shared/emulator-envelope.ts` y `agent.config.ts` ya valida E.164.
   Task 2 del plan piloto está **hecha**; no se reimplementa.
4. `docs/FAILURE_MATRIX.md` está vacío (sólo el título). Hay que llenarlo.
5. `docs/ROADMAP.md` invariante 6 todavía dice "OpenAI"; el proyecto migró a
   Gemini. Corregir al cerrar.

### Estado real de las Tasks 1 y 2 del plan piloto

- **Task 1 (Decision v2, cero handoff)**: HECHA. `decision.ts` es
  dependency-free, `decision-policy.test.ts` cubre las combinaciones cruzadas,
  la migración `20260806010009` convergió `transferred` → `closed`, y no hay
  rutas funcionales de transferencia. No se reimplementa.
- **Task 2 (identidad Emulator explícita)**: HECHA. `agent.config.ts` valida
  `emulatorPhoneE164` contra `E164_PATTERN` y falla antes del HTTP.
  No se reimplementa.

## Bitácora de tareas

| # | Tarea | Estado | Evidencia |
|---|---|---|---|
| 0 | Auditoría y baseline | hecho | secciones de arriba |
| 0b | Harness PG nativo | hecho | `scripts/pg-native-up.sh`; 3/3 loops de migración desde cero |
| BUG-01 | Doble codificación jsonb | corregido | `src/lib/db/json.ts` + 7 sitios; `tests/integration/jsonb-canonical-persistence.test.ts` 7/7; guard estático `tests/unit/db/jsonb-parameters.test.ts` |
| BUG-02 | Tests con vectores de 1536 | corregido | `EMBEDDING_DIMENSIONS` como única fuente; `database-invariants`, `fake-providers`, pgTAP 004 |
| BUG-03 | `knowledge_chunks` en 1536 | corregido | `supabase/migrations/20260811010001_knowledge_chunks_gemini_768.sql`; `tests/integration/embedding-dimensions.test.ts` 4/4 |
| 1+2 | Hexagonal + batching durable | hecho | ver abajo |

### FASE 1+2 — arquitectura hexagonal y batching durable

Se implementaron juntas: el batching es exactamente el corte que el plan pedía
para introducir puertos y casos de uso, así que no hubo un refactor separado ni
una reescritura masiva.

Archivos nuevos:

- `supabase/migrations/20260811020001_inbound_batches.sql` — tabla
  `inbound_batches`, `messages.batch_id`, `messages.conversation_seq`, índice
  parcial de un lote abierto por conversación, FKs compuestas que impiden cruzar
  contacto o conversación, y cuatro funciones:
  `open_or_join_inbound_batch`, `claim_inbound_batch`, `complete_inbound_batch`,
  `expire_inbound_batch_claims`. Privilegios mínimos a `orchestrator_role`.
- `src/features/orchestration/domain/batch-window.ts` — dominio puro
  (`planBatchWait`): sleep / claim / give_up. Sin Next, Botpress, Supabase ni Zod.
- `src/features/orchestration/ports/orchestration-store.ts` — puerto.
- `src/features/orchestration/adapters/postgres-orchestration-store.ts` — adapter.

Decisiones de concurrencia:

- El claim es **un solo UPDATE con predicado**. Cinco reclamantes se serializan
  en el lock de fila; los perdedores reevalúan el WHERE contra la fila del
  ganador, no coinciden y caen a `absorbed`. Sin lock de aplicación, sin Redis.
- El claim corre en READ COMMITTED (fuera de `withSerializableTransaction`) a
  propósito: en SERIALIZABLE los perdedores levantarían 40001 y con 150
  conversaciones concurrentes eso es una tormenta de reintentos sin beneficio.
- `open_or_join_inbound_batch` sí corre dentro de la transacción de ingesta: el
  mensaje tiene que ser miembro durable de una ventana **antes** de que Botpress
  duerma, o un crash durante la espera lo pierde.
- Un lote con lease vencido se puede **robar** (`stolen: true`), no se devuelve a
  `waiting`: eso chocaría con el índice parcial si la conversación ya abrió otro.
- Las funciones plpgsql llevan `#variable_conflict use_column` porque las
  columnas de `RETURNS TABLE` sombrean nombres de columna reales.

Pruebas: `tests/integration/inbound-batching.test.ts` (12/12) y
`tests/unit/orchestration/batch-window.test.ts` (12/12).

### FASE 3 — contexto controlado en el claim

- `src/features/orchestration/domain/turn-policy.ts` — `evaluateTurnPolicy`.
  La política vivía duplicada en `ingestion.service` y `decision.service`, que es
  justo la forma de que un contacto bloqueado sea respondido por un camino y
  suprimido por el otro. Ahora es una sola regla sin dependencias.
- `src/features/orchestration/ports/retrieval.ts` — puertos `MemoryRetriever` y
  `KnowledgeRetriever`.
- `src/features/orchestration/adapters/postgres-retrievers.ts` — implementaciones
  pgvector. Lanzan de verdad cuando fallan, para que «no disponible» nunca se
  confunda con «nada relevante».
- `src/features/orchestration/application/claim-batch.ts` — caso de uso.
- `src/app/api/agent/batches/[batch_id]/claim/route.ts` — ruta.
  200 claimed · 202 waiting · 409 absorbed/completed · 410 abandoned · 404.
- `src/proxy.ts` — clave de idempotencia `claim:<batch_id>` para la ruta nueva.

Cambios de comportamiento en el ingest:

- Ya no hace búsqueda semántica, ni búsqueda de KB, ni regeneración de resumen.
  Antes una ráfaga de cinco mensajes pagaba cinco embeddings y una llamada al
  modelo para producir **una** respuesta, y encima en el camino crítico del ACK
  del canal. Ahora la ingesta es persistencia pura y el trabajo derivado lo hace
  una sola vez el workflow que gana el claim.
- `IngestContext.context` desapareció. El contexto se entrega en el claim.
- `embedding: 'skip'` por defecto para inbound y outbound (Fase 4).

Pruebas: `claim-batch.test.ts` (17/17, con dobles en memoria),
`turn-policy.test.ts` (14/14), `claim-context.test.ts` (6/6 contra PostgreSQL).

### Revisión independiente (BUG-01/02/03)

Un revisor independiente verificó: no quedan sitios con parámetros jsonb
precodificados en `src/` ni en `scripts/`; `jsonbParam` distingue bien SQL NULL
de JSON `null` contra la nulabilidad real de cada columna; no hay ambigüedad de
tipos al quitar los casts (las cuatro funciones SQL tienen firma única y
`sql.json` etiqueta el OID explícitamente); la migración es aditiva y no deja
objetos huérfanos.

Hallazgo aceptado y corregido: el guard estático estaba anclado en
`JSON.stringify(` y se evadía con `::JSONB`, `::pg_catalog.jsonb`, indirección
por variable o argumentos largos. Ahora prohíbe **cualquier** cast jsonb sobre un
slot de bind (`}::jsonb`, case-insensitive, con esquema opcional), que es la
parte que realmente dispara la inferencia de postgres.js, y hay tests que prueban
que cada evasión queda atrapada.

Hallazgo del revisor sobre `npm run typecheck` fallando: era una foto de mitad de
vuelo mientras yo estaba cableando el batching. Verificado en verde después.

## Bloqueos externos abiertos

| ID | Bloqueo | Acción exacta que debe hacer el usuario |
|---|---|---|
| EXT-01 | Sin runtime de contenedores | Instalar Docker Desktop u OrbStack y arrancarlo, para habilitar `supabase db lint` y `supabase test db` (pgTAP) |
| EXT-02 | `GEMINI_API_KEY` ausente en el entorno de test | Exportar la clave si se quiere probar embeddings/resumen reales; mientras tanto se usan fakes deterministas |
| EXT-03 | Integración oficial de WhatsApp sin autorizar | `adk check` reporta `state: unconfigured`, `reason: requires authorization` |
| EXT-04 | `npm run evals` falla: falta la integración `chat` | Requiere `adk integrations add chat` + `adk deploy`, que modifica el proyecto en Botpress Cloud. **No lo ejecuté**: es una acción hacia afuera y la consigna prohíbe deploy sin autorización explícita. Autorizame y lo corro. |

## Estado de los gates (2026-08-11, ejecución fresca)

| Gate | Resultado |
|---|---|
| `npm run lint` | ✅ |
| `npm run typecheck` | ✅ |
| `npm run test:coverage` | ✅ 23 archivos / 280 tests |
| `npm run build` | ✅ (incluye `/api/agent/batches/[batch_id]/claim`) |
| `npm run test:integration` (PG nativo) | ✅ 8 archivos / 54 tests |
| `scripts/verify-native-postgres-loop.sh` | ✅ 3/3 desde cero |
| `npm run test:db:reset-loop` | ⛔ EXT-01 |
| `npm run test:db:lint` | ⛔ EXT-01 |
| `npm run test:db:invariants` | ⛔ EXT-01 |
| botpress `npm run typecheck` | ✅ |
| botpress `npm run check` | ✅ |
| botpress `npm run build` | ✅ |
| botpress `npm run evals` | ⛔ EXT-04 |

Git: HEAD sigue en `646045d`, sin commits, sin push, sin reset/checkout/clean/stash.
Ningún cambio preexistente fue borrado ni sobrescrito.

## Acciones operativas pendientes para el usuario

| ID | Acción |
|---|---|
| OPS-01 | `20260811010001_knowledge_chunks_gemini_768.sql` hace `TRUNCATE knowledge_chunks`. Los chunks son derivados, pero si el entorno donde se aplique ya tenía contenido ingerido hay que volver a correr `scripts/ingest-kb.mjs` o la búsqueda de KB devuelve vacío en silencio. |
| OPS-02 | Ni `knowledge_chunks` ni `search_knowledge_base` / `search_contact_memory` tienen GRANT explícito a `orchestrator_role` (deuda que viene de la fase 6, no la introdujo esta sesión). En Supabase funciona porque el rol de conexión es el dueño; conviene cerrarlo antes de producción. |
