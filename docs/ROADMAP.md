# Roadmap de robustez — StudyX Agente de Ventas

## Visión

StudyX es un agente de ventas conversacional para cerrar oportunidades breves por WhatsApp, con PostgreSQL como fuente de verdad y Botpress como capa de conversación. Debe ser seguro ante reintentos, concurrencia, dependencias lentas y fallos parciales.

Usuario primario: prospectos contactando a StudyX. Usuarios secundarios: equipo comercial y operadores que intervienen ante excepciones.

Restricción principal: los hechos comerciales, el consentimiento y la entrega nunca dependen exclusivamente de una respuesta de IA.

## Estado DDIA

- Estado actual: **8.5/10 local**. Ya existen transacciones de extremo a extremo, idempotencia externa, constraints compuestos, outbox, leases, auditoría atómica y pruebas de replay/fallos. Falta evidencia de operación real y recuperación administrada.
- Objetivo de esta hoja de ruta: **9/10**. El punto restante depende de medir producción real, recuperación del proveedor y estrategia de backup/failover de Supabase.

## Stack

| Capa | Elección | Motivo |
|---|---|---|
| Canal conversacional | Botpress ADK + WhatsApp | Adaptación de canal y conversación |
| API de negocio | Next.js Route Handlers + TypeScript | Backend existente y validación tipada |
| Base canónica | PostgreSQL 17 en Supabase | ACID, constraints, trazabilidad y consultas relacionales |
| Memoria semántica | pgvector en PostgreSQL | Índice derivado, reconstruible y aislado por contacto |
| Validación | Zod | Contratos de entrada explícitos |
| Pruebas | Vitest + Supabase local | Pruebas unitarias, integración, concurrencia y replay |
| Despliegue | Vercel + Botpress Cloud | Destinos ya elegidos por el proyecto |

## Invariantes no negociables

1. Un `(channel, external_message_id)` representa como máximo un inbound.
2. Un inbound representa como máximo un outbound lógico.
3. Sólo puede existir una conversación abierta por `(contact_id, channel)`.
4. Un contacto bloqueado o sin consentimiento comercial no puede recibir un outbound comercial.
5. Un outbound sólo figura como `sent` cuando existe confirmación del canal.
6. Un fallo de Gemini o pgvector no revierte ni duplica un mensaje canónico.
7. Cada operación puede rastrearse desde `external_message_id` hasta `turn_id`, delivery y auditoría.
8. Los resúmenes y embeddings son derivados; nunca reemplazan consentimiento, precios, pagos o estados estructurados.

## Modelo de datos objetivo

### `contacts`

Mantiene identidad, lifecycle, bloqueo y etapa comercial. El consentimiento por canal vive separado en `contact_channel_permissions`, con evidencia append-only en `consent_events`.

### `conversations`

Mantiene sesiones por contacto/canal y referencia `channel_threads`, que conserva la identidad externa del proveedor.

### `messages`

Mantiene mensajes canónicos y referencia un `channel_event` único. El ledger externo conserva proveedor, integración, conversación, mensaje y hash del payload.

### `outbound_deliveries`

Mantiene intención y resultado de entrega: `pending`, `sending`, `sent`, `retry_pending`, `failed` o `dead_letter`; incluye intentos, `next_attempt_at`, error y el ID confirmado por el proveedor.

### `message_embeddings`

Vista derivada y reconstruible. Un embedding por mensaje o artefacto elegible; generación asíncrona y selectiva.

### `audit_log`

Registro inmutable de decisiones y transiciones. Las escrituras críticas deben formar parte de la misma transacción o ser recuperables mediante outbox.

## Fase 1 — Núcleo idempotente y transaccional

*Objetivo: aceptar reintentos y concurrencia sin crear mensajes, conversaciones o respuestas duplicadas.*

### Base de datos

- [x] Crear migraciones nuevas y aditivas; no editar migraciones ya aplicadas.
- [x] Agregar identidad externa y constraints idempotentes.
- [x] Agregar unicidad parcial de conversación abierta.
- [x] Separar consentimiento, bloqueo y etapa comercial.
- [x] Crear `outbound_deliveries` y sus constraints de estado.
- [x] Añadir índices para replay, pendientes y reconciliación.

### Backend

- [x] Extender el contrato de ingesta con IDs externos obligatorios.
- [x] Ejecutar escrituras canónicas en transacciones cortas.
- [x] Devolver el resultado existente ante una reentrega.
- [x] Bloquear outbounds comercialmente prohibidos en el backend.
- [x] Mapear conflictos por SQLSTATE/constraint, sin analizar texto de errores.

### Pruebas

- [x] Diez entregas idénticas producen un inbound.
- [x] Veinte ingestas simultáneas producen una conversación abierta.
- [x] Dos respuestas simultáneas producen un outbound lógico.
- [x] Un bloqueado nunca produce delivery.

### Definición de terminado

Las invariantes 1–4 están protegidas por constraints y pruebas de integración, no sólo por código de aplicación.

## Fase 2 — Procesamiento derivado y memoria segura

*Objetivo: sacar Gemini del camino transaccional y recuperar sólo memoria relevante.*

### Backend y workers

- [x] Persistir el mensaje antes de generar embeddings o resúmenes.
- [ ] Afinar elegibilidad: hoy se omiten triviales, falta clasificar reutilización comercial.
- [x] Corregir la consulta de últimos N mensajes.
- [ ] Evitar un segundo embedding para la misma query cuando sea reutilizable.
- [ ] Agregar umbral de similitud, deduplicación y máximo de fragmentos.
- [ ] Guardar procedencia y versión de resúmenes.

### Pruebas

- [x] Gemini caído no impide confirmar el inbound.
- [x] pgvector/embedding no disponible degrada a memoria reciente.
- [ ] Una búsqueda irrelevante devuelve memoria vacía.
- [x] Cincuenta mensajes devuelven los últimos N en orden cronológico.

### Definición de terminado

La latencia de Gemini no puede provocar una reentrega duplicada y la memoria derivada puede reconstruirse desde PostgreSQL.

## Fase 3 — Contrato Botpress y entrega recuperable

*Objetivo: completar un turno desde el canal con trazabilidad y reintentos seguros.*

### Contrato y workflow

- [x] Configurar endpoint, secreto y timeouts fuera del prompt.
- [x] Mapear IDs externos en Emulator; WhatsApp real pendiente de integración oficial.
- [x] Implementar tres reintentos adicionales con backoff y jitter sólo para errores transitorios.
- [x] Crear estados recuperables de workflow y entrega.
- [x] Confirmar delivery con ID externo o dejarlo recuperable.
- [x] Implementar kill switch para respuestas autónomas.

### Evaluaciones

- [ ] Duplicado, mensajes rápidos y respuesta citada.
- [ ] Bloqueado, reclamo, ambigüedad y pedido humano.
- [ ] Timeout, modelo caído, persistencia fallida y envío fallido.
- [ ] La IA nunca comunica éxito si el backend no lo confirmó.

### Definición de terminado

Un turno completo puede reanudarse después de cada fallo inyectado sin duplicar efectos comerciales.

## Fase 4 — Gate de producción

*Objetivo: convertir la robustez en una condición automática de despliegue.*

- [x] Corregir lint/build para Next.js 16.3.
- [ ] Añadir CI con tipos, lint, unitarias, integración y migración limpia.
- [ ] Añadir health y readiness checks sin exponer secretos.
- [ ] Medir p50/p95, tasa de duplicados, backlog, fallos de delivery y pedidos humanos resueltos automáticamente.
- [ ] Ejecutar carga de 25 conversaciones y luego 150 de forma controlada.
- [ ] Probar restauración de backup y reconciliación de outbox.
- [ ] Desplegar en modo supervisado antes de habilitar autonomía.

### Definición de terminado

Ningún cambio puede desplegarse si rompe una invariante, una migración desde cero o una prueba de replay/fallo.

## Evolución del esquema

| Tabla | Fase 1 | Fase 2 | Fase 3 |
|---|---|---|---|
| `contacts` | consentimiento, bloqueo, etapa | — | — |
| `conversations` | ID externo + unicidad abierta | — | estado operativo |
| `messages` | IDs externos + idempotencia | elegibilidad de memoria | correlación de canal |
| `outbound_deliveries` | tabla y estados | reconciliación | confirmación del canal |
| `message_embeddings` | unicidad | selección y procedencia | — |

## Superficie API objetivo

| Ruta | Fase | Propósito |
|---|---:|---|
| `POST /api/agent/ingest` | 1 | Ingesta idempotente y contexto |
| `POST /api/agent/turns/:turn_id/decision` | 1 | Validar y crear un outbound lógico |
| `POST /api/agent/outbounds/:id/delivery` | 3 | Confirmar envío o registrar fallo recuperable |
| `POST /api/agent/reply` | 1 | Adapter legacy sobre el contrato de decisión |
| `GET /api/health` | 4 | Liveness sin dependencias externas |
| `GET /api/ready` | 4 | Readiness de dependencias críticas |

## Deliberadamente fuera de alcance

- Dashboard comercial completo.
- Pagos o descuentos autónomos.
- CRM generalista.
- Migrar a una base vectorial separada.
- Indexar todos los mensajes por defecto.
- Prometer exactamente una entrega física de WhatsApp; se garantiza efecto de negocio idempotente sobre entrega al menos una vez.
