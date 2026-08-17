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

---

# Fases 4–8 (sesión 2026-08-11, continuación)

Baseline al arrancar: HEAD `d3ad38c`
(`feat: Migración Gemini 768 + serialización JSONB + Fase 2 batching durable`),
rama `snapshot/wip-full`. Sin reset, checkout, clean, stash, commit, push, PR,
deploy ni migración remota en toda la sesión.
`.env.local.bak-2026-08-10` nunca se abrió.

## Decisión de canal: Telegram

Telegram es el único canal real del piloto. WhatsApp queda **fuera de alcance**.
Se conservó la decisión previa de que Telegram viaje como `channel='whatsapp'` +
`sandbox_provider='telegram_sandbox'` + teléfono sintético + fila en
`sandbox_identities`: ejerce el mismo recorrido canónico que después usará
WhatsApp, y `provider` participa de todas las constraints de unicidad, así que
el aislamiento es de esquema, no de convención.

Telegram es sólo un adaptador de prueba. Ninguna regla comercial lo menciona.

## FASE 4 — Memoria selectiva

`selected_memories` invierte la carga de la prueba: no se recuerda nada salvo
que sobreviva a una validación estructural contra el lote que el cliente
escribió. Los rechazos también se guardan, con motivo — sin eso, «el agente
inventó un dato» es una anécdota en vez de una fila.

Archivos nuevos:

- `supabase/migrations/20260811030001_selected_memories.sql` — tabla con los seis
  estados (`proposed/accepted/rejected/active/superseded/expired`), FK compuesta
  `(source_message_id, conversation_id, contact_id, 'inbound')` que hace
  imposible citar a otro contacto o a un outbound, índice parcial único de un
  solo `active` por (contacto, tipo, clave), dedupe parcial por hash, CHECK que
  impide vectorizar cualquier cosa que no esté `accepted`/`active`, y cinco
  funciones (`record_selected_memory`, `record_rejected_memory`,
  `expire_selected_memories`, `search_selected_memories`,
  `claim_memory_embeddings`).
- `src/features/orchestration/domain/memory-selection.ts` — validación pura:
  tipo en lista cerrada, clave slug y no reservada, umbral de confianza, cita
  presente en el lote, valor anclado a su propia cita (ningún número aparece de
  la nada), datos sensibles, texto imperativo, y contradicción con datos
  estructurados.
- `src/features/orchestration/ports/memory-store.ts` + adapter Postgres.
- `src/features/orchestration/application/select-memories.ts` — tope de 10
  candidatos por turno; cada escritura aislada; un fallo cuenta y sigue.
- `src/app/api/cron/memory-maintenance/route.ts` — expiración + vectorización
  asíncrona con presupuesto de intentos.

Decisiones que costaron una corrección:

- El reemplazo entra como `accepted`, después se degrada el anterior, y recién
  entonces se promueve el nuevo a `active`. El orden es forzado: el índice
  parcial no se puede diferir y la FK de reemplazo exige que la fila nueva ya
  exista. Insertar directo como `active` fallaba con 23505 (encontrado por el
  test de reemplazo, corregido en la misma migración antes de aplicarla en
  ningún entorno real).
- La selección corre **después** del commit de la decisión y en otra conexión.
  Adentro de la transacción serializable, un solo INSERT rechazado abortaba la
  transacción entera y se llevaba puestos la decisión y el outbound.
- `PostgresMemoryRetriever` ahora lee `search_selected_memories` en vez de
  `search_contact_memory`: la memoria de largo plazo dejó de ser «todo mensaje
  vectorizado».

Pruebas: `memory-selection.test.ts` (26), `select-memories.test.ts` (9),
`selected-memories.test.ts` (13 contra PostgreSQL).

## FASE 5 — Knowledge Base y catálogo

- `src/features/orchestration/domain/retrieved-context.ts` — `sanitizeRetrievedText`
  (quita los marcadores de la cerca y los caracteres de control, marca lo que
  parece instrucción) y `capRetrievedItems` (trunca por ítem **antes** de medir
  el presupuesto total, o un documento gigante desaloja a todos los demás).
- `src/features/orchestration/domain/catalog-view.ts` — una promoción vencida no
  es «una promoción que terminó»: está **ausente** y el precio vuelve a lista.
  Catálogo vacío ⇒ `prices_assertable: false`, que es la señal de negarse a
  cotizar en vez de improvisar.
- `claim-batch.ts` aplica los topes a KB y memorias y reporta
  `knowledge_base_dropped` e `injection_suspected_count`: un tope nunca es una
  omisión silenciosa.
- La ruta del catálogo devuelve la vista, sin query params: la firma HMAC cubre
  path y body, así que un filtro por query sería la única entrada sin firmar.

Del lado ADK: `ClaimedTurnSchema` **declara** `knowledge_base` y
`selected_memories` (el hueco G-06: Next.js las devolvía y el contrato no las
nombraba), `CatalogResponseSchema`, y la acción `lookupCatalog`.

Pruebas: `retrieved-context.test.ts` (11), `catalog-view.test.ts` (10),
`botpress-response-parity.test.ts` (5).

## FASE 6 — Decision v3 y workflow durable

- `supabase/migrations/20260811040001_agent_decisions_v3.sql` — `schema_version
  IN (2,3)`, `retrieval_used jsonb` con CHECK de forma, y `business_action`
  limitado por la base a `mark_hot_lead` y `log_objection`. `escalate_to_human`
  se rechaza en la base **y** está ausente del schema productor: no hay humano
  al que derivar, así que permitir la fila sería crear un estado que nadie
  atiende. El trigger de inmutabilidad se recreó para cubrir la columna nueva.
- `decision.service.ts` usa `parseDecisionAny` + `assertBusinessActionPermitted`.
  v2 sigue siendo válido en el alambre.
- La ruta acepta una unión discriminada v2/v3; zod valida forma, el dominio
  valida reglas.
- `processInboundTurn` completo: transcribe → `/ingest` → `step.sleepUntil(due_at)`
  → `/claim` (hasta 6 intentos, deslizando con `retry_after_ms`) → se detiene en
  `absorbed`/`completed`/`abandoned` **sin llamar al modelo** → catálogo
  degradable → prompt armado exclusivamente con el contexto reclamado → Decision
  v3 → validación local → `/decision` → **un solo** `createMessage` → `/delivery`.
  `timeout` subido a 5m porque la ventana desliza.

Hallazgo del contrato, encontrado y cerrado: `IngestResponseSchema` del ADK
seguía exigiendo `context`, que la fase 3 había eliminado. Toda ingesta real
habría fallado con `INVALID_STUDYX_RESPONSE` — una caída total del camino feliz
que ningún test podía ver, porque los dos lados nunca están en el mismo proceso.
`tests/contract/botpress-response-parity.test.ts` ahora lo pinea desde los dos
extremos (tipo TypeScript real + texto del schema ADK).

Desviación registrada: el ADK no expone `tools` de forma verificable en sus
tipos, así que el catálogo se **inyecta como dato estructurado** dentro de la
cerca no confiable en vez de exponerse como herramienta con loop. Cumple lo
mismo (Botpress no toca PostgreSQL, el modelo no puede escribir) y es
determinista para evals.

Pruebas: `decision-v3-policy.test.ts` (10), `decision-v3.test.ts` (7 contra
PostgreSQL). Evals escritas: `conversational-matrix.eval.ts` (9 escenarios con
aserciones deterministas `not_contains`/`matches` + juez) y
`burst-single-answer.eval.ts`. Correr `adk evals` está bloqueado (EXT-04).

## FASE 7 — Concurrencia, entrega y reconciliación

Regla central: **un reenvío exige evidencia afirmativa de que no hubo envío
físico**, no la ausencia de evidencia de que sí lo hubo.

- `src/features/orchestration/domain/delivery-reconciliation.ts` — función pura.
  `provider_message_id` presente gana sobre cualquier otra señal, incluida la
  columna `state`. El estado ambiguo (arrendado, lease vencido, sin reporte) va
  a `ambiguous_paused`, que es **pegajoso**: ninguna pasada posterior lo puede
  convertir en reenvío, con cualquier presupuesto de intentos.
- `supabase/migrations/20260811050001_orchestration_reconciliation.sql` —
  `reconciliation_state/reason/at/count` en `outbound_deliveries`,
  `list_stale_outbound_deliveries`, `apply_delivery_reconciliation` (bajo
  `FOR UPDATE`, con re-chequeo de `provider_message_id` antes de autorizar) y
  `list_orphaned_decisions`.
- `application/reconcile-orchestration.ts` + `/api/cron/reconcile-orchestration`
  (cada 2 min en `vercel.json`), con auditoría por `event_key` determinista y
  ocho contadores.

Corrección durante la fase: `apply_delivery_reconciliation` intentaba
`failed_retryable -> pending`, que la máquina de estados de la fase 1 prohíbe.
Un reenvío autorizado **no** mueve `state` —`pending` y `failed_retryable` ya
son los estados desde los que un worker toma la entrega— sino que suelta el
lease muerto y adelanta el reloj. `mark_sent` pasa por `leased` porque
`submitted` sólo es alcanzable desde ahí, y esa transición es exactamente lo que
pasó. Pelearse con la máquina de estados habría sido el bug.

Pruebas: `delivery-reconciliation.test.ts` (15), `reconcile-orchestration.test.ts`
(11 contra PostgreSQL, con dos conexiones independientes reales).

Nota de test: `outbound_deliveries_set_updated_at` reescribe `updated_at` en
cada UPDATE, así que envejecer una fila requiere
`SET LOCAL session_replication_role='replica'` dentro de una transacción —
alcance de una sola conexión, seguro frente a archivos de test concurrentes.

## FASE 8 — Health, readiness y piloto

- `/api/health` — liveness pura, sin tocar dependencias. Una sonda de liveness
  que consultara PostgreSQL reiniciaría todos los procesos sanos durante un
  hipo de base.
- `/api/ready` — sólo configuración requerida y PostgreSQL. Reporta **nombres**
  de variables faltantes, jamás valores.
- `/api/diagnostics` — los degradables (Gemini, pgvector, backlog derivado),
  detrás de `CRON_SECRET`, siempre 200: el cuerpo trae la mala noticia. Separado
  a propósito, para que una caída de pgvector no pueda sacar de rotación a un
  proceso perfectamente capaz de conversar.
- `structured-log.ts` — `withTrace` (trace_id, contact_id, conversation_id,
  batch_id, turn_id, decision_id, outbound_id) y `timedStage` (latencia por
  etapa, en éxito y en error). Cableado en las rutas de claim y decisión.
- Contadores nuevos: memoria (aceptada/rechazada/duplicada/reemplazada/expirada/
  fallo de embedding), catálogo, y ocho de reconciliación.

Docs: `docs/PILOT_RUNBOOK.md`, `docs/PILOT_MATRIX.md` (36 escenarios en cuatro
bloques), `docs/FAILURE_MATRIX.md` (estaba vacío; ahora es la matriz completa
con la prueba de cada fila), `docs/ORCHESTRATOR_MAP.md` reescrito.

Pruebas: `readiness.test.ts` (9), `health-readiness.test.ts` (5).

## Autorrevisión: bug encontrado y corregido en la fase 8

`src/proxy.ts` tiene `matcher: ['/api/:path*']` y exige `x-orchestrator-key`
para todo salvo `/api/cron/`. Recién creados, `/api/health`, `/api/ready` y
`/api/diagnostics` devolvían **401** antes de llegar a su handler: existían y
eran inservibles. Un balanceador o una sonda de uptime no tiene ni va a tener
clave de orquestador, así que el proceso habría reportado «unhealthy» por la
única razón que no puede evitar — que la sonda es anónima.

Corregido con una lista de rutas públicas de coincidencia **exacta**
(`/api/healthcheck-admin` no es `/api/health`). `/api/diagnostics` sigue
exigiendo `CRON_SECRET`, pero en su handler: un 401 del proxy sería
indistinguible del 401 del handler y mandaría al operador tras la credencial
equivocada.

Prueba: `tests/unit/security/proxy-public-paths.test.ts` (9), escrita en rojo
antes del arreglo.

## Bloqueos externos (actualizado)

| ID | Bloqueo | Evidencia | Acción exacta del usuario |
|---|---|---|---|
| EXT-01 | Sin runtime de contenedores | `supabase status` falla contra `unix:///var/run/docker.sock` | Instalar Docker Desktop u OrbStack para `supabase db lint` y pgTAP |
| EXT-02 | `GEMINI_API_KEY` ausente en test | — | Exportarla para probar embeddings/resumen reales; mientras tanto hay fakes deterministas |
| EXT-04 | `npm run evals` falla | `adk check` no lista la integración `chat` | `adk integrations add chat` + `adk deploy`. **No lo ejecuté**: la consigna prohíbe agregar `chat` |
| EXT-05 | El piloto real por Telegram no puede correr | `adk check --format json` no lista `telegram` entre las dependencias instaladas | `adk integrations info telegram` → `adk integrations add telegram` → `adk deploy`, con autorización explícita |

EXT-03 (WhatsApp) queda cerrado por decisión: WhatsApp está fuera de alcance.

## Gates (ejecución fresca, fin de fase 8)

| Gate | Resultado |
|---|---|
| `npm run lint` | ✅ |
| `npm run typecheck` | ✅ (tras borrar `tsconfig.tsbuildinfo`) |
| `npm run test:coverage` | ✅ 31 archivos / 375 tests |
| `npm run build` | ✅ 19 rutas, incluidas health/ready/diagnostics y los 3 cron |
| `npm run test:integration` (PG nativo, cluster desde cero) | ✅ 12 archivos / 90 tests |
| `scripts/verify-native-postgres-loop.sh` | ✅ 3/3 desde cero |
| botpress `npm run typecheck` | ✅ |
| botpress `npm run check` | ✅ `errors: []` |
| botpress `npm run build` | ✅ |
| botpress `npm run evals` | ⛔ EXT-04 |
| `npm run test:db:lint` / `test:db:invariants` | ⛔ EXT-01 |

## Todavía NO implementado

1. **Worker de outbound.** El reconciliador puede *autorizar* un reenvío, pero
   nadie lo envía: `createMessage` vive en Botpress y no hay un proceso que tome
   entregas `resend_authorized`. Es deliberado —«no reintentos ciegos»— pero es
   un hueco real y hay que decirlo.
2. **Audio detrás de un puerto** (G-14): `transcribeAudio` se sigue invocando
   directo desde el workflow.
3. **Pruebas de carga.**
4. **WhatsApp**: fuera de alcance por decisión.
5. **Ejecución del piloto**: ninguna fila de `PILOT_MATRIX.md` está llena.
   Bloqueado por EXT-05.
6. ~~`docs/ROADMAP.md` invariante 6 dice «OpenAI»~~ — corregido a Gemini en esta sesión (4 referencias).
7. OPS-02 sigue abierto: `knowledge_chunks` y las funciones de búsqueda de KB no
   tienen GRANT explícito a `orchestrator_role` (deuda de la fase 6 previa).

---

# FASE 7b — Cierre de la revisión adversarial y salida a producción

Fecha: 2026-08-11 (sesión de despliegue).

## Los dos fallos del revisor, y por qué eran el mismo fallo

El revisor independiente encontró dos caminos por los que el sistema podía
mandar el mismo mensaje dos veces. Los dos nacen del mismo error conceptual:
tratar *«lo último que se supo de esta entrega»* como si fuera *«lo que se sabe
del intento que corre ahora»*.

### Fallo A — la pausa no era terminal

`apply_delivery_reconciliation` aceptaba `authorize_resend` sobre una entrega ya
marcada `ambiguous_paused`. `list_stale_outbound_deliveries` filtraba las
pausadas, y el dominio devolvía `wait`, pero **filtrar una lectura no es
proteger una escritura**: entre que una pasada leyó su lista y escribe su
veredicto, otra pudo haber pausado la fila. Dos cron superpuestos alcanzaban.

### Fallo B — un reporte sin dueño

`list_stale_outbound_deliveries` tomaba el reporte más reciente de la entrega
sin preguntar a qué intento pertenecía. Un `failed` del intento 1 quedaba como
evidencia sobre el intento 2, que pudo haber creado el mensaje en Botpress antes
de morir. El reconciliador leía «falló antes de enviar» y autorizaba un reenvío
encima de un envío físico.

## Reproducción (TDD, rojo antes que verde)

Los tests del revisor en `tests/integration/zz-adversarial-review.test.ts`
fallaron primero, los dos con el mismo síntoma:

```
FINDING A: expected 'resend_authorized' to be 'ambiguous_paused'
FINDING B: expected 'resend_authorized' to be 'ambiguous_paused'
```

Se sumaron 10 tests nuevos en `tests/integration/delivery-attempt-fencing.test.ts`
(8 en rojo, 2 como guardas de regresión) antes de escribir una línea de producción.

## La corrección

Migración **aditiva** `20260811060001_delivery_attempt_fencing.sql`. No se tocó
ninguna migración aplicada.

1. `delivery_reports.delivery_attempt` — un reporte pertenece a un intento.
2. Trigger `delivery_reports_attempt_fence` — un reporte no puede decir que
   pertenece a un intento que todavía no ocurrió.
3. `list_stale_outbound_deliveries` — sólo lee reportes del intento vigente
   (`IS NOT DISTINCT FROM`: sin intento no hay evidencia, y sin evidencia se
   pausa).
4. `apply_delivery_reconciliation` — desde `ambiguous_paused` la única
   transición que puede hacer una máquina es converger hacia un envío probado
   (`mark_sent` con `provider_message_id`). Todo lo demás se **rechaza y se
   audita** en `audit_log` como `delivery.reconciliation.rejected`.

En TypeScript (`decision.service.ts`):

- La entrega se bloquea (`FOR UPDATE`) **antes** de calcular nada: el intento es
  lo que le da identidad al reporte y hay que leerlo bajo el mismo lock que
  después rechaza mover una fila cuyo intento avanzó.
- El intento entra en el `event_key`, así un replay del intento 1 sigue
  deduplicando pero el reporte propio del intento 2 se puede registrar al lado.
- Un reporte atrasado se guarda como evidencia, se audita
  (`delivery.report.stale_ignored`) y devuelve `status: 'stale_ignored'` **sin
  tocar el estado de la entrega**.
- Los `UPDATE` que mueven estado llevan `AND attempt_count = <intento>`.

Contrato de punta a punta: el commit devuelve `outbound.delivery_attempt` (del
`RETURNING` del propio UPDATE que toma el lease) y el workflow de Botpress lo
devuelve en los dos reportes, éxito y fracaso.

## Corrección de un test, justificada

`reconcile-orchestration.test.ts` → «abandons instead of resending when the
attempt budget is gone» pasó a agotar el presupuesto **antes** del reporte. El
orden viejo (reportar y después mover el contador) dejaba al último intento sin
evidencia, que bajo la regla nueva es un pausado, no un abandono. No se debilitó
la aserción: se corrigió el montaje para que pruebe lo que dice probar.

## Lint

Se eliminaron los dos `console.log` forenses del revisor y sus directivas
`eslint-disable` sobrantes, convirtiendo el output de depuración en aserciones
reales (`applied.applied === false`, `by_action.authorize_resend === 0`,
`after.state === before.state`).

## Gates (ejecución fresca, fase 7b)

| Gate | Resultado |
|---|---|
| `npm run lint` | ✅ 0 errores, 0 warnings |
| `npm run typecheck` | ✅ |
| `npm run test:coverage` | ✅ 32 archivos / 384 tests |
| `npm run test:integration` (PG nativo desde cero) | ✅ 14 archivos / 104 tests |
| `scripts/verify-native-postgres-loop.sh` | ✅ 3/3 |
| `npm run build` | ✅ 20 rutas |
| botpress `typecheck` / `check` / `build` | ✅ |

## Supabase remoto: la divergencia, resuelta

El remoto tenía dos migraciones que **no están en Git**:
`20260805000001_universal_business_memory` y `20260805000002_secure_existing_tables`.
La primera creó un `knowledge_chunks` de otro linaje (`source_id`,
`embedding_status`, `metadata`, FK a `knowledge_sources`, función
`search_workspace_knowledge`) que chocaba por nombre con el KB de la fase 6.

Ningún código de StudyX referencia ese linaje: el repo usa
`knowledge_documents` + `knowledge_chunks(document_id, …)` + `search_knowledge_base()`.

Resolución aprobada por el usuario, **no destructiva**:

```sql
ALTER TABLE public.knowledge_chunks RENAME TO legacy_knowledge_chunks_20260805;
```

Las 6 filas se conservan y el rename es reversible. Queda huérfana
`search_workspace_knowledge`, que StudyX nunca invoca.

No se ejecutó `migration repair --status reverted`: habría dejado el historial
diciendo que esas dos migraciones están revertidas cuando en realidad están
aplicadas. En su lugar, cada migración pendiente se aplicó en su propia
transacción con `psql --single-transaction` y se registró en
`supabase_migrations.schema_migrations`.

Aplicadas en orden: `20260809020001`, `20260811010001`, `20260811020001`,
`20260811030001`, `20260811040001`, `20260811050001`, `20260811060001`.
`migration list` ya no muestra pendientes locales.

Verificado en remoto: `inbound_batches`, `selected_memories`,
`knowledge_documents`, `apply_delivery_reconciliation` con la guarda adherente,
`delivery_reports.delivery_attempt` y el trigger de fencing.

## Vercel

Proyecto `maneyraos-projects/studyx-agente-ventas` creado y vinculado.
Variables cargadas en `production`. Se agregó `.vercelignore` para que ningún
`.env*` ni `*.bak-*` viaje en el upload.

**Restricción de plan:** la cuenta es Hobby y sólo admite cron diarios. Los tres
cron pasaron de `*/5`, `*/10` y `*/2` a una corrida diaria. No están en el
camino crítico de un turno (ingest → claim → decision → delivery es síncrono),
pero el reconciliador deja de barrer cada 2 minutos. Durante el piloto se
dispara a mano contra `/api/cron/reconcile-orchestration` con `CRON_SECRET`.
El plan Pro restituye la cadencia original.

## Hallazgo abierto (no bloqueante)

`DATABASE_URL` entra al pooler como `postgres` (superusuario), no como
`orchestrator_role`. El comentario de `src/lib/db/orchestrator.ts` afirma lo
segundo. El modelo de menor privilegio de la fase 1 —sin acceso directo a
`audit_log`— no está en efecto en producción. No rompe nada funcional; hay que
corregirlo antes de tráfico real.
