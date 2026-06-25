---
description: "Task list for Agent Message Ingestion Endpoint"
---

# Tasks: Agent Message Ingestion Endpoint

**Input**: Design documents from `/specs/002-agent-message-ingestion/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: No se solicitaron pruebas automatizadas (el repo no tiene framework de tests, igual que la 001). La validación de cada historia se realiza con los escenarios `curl` de `quickstart.md`.

**Organization**: Tareas agrupadas por historia de usuario para implementación y validación independientes. Reutiliza primitivos de la feature 001 (no los reimplementa).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Puede correr en paralelo (archivo distinto, sin dependencias pendientes)
- **[Story]**: Historia de usuario asociada (US1–US4)

## Path Conventions

Web service Next.js App Router: Route Handlers en `src/app/api/`, lógica en `src/lib/`, migraciones en `supabase/migrations/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuración compartida de la feature

- [x] T001 [P] Agregar variables de entorno de la feature con sus defaults a `.env.local.example`: `SUMMARY_THRESHOLD=10`, `SUMMARY_MODEL=gpt-4o-mini`, `RECENT_TURNS_LIMIT=10`
- [x] T002 [P] Crear módulo de configuración `src/lib/config.ts` que lea y exponga `SUMMARY_THRESHOLD` (default 10), `SUMMARY_MODEL` (default `gpt-4o-mini`), `RECENT_TURNS_LIMIT` (default 10) y `LTM_RESULTS_LIMIT` (default 5) con parseo numérico seguro

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Cambios de esquema y tipos que TODAS las historias necesitan

**⚠️ CRITICAL**: Ninguna historia puede comenzar hasta completar esta fase

- [x] T003 Crear migración `supabase/migrations/20260625000001_contact_summary_and_turn_link.sql`: `ALTER TABLE contacts ADD COLUMN summary text, ADD COLUMN summary_updated_at timestamptz, ADD COLUMN pending_turns int NOT NULL DEFAULT 0 CHECK (pending_turns >= 0)`; `ALTER TABLE messages ADD COLUMN in_reply_to uuid REFERENCES messages(id)`; `CREATE UNIQUE INDEX messages_in_reply_to_unique ON messages (in_reply_to) WHERE in_reply_to IS NOT NULL` (solo tipos text/int/uuid — sin tocar `extensions.vector`, ver research D8)
- [ ] T004 Aplicar la migración (`supabase db push`) y verificar las nuevas columnas/índice en `contacts` y `messages`
- [x] T005 Extender la interfaz `Contact` en `src/lib/services/contact.service.ts` con `summary: string | null`, `summary_updated_at: string | null`, `pending_turns: number` (el `SELECT *`/`RETURNING *` ya los devuelve; solo se ajusta el tipo)

**Checkpoint**: Esquema y tipos listos — las historias pueden comenzar

---

## Phase 3: User Story 1 - Procesar mensaje entrante y devolver contexto consolidado (Priority: P1) 🎯 MVP

**Goal**: `POST /api/agent/ingest` identifica/crea el contacto, asegura conversación abierta, registra el inbound y devuelve `{turn_id, contact, recent_turns}` sin credenciales.

**Independent Test**: Enviar `{phone, content}` y verificar contacto resuelto, inbound registrado/auditado, y contexto con estado+resumen+turnos recientes, sin secretos (quickstart Esc. 1 y 7).

### Implementation for User Story 1

- [x] T006 [P] [US1] Agregar `findOpenConversation(contact_id, channel)` y `getOrCreateOpenConversation(contact_id, channel)` a `src/lib/services/conversation.service.ts` (reutiliza `createConversation`; selecciona la conversación `open` existente o crea una)
- [x] T007 [US1] Crear `src/lib/services/ingestion.service.ts` con `processInboundMessage({phone, content, channel})`: `resolveContact` → `getOrCreateOpenConversation` → `registerMessage(inbound)` → ensambla `recent_turns` (orden cronológico ascendente, heredado de `getRecentMessages`) con `getRecentMessages(conversation_id, RECENT_TURNS_LIMIT)` → devuelve `{ turn_id: inbound.id, contact: {id,status,name,blocked,summary,summary_updated_at}, recent_turns, long_term_memory: null, long_term_memory_available: true }` (memoria larga se cablea en US3)
- [x] T008 [US1] Crear handler `src/app/api/agent/ingest/route.ts` (POST) con schema Zod `{ phone: E.164, content: 1..4096, channel?: 'whatsapp'|'voice' default 'whatsapp' }`, delegando en `processInboundMessage` y mapeando errores: `INVALID_JSON`(400), `VALIDATION_ERROR`(400), `INVALID_PHONE`(400 desde `ContactValidationError`), `INTERNAL_ERROR`(500)
- [x] T009 [US1] Garantizar que la forma de `contact` devuelta excluye campos sensibles/infra (solo `id,status,name,blocked,summary,summary_updated_at`) en `ingestion.service.ts` — FR-010/SC-003. Incluir la señal `blocked = (status === 'inactivo')` para el caso opt-out/bloqueado (FR-004, edge case opt-out)
- [ ] T010 [US1] Validar con quickstart Escenario 1 (ingesta trivial: `long_term_memory: null`, sin búsqueda vectorial — incluido el caso borde de mensaje trivial que contiene un marcador de referencia, que NO debe disparar búsqueda), `blocked` presente en el contexto, y Escenario 7 (teléfono inválido→400, contenido vacío→400, sin auth→401)

**Checkpoint**: US1 funcional e independiente — MVP del endpoint de ingesta

---

## Phase 4: User Story 2 - Registrar la respuesta saliente generada (Priority: P1)

**Goal**: `POST /api/agent/reply` persiste el outbound correlacionado por `turn_id`, garantiza un outbound por turno e incrementa el contador de turnos.

**Independent Test**: Tras una ingesta, registrar la respuesta y verificar `direction:outbound`, `in_reply_to == turn_id`, `pending_turns` incrementado; reintento→409, turn inexistente→404 (quickstart Esc. 2).

### Implementation for User Story 2

- [x] T011 [P] [US2] Extender `registerMessage` en `src/lib/services/message.service.ts` para aceptar `in_reply_to?: string` opcional y persistirlo en el INSERT (incluir `in_reply_to` en el schema/tipo y en `RETURNING`); agregar `getMessageById(id)` para lookup del turno
- [x] T012 [US2] Agregar `registerAgentReply({turn_id, content})` a `src/lib/services/ingestion.service.ts`: validar que el inbound existe, es `direction:inbound`, pertenece a conversación `open` y no tiene reply previa → `registerMessage(outbound, in_reply_to=turn_id)` → `UPDATE contacts SET pending_turns = pending_turns + 1 WHERE id = contact_id RETURNING pending_turns`; lanzar `TurnNotFoundError`/`TurnAlreadyAnsweredError` (esta última también capturable desde la violación del índice único)
- [x] T013 [US2] Crear handler `src/app/api/agent/reply/route.ts` (POST) con schema Zod `{ turn_id: uuid, content: 1..4096 }`, delegando en `registerAgentReply`, devolviendo 201 `{message, summary_regenerated:false, pending_turns}` y mapeando `TURN_NOT_FOUND`(404), `TURN_ALREADY_ANSWERED`(409), `VALIDATION_ERROR`(400), `INVALID_JSON`(400), `INTERNAL_ERROR`(500)
- [ ] T014 [US2] Validar con quickstart Escenario 2 (correlación `in_reply_to`, `pending_turns:1`, reintento→409, turn inexistente→404)

**Checkpoint**: US1+US2 — loop completo de turno (entrante + saliente) auditado

---

## Phase 5: User Story 3 - Recuperar memoria de largo plazo solo ante referencias al pasado (Priority: P2)

**Goal**: La ingesta dispara `semanticSearch` (filtrada por `contact_id`) solo cuando el mensaje alude al pasado; degrada sin bloquear si falla.

**Independent Test**: Mensaje trivial→`long_term_memory:null` y cero búsquedas; mensaje referencial→fragmentos del propio contacto; fallo simulado→`long_term_memory_available:false` (quickstart Esc. 3 y 5).

### Implementation for User Story 3

- [x] T015 [P] [US3] Crear `src/lib/heuristics/reference-detection.ts` con `referencesPast(content): boolean` usando lista mantenible de marcadores normalizados (sin acentos, minúsculas), p. ej. `como te dije`, `lo que hablamos`, `mi cuenta`, `me ofreciste`, `el curso que`, `quedamos en`, `te pasé`, `mi pedido` (ver research D1)
- [x] T016 [US3] Cablear recuperación condicional en `processInboundMessage` (`src/lib/services/ingestion.service.ts`): trivialidad con precedencia → `shouldRetrieveMemory = !isTrivial(content) && referencesPast(content)` (short-circuit: un mensaje trivial NUNCA dispara búsqueda aunque tenga marcador — FR-006/SC-001); si `shouldRetrieveMemory` → `semanticSearch({contact_id, query:content, limit: config.ltmResultsLimit})` dentro de try/catch (degradación FR-015): éxito→`long_term_memory=results`, fallo→`long_term_memory=null, long_term_memory_available=false` + log/counter; en otro caso→`long_term_memory=null`. Nota: `semanticSearch` (001) embebe la query internamente; no se necesita paso de embedding aquí (ver research D9)
- [ ] T017 [US3] Validar con quickstart Escenario 3 (referencial dispara, aislamiento por `contact_id` SC-005) y Escenario 5 (degradación SC-007)

**Checkpoint**: Memoria de largo plazo condicional operativa y aislada por contacto

---

## Phase 6: User Story 4 - Mantener el resumen del contacto por umbral (Priority: P2)

**Goal**: Al completar un turno no trivial que cruza el umbral, regenerar el resumen una vez; reiniciar el contador solo tras éxito; diferir si el cruce ocurre en turno trivial.

**Independent Test**: Turnos bajo umbral→sin regeneración; cruce no trivial→`summary_regenerated:true`, `pending_turns:0`; cruce trivial→diferido (quickstart Esc. 4).

### Implementation for User Story 4

- [x] T018 [P] [US4] Crear `src/lib/heuristics/triviality.ts` con `isTrivial(content): boolean` (saludos/confirmaciones/agradecimientos y mensajes muy cortos sin pregunta ni cifras — ver research D2)
- [x] T019 [US4] Crear `src/lib/services/summary.service.ts` con `regenerateSummary(contact_id)`: obtener mensajes recientes del contacto → llamada chat OpenAI (`SUMMARY_MODEL`) con prompt acotado anti-alucinación (solo datos reales del contacto, Principio VII) → `UPDATE contacts SET summary=..., summary_updated_at=now()` → `auditLog({action:'contact.summary_regenerated', entity_type:'contact', entity_id:contact_id})`
- [x] T020 [US4] Extender `registerAgentReply` (`src/lib/services/ingestion.service.ts`): tras incrementar `pending_turns`, si `pending_turns >= SUMMARY_THRESHOLD` Y `!isTrivial(inbound.content)` → `regenerateSummary` en try/catch: éxito→`UPDATE pending_turns=0`, `summary_regenerated=true`; fallo→conservar contador/resumen (FR-015); cruce en turno trivial→diferir (sin regenerar/reiniciar). Devolver `summary_regenerated` y `pending_turns` en la respuesta
- [ ] T021 [US4] Validar con quickstart Escenario 4 (umbral no trivial regenera y resetea; borde trivial difiere sin resetear)

**Checkpoint**: Las 4 historias funcionan de forma independiente

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Observabilidad, tipos y validación integral

- [x] T022 [P] Agregar logging estructurado y counters para las operaciones nuevas (`ingest_processed`, `replies_registered`, `summaries_regenerated`, `references_detected`) en `ingestion.service.ts` y `summary.service.ts` usando `src/lib/observability/*`
- [x] T023 [P] Actualizar `src/lib/supabase/database.types.ts` con las columnas nuevas de `contacts` (`summary`, `summary_updated_at`, `pending_turns`) y `messages` (`in_reply_to`)
- [ ] T024 Verificar cobertura de auditoría (quickstart Esc. 6: `message.registered` inbound+outbound, `contact.summary_regenerated`) y ausencia de credenciales en respuestas (SC-003). Precondición FR-012 ya verificada por código: `registerMessage` (001) audita inbound/outbound de forma incondicional y fuera de catch (ver research D9); este paso confirma el comportamiento end-to-end contra la BD
- [ ] T025 Ejecutar la validación completa de `quickstart.md` (todos los escenarios, checklist SC-001…SC-007)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: sin dependencias — puede comenzar de inmediato
- **Foundational (Phase 2)**: depende de Setup — BLOQUEA todas las historias (T004 depende de T003; T005 depende de T004)
- **User Stories (Phase 3–6)**: dependen de Foundational
- **Polish (Phase 7)**: depende de las historias deseadas completas

### User Story Dependencies

- **US1 (P1)**: tras Foundational — sin dependencias de otras historias (MVP)
- **US2 (P1)**: tras Foundational — independiente; comparte `ingestion.service.ts` con US1
- **US3 (P2)**: tras US1 (extiende `processInboundMessage`); heurística T015 es independiente
- **US4 (P2)**: tras US2 (extiende `registerAgentReply` en T020); heurística T018 y `summary.service` T019 son independientes hasta T020

### Within Each User Story

- Heurísticas/servicios base antes de cablearlos en handlers
- Servicios antes de endpoints
- Validación quickstart al final de cada historia

### Parallel Opportunities

- Setup: T001, T002 en paralelo
- Heurísticas: T015 y T018 en paralelo entre sí y con otras tareas (archivos nuevos aislados)
- T011 (message.service) y T006 (conversation.service) tocan archivos distintos → paralelizables
- Polish: T022 y T023 en paralelo

---

## Parallel Example: heurísticas y servicios base

```bash
# Tras Foundational, archivos independientes en paralelo:
Task: "T006 [US1] findOpenConversation/getOrCreateOpenConversation en conversation.service.ts"
Task: "T011 [US2] in_reply_to + getMessageById en message.service.ts"
Task: "T015 [US3] referencesPast en heuristics/reference-detection.ts"
Task: "T018 [US4] isTrivial en heuristics/triviality.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → 2. Phase 2 Foundational (migración) → 3. Phase 3 US1 → **STOP y validar** ingesta + contexto → demo.

### Incremental Delivery

1. Setup + Foundational → base lista
2. US1 (ingesta+contexto) → MVP
3. US2 (registro de respuesta + correlación) → loop de turno completo
4. US3 (memoria de largo plazo condicional)
5. US4 (resumen por umbral)
6. Polish

### Parallel Team Strategy

Tras Foundational: Dev A → US1, Dev B → US2 (coordinando `ingestion.service.ts`), Dev C → heurísticas US3/US4. Integración por historia.

---

## Notes

- [P] = archivos distintos, sin dependencias pendientes
- `ingestion.service.ts` es tocado por US1 (T007), US2 (T012), US3 (T016) y US4 (T020): secuenciar esas ediciones aunque pertenezcan a historias distintas
- Reutiliza 001: `resolveContact`, `registerMessage`, `getRecentMessages`, `semanticSearch`, `auditLog`, middleware de auth
- Sin SQL de vectores nuevo (research D8); la migración solo agrega text/int/uuid
- Commit tras cada tarea o grupo lógico; validar cada historia en su checkpoint
