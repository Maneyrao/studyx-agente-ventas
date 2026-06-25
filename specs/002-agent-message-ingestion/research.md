# Phase 0 — Research: Agent Message Ingestion Endpoint

Todas las incógnitas de Technical Context quedaron resueltas. No quedan marcadores
NEEDS CLARIFICATION. Las decisiones de comportamiento ambiguas ya fueron fijadas en la
sesión de `/speckit-clarify` (ver `spec.md` → Clarifications).

---

## D1 — Detección de "referencia al pasado" (disparo de memoria de largo plazo)

- **Decisión**: Heurística determinista en TypeScript (`src/lib/heuristics/reference-detection.ts`) que evalúa el contenido del mensaje entrante contra una lista mantenible de marcadores lingüísticos (regex/keywords normalizados sin acentos y en minúsculas), p. ej. `como te dije`, `lo que hablamos`, `mi cuenta`, `me ofreciste`, `el curso que`, `la promo`, `quedamos en`, `te pasé`, `mi pedido`. Devuelve `boolean`. Solo si `true` se invoca `semanticSearch`.
- **Rationale**: Cero llamadas a modelos y cero embeddings en turnos triviales (cumple SC-001/SC-006); totalmente determinista y testeable sin BD ni red; ante ausencia de marcador NO dispara (favorece costo bajo, FR-005). Lista ampliable sin cambio de contrato.
- **Alternativas consideradas**:
  - *Clasificador LLM por turno*: más preciso con frases sutiles pero agrega costo+latencia en CADA turno, incluso triviales — contradice el objetivo central. Rechazado en clarify.
  - *Umbral de similitud vectorial*: obliga a embeber cada mensaje para decidir — costo fijo por turno. Rechazado.
  - *Híbrido heurística+LLM*: mayor complejidad de implementación/test sin beneficio claro para el MVP. Rechazado.

## D2 — Detección de trivialidad (gobierna la regeneración de resumen)

- **Decisión**: Heurística determinista separada (`src/lib/heuristics/triviality.ts`), `isTrivial(content): boolean`. **Regla exacta** (para garantizar determinismo y testeabilidad de SC-001/SC-006):
  1. **Normalización**: minúsculas, eliminación de acentos (NFD + strip de diacríticos) y `trim`.
  2. **Match exacto** contra la lista cerrada de frases triviales: `hola`, `buenas`, `buen dia`, `buenos dias`, `buenas tardes`, `buenas noches`, `hi`, `hello`, `ok`, `dale`, `si`, `no`, `listo`, `entendido`, `gracias`, `muchas gracias`, `genial`, `perfecto`, `de nada`, `np`, `claro`, `obvio`, `eso`. → trivial.
  3. **Regla de brevedad** (si no hubo match exacto): el mensaje es trivial si tiene **≤ 3 palabras** Y **no** contiene `?` Y **no** contiene ningún dígito.
  4. En cualquier otro caso → NO trivial.
  - La lista de frases es mantenible/ampliable sin cambio de contrato. Devuelve `boolean`.
- **Rationale**: Trivialidad y referencia-al-pasado son clasificaciones **distintas** (un mensaje puede ser sustantivo sin aludir al pasado, p. ej. "¿cuánto sale el curso de Python?"). Separarlas mantiene FR-005 (memoria) y FR-006/FR-009 (resumen) independientes y testeables. La triviality se evalúa en el paso de `reply` a partir del contenido **inbound** del turno (recuperado por `turn_id`), de modo que el cliente no necesita reenviarla.
- **Alternativas**: reusar la misma heurística para ambos fines — rechazado: acopla dos políticas con criterios diferentes.

## D3 — Correlación de turno (inbound ↔ outbound)

- **Decisión**: El `turn_id` devuelto por `/api/agent/ingest` **es el `id` del mensaje inbound**. `/api/agent/reply` recibe `{ turn_id, content }`, busca el mensaje inbound por id, valida que exista, sea `inbound` y no tenga ya una respuesta, y persiste el outbound con `in_reply_to = turn_id`. Un índice único parcial sobre `messages(in_reply_to)` (where not null) garantiza **un outbound por turno**.
- **Rationale**: Confirmado en clarify (identificador de turno explícito). Robusto ante turnos concurrentes del mismo contacto; hace determinista el error "outbound sin inbound correlacionado" (FR-007, US2-escenario 2). Reutiliza la tabla `messages` sin entidad nueva.
- **Alternativas**: correlación implícita por conversación activa (frágil ante concurrencia) — rechazada en clarify; endpoint único síncrono (cambia el modelo a bloqueante) — rechazado.

## D4 — Contador de turnos y disparo de resumen

- **Decisión**: Columna `contacts.pending_turns int NOT NULL DEFAULT 0`. Se incrementa **una vez por turno** al registrarse el outbound en `/api/agent/reply`. Si `pending_turns >= UMBRAL` **y** el turno NO es trivial → regenerar resumen; en éxito `pending_turns = 0`; en fallo, conservar contador y resumen previo (reintento en próximo cruce). Si el cruce ocurre en turno trivial → diferir (no regenerar, no resetear). Umbral configurable vía env (`SUMMARY_THRESHOLD`, default 10).
- **Rationale**: Implementa FR-008/FR-009 y la reconciliación trivial/umbral de clarify; determinista y reintentable; un solo `UPDATE … SET pending_turns = pending_turns + 1` evita condiciones de carrera de lectura-modificación-escritura.
- **Alternativas**: no contar turnos triviales (contradice "turnos completados" de clarify) — rechazado; contar mensajes individuales (doble conteo) — rechazado.

## D5 — Generación del resumen (modelo y formato)

- **Decisión**: Reutilizar el cliente **OpenAI** ya configurado (`src/lib/embeddings/openai.ts`) para una llamada *chat completion* acotada que resume los últimos turnos del contacto (intereses, objeciones, datos aportados, estado comercial) en texto compacto (límite de tokens de salida). Modelo configurable vía env (`SUMMARY_MODEL`, default un modelo chat económico de OpenAI). Resultado guardado en `contacts.summary` + `summary_updated_at`.
- **Rationale**: El stack ya estandarizó OpenAI (embeddings) con credenciales presentes; reusar el mismo proveedor evita introducir un SDK y secretos nuevos (alineado con menor superficie/Principio II). El prompt restringe el resumen a datos reales del contacto (Principio VII, anti-alucinación). Modelo intercambiable sin cambio de contrato.
- **Alternativas**: usar un proveedor LLM distinto (p. ej. Anthropic) — rechazado para el MVP por agregar dependencia + credenciales nuevas sin necesidad; mantener resumen "extractivo" sin LLM (concatenar) — rechazado por baja calidad de contexto.

## D6 — Resolución de la conversación activa

- **Decisión**: Añadir `findOpenConversation(contact_id, channel)` a `conversation.service.ts` y un helper `getOrCreateOpenConversation()` que devuelve la conversación `open` existente o crea una nueva con `createConversation()` (ya existente). La ingesta usa este helper antes de `registerMessage`.
- **Rationale**: 001 solo expone `createConversation`/`getConversation`; la ingesta necesita "la conversación abierta del contacto o una nueva". Mantiene una sola conversación `open` por contacto/canal (índice parcial `conversations_status_idx` ya favorece el lookup).
- **Alternativas**: crear una conversación por turno — rechazado: rompe la continuidad de "turnos recientes".

## D7 — Degradación controlada (FR-015, SC-007)

- **Decisión**: La búsqueda de largo plazo y la regeneración de resumen se ejecutan en bloques try/catch que, ante fallo, registran el error (structured-log + counter) y devuelven/continúan con el contexto disponible (turnos recientes + resumen previo). El paquete de contexto incluye un flag `long_term_memory_available: boolean` cuando aplica.
- **Rationale**: FR-015/SC-007 exigen que ni la memoria ni el resumen bloqueen el turno. Sigue el patrón de degradación de embeddings ya presente en `message.service.ts`.

## D8 — Cumplimiento del recordatorio pgvector (input del usuario)

- **Decisión**: No introducir SQL de vectores nuevo. Reutilizar `registerMessage` (cast `::extensions.vector` explícito) y `search_contact_memory` (función con `SET search_path = public, extensions` y parámetro `extensions.vector`). El `GRANT USAGE ON SCHEMA extensions` a `orchestrator_role` ya existe.
- **Rationale**: El pooler en modo transacción no garantiza `search_path` de sesión entre queries; al delegar en código que ya casa explícitamente y en una función con `search_path` fijado, esta feature no añade riesgo. La nueva migración no toca tipos vector (solo `text`/`int`/`uuid`).
- **Verificación**: confirmado por inspección de `message.service.ts:62,69`, `memory.service.ts:54`, `migrations/...010_search_function.sql` y `...184404_grant_extensions_usage.sql`.

## D9 — Verificación de primitivos reutilizados de la 001

Confirmaciones por inspección de código que respaldan requisitos que dependen del reuso:

- **Auditoría de inbound/outbound (FR-012, SC-002)**: `registerMessage` (`message.service.ts:103-108`) llama a `auditLog({ action: 'message.registered', ... })` de forma **incondicional y awaited, fuera de todo `try/catch`** (el único try/catch del método, líneas 77-93, envuelve solo la generación de embeddings y cierra antes). `auditLog` (`audit/logger.ts`) invoca `write_audit_log()` que ejecuta `INSERT INTO audit_log (...)` (`migrations/...009_audit_write_function.sql:14-17`). Aplica a ambas direcciones (el método es agnóstico de `direction`). Si la auditoría falla, propaga error (falla ruidosa, no silenciosa). → FR-012 cubierto sin tareas adicionales.
  - **Matiz**: el INSERT del mensaje (`orchestrator_role`) y el de auditoría (`audit_writer`) usan conexiones separadas; no son atómicos. Un fallo de auditoría deja el mensaje persistido pero reporta error. Propiedad pre-existente de la 001, aceptable para el MVP.
- **Embedding de la query en búsqueda semántica (I2)**: `semanticSearch` (`memory.service.ts:49`) hace `generateEmbedding(query)` **internamente**; T016 no necesita un paso de embedding propio.
- **Recuperación reciente**: `getRecentMessages` (`memory.service.ts`) devuelve mensajes en `ORDER BY created_at ASC` (orden cronológico ascendente), satisfaciendo FR-004.
- **Filtro de aislamiento (FR-011)**: `search_contact_memory` filtra por `me.contact_id = p_contact_id` y `semanticSearch` exige `contact_id` (lanza si falta).
