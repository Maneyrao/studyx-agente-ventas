# Data Model: Contact Identity Foundation

## Extensión requerida

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

---

## Tabla: contacts

Identidad unificada de una persona. Un registro por número de teléfono E.164.

```sql
CREATE TABLE contacts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone        text        NOT NULL,
  status       text        NOT NULL DEFAULT 'prospecto'
                           CHECK (status IN ('prospecto', 'cliente', 'inactivo')),
  channel_origin text      NOT NULL
                           CHECK (channel_origin IN ('whatsapp', 'voice')),
  opted_in_at  timestamptz NOT NULL DEFAULT now(),
  name         text,
  email        text,
  deleted_at   timestamptz,                        -- soft-delete
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT contacts_phone_unique UNIQUE (phone)
);

CREATE INDEX contacts_phone_idx ON contacts (phone);
CREATE INDEX contacts_status_idx ON contacts (status) WHERE deleted_at IS NULL;
```

**Invariantes**:
- `phone` sigue formato E.164 (validado en capa de servicio antes de llegar a BD).
- `UNIQUE (phone)` garantiza unicidad estructural; el upsert atómico depende de esta
  constraint.
- `deleted_at IS NOT NULL` equivale a contacto desactivado (soft-delete); ninguna
  operación de borrado físico existe.
- `opted_in_at` se establece en la primera creación y nunca se modifica.

---

## Tabla: conversations

Sesión de interacción de un contacto con el sistema.

```sql
CREATE TABLE conversations (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid        NOT NULL REFERENCES contacts(id),
  channel         text        NOT NULL
                              CHECK (channel IN ('whatsapp', 'voice')),
  status          text        NOT NULL DEFAULT 'open'
                              CHECK (status IN ('open', 'closed')),
  current_intent  text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  last_turn_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversations_contact_idx ON conversations (contact_id);
CREATE INDEX conversations_status_idx  ON conversations (status) WHERE status = 'open';
```

**Invariantes**:
- Una conversación siempre pertenece a exactamente un contacto.
- `current_intent` es texto libre actualizable; no tiene constraint de valores.
- `last_turn_at` se actualiza con cada mensaje registrado en la conversación.

---

## Tabla: messages

Turno individual de conversación.

```sql
CREATE TABLE messages (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid        NOT NULL REFERENCES conversations(id),
  contact_id      uuid        NOT NULL REFERENCES contacts(id),  -- desnormalizado
  direction       text        NOT NULL
                              CHECK (direction IN ('inbound', 'outbound')),
  content         text        NOT NULL
                              CHECK (char_length(content) BETWEEN 1 AND 4096),
  metadata        jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC);
CREATE INDEX messages_contact_idx      ON messages (contact_id, created_at DESC);
```

**Invariantes**:
- `contact_id` está desnormalizado para permitir consultas de memoria sin JOIN adicional.
- `content` no puede estar vacío ni superar 4 096 caracteres (límite WhatsApp Business).
- La tabla es append-only: nunca se hace UPDATE ni DELETE sobre sus filas.

---

## Tabla: message_embeddings

Representación vectorial de un mensaje para búsqueda semántica.

```sql
CREATE TABLE message_embeddings (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  uuid        NOT NULL REFERENCES messages(id),
  contact_id  uuid        NOT NULL REFERENCES contacts(id),  -- desnormalizado para filtrado
  embedding   vector(1536) NOT NULL,
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'indexed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Índice HNSW para búsqueda vectorial con distancia coseno
CREATE INDEX message_embeddings_hnsw_idx
  ON message_embeddings
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Índice filtrado para búsquedas por contacto
CREATE INDEX message_embeddings_contact_idx
  ON message_embeddings (contact_id)
  WHERE status = 'indexed';

-- Índice para jobs de reintento de embeddings pendientes
CREATE INDEX message_embeddings_pending_idx
  ON message_embeddings (created_at)
  WHERE status = 'pending';
```

**Invariantes**:
- Toda búsqueda semántica DEBE incluir `WHERE contact_id = $1`. El servicio rechaza
  queries sin este filtro.
- `contact_id` está desnormalizado en esta tabla para que el filtro de aislamiento
  sea eficiente sin JOIN.
- Un mensaje puede existir sin su embedding (status `pending`). La búsqueda devuelve
  solo embeddings con status `indexed`.

---

## Tabla: audit_log

Bitácora append-only e inmutable de todas las operaciones del sistema.

```sql
CREATE TABLE audit_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  actor        text        NOT NULL DEFAULT 'orchestrator',
  action       text        NOT NULL,   -- e.g. 'contact.created', 'message.registered'
  entity_type  text        NOT NULL,   -- e.g. 'contact', 'message', 'conversation'
  entity_id    uuid,
  payload      jsonb
);

CREATE INDEX audit_log_entity_idx     ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_occurred_idx   ON audit_log (occurred_at DESC);
CREATE INDEX audit_log_action_idx     ON audit_log (action);
```

**Invariantes**:
- Solo se permiten INSERT, canalizados exclusivamente a través de `write_audit_log()`
  (SECURITY DEFINER como `audit_writer`). El rol `orchestrator_role` no tiene ningún
  privilegio directo sobre esta tabla.
- No existe soft-delete ni columna `deleted_at`: los registros de auditoría son
  permanentes por diseño.
- `payload` contiene datos resumidos (no credenciales, no contenido completo de
  mensajes sensibles).

---

## Roles de base de datos y permisos

Ambos roles tienen `LOGIN` y contraseña propia — son roles de conexión, no solo
roles de permisos. El orquestador nunca usa `SUPABASE_SERVICE_ROLE_KEY` en runtime;
se conecta vía Supavisor (transaction mode) con las credenciales de su rol.
Las contraseñas se configuran en Supabase Dashboard → Project Settings → Database → Roles.

```sql
-- Roles de conexión con credenciales propias
CREATE ROLE orchestrator_role LOGIN PASSWORD '<orchestrator_password>';
CREATE ROLE audit_writer       LOGIN PASSWORD '<audit_writer_password>';

-- orchestrator_role: tablas de negocio — INSERT, UPDATE, SELECT; sin DELETE
GRANT INSERT, UPDATE, SELECT ON contacts           TO orchestrator_role;
GRANT INSERT, UPDATE, SELECT ON conversations      TO orchestrator_role;
GRANT INSERT, UPDATE, SELECT ON messages           TO orchestrator_role;
GRANT INSERT, UPDATE, SELECT ON message_embeddings TO orchestrator_role;
REVOKE DELETE, TRUNCATE ON contacts, conversations,
  messages, message_embeddings FROM orchestrator_role;

-- orchestrator_role NO tiene ningún privilegio directo sobre audit_log.
-- La única vía de escritura es write_audit_log() (SECURITY DEFINER como audit_writer).
REVOKE ALL ON audit_log FROM orchestrator_role;

-- audit_writer: INSERT + SELECT en audit_log; sin DELETE ni UPDATE
GRANT INSERT, SELECT ON audit_log TO audit_writer;
REVOKE DELETE, TRUNCATE, UPDATE ON audit_log FROM audit_writer;
```

---

## Función de escritura de audit log

`write_audit_log` es la única vía autorizada para insertar en `audit_log`. Ejecuta
como `audit_writer` (SECURITY DEFINER) independientemente del rol del llamador.
Como `audit_writer` no es superusuario, los GRANTs son efectivos a nivel de BD.

```sql
CREATE OR REPLACE FUNCTION write_audit_log(
  p_actor       text,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_payload     jsonb DEFAULT NULL
) RETURNS void
SECURITY DEFINER
SET search_path = public
LANGUAGE sql AS $$
  INSERT INTO audit_log (actor, action, entity_type, entity_id, payload)
  VALUES (p_actor, p_action, p_entity_type, p_entity_id, p_payload);
$$;

ALTER FUNCTION write_audit_log OWNER TO audit_writer;
GRANT EXECUTE ON FUNCTION write_audit_log TO orchestrator_role;
REVOKE EXECUTE ON FUNCTION write_audit_log FROM PUBLIC;
```

**Invariante**: El cuerpo contiene únicamente INSERT. `orchestrator_role` tiene
EXECUTE sobre la función pero ningún privilegio directo sobre `audit_log`.

---

## Función de búsqueda semántica con filtro obligatorio

```sql
CREATE OR REPLACE FUNCTION search_contact_memory(
  p_contact_id uuid,
  p_query_embedding vector(1536),
  p_limit int DEFAULT 10
)
RETURNS TABLE (
  message_id  uuid,
  contact_id  uuid,
  content     text,
  similarity  float,
  created_at  timestamptz
)
LANGUAGE sql STABLE AS $$
  SELECT
    m.id         AS message_id,
    me.contact_id,
    m.content,
    1 - (me.embedding <=> p_query_embedding) AS similarity,
    m.created_at
  FROM message_embeddings me
  JOIN messages m ON m.id = me.message_id
  WHERE me.contact_id = p_contact_id    -- filtro obligatorio de aislamiento
    AND me.status = 'indexed'
  ORDER BY me.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;
```

El filtro `WHERE me.contact_id = p_contact_id` es estructural en la función; no puede
ser omitido por el caller. Esto implementa el Principio VI de la constitución a nivel
de base de datos, no solo de instrucción de código.

---

## Diagrama de relaciones

```
contacts (1) ──── (N) conversations
contacts (1) ──── (N) messages           [contact_id desnormalizado]
contacts (1) ──── (N) message_embeddings [contact_id desnormalizado]
conversations (1) ── (N) messages
messages (1) ──── (0..1) message_embeddings
```
