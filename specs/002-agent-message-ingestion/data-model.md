# Phase 1 — Data Model: Agent Message Ingestion Endpoint

Esta feature **reutiliza** el esquema de la 001 y solo agrega columnas e índices. No crea
tablas nuevas. Migración propuesta:
`supabase/migrations/20260625XXXXXX_contact_summary_and_turn_link.sql`.

---

## Cambios de esquema

### `contacts` (ALTER — añadir columnas)

| Columna | Tipo | Reglas | Propósito |
|---------|------|--------|-----------|
| `summary` | `text` | nullable (NULL = sin resumen aún) | Resumen evolutivo compacto del contacto (intereses, objeciones, datos, estado comercial). |
| `summary_updated_at` | `timestamptz` | nullable | Marca de la última regeneración exitosa del resumen. |
| `pending_turns` | `int` | `NOT NULL DEFAULT 0`, `CHECK (pending_turns >= 0)` | Turnos completados desde la última regeneración exitosa; dispara el umbral. |

- `orchestrator_role` ya tiene `UPDATE`/`SELECT` sobre `contacts`; los grants de tabla cubren las columnas nuevas.
- Sin impacto en `resolveContact` (la interfaz `Contact` se extiende con los 3 campos).

### `messages` (ALTER — correlación de turno)

| Columna | Tipo | Reglas | Propósito |
|---------|------|--------|-----------|
| `in_reply_to` | `uuid` | nullable, `REFERENCES messages(id)` | En un mensaje `outbound`, apunta al `inbound` (turno) que responde. NULL para inbound. |

Índice único parcial — **un outbound por turno**:

```sql
CREATE UNIQUE INDEX messages_in_reply_to_unique
  ON messages (in_reply_to)
  WHERE in_reply_to IS NOT NULL;
```

- Garantiza determinismo de "outbound sin inbound correlacionado / turno ya respondido" (FR-007).
- `orchestrator_role` ya tiene `INSERT`/`UPDATE`/`SELECT` sobre `messages`.

> **Nota pgvector**: la migración solo añade tipos `text`/`int`/`uuid`. No toca `message_embeddings` ni el tipo `extensions.vector`; no requiere casts de vector ni cambios de `search_path` (ver research D8).

---

## Entidades (vista lógica)

### Contacto *(extendido)*
- Campos previos (001): `id, phone, status, channel_origin, opted_in_at, name, email, deleted_at, created_at, updated_at`.
- **Nuevos**: `summary`, `summary_updated_at`, `pending_turns`.
- Estados de `status`: `prospecto | cliente | inactivo` (sin cambios). En el MVP, tanto el **opt-out** (el contacto pidió no ser contactado) como el **bloqueo** se representan con el único valor `status = inactivo`; no se distinguen como estados separados. La señalización para el agente se deriva de ese valor y se expone como `blocked: boolean` en el paquete de contexto de la ingesta. Si en el futuro se necesita diferenciar opt-out de bloqueo, requerirá un estado/columna adicional.

### Conversación *(reutilizada)*
- `id, contact_id, channel, status (open|closed|transferred), current_intent, started_at, last_turn_at, created_at`.
- Invariante para esta feature: a lo sumo **una** conversación `open` por `(contact_id, channel)`; la ingesta reutiliza la abierta o crea una nueva.

### Mensaje *(extendido)*
- Campos previos (001): `id, conversation_id, contact_id, direction (inbound|outbound), content (1..4096), metadata, created_at`.
- **Nuevo**: `in_reply_to` (solo outbound).
- **Turno** = par (mensaje inbound, su outbound correlacionado por `in_reply_to`). El `turn_id` expuesto al agente es el `id` del inbound.

### Resumen de contacto *(materializado en `contacts`)*
- `summary` (texto), `summary_updated_at`. Se sobrescribe in-place en cada regeneración exitosa (sin borrado físico; cumple Principio IV).

### Contador de interacciones *(materializado en `contacts.pending_turns`)*
- Incrementa +1 por turno al registrar el outbound; se reinicia a 0 solo tras regeneración exitosa.

### Paquete de contexto *(salida del endpoint de ingesta — no persistido)*
```text
{
  turn_id,                       // id del mensaje inbound
  contact: { id, status, name?, blocked, summary, summary_updated_at },
                                 // blocked = (status === 'inactivo'); señal opt-out
  recent_turns: [ { direction, content, created_at } ],   // orden cronológico asc
  long_term_memory: [ { content, similarity, created_at } ] | null,
                                 // solo si NO es trivial Y referencesPast (trivialidad tiene precedencia)
  long_term_memory_available: boolean   // false si la búsqueda falló (degradación)
}
```

### Registro de auditoría *(reutilizado, sin cambios)*
- Escrito vía `write_audit_log()` (SECURITY DEFINER, rol `audit_writer`). Acciones esperadas: `contact.created/accessed`, `conversation.created`, `message.registered` (inbound y outbound), `contact.summary_regenerated`.

---

## Reglas de validación (resumen)

| Regla | Origen | Punto de aplicación |
|-------|--------|---------------------|
| `phone` en formato E.164 (`^\+[1-9]\d{7,14}$`) | FR-014 | Zod en handler + `resolveContact` |
| `content` no vacío, 1..4096 chars | FR-014 | Zod en handler + CHECK en `messages` |
| `turn_id` es UUID existente, `inbound`, sin reply previa | FR-007 | `ingestion.service` + índice único parcial |
| Búsqueda de largo plazo siempre con `contact_id` | FR-011 | `semanticSearch`/`search_contact_memory` |
| `pending_turns >= 0` | invariante | CHECK |
| Sin `DELETE` físico | Principio IV | grants de `orchestrator_role` |
