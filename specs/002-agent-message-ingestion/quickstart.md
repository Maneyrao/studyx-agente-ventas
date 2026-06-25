# Quickstart — Validación: Agent Message Ingestion Endpoint

Guía de validación end-to-end de los endpoints `/api/agent/ingest` y `/api/agent/reply`.
Para el detalle de campos y errores ver [contracts/api.md](./contracts/api.md); para el
esquema ver [data-model.md](./data-model.md).

## Prerrequisitos

- Feature 001 desplegada (tablas `contacts`, `conversations`, `messages`,
  `message_embeddings`, `audit_log`; roles `orchestrator_role` y `audit_writer`).
- Migración de esta feature aplicada:
  `supabase/migrations/20260625XXXXXX_contact_summary_and_turn_link.sql`.
- Variables de entorno: `DATABASE_URL` (como `orchestrator_role`), `AUDIT_DATABASE_URL`
  (como `audit_writer`), `OPENAI_API_KEY`, `ORCHESTRATOR_API_KEY`, y opcionales
  `SUMMARY_THRESHOLD` (default 10), `SUMMARY_MODEL`, `RECENT_TURNS_LIMIT` (default 10).

## Setup

```bash
# Aplicar migraciones
supabase db push

# Levantar el orquestador
npm run dev
```

```bash
export KEY="<ORCHESTRATOR_API_KEY>"
export BASE="http://localhost:3000"
```

---

## Escenario 1 — Ingesta de mensaje trivial (US1 + SC-001)

```bash
curl -s -X POST "$BASE/api/agent/ingest" \
  -H "X-Orchestrator-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"phone":"+5491112345678","content":"hola"}'
```

**Esperado**: HTTP 200; `long_term_memory: null`; `recent_turns` presente; `turn_id`
devuelto; `contact.blocked: false`. Verificar en logs que **no** se ejecutó búsqueda
semántica (contador `semantic_searches_executed` sin incrementar).

**Caso borde (FR-006/SC-001)** — mensaje trivial que contiene un marcador de referencia:

```bash
curl -s -X POST "$BASE/api/agent/ingest" \
  -H "X-Orchestrator-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"phone":"+5491112345678","content":"ok mi cuenta"}'
```

**Esperado**: la trivialidad tiene precedencia → `long_term_memory: null` y **cero**
búsquedas, aunque el texto contenga el marcador `mi cuenta`.

**Contacto bloqueado (opt-out)**: para un contacto con `status = inactivo`, verificar que
el contexto devuelve `contact.blocked: true`.

---

## Escenario 2 — Registro de respuesta + correlación de turno (US2)

```bash
# Tomar turn_id del escenario 1
curl -s -X POST "$BASE/api/agent/reply" \
  -H "X-Orchestrator-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"turn_id":"<TURN_ID>","content":"¡Hola! ¿En qué te puedo ayudar?"}'
```

**Esperado**: HTTP 201; `message.direction: "outbound"`; `message.in_reply_to == turn_id`;
`pending_turns: 1`; `summary_regenerated: false`.

Reintentar el mismo `reply` con el mismo `turn_id` ⇒ HTTP 409 `TURN_ALREADY_ANSWERED`.
Usar un `turn_id` inexistente ⇒ HTTP 404 `TURN_NOT_FOUND`.

---

## Escenario 3 — Ingesta referencial dispara memoria de largo plazo (US3 + SC-005)

```bash
curl -s -X POST "$BASE/api/agent/ingest" \
  -H "X-Orchestrator-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"phone":"+5491112345678","content":"quería retomar lo que hablamos del curso de Python"}'
```

**Esperado**: HTTP 200; `long_term_memory` es un arreglo (no null);
`long_term_memory_available: true`; todos los fragmentos pertenecen al `contact_id` del
número consultado (aislamiento de memoria, Principio VI).

**Aislamiento (SC-005)**: insertar mensajes de otro contacto semánticamente cercanos y
repetir; verificar que **ningún** fragmento de otro contacto aparece en el resultado.

---

## Escenario 4 — Resumen por umbral (US4 + SC-004)

1. Procesar turnos completos (ingest+reply) **sustantivos** hasta `pending_turns` previo a
   `SUMMARY_THRESHOLD`; verificar `summary_regenerated: false` y `summary` sin cambios.
2. Completar el turno que cruza el umbral con contenido **no trivial**; verificar
   `summary_regenerated: true`, `pending_turns: 0`, y `contact.summary` actualizado en la
   siguiente ingesta.
3. **Borde trivial**: hacer que el cruce ocurra en un turno **trivial** (`content:"ok"`);
   verificar `summary_regenerated: false` y que `pending_turns` NO se reinicia (disparo
   diferido). El siguiente turno sustantivo debe regenerar.

---

## Escenario 5 — Degradación de memoria (US3-4 + SC-007)

Simular fallo de OpenAI (clave inválida temporal) y enviar una ingesta referencial.

**Esperado**: HTTP 200 igual; `long_term_memory_available: false`; `recent_turns` y
`summary` previos presentes; el turno no se bloquea.

---

## Escenario 6 — Auditoría completa (SC-002) y sin credenciales (SC-003)

```sql
-- Como audit_writer / consulta de verificación
SELECT action, entity_type, count(*) FROM audit_log
WHERE created_at > now() - interval '10 minutes'
GROUP BY 1,2 ORDER BY 1;
```

**Esperado**: aparecen `message.registered` para inbound y outbound, `contact.*`,
`conversation.created` y `contact.summary_regenerated` cuando corresponda.

Inspeccionar cualquier respuesta de `/api/agent/*`: **no** debe contener cadenas de
conexión, contraseñas de rol ni `DATABASE_URL` (SC-003).

---

## Escenario 7 — Validación e input inválido (FR-014)

```bash
# Teléfono inválido
curl -s -X POST "$BASE/api/agent/ingest" -H "X-Orchestrator-Key: $KEY" \
  -H "Content-Type: application/json" -d '{"phone":"123","content":"hola"}'   # ⇒ 400 INVALID_PHONE

# Contenido vacío
curl -s -X POST "$BASE/api/agent/ingest" -H "X-Orchestrator-Key: $KEY" \
  -H "Content-Type: application/json" -d '{"phone":"+5491112345678","content":""}'  # ⇒ 400 VALIDATION_ERROR

# Sin auth
curl -s -X POST "$BASE/api/agent/ingest" -H "Content-Type: application/json" \
  -d '{"phone":"+5491112345678","content":"hola"}'   # ⇒ 401 UNAUTHORIZED
```

---

## Checklist de criterios de aceptación

- [ ] SC-001 — mensaje trivial: 0 búsquedas vectoriales, 0 regeneraciones.
- [ ] SC-002 — inbound y outbound auditados.
- [ ] SC-003 — sin credenciales de BD en respuestas.
- [ ] SC-004 — resumen 1 vez por cruce de umbral.
- [ ] SC-005 — memoria filtrada por `contact_id`.
- [ ] SC-006 — ruta trivial evita búsqueda y resumen.
- [ ] SC-007 — degradación sin bloquear el turno.
