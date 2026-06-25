# Quickstart: Contact Identity Foundation

Guía de validación end-to-end para verificar que el servicio funciona correctamente
una vez implementado.

## Prerequisitos

- Node.js 20+ instalado
- Proyecto Next.js inicializado en la raíz del repositorio
- Proyecto Supabase creado con extensión `vector` habilitada
- Variables de entorno configuradas (ver `.env.local.example`)
- Migraciones aplicadas (`supabase db push` o CLI equivalente)

## Variables de entorno requeridas

```env
# Supabase
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>

# OpenAI
OPENAI_API_KEY=sk-...

# Autenticación interna del orquestador
ORCHESTRATOR_API_KEY=<string_secreto_min_32_chars>
```

## Iniciar el servidor de desarrollo

```bash
npm run dev
# Servidor disponible en http://localhost:3000
```

---

## Escenario 1: Resolver identidad de un contacto nuevo

Verifica FR-001, FR-003 y SC-001.

```bash
# Crear contacto nuevo
curl -s -X POST http://localhost:3000/api/contacts \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: $ORCHESTRATOR_API_KEY" \
  -d '{"phone": "+5491112345678", "channel": "whatsapp"}' | jq .
```

**Resultado esperado**:

```json
{
  "contact": {
    "id": "<uuid>",
    "phone": "+5491112345678",
    "status": "prospecto",
    "channel_origin": "whatsapp",
    "opted_in_at": "<timestamp>"
  },
  "created": true
}
```

```bash
# Llamar de nuevo con el mismo número → debe devolver el existente sin duplicar
curl -s -X POST http://localhost:3000/api/contacts \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: $ORCHESTRATOR_API_KEY" \
  -d '{"phone": "+5491112345678", "channel": "whatsapp"}' | jq .created
# Resultado esperado: false
```

```bash
# Número inválido → debe rechazar
curl -s -X POST http://localhost:3000/api/contacts \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: $ORCHESTRATOR_API_KEY" \
  -d '{"phone": "123", "channel": "whatsapp"}' | jq .code
# Resultado esperado: "INVALID_PHONE"
```

---

## Escenario 2: Registrar mensajes de una conversación

Verifica FR-004, FR-005, FR-006, SC-002.

```bash
# Usar el contact_id del escenario 1
CONTACT_ID="<uuid del contacto>"

# Crear conversación
CONV=$(curl -s -X POST http://localhost:3000/api/conversations \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: $ORCHESTRATOR_API_KEY" \
  -d "{\"contact_id\": \"$CONTACT_ID\", \"channel\": \"whatsapp\"}")
CONV_ID=$(echo $CONV | jq -r '.conversation.id')

# Registrar mensaje entrante
curl -s -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: $ORCHESTRATOR_API_KEY" \
  -d "{
    \"conversation_id\": \"$CONV_ID\",
    \"direction\": \"inbound\",
    \"content\": \"Hola, me interesa el curso de Python para datos\"
  }" | jq .

# Registrar respuesta saliente
curl -s -X POST http://localhost:3000/api/messages \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: $ORCHESTRATOR_API_KEY" \
  -d "{
    \"conversation_id\": \"$CONV_ID\",
    \"direction\": \"outbound\",
    \"content\": \"Claro, te cuento sobre nuestro curso de Python para análisis de datos.\"
  }" | jq .
```

**Resultado esperado**: ambas respuestas con HTTP 201 y `embedding_status` presente.

```bash
# Verificar en Supabase: ambos mensajes aparecen en audit_log
# (via Supabase Studio o SQL: SELECT * FROM audit_log WHERE entity_type = 'message' ORDER BY occurred_at DESC LIMIT 5)
```

---

## Escenario 3: Recuperar memoria reciente

Verifica FR-007, SC-005.

```bash
curl -s "http://localhost:3000/api/memory/recent?conversation_id=$CONV_ID&limit=5" \
  -H "X-Orchestrator-Key: $ORCHESTRATOR_API_KEY" | jq '.messages | length'
# Resultado esperado: 2 (los dos mensajes del escenario anterior)
```

---

## Escenario 4: Búsqueda semántica aislada por contacto

Verifica FR-009, SC-003, SC-007.

Prerequisito: los mensajes del Escenario 2 deben tener `embedding_status: "indexed"`.
Si están en `"pending"`, esperar el cron o forzar indexación manualmente.

```bash
# Búsqueda semántica sobre el contacto correcto
curl -s -X POST http://localhost:3000/api/memory/search \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: $ORCHESTRATOR_API_KEY" \
  -d "{
    \"contact_id\": \"$CONTACT_ID\",
    \"query\": \"cursos de programación\",
    \"limit\": 5
  }" | jq .

# Resultado esperado: results contiene el mensaje sobre Python, similarity > 0.7
```

```bash
# Crear un segundo contacto con mensajes similares
CONTACT2=$(curl -s -X POST http://localhost:3000/api/contacts \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: $ORCHESTRATOR_API_KEY" \
  -d '{"phone": "+5491199998888", "channel": "whatsapp"}')
CONTACT2_ID=$(echo $CONTACT2 | jq -r '.contact.id')

# ... registrar conversación y mensajes para CONTACT2 ...

# Buscar en memoria de CONTACT2 → NO debe devolver mensajes de CONTACT_ID
curl -s -X POST http://localhost:3000/api/memory/search \
  -H "Content-Type: application/json" \
  -H "X-Orchestrator-Key: $ORCHESTRATOR_API_KEY" \
  -d "{
    \"contact_id\": \"$CONTACT2_ID\",
    \"query\": \"cursos de programación\",
    \"limit\": 10
  }" | jq '[.results[] | select(.message_id != null)] | length'
# Resultado esperado: 0 (sin mensajes del contacto 1)
```

---

## Escenario 5: Verificar que no existen operaciones de borrado

Verifica SC-006 y Principio IV de la constitución.

```bash
# Ninguno de estos debe existir como endpoint
curl -s -X DELETE http://localhost:3000/api/contacts/$CONTACT_ID \
  -H "X-Orchestrator-Key: $ORCHESTRATOR_API_KEY"
# Resultado esperado: 404 o 405 (Method Not Allowed)
```

Verificación adicional en Supabase: intentar ejecutar `DELETE FROM contacts WHERE id = '<uuid>'`
con el rol `orchestrator_role` → debe fallar con error de permisos.

---

## Verificación de observabilidad

Con el servidor corriendo, ejecutar los escenarios anteriores y revisar los logs:

```bash
# En desarrollo, los logs aparecen en la terminal donde corre `npm run dev`
# Cada operación debe emitir una línea JSON con campos: level, event, contact_id, duration_ms
```

Eventos esperados en los logs:
- `contact.resolved` (created: true/false)
- `conversation.created`
- `message.registered` (embedding_status: indexed/pending)
- `memory.recent.fetched`
- `memory.search.executed` (results_count, duration_ms)

---

## Referencias

- Contratos completos: [`contracts/api.md`](contracts/api.md)
- Modelo de datos: [`data-model.md`](data-model.md)
- Decisiones técnicas: [`research.md`](research.md)
