# API Contracts: Contact Identity Foundation

Todos los endpoints son Route Handlers de Next.js (`src/app/api/`), accesibles
únicamente por el orquestador. Requieren el header de autenticación interno en
cada request.

---

## Autenticación (todos los endpoints)

```
Header: X-Orchestrator-Key: <valor de ORCHESTRATOR_API_KEY en env>
```

Si falta o es inválido:

```json
HTTP 401
{ "error": "Unauthorized", "code": "AUTH_INVALID_KEY" }
```

---

## Formato de error estándar

```json
{
  "error": "<mensaje legible>",
  "code":  "<SNAKE_CASE_CODE>"
}
```

Códigos comunes:

| Código | HTTP | Descripción |
|--------|------|-------------|
| `AUTH_INVALID_KEY` | 401 | API key ausente o inválida |
| `VALIDATION_ERROR` | 400 | Body inválido o campos faltantes |
| `INVALID_PHONE` | 400 | Número de teléfono no es E.164 válido |
| `CONVERSATION_NOT_FOUND` | 404 | conversation_id no existe o no pertenece al contacto |
| `CONTENT_EMPTY` | 400 | Mensaje con contenido vacío |
| `CONTENT_TOO_LONG` | 400 | Mensaje supera 4 096 caracteres |
| `CONTACT_NOT_FOUND` | 404 | contact_id no existe |
| `INTERNAL_ERROR` | 500 | Error interno no recuperable |

---

## POST /api/contacts

Resuelve o crea un contacto a partir de un número de teléfono.
Operación idempotente: si el número ya existe, devuelve el contacto existente.

### Request

```json
{
  "phone":   "+5491112345678",
  "channel": "whatsapp"
}
```

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `phone` | string | ✅ | Número E.164 (empieza con `+`, solo dígitos) |
| `channel` | `"whatsapp"` \| `"voice"` | ✅ | Canal de origen de la sesión |

### Response 200 OK (contacto recuperado)

```json
{
  "contact": {
    "id":             "uuid",
    "phone":          "+5491112345678",
    "status":         "prospecto",
    "channel_origin": "whatsapp",
    "opted_in_at":    "2026-06-23T10:00:00Z",
    "name":           null,
    "email":          null,
    "created_at":     "2026-06-23T10:00:00Z"
  },
  "created": false
}
```

### Response 201 Created (contacto nuevo)

Mismo body con `"created": true`.

### Errores posibles

- `400 INVALID_PHONE` — formato no E.164
- `400 VALIDATION_ERROR` — campos faltantes o `channel` inválido

---

## POST /api/conversations

Crea una nueva conversación para un contacto existente.

### Request

```json
{
  "contact_id": "uuid",
  "channel":    "whatsapp"
}
```

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `contact_id` | uuid | ✅ | ID del contacto existente |
| `channel` | `"whatsapp"` \| `"voice"` | ✅ | Canal de la sesión |

### Response 201 Created

```json
{
  "conversation": {
    "id":             "uuid",
    "contact_id":     "uuid",
    "channel":        "whatsapp",
    "status":         "open",
    "current_intent": null,
    "started_at":     "2026-06-23T10:01:00Z",
    "last_turn_at":   "2026-06-23T10:01:00Z"
  }
}
```

### Errores posibles

- `404 CONTACT_NOT_FOUND` — `contact_id` no existe

---

## PATCH /api/conversations/:id

Actualiza el estado o la intención de una conversación activa.

### Request

```json
{
  "status":          "closed",
  "current_intent":  "compra_completada"
}
```

Todos los campos son opcionales; se actualiza solo lo que se envía.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `status` | `"open"` \| `"closed"` | Nuevo estado |
| `current_intent` | string | Intención detectada (texto libre) |

### Response 200 OK

```json
{
  "conversation": { /* objeto Conversation actualizado */ }
}
```

### Errores posibles

- `404 CONVERSATION_NOT_FOUND`

---

## POST /api/messages

Registra un mensaje (inbound o outbound) en una conversación activa.

### Request

```json
{
  "conversation_id": "uuid",
  "direction":       "inbound",
  "content":         "Hola, me interesa el curso de Python",
  "metadata":        { "whatsapp_message_id": "wamid.xxx" }
}
```

| Campo | Tipo | Requerido | Descripción |
|-------|------|-----------|-------------|
| `conversation_id` | uuid | ✅ | Conversación activa |
| `direction` | `"inbound"` \| `"outbound"` | ✅ | Origen del turno |
| `content` | string | ✅ | Texto del mensaje (1–4 096 chars) |
| `metadata` | object | ❌ | Datos opcionales del canal |

### Response 201 Created

```json
{
  "message": {
    "id":              "uuid",
    "conversation_id": "uuid",
    "contact_id":      "uuid",
    "direction":       "inbound",
    "content":         "Hola, me interesa el curso de Python",
    "metadata":        { "whatsapp_message_id": "wamid.xxx" },
    "created_at":      "2026-06-23T10:02:00Z"
  },
  "embedding_status": "indexed"
}
```

`embedding_status` puede ser `"indexed"` (embedding generado en el mismo request) o
`"pending"` (la generación falló; se reintentará vía cron).

### Errores posibles

- `404 CONVERSATION_NOT_FOUND` — `conversation_id` no existe o está cerrada
- `400 CONTENT_EMPTY` — `content` es vacío
- `400 CONTENT_TOO_LONG` — `content` supera 4 096 caracteres

---

## GET /api/memory/recent

Recupera los últimos N mensajes de una conversación en orden cronológico.

### Query parameters

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `conversation_id` | uuid | ✅ | — | Conversación |
| `limit` | integer | ❌ | `10` | Máximo de mensajes (1–50) |

Ejemplo: `GET /api/memory/recent?conversation_id=uuid&limit=5`

### Response 200 OK

```json
{
  "messages": [
    {
      "id":        "uuid",
      "direction": "inbound",
      "content":   "Hola, me interesa el curso",
      "created_at":"2026-06-23T10:02:00Z"
    },
    {
      "id":        "uuid",
      "direction": "outbound",
      "content":   "Claro, ¿cuál curso te interesa?",
      "created_at":"2026-06-23T10:02:05Z"
    }
  ],
  "total": 2
}
```

### Errores posibles

- `404 CONVERSATION_NOT_FOUND`

---

## POST /api/memory/search

Búsqueda semántica en la memoria de largo plazo de un contacto.
El `contact_id` es obligatorio; la búsqueda nunca cruza datos entre contactos.

### Request

```json
{
  "contact_id": "uuid",
  "query":      "cursos de programación que mencionó",
  "limit":      5
}
```

| Campo | Tipo | Requerido | Default | Descripción |
|-------|------|-----------|---------|-------------|
| `contact_id` | uuid | ✅ | — | Propietario de la memoria (aislamiento obligatorio) |
| `query` | string | ✅ | — | Texto de búsqueda en lenguaje natural |
| `limit` | integer | ❌ | `10` | Resultados máximos (1–20) |

### Response 200 OK

```json
{
  "results": [
    {
      "message_id": "uuid",
      "content":    "Sí, me interesa el curso de Python para datos",
      "similarity": 0.91,
      "created_at": "2026-06-20T09:15:00Z"
    }
  ],
  "total": 1
}
```

Si no hay embeddings indexados para el contacto: `"results": [], "total": 0`.

### Errores posibles

- `400 VALIDATION_ERROR` — `contact_id` o `query` faltantes
- `404 CONTACT_NOT_FOUND` — `contact_id` no existe

---

## Notas de diseño

- Ningún endpoint expone DELETE ni TRUNCATE.
- Toda operación de escritura genera una entrada en `audit_log` antes de retornar.
- La autenticación con `X-Orchestrator-Key` es manejada por `src/middleware.ts` antes
  de que el Route Handler procese el request.
- Los endpoints de memoria (`/api/memory/*`) son exclusivos para el orquestador;
  ningún agente conversacional los invoca directamente.
