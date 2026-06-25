# API Contracts: Agent Message Ingestion Endpoint

Route Handlers de Next.js bajo `src/app/api/agent/`, accesibles únicamente por el agente
de texto (cliente del orquestador). Requieren el header de autenticación interno en cada
request (middleware `X-Orchestrator-Key`, reutilizado de la 001).

---

## Autenticación (todos los endpoints)

```
Header: X-Orchestrator-Key: <valor de ORCHESTRATOR_API_KEY en env>
```

Si falta o es inválido (resuelto por `src/middleware.ts` antes del handler):

```json
HTTP 401
{ "error": "UNAUTHORIZED" }
```

---

## Formato de error estándar

```json
{ "error": "<SNAKE_CASE_CODE>", "details": { } }
```

| Código | HTTP | Descripción |
|--------|------|-------------|
| `UNAUTHORIZED` | 401 | API key ausente o inválida |
| `INVALID_JSON` | 400 | Body no es JSON válido |
| `VALIDATION_ERROR` | 400 | Body inválido o campos faltantes (incluye `details` de Zod) |
| `INVALID_PHONE` | 400 | Número de teléfono no es E.164 válido |
| `TURN_NOT_FOUND` | 404 | `turn_id` no existe, no es inbound, o no pertenece a una conversación abierta |
| `TURN_ALREADY_ANSWERED` | 409 | El turno ya tiene una respuesta saliente registrada |
| `INTERNAL_ERROR` | 500 | Error interno no recuperable |

---

## POST /api/agent/ingest

Procesa un mensaje entrante del prospecto: identifica/crea el contacto, asegura una
conversación abierta, registra el mensaje `inbound` y devuelve el contexto consolidado.
Dispara búsqueda de memoria de largo plazo **solo** si el contenido alude al pasado
(heurística determinista).

### Request

```json
{
  "phone": "+5491112345678",
  "content": "Hola, quería retomar lo que hablamos sobre el curso de Python",
  "channel": "whatsapp"
}
```

- `phone` (string, requerido): E.164.
- `content` (string, requerido): 1..4096 caracteres.
- `channel` (enum `whatsapp|voice`, opcional, default `whatsapp`).

### Response 200

```json
{
  "turn_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "contact": {
    "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "status": "prospecto",
    "name": null,
    "blocked": false,
    "summary": "Interesado en el curso de Python; preguntó por precio y modalidad.",
    "summary_updated_at": "2026-06-24T18:30:00Z"
  },
  "recent_turns": [
    { "direction": "inbound",  "content": "¿Cuánto sale el curso de Python?", "created_at": "2026-06-24T18:00:00Z" },
    { "direction": "outbound", "content": "Sale $X e incluye …",             "created_at": "2026-06-24T18:00:05Z" }
  ],
  "long_term_memory": [
    { "content": "Me interesa el curso de Python pero en horario nocturno", "similarity": 0.83, "created_at": "2026-06-20T12:00:00Z" }
  ],
  "long_term_memory_available": true
}
```

- `contact.blocked`: `true` cuando el contacto está `inactivo`/bloqueado (opt-out); señala al agente que NO continúe la conversación comercial.
- `long_term_memory`: arreglo con fragmentos del **mismo contacto** (filtrado por `contact_id`) cuando el mensaje **no es trivial** y la heurística detectó referencia al pasado; `null` cuando el mensaje es trivial o no referencial. La trivialidad tiene precedencia: un mensaje trivial nunca dispara búsqueda aunque contenga un marcador.
- `long_term_memory_available`: `false` si la búsqueda se intentó pero falló (degradación; el resto del contexto se devuelve igual).
- El cuerpo **nunca** contiene credenciales de BD ni secretos de infraestructura (FR-010, SC-003).

### Errores
`INVALID_JSON` (400), `VALIDATION_ERROR` (400), `INVALID_PHONE` (400), `INTERNAL_ERROR` (500).

### Notas de comportamiento
- Mensaje trivial (`hola`, `ok`, `gracias`) → `long_term_memory: null`, **cero** búsqueda vectorial (SC-001).
- El mensaje inbound queda registrado y auditado antes de construir el contexto (FR-003, FR-012).

---

## POST /api/agent/reply

Registra la respuesta saliente generada por el agente, correlacionada al turno entrante.
Incrementa el contador de turnos y, si corresponde, regenera el resumen.

### Request

```json
{
  "turn_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "content": "Claro, el curso de Python en horario nocturno arranca el …"
}
```

- `turn_id` (uuid, requerido): el `id` devuelto por `/api/agent/ingest`.
- `content` (string, requerido): 1..4096 caracteres.

### Response 201

```json
{
  "message": {
    "id": "b3d2…",
    "conversation_id": "a1c4…",
    "contact_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "direction": "outbound",
    "in_reply_to": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "created_at": "2026-06-24T18:30:10Z"
  },
  "summary_regenerated": false,
  "pending_turns": 4
}
```

- `summary_regenerated`: `true` solo si este turno cruzó el umbral, fue **no trivial**, y la regeneración tuvo éxito.
- `pending_turns`: contador resultante (0 si se regeneró con éxito).

### Errores
`INVALID_JSON` (400), `VALIDATION_ERROR` (400), `TURN_NOT_FOUND` (404),
`TURN_ALREADY_ANSWERED` (409), `INTERNAL_ERROR` (500).

### Notas de comportamiento
- Si el umbral se cruza en un turno **trivial**, `summary_regenerated: false` y el disparo se difiere (FR-006/FR-009).
- Si la regeneración falla, `summary_regenerated: false`, se conserva `pending_turns` y el resumen previo; el endpoint responde 201 igual (degradación, FR-015).
- El outbound queda auditado (FR-012).
