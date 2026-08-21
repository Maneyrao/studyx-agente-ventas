# StudyX — Recuperación de memoria vectorial y reducción de latencia

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task, `superpowers:using-git-worktrees` before parallel work, and `superpowers:verification-before-completion` before every deploy. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restaurar la memoria vectorial de Agent A, asegurar que las memorias propuestas sean aceptables y auditables, y reducir la latencia sin sacrificar consistencia, aislamiento ni actualidad comercial.

**Architecture:** Supabase/PostgreSQL sigue siendo la fuente de verdad. Botpress recibe en cada `claim` un snapshot controlado de negocio, conversación y memoria; no accede directamente a la base. Se migra a `gemini-embedding-2` manteniendo `vector(768)`, se identifica cada vector con un epoch, se reindexan todos los derivados y se conserva una cola durable. En el hot path se usa un solo embedding por turno y el catálogo sale del mismo snapshot del `claim`, eliminando una lectura HTTP/DB duplicada.

**Tech Stack:** Next.js 16, TypeScript, PostgreSQL/Supabase, pgvector, Botpress ADK, Gemini Embeddings, Vercel.

**Spec:** `docs/ORCHESTRATOR_MAP.md`, `docs/PILOT_RUNBOOK.md`, `docs/PILOT_MATRIX.md`, [Gemini Embeddings](https://ai.google.dev/gemini-api/docs/embeddings), [Gemini deprecations](https://ai.google.dev/gemini-api/docs/deprecations), [Vercel Cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing), [Next.js after](https://nextjs.org/docs/app/api-reference/functions/after).

## Diagnóstico confirmado

- `text-embedding-004` está apagado y el backend recibe HTTP 404.
- Hay 58 `embedding_jobs` fallidos, 23 `knowledge_projection_jobs` pendientes y 0 documentos/chunks vectoriales actuales.
- Las 16 memorias selectivas registradas fueron rechazadas con `TYPE_NOT_ALLOWED`: el contrato del modelo permite cualquier `type`, pero el backend sólo acepta siete.
- Agent A sí recibe negocio estructurado desde Supabase. La memoria reciente y los datos de cursos/pagos funcionan sin pgvector.
- El camino actual genera dos embeddings iguales por turno y vuelve a consultar el catálogo después de que `claim` ya cargó los mismos datos.
- Baseline Telegram reciente, sólo orientativo (`n=7`): decisión p50 4,3 s; p95 5,8 s. La ventana intencional es 1 s.

## Reglas globales

- No editar migraciones aplicadas; sólo migraciones aditivas.
- No mezclar vectores de modelos o instrucciones distintas aunque ambos midan 768.
- No imprimir claves, tokens, URLs firmadas ni contenido personal en logs o evidencias.
- No ejecutar semillas, resets ni pruebas contra `DATABASE_URL`; esa variable apunta a producción. Usar `TEST_DATABASE_URL` local.
- La falta de pgvector/embeddings degrada la respuesta, pero nunca debe bloquear el turno.
- Consentimiento, estado del contacto, llamadas, pagos y precios nunca se cachean entre turnos.
- Una llamada fallida al proveedor no debe provocar duplicación de decisiones ni mensajes.
- Los cron de Vercel Hobby pueden correr como máximo una vez por día. No reintroducir `*/5` ni `*/15`.
- Los cambios locales de Agent A v2 y opt-out se preservan antes de abrir worktrees. `.jez/`, `*.source.json`, `agent-a.json` y `botpress-agent/retell/*` quedan fuera del runtime salvo decisión explícita.

## Organización de agentes

| Rol | Trabajo | Puede correr en paralelo | Archivos exclusivos principales |
|---|---|---:|---|
| Lead/Integrator | Baseline, contratos compartidos, merges, gates y release | Siempre activo | Ningún cambio grande sin review |
| Vector Worker | Proveedor Gemini, epoch, colas, backfill y diagnósticos | Sí, Wave 1 | `src/lib/embeddings`, workers, migración vectorial |
| Memory Contract Worker | Tipos permitidos, privacidad, prompt y aceptación de memorias | Sí, Wave 1 | schemas/prompt de memoria y sus tests |
| Latency Worker | Snapshot único, embedding único y eliminación del catálogo duplicado | Wave 2 | `claim-batch`, retrievers, business context, workflow Botpress |
| Release Verifier | Preview, migración, drain, Telegram smoke y rollback | Wave 3, sólo lectura hasta el deploy | scripts/runbooks/evidencia |

El Lead no permite que Memory Contract Worker y Latency Worker editen simultáneamente `botpress-agent/src/prompts/agent-a-sales-bridge.ts` o `botpress-agent/src/schemas/contracts.ts`. Latency empieza después de integrar Memory Contract.

## Orden de ejecución

```text
Task 0 ─┬─> Task 1 Vector ─> Task 3 Colas/epoch ─┐
        └─> Task 2 Memoria ──────────────────────┼─> Task 4 Latencia
                                                └─> Task 5 Backfill local
Task 4 + Task 5 ─> Task 6 Gates ─> Task 7 Preview/producción ─> Task 8 Telegram
```

---

### Task 0: Congelar el baseline y preservar Agent A v2

**Owner:** Lead/Integrator

**Files:**
- Commit only: `src/lib/heuristics/opt-out.ts`, `botpress-agent/src/prompts/agent-a-sales-bridge.ts`, sus tests y `docs/PILOT_MATRIX.md`.
- Exclude: `.jez/`, `botpress-agent/retell/`, `botpress-agent/src/**/*.source.json`, `botpress-agent/src/prompts/agent-a.json`.

**Produces:** rama limpia `codex/memory-latency-recovery` basada en `736cc36`, con Agent A v2 preservado en un commit independiente.

- [ ] Registrar `git status --short`, `git rev-parse HEAD` y los dos `git ls-remote` sin modificar archivos.
- [ ] Ejecutar los tests actuales antes de separar ramas:

```bash
npm run lint
npm run typecheck
npm test
cd botpress-agent && npm run typecheck && npm run check
```

- [ ] Crear `codex/memory-latency-recovery`, agregar sólo los archivos ejecutables y tests de Agent A v2, verificar `git diff --cached --check` y commitear:

```bash
git commit -m "fix: keep WhatsApp sales open after call decline"
```

- [ ] Usar `superpowers:using-git-worktrees` para crear dos worktrees desde ese commit: `vector-recovery` y `memory-contract`.

**Gate:** tests verdes; ningún artefacto no ejecutable dentro del commit; worktrees parten del mismo SHA.

---

### Task 1: Cambiar el proveedor a Gemini Embedding 2

**Owner:** Vector Worker

**Files:**
- Modify: `src/lib/embeddings/gemini.ts`
- Create: `tests/unit/embeddings/gemini.test.ts`
- Create: `scripts/smoke-embedding-gemini.mjs`
- Modify callers: `src/lib/services/message.service.ts`, `memory.service.ts`, `knowledge-base.service.ts`, `knowledge-projection.service.ts`, `src/features/orchestration/adapters/postgres-retrievers.ts`, y workers de embeddings.

**Interfaces:**
- Produces: `generateQueryEmbedding(text)` y `generateDocumentEmbedding({ title, text, kind })`.
- Constant: `EMBEDDING_DIMENSIONS = 768`.
- Constant: `EMBEDDING_EPOCH = 'gemini-embedding-2:768:retrieval-v1'`.
- Errors distinguish `retryable` (timeout/red/429/5xx) from `terminal_configuration` (400/401/403/404).

- [ ] Escribir primero tests con `fetch` simulado que exijan:
  - endpoint `models/gemini-embedding-2:embedContent`;
  - API key en `x-goog-api-key`, nunca en URL;
  - `embedContentConfig.outputDimensionality = 768`;
  - 768 números finitos;
  - instrucciones distintas y estables para query/document;
  - clasificación de 401/404 como terminal y 429/5xx como retryable.
- [ ] Correr `npx vitest run tests/unit/embeddings/gemini.test.ts` y verificar que falla por `text-embedding-004`.
- [ ] Implementar el adaptador mínimo y actualizar todos los consumidores con el propósito correcto.
- [ ] Crear el smoke que lee `GEMINI_API_KEY`, imprime solamente modelo/dimensión/duración/status y falla si la longitud no es 768.
- [ ] Correr unitarios, typecheck y el smoke con la clave local.
- [ ] Commit:

```bash
git commit -m "fix: migrate embeddings to gemini embedding 2"
```

**Gate:** un embedding real devuelve exactamente 768 valores; ningún secreto aparece en salida; todas las llamadas viejas fueron reemplazadas.

---

### Task 2: Alinear el contrato de memoria con Agent A

**Owner:** Memory Contract Worker

**Files:**
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/prompts/agent-a-sales-bridge.ts`
- Modify: `src/app/api/agent/turns/[turn_id]/decision/route.ts`
- Modify: `src/features/orchestration/domain/decision.ts`
- Modify: `src/features/orchestration/domain/memory-selection.ts`
- Test: `tests/unit/orchestration/memory-selection.test.ts`
- Test: `tests/integration/selected-memories.test.ts`
- Test: `tests/unit/botpress/agent-a-sales-bridge-prompt.test.ts`
- Test: `tests/contract/botpress-response-parity.test.ts`

**Interfaces:** `memory_candidates[].type` acepta únicamente `study_goal`, `study_context`, `preference`, `constraint`, `objection`, `timeline`, `contact_preference`.

- [ ] Escribir tests rojos que demuestren:
  - `interest`, `profile`, `location`, `user_fact` y tipos libres no atraviesan el schema;
  - `study_goal/course_of_interest` con cita literal sí se acepta;
  - nombre, email, teléfono y código postal no se almacenan como memoria vectorial;
  - rechazo de llamada se guarda como `contact_preference`, no como opt-out general;
  - precio, pago, cupo y consentimiento siguen prohibidos.
- [ ] Cambiar los tres schemas al mismo enum cerrado y mantener el test de paridad.
- [ ] Agregar al prompt la tabla mínima tipo→uso y exigir `[]` cuando no exista un hecho literal seguro.
- [ ] Agregar claves de PII al conjunto reservado y un test de regresión por cada categoría.
- [ ] Correr suites de memoria, prompt y contratos.
- [ ] Commit:

```bash
git commit -m "fix: align Agent A memory candidates with backend policy"
```

**Gate:** el escenario “Me interesa Barista” crea una memoria `active/pending`; ningún candidato nuevo termina en `TYPE_NOT_ALLOWED`; PII queda fuera del vector store.

---

### Task 3: Versionar vectores y volver seguras las colas

**Owner:** Vector Worker, después de Task 1

**Files:**
- Create: `supabase/migrations/20260821010001_embedding_epoch_gemini_2.sql`
- Create: `src/lib/services/message-embedding-worker.service.ts`
- Create: `src/lib/services/selected-memory-embedding-worker.service.ts`
- Modify: `src/lib/services/knowledge-projection.service.ts`
- Modify: `src/app/api/cron/retry-embeddings/route.ts`
- Modify: `src/app/api/cron/memory-maintenance/route.ts`
- Modify: `src/app/api/cron/project-knowledge/route.ts`
- Create: guarded CLI runners under `scripts/` for the three durable queues.
- Test: embedding dimensions, database invariants, selected memories, knowledge projection and isolation.

**Interfaces:** cada vector materializado guarda `embedding_epoch`; toda búsqueda recibe el epoch activo y excluye vectores anteriores.

- [ ] Escribir tests de migración que fallen porque las tablas y funciones aún no conocen el epoch.
- [ ] Agregar `embedding_epoch` nullable a `message_embeddings`, `selected_memories` y `knowledge_chunks`; vectores `ready/indexed` nuevos deben llevar el epoch activo.
- [ ] Crear overloads epoch-aware de `search_contact_memory`, `search_selected_memories` y `search_knowledge_base`. Mantener temporalmente firmas antiguas durante expand/backfill.
- [ ] Corregir `claim_memory_embeddings`: agregar estado leased, `lease_until` y `leased_by`; dos workers concurrentes nunca pueden reclamar la misma memoria.
- [ ] Limitar cada worker por cantidad pequeña y deadline de pared menor a 50 s; no reclamar más trabajo del que puede terminar antes del máximo Hobby de 60 s.
- [ ] Hacer que cada `UPDATE ... completed/ready` verifique que modificó exactamente la fila arrendada.
- [ ] Agregar backoff y dead-letter coherentes para proveedor retryable; un error terminal de configuración no debe quemar reintentos infinitamente.
- [ ] Actualizar diagnósticos con conteos/edad/error de las tres colas y cobertura del epoch, sin llamar Gemini en cada poll.
- [ ] Correr integración con dos workers concurrentes y dos drains consecutivos.
- [ ] Commit:

```bash
git commit -m "feat: make vector materialization epoch-aware and durable"
```

**Gate:** cero doble claim; replay idempotente; búsquedas ignoran epoch viejo; no se cambia `vector(768)`.

---

### Task 4: Reducir el hot path del orquestador

**Owner:** Latency Worker, después de integrar Tasks 1–3

**Files:**
- Modify: `src/features/orchestration/ports/retrieval.ts`
- Modify: `src/features/orchestration/adapters/postgres-retrievers.ts`
- Modify: `src/features/orchestration/application/claim-batch.ts`
- Modify: `src/features/orchestration/domain/business-context.ts`
- Modify: `src/features/orchestration/adapters/postgres-business-context.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `botpress-agent/src/prompts/agent-a-sales-bridge.ts`
- Retain for non-turn callers: `src/app/api/agent/tools/catalog/route.ts` and `botpress-agent/src/actions/lookupCatalog.ts`.

**Interfaces:**
- `claim` devuelve un único snapshot comercial con `as_of`, offerings y `prices_assertable`.
- Una query no trivial genera un solo embedding y lo comparte entre memoria y KB.
- El workflow normal no llama `lookupCatalog` después del claim.

- [ ] Agregar timings PII-free: espera real, claim total, core DB, embedding compartido, búsqueda memoria, búsqueda KB, snapshot comercial, modelo y event→decision.
- [ ] Escribir tests rojos: `embedding_calls === 1`; `catalog_calls === 0`; memoria/KB reciben el mismo vector; un fallo DB de una búsqueda no borra la otra; un fallo del embedding marca ambas indisponibles.
- [ ] Generar una sola query embedding en `claim-batch` y ejecutar únicamente las dos búsquedas pgvector en paralelo.
- [ ] Hacer una sola consulta SQL del business snapshot por slug, con workspace, offerings y qualification fields acotados. Agregar `as_of` de base.
- [ ] Derivar el catálogo compacto desde ese snapshot y eliminar `lookupCatalog` del camino normal de Botpress.
- [ ] Mantener `/tools/catalog` como endpoint independiente, pero con lectura específica que no cargue qualification fields.
- [ ] Eliminar del prompt la duplicación catálogo/offerings: cada precio, nombre y modalidad aparece una sola vez.
- [ ] Excluir mensajes del batch actual de `recent_turns` para que no entren dos veces al prompt.
- [ ] Hacer que saludo inequívoco y decisión determinista de llamada salteen embeddings. Centralizar/parificar la clasificación para no crear regex divergentes.
- [ ] No subir `DB_POOL_MAX` todavía. Primero consolidar queries y medir.
- [ ] Commit:

```bash
git commit -m "perf: remove duplicate catalog and embedding reads"
```

**Gate estructural:** 0 llamadas de catálogo por turno normal; máximo 1 embedding; máximo 5 statements desde claim hasta modelo en warm path; fast paths sin embeddings.

---

### Task 5: Reindexar datos derivados de forma reproducible

**Owner:** Vector Worker + DB reviewer

**Files:**
- Extend migration/runbook from Task 3.
- Update: `docs/PILOT_RUNBOOK.md`.

- [ ] En PostgreSQL local desechable, aplicar todas las migraciones desde cero.
- [ ] Marcar los vectores del epoch anterior como no elegibles, sin borrar mensajes, memorias auditadas ni `knowledge_sources`.
- [ ] Revivir/recrear idempotentemente:
  - `message_embeddings` derivados del proveedor anterior;
  - memorias `accepted/active` como `pending`, intentos 0;
  - jobs de cada `knowledge_source active` sin chunk del epoch actual.
- [ ] Ejecutar los tres runners hasta que una pasada reclame 0.
- [ ] Ejecutarlos una segunda vez y comprobar que no crean filas ni trabajo nuevo.
- [ ] Probar una query conocida de KB y una memoria conocida del mismo contacto; repetir con otro workspace/contacto y exigir 0 fugas.
- [ ] Documentar comandos de backfill, conteos esperados y rollback operativo.

**Gate:** fuentes activas = documentos/chunks visibles del epoch actual; colas claimables/fallidas/dead-letter = 0; aislamiento verde.

---

### Task 6: Gates integrados antes de tocar producción

**Owner:** Lead/Integrator + Release Verifier

- [ ] Integrar commits en `codex/memory-latency-recovery` uno por uno y revisar conflictos.
- [ ] Ejecutar:

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:coverage
bash scripts/pg-native-up.sh
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration
npm run build
cd botpress-agent && npm run typecheck && npm run check && npm run build
```

- [ ] Ejecutar las evals reales de Agent A v2 y guardar evidencia con prompt version.
- [ ] Extender `scripts/load-turn-concurrency.mjs` con un mensaje comercial no trivial; correr al menos 100 turnos exitosos en tres ventanas.
- [ ] Comparar baseline vs candidato:
  - event→decision objetivo p50 ≤ 3,2 s y p95 ≤ 4,5 s;
  - batch sleep real p95 ≤ 1,15 s;
  - claim p95 ≤ 1,8 s;
  - 0 duplicados de decisión/outbound;
  - disponibilidad de KB/memoria sin regresión.

**Gate:** todas las suites verdes y budgets cumplidos o desviación explicada con evidencia; ninguna prueba toca producción.

---

### Task 7: Despliegue expand → backfill → activación

**Owner:** Release Verifier; Lead aprueba cada gate

- [ ] Verificar en Vercel, sin imprimir valores: `GEMINI_API_KEY`, `DATABASE_URL`, `CRON_SECRET`, `BUSINESS_WORKSPACE_SLUG`, claves de orquestador y firma.
- [ ] Aplicar primero la migración aditiva de epoch; no ejecutar todavía el backfill.
- [ ] Desplegar Next.js candidato sin mover el alias y verificar SHA, `/api/health`, `/api/ready` y diagnostics.
- [ ] Promover backend. La recuperación vectorial degrada abierto mientras todavía no haya backfill.
- [ ] Ejecutar el backfill idempotente y drenar las tres colas con runners guardados.
- [ ] Reagendar únicamente workers ya acotados, una vez por día en Hobby y en horas separadas. El cron es recuperación; nunca forma parte de la respuesta conversacional.
- [ ] Para baja latencia de memoria nueva, invocar un worker pequeño mediante `after()` después del commit; la fila durable y el cron diario siguen siendo la garantía de recuperación.
- [ ] Desplegar Botpress después de que el backend y el snapshot sean compatibles. Confirmar que producción registra `studyx-agent-a-sales-v2`.

**Gate:** epoch actual con cobertura total; backlog 0; Botpress sin `paused_error`; alias y SHA documentados.

**Rollback:** desactivar automatización Botpress, deshabilitar schedules explícitamente, restaurar el deployment anterior de aplicación y dejar las colas pendientes. No volver a `text-embedding-004`, no eliminar el epoch ni restaurar vectores viejos.

---

### Task 8: Smoke E2E de Telegram y cierre

**Owner:** Release Verifier + observador DB

- [ ] Verificar webhook Agent A sin cambiarlo: host Botpress, backlog 0, sin error.
- [ ] Ejecutar conversación trazable:
  1. “Hola, me interesa el curso de Barista”.
  2. Responder una preferencia/objetivo literal que deba recordarse.
  3. Cambiar de tema y volver a preguntar por el objetivo para comprobar recuperación.
  4. Solicitar información comercial y elegir una de las tres formas de pago.
  5. Rechazar una llamada y continuar por escrito.
- [ ] Por cada trace exigir: un inbound, una decisión, un outbound, un submission y ninguna entrega ambigua.
- [ ] Comprobar `business_context_available=true`, `knowledge_base_available=true`, `long_term_memory_available=true` en el turno que corresponda.
- [ ] Comprobar memoria `active/ready` con epoch actual, cita literal y mismo contacto.
- [ ] Comprobar que el enlace de pago elegido sale del snapshot estructurado y que no existe una cuarta opción.
- [ ] Observar 30 minutos; guardar SHA Git, deployment Vercel, revisión Botpress, prompt version, métricas y conteos sanitizados.

**Definición de terminado:** memoria nueva aceptada y recuperada, KB consultable, catálogo actual sin segunda lectura, Telegram responde una sola vez, objetivos de latencia cumplidos y rollback probado/documentado.

## Estimación con agentes

| Wave | Trabajo | Tiempo esperado |
|---|---|---:|
| 0 | Baseline y preservación de v2 | 2–3 h |
| 1 paralela | Provider + contrato de memoria | 6–10 h |
| 2 | Epoch/colas + hot path | 10–16 h |
| 3 | Integración, backfill, deploy y smoke | 6–10 h |
| Total calendario | Con dos workers y un integrador | 3–5 días laborables |

No sumar Agent B/Retell a este release. Su webhook, credenciales y loop post-llamada son otra línea de trabajo y no deben bloquear la recuperación de Agent A.
