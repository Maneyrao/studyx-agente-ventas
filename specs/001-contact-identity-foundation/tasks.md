---
description: "Task list for Contact Identity Foundation"
---

# Tasks: Contact Identity Foundation

**Input**: Design documents from `/specs/001-contact-identity-foundation/`

**Prerequisites**: plan.md ✅ | spec.md ✅ | data-model.md ✅ | contracts/api.md ✅ | research.md ✅

**Tests**: No test tasks (no TDD explícito solicitado en la spec). Validación vía quickstart.md.

**Organization**: Tareas agrupadas por user story. Setup y Foundation son prerequisitos globales.

**Changelog** (post speckit-analyze):
- I4: T013 separado en dos roles; nuevo T014 función `write_audit_log` SECURITY DEFINER
- C1: nuevo T022 módulo de contadores; integrado en T024, T027, T033
- C3: T009 menciona explícitamente los dos índices requeridos por SC-005
- I2: T035 (cron) solo crea el route handler; T037 crea `vercel.json` completo

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Puede correr en paralelo (archivos diferentes, sin dependencias incompletas)
- **[Story]**: A qué user story pertenece (US1–US4)
- Incluye rutas de archivo exactas en cada descripción

---

## Phase 1: Setup

**Purpose**: Inicialización del proyecto y configuración base.

- [x] T001 Inicializar proyecto Next.js 14 con App Router y TypeScript en la raíz del repositorio (`npx create-next-app@latest . --typescript --app --src-dir --no-tailwind`)
- [x] T002 [P] Instalar dependencias de runtime: `postgres` (postgres.js v3), `openai`, `zod`; instalar como devDependency: `@supabase/supabase-js` (solo para Supabase CLI y generación de tipos); actualizar `package.json`
- [x] T003 [P] Crear estructura de directorios vacíos: `src/lib/db/`, `src/lib/supabase/`, `src/lib/services/`, `src/lib/embeddings/`, `src/lib/audit/`, `src/lib/observability/`, `supabase/migrations/`, `supabase/seed/`
- [x] T004 [P] Inicializar Supabase CLI y vincular proyecto local (`supabase init`, `supabase link`); generar `supabase/config.toml`
- [x] T005 [P] Crear `.env.local.example` con las variables de runtime: `DATABASE_URL` (Supavisor connection string de `orchestrator_role`, transaction mode, formato `postgresql://orchestrator_role:<pw>@<ref>.pooler.supabase.com:5432/postgres`), `AUDIT_DATABASE_URL` (ídem para `audit_writer`), `OPENAI_API_KEY`, `ORCHESTRATOR_API_KEY`; agregar comentario: "`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` son solo para Supabase CLI en dev/CI, no para el runtime del orquestador"; copiar a `.env.local` con valores reales

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Esquema de BD, roles restringidos, infraestructura compartida. DEBE completarse antes de cualquier user story.

**⚠️ CRÍTICO**: Ninguna user story puede comenzar hasta que esta fase esté completa.

- [x] T006 Crear migración `supabase/migrations/20260623000001_enable_pgvector.sql`: `CREATE EXTENSION IF NOT EXISTS vector;`
- [x] T007 [P] Crear migración `supabase/migrations/20260623000002_contacts.sql`: tabla `contacts` con columnas `id`, `phone` (UNIQUE), `status`, `channel_origin`, `opted_in_at`, `name`, `email`, `deleted_at`, `created_at`, `updated_at`; CHECK constraints; índices `contacts_phone_idx`, `contacts_status_idx` (ver data-model.md)
- [x] T008 [P] Crear migración `supabase/migrations/20260623000003_conversations.sql`: tabla `conversations` con FK a `contacts`; columnas `id`, `contact_id`, `channel`, `status`, `current_intent`, `started_at`, `last_turn_at`, `created_at`; índices `conversations_contact_idx`, `conversations_status_idx`
- [x] T009 Crear migración `supabase/migrations/20260623000004_messages.sql`: tabla `messages` con FKs a `conversations` y `contacts`; columnas `id`, `conversation_id`, `contact_id` (desnormalizado), `direction`, `content` (CHECK `char_length(content) BETWEEN 1 AND 4096`), `metadata` (jsonb), `created_at`; crear AMBOS índices del data-model.md: `messages_conversation_idx ON messages (conversation_id, created_at DESC)` ← requerido por SC-005 para ORDER BY eficiente y `messages_contact_idx ON messages (contact_id, created_at DESC)`
- [x] T010 Crear migración `supabase/migrations/20260623000005_message_embeddings.sql`: tabla `message_embeddings` con FKs a `messages` y `contacts`; columna `embedding vector(1536)`; columnas `status` (CHECK `'pending'|'indexed'`), `created_at`; índices `message_embeddings_contact_idx ON message_embeddings (contact_id) WHERE status = 'indexed'` y `message_embeddings_pending_idx ON message_embeddings (created_at) WHERE status = 'pending'`
- [x] T011 [P] Crear migración `supabase/migrations/20260623000006_audit_log.sql`: tabla `audit_log` con columnas `id`, `occurred_at`, `actor`, `action`, `entity_type`, `entity_id`, `payload` (jsonb); índices `audit_log_entity_idx`, `audit_log_occurred_idx`, `audit_log_action_idx`
- [x] T012 Crear migración `supabase/migrations/20260623000007_hnsw_index.sql`: `CREATE INDEX message_embeddings_hnsw_idx ON message_embeddings USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);`
- [x] T013 Crear migración `supabase/migrations/20260623000008_roles.sql`: crear DOS roles de conexión con `LOGIN PASSWORD` (ver data-model.md sección "Roles de base de datos y permisos"): `CREATE ROLE orchestrator_role LOGIN PASSWORD '<orchestrator_password>'` con GRANT INSERT, UPDATE, SELECT sobre tablas de negocio; REVOKE DELETE, TRUNCATE; REVOKE ALL sobre `audit_log`; `CREATE ROLE audit_writer LOGIN PASSWORD '<audit_writer_password>'` con GRANT INSERT, SELECT sobre `audit_log`; REVOKE DELETE, TRUNCATE, UPDATE sobre `audit_log`; configurar las mismas contraseñas en Supabase Dashboard → Project Settings → Database → Roles para que Supavisor las acepte como roles de conexión
- [x] T014 Crear migración `supabase/migrations/20260623000009_audit_write_function.sql`: función `write_audit_log(p_actor text, p_action text, p_entity_type text, p_entity_id uuid, p_payload jsonb DEFAULT NULL) RETURNS void` con `SECURITY DEFINER` y `SET search_path = public`; `ALTER FUNCTION write_audit_log OWNER TO audit_writer`; `GRANT EXECUTE ON FUNCTION write_audit_log TO orchestrator_role`; `REVOKE EXECUTE ON FUNCTION write_audit_log FROM PUBLIC`; el cuerpo hace INSERT en `audit_log` — el orquestador NUNCA tiene INSERT directo en `audit_log`, solo EXECUTE en esta función
- [x] T015 Crear migración `supabase/migrations/20260623000010_search_function.sql`: función SQL `search_contact_memory(p_contact_id uuid, p_query_embedding vector(1536), p_limit int DEFAULT 10) RETURNS TABLE(...)` con filtro `WHERE me.contact_id = p_contact_id` estructural (ver data-model.md); `GRANT EXECUTE ON FUNCTION search_contact_memory TO orchestrator_role`
- [x] T016 Aplicar todas las migraciones al entorno local (`supabase db push`) y verificar que las 5 tablas, los 2 roles, las 2 funciones y los índices existen correctamente
- [x] T017 [P] Generar tipos TypeScript desde el esquema local de Supabase: `supabase gen types typescript --local > src/lib/supabase/database.types.ts`; estos tipos son solo para autocompletado y verificación estática — no implican uso de supabase-js en runtime
- [x] T018 [P] Implementar cliente SQL del orquestador en `src/lib/db/orchestrator.ts`: instanciar `postgres` (postgres.js) con `DATABASE_URL` desde variables de entorno; configurar `max: 1` para compatibilidad con Vercel serverless; exportar `sql` como named export; este cliente corre como `orchestrator_role` — no es superusuario, los GRANTs y REVOKEs de T013 son efectivos en todas las queries
- [x] T019 [P] Implementar módulo de logging estructurado en `src/lib/observability/structured-log.ts`: función `log(level: 'info'|'warn'|'error', event: string, fields?: Record<string, unknown>)` que emite JSON con `{ level, event, timestamp, ...fields }` a `console.log`; función auxiliar `logDuration(event, fn)` que mide `duration_ms` y lo incluye en el log
- [x] T020 [P] Implementar cliente SQL de auditoría en `src/lib/db/audit.ts`: instanciar `postgres` (postgres.js) con `AUDIT_DATABASE_URL`; exportar `auditSql` como named export; este cliente corre como `audit_writer` — el único rol con INSERT en `audit_log`; luego implementar `src/lib/audit/logger.ts`: función `auditLog({ action, entity_type, entity_id, payload? })` que ejecuta `auditSql\`SELECT write_audit_log(${'orchestrator'}, ${action}, ${entity_type}, ${entity_id}, ${payload})\`` usando `auditSql`; lanzar si falla; la separación es efectiva a nivel de BD porque `audit_writer` tiene LOGIN propio y no es superusuario
- [x] T021 [P] Implementar wrapper de embeddings en `src/lib/embeddings/openai.ts`: función `generateEmbedding(text: string): Promise<number[]>` usando OpenAI SDK v4, modelo `text-embedding-3-small`, timeout 5 s; relanzar error para que el caller maneje el fallback
- [x] T022 [P] Implementar módulo de contadores en `src/lib/observability/counters.ts`: exportar función `counter.increment(name: CounterName)` donde `CounterName` es el union type `'contacts_created' | 'messages_registered' | 'semantic_searches_executed' | 'pending_embeddings'`; cada llamada emite una línea de log estructurado `{ event: 'metric.increment', name, value: 1, timestamp }` via `log()` de structured-log.ts; sin estado en memoria (serverless-safe — la agregación ocurre en la herramienta de logs); satisface FR-013 y SC-008
- [x] T023 Implementar middleware de autenticación del orquestador en `src/middleware.ts`: validar header `X-Orchestrator-Key` contra `ORCHESTRATOR_API_KEY` para todas las rutas `/api/*`; retornar `401 AUTH_INVALID_KEY` si falta o no coincide; usar `NextResponse`

**Checkpoint**: BD lista con esquema completo, dos roles separados, funciones SECURITY DEFINER aplicadas, cliente y utilidades compartidas funcionando.

---

## Phase 3: User Story 1 — Resolver identidad de un contacto nuevo (Priority: P1) 🎯 MVP

**Goal**: Dado un número de teléfono, el sistema crea o recupera un contacto único de forma atómica.

**Independent Test**: `POST /api/contacts` con número nuevo → `201 created: true`; llamada repetida → `200 created: false`; número inválido → `400 INVALID_PHONE`

### Implementation for User Story 1

- [x] T024 [P] [US1] Implementar `ContactService` en `src/lib/services/contact.service.ts`: importar `sql` de `src/lib/db/orchestrator.ts`; función `resolveContact({ phone, channel })` con validación E.164 (regex `/^\+[1-9]\d{7,14}$/`); upsert atómico con `` sql`INSERT INTO contacts … ON CONFLICT (phone) DO NOTHING RETURNING *` `` — si no retorna filas, `` sql`SELECT * FROM contacts WHERE phone = ${phone}` ``; llamar `counter.increment('contacts_created')` solo si `created === true`; log estructurado con evento `contact.resolved`; llamar `auditLog`; retornar `{ contact, created: boolean }`
- [x] T025 [US1] Implementar Route Handler `src/app/api/contacts/route.ts`: validar body con zod (`phone: string, channel: z.enum(['whatsapp','voice'])`); llamar `ContactService.resolveContact`; retornar `201` si `created: true`, `200` si `false`; manejar `INVALID_PHONE` → `400`, errores internos → `500`

**Checkpoint**: US1 completamente funcional — POST /api/contacts crea y recupera contactos sin duplicados.

---

## Phase 4: User Story 2 — Registrar mensajes de una conversación (Priority: P1)

**Goal**: Crear conversaciones y registrar cada turno (inbound/outbound) con su embedding.

**Independent Test**: Crear conversación → `201`; registrar dos mensajes → `201` con `embedding_status`; mensaje con conversación cerrada → `404 CONVERSATION_NOT_FOUND`; contenido vacío → `400 CONTENT_EMPTY`

### Implementation for User Story 2

- [x] T026 [P] [US2] Implementar `ConversationService` en `src/lib/services/conversation.service.ts`: función `createConversation({ contact_id, channel })` que valida que `contact_id` existe (404 si no); función `updateConversation(id, { status?, current_intent? })` que valida que la conversación existe; `updateLastTurn(id)` que actualiza `last_turn_at = now()` (llamado desde MessageService); log y auditLog por cada operación
- [x] T027 [P] [US2] Implementar `MessageService` en `src/lib/services/message.service.ts`: importar `sql` de `src/lib/db/orchestrator.ts`; función `registerMessage({ conversation_id, direction, content, metadata? })`; validar con zod; `` sql`SELECT * FROM conversations WHERE id = ${id}` `` y verificar estado `open`; `` sql`INSERT INTO messages ...` ``; llamar `ConversationService.updateLastTurn`; llamar `counter.increment('messages_registered')` **inmediatamente después del INSERT del mensaje** (independientemente del resultado del embedding); intentar `generateEmbedding(content)` con try/catch (timeout 5 s): si éxito → `` sql`INSERT INTO message_embeddings ... status 'indexed'` ``; si falla → INSERT con `status: 'pending'`, llamar `counter.increment('pending_embeddings')` adicionalmente; llamar `auditLog`; log estructurado con evento `message.registered`; retornar `{ message, embedding_status }`
- [x] T028 [US2] Implementar Route Handler `src/app/api/conversations/route.ts`: validar body con zod (`contact_id: z.string().uuid(), channel: z.enum([...])`); llamar `ConversationService.createConversation`; retornar `201`; manejar `CONTACT_NOT_FOUND` → `404`
- [x] T029 [US2] Implementar Route Handler `src/app/api/conversations/[id]/route.ts` (PATCH): validar body con zod (`status?: z.enum([...]).optional(), current_intent?: z.string().optional()`); llamar `ConversationService.updateConversation`; retornar `200`; manejar `CONVERSATION_NOT_FOUND` → `404`
- [x] T030 [US2] Implementar Route Handler `src/app/api/messages/route.ts`: validar body con zod (`conversation_id: z.string().uuid(), direction: z.enum(['inbound','outbound']), content: z.string().min(1).max(4096), metadata: z.object({}).passthrough().optional()`); llamar `MessageService.registerMessage`; retornar `201`; manejar `CONVERSATION_NOT_FOUND` → `404`, `CONTENT_EMPTY`/`CONTENT_TOO_LONG` → `400`

**Checkpoint**: US1 + US2 funcionales — conversaciones y mensajes registrados con embeddings.

---

## Phase 5: User Story 3 — Recuperar memoria reciente (Priority: P2)

**Goal**: Los últimos N mensajes de una conversación en orden cronológico, sin latencia adicional.

**Independent Test**: `GET /api/memory/recent?conversation_id=<id>&limit=5` con 10 mensajes registrados → devuelve exactamente 5 en orden cronológico ascendente, todos del contacto propietario (garantizado estructuralmente por la FK conversation→contact).

### Implementation for User Story 3

- [x] T031 [US3] Implementar función `getRecentMessages({ conversation_id, limit })` en `src/lib/services/memory.service.ts` (archivo nuevo): importar `sql` de `src/lib/db/orchestrator.ts`; ejecutar `` sql`SELECT id, direction, content, created_at FROM messages WHERE conversation_id = ${conversationId} ORDER BY created_at ASC LIMIT ${Math.min(limit, 50)}` ``; la propiedad del contacto está garantizada estructuralmente por la FK `conversations.contact_id`; log estructurado con evento `memory.recent.fetched` y campo `count`; retornar `{ messages, total }`
- [x] T032 [US3] Implementar Route Handler `src/app/api/memory/recent/route.ts` (GET): parsear y validar query params con zod (`conversation_id: z.string().uuid()`, `limit: z.coerce.number().int().min(1).max(50).default(10)`); llamar `MemoryService.getRecentMessages`; retornar `200`; manejar `CONVERSATION_NOT_FOUND` → `404`

**Checkpoint**: US1 + US2 + US3 funcionales — recuperación de memoria reciente operativa.

---

## Phase 6: User Story 4 — Búsqueda semántica de largo plazo (Priority: P2)

**Goal**: Búsqueda por similitud en historial del contacto, siempre aislada por `contact_id`.

**Independent Test**: `POST /api/memory/search` con `contact_id` de contacto A → resultados pertenecen solo al contacto A, aunque contacto B tenga mensajes semánticamente más cercanos.

### Implementation for User Story 4

- [x] T033 [US4] Implementar función `semanticSearch({ contact_id, query, limit })` en `src/lib/services/memory.service.ts` (extender el archivo creado en T031, no reemplazarlo): importar `sql` de `src/lib/db/orchestrator.ts`; lanzar `Error('contact_id is required')` si no se provee; llamar `generateEmbedding(query)`; ejecutar `` sql`SELECT * FROM search_contact_memory(${contactId}, ${embedding}::vector, ${limit})` `` — el filtro `WHERE contact_id = $1` es estructural en la función SQL de T015; llamar `counter.increment('semantic_searches_executed')`; log estructurado con evento `memory.search.executed` y campos `contact_id`, `results_count`, `duration_ms`; retornar `{ results, total }`
- [x] T034 [US4] Implementar Route Handler `src/app/api/memory/search/route.ts` (POST): validar body con zod (`contact_id: z.string().uuid(), query: z.string().min(1), limit: z.number().int().min(1).max(20).default(10)`); llamar `MemoryService.semanticSearch`; retornar `200`; manejar `CONTACT_NOT_FOUND` → `404`, errores del embedding → `500 INTERNAL_ERROR`
- [x] T035 [P] [US4] Implementar Route Handler `src/app/api/cron/retry-embeddings/route.ts`: GET handler que verifica header `Authorization: Bearer ${CRON_SECRET}` (Vercel lo inyecta automáticamente); consulta `message_embeddings WHERE status = 'pending' ORDER BY created_at LIMIT 50`; para cada embedding pendiente: recupera el `content` del mensaje asociado, llama `generateEmbedding`, actualiza `status = 'indexed'`; llama `counter.increment('pending_embeddings')` por cada fallo remanente; retornar `{ processed, failed }`; NO crear `vercel.json` aquí (lo maneja T037)

**Checkpoint**: Todas las US funcionales — sistema completo de identidad y memoria operativo.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Validación end-to-end, configuración de despliegue y semilla de datos.

- [x] T036 [P] Crear semilla de desarrollo `supabase/seed/dev.sql`: 3 contactos de prueba con distintos estados (`prospecto`, `cliente`, `inactivo`), 2 conversaciones, 6 mensajes (3 inbound + 3 outbound); no incluir embeddings reales (se generan en runtime)
- [x] T037 [P] Crear `vercel.json` completo en la raíz con configuración de regiones Y entrada de cron: `{ "regions": ["gru1"], "crons": [{ "path": "/api/cron/retry-embeddings", "schedule": "*/5 * * * *" }] }`; este es el único task que escribe `vercel.json`; agregar `CRON_SECRET` a `.env.local.example`
- [x] T038 Ejecutar los 5 escenarios de validación de `quickstart.md` contra el servidor local y verificar todos los criterios de aceptación de la spec (SC-001 a SC-008); incluir verificación explícita de SC-007 con contacto sembrado con ≥ 200 mensajes indexados para validar latencia semántica < 2 s p95
- [x] T039 [P] Verificar que ningún método HTTP DELETE devuelve `2xx` en ningún endpoint; intentar `DELETE FROM contacts` con credencial `orchestrator_role` en Supabase Studio y confirmar que falla con error de permisos; documentar resultado en `quickstart.md` bajo "Escenario 5"

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Sin dependencias — puede comenzar de inmediato
- **Foundational (Phase 2)**: Depende del Setup completo — BLOQUEA todas las user stories
- **US1 (Phase 3)**: Depende de Foundation; no depende de US2, US3, US4
- **US2 (Phase 4)**: Depende de Foundation; no depende de US3, US4; integra con US1 (usa contactos existentes)
- **US3 (Phase 5)**: Depende de Foundation + US2 (necesita mensajes registrados para testear)
- **US4 (Phase 6)**: Depende de Foundation + US2 (necesita embeddings); US3 independiente
- **Polish (Phase 7)**: Depende de todas las US completadas

### User Story Dependencies

- **US1 (P1)**: Puede iniciar apenas Foundation esté completo. Sin dependencias de otras US.
- **US2 (P1)**: Puede iniciar junto a US1 después de Foundation. Usa contactos de US1 pero no depende de su implementación (solo de la BD).
- **US3 (P2)**: Puede iniciar después de Foundation. Requiere US2 completo para validación end-to-end.
- **US4 (P2)**: Puede iniciar después de Foundation. Requiere US2 completo (embeddings). T033–T034 pueden desarrollarse en paralelo con US3.

### Within Each Phase

- Migrations T006–T015: T006 primero (pgvector), T007 y T008 en paralelo, T009 después (depende de contacts + conversations), T010 después (depende de messages), T011 en paralelo con T009-T010, T012 después de T010 (depende de message_embeddings), T013 después de T012, T014 después de T013 (función requiere que el rol exista), T015 independiente de T014 (puede ir en paralelo)
- Infraestructura compartida T017–T022: en paralelo entre sí, después de T016
- T023 (middleware): después de T017–T022
- Servicios de una misma US marcados [P]: pueden desarrollarse en paralelo
- Route Handler SIEMPRE después del servicio correspondiente
- T033 (semanticSearch) EXTIENDE el archivo de T031; T033 debe iniciarse después de T031

### Parallel Opportunities

- T002, T003, T004, T005 — en paralelo entre sí (Setup)
- T007, T008 — en paralelo (después de T006)
- T011 — en paralelo con T009, T010
- T014, T015 — T014 después de T013; T015 puede ir en paralelo con T014
- T017, T018, T019, T020, T021, T022 — en paralelo entre sí (después de T016)
- T024 — en paralelo preparando el handler mientras T025 no depende de él
- T026, T027 — en paralelo entre sí (US2)
- T033, T035 — en paralelo; T034 después de T033

---

## Parallel Example: Foundation (Phase 2)

```bash
# Grupo A: migraciones (orden por dependencias FK)
Task T006: enable pgvector
Task T007 + T008: contacts + conversations (paralelo)
Task T009: messages (después de T007 + T008)
Task T010: message_embeddings (después de T009)
Task T011: audit_log (paralelo con T009 + T010)
Task T012: HNSW index (después de T010)
Task T013: orchestrator_role + audit_writer (después de T012)
Task T014: write_audit_log SECURITY DEFINER (después de T013 — requiere audit_writer)
Task T015: search_contact_memory (paralelo con T014)
Task T016: supabase db push

# Grupo B: infraestructura compartida (paralelo entre sí, después de T016)
Task T017: generate types
Task T018: supabase client
Task T019: structured logging
Task T020: audit logger (usa write_audit_log via rpc)
Task T021: embeddings wrapper
Task T022: counters module
# Secuencial al final:
Task T023: middleware (después de T017–T022)
```

---

## Implementation Strategy

### MVP First (US1 Solamente)

1. Completar Phase 1: Setup
2. Completar Phase 2: Foundation (CRÍTICO — bloquea todo)
3. Completar Phase 3: US1 — resolver contacto
4. **PARAR Y VALIDAR**: `POST /api/contacts` crea y recupera sin duplicados
5. Agregar US2 si MVP es satisfactorio

### Incremental Delivery

1. Setup + Foundation → BD y middleware listos
2. + US1 → resolución de identidad operativa (MVP mínimo)
3. + US2 → registro de mensajes + embeddings
4. + US3 → memoria reciente disponible para el orquestador
5. + US4 → búsqueda semántica de largo plazo completa

### Parallel Team Strategy

Con dos desarrolladores después de Foundation:

- Dev A: US1 → US3
- Dev B: US2 → US4

---

## Notes

- `[P]` = archivos diferentes, sin dependencias incompletas
- `[Story]` mapea la tarea a una user story específica para trazabilidad
- Cada US es independientemente testeable con los endpoints definidos en `contracts/api.md`
- Confirmar que `src/middleware.ts` (T023) está activo ANTES de probar cualquier Route Handler
- T033 EXTIENDE `memory.service.ts` creado en T031; verificar que no sobreescribe el archivo
- El cron de T035 requiere `CRON_SECRET` en Vercel (auto-inyectado por la plataforma en producción; definir manualmente en `.env.local` para desarrollo)
- `vercel.json` se crea una sola vez en T037 con regiones y cron juntos
- No hacer DELETE en ningún paso; si alguna migración falla, usar `supabase db reset` y reaplicar
- `SUPABASE_SERVICE_ROLE_KEY` NO es una variable de entorno del runtime del orquestador; queda fuera de `.env.local.example` para el runtime (solo en la config del CLI)
- Todos los servicios importan `sql` de `src/lib/db/orchestrator.ts`; el audit logger importa `auditSql` de `src/lib/db/audit.ts`; ninguno usa supabase-js en runtime
- La separación `orchestrator_role` / `audit_writer` es verificable: intentar `INSERT INTO audit_log …` directamente con `DATABASE_URL` debe fallar con error de permisos
