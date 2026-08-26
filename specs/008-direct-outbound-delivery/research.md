# Research: Entrega Outbound Directa Multicanal

**Feature**: 008 | **Fase**: 0 | **Fecha**: 2026-08-18

Este documento resuelve los tres `NEEDS CLARIFICATION` de la especificación y consolida
el relevamiento del código y de las APIs externas que condiciona el diseño.

---

## Parte 1 — Relevamiento del código existente

### R1.1 — ¿Hace falta una tabla de identidades por canal?

**Decisión**: No. Se usa `channel_threads`.

**Rationale**: `channel_threads` (migración `20260805010003:16`) ya guarda
`(contact_id, provider, integration_id, channel, external_conversation_id)` con
`UNIQUE (provider, integration_id, external_conversation_id)`. Para Telegram, el `chat_id`
*es* el identificador de conversación, así que encaja sin forzar la semántica. El
constraint único ya satisface FR-016 sin trabajo nuevo, y el índice
`channel_threads_contact_lookup_idx (contact_id, channel, last_seen_at DESC)` sirve
directamente a la selección de canal.

**Alternativas consideradas**: crear `contact_channel_identities`, como suponía la
especificación. Descartada: duplicaría la identidad de canal en dos tablas, y la
divergencia entre ambas sería inevitable con el tiempo.

### R1.2 — ¿El `chat_id` de Telegram llega en la ingesta? (pregunta abierta del plan)

**Decisión**: Sí llega, y ya se persiste. El bloqueo es otro.

**Rationale**: `inbound-envelope.ts:38` define `external_conversation_id` como campo del
contrato, e `ingestion.service.ts:298` ya hace `INSERT INTO channel_threads ... ON
CONFLICT (provider, integration_id, external_conversation_id)`. Esa vinculación es
idempotente por construcción, lo que satisface FR-030 sin código nuevo.

El bloqueo real está en `ingestion.service.ts:221`: `const channel = 'whatsapp' as const`.
La ingesta fuerza el canal, así que hoy toda identidad entrante se registra como WhatsApp,
sea cual sea su origen. Hay que derivar el canal del envelope.

**Consecuencia**: FR-028 es un cambio de una línea más su cobertura de no-regresión, no
una funcionalidad nueva.

### R1.3 — ¿Dónde vive el gate de consentimiento?

**Decisión**: Componer sobre `evaluateTurnPolicy()`, nunca reimplementarlo.

**Rationale**: `src/features/orchestration/domain/turn-policy.ts` es una política pura y
sin dependencias que ya evalúa `lifecycle_status`, `deleted_at`, `contact_status` y
`consent_status`. Su encabezado documenta que esa lógica *ya vivió duplicada una vez*, y
que la duplicación permitía responderle a un contacto bloqueado por un camino mientras el
otro lo suprimía. Reimplementarla en `messaging` repetiría exactamente el defecto que ese
archivo existe para cerrar.

Lo que la política **no** cubre y esta feature debe agregar por composición: la
disponibilidad del canal (existencia de identidad utilizable y vigencia de la ventana).

**Alternativas consideradas**: un gate propio en `messaging`. Descartada por lo anterior.

### R1.4 — Idempotencia del envío

**Decisión**: Reutilizar `enqueue_outbound_delivery(...)` y el
`UNIQUE (provider, integration_id, idempotency_key)` de `outbound_deliveries`.

**Rationale**: FR-010 exige que la garantía esté respaldada por una restricción de base de
datos y no por lógica de aplicación. El constraint ya existe (`20260805010005:60`) y la
función SQL ya crea la entrega y su evento de outbox de forma atómica; está en uso en
`decision.service.ts:406`. Bajo concurrencia, la segunda transacción choca contra el
índice único y lee la fila ganadora.

### R1.5 — Candado anti-efectos-reales (hallazgo no previsto por la spec)

**Decisión**: El envío directo debe consultar `sandbox_identities` antes de contactar a
cualquier proveedor. Se incorpora como FR-034.

**Rationale**: la migración `20260808010001` documenta explícitamente que la presencia de
una fila para un `contact_id` bloquea "llamadas Retell, cobros, envíos WhatsApp de
producción y filas en Sheets de producción". Un camino de envío nuevo que ignore ese
candado reintroduciría el efecto real que la fase 2 se ocupó de cerrar. No es una mejora
opcional: es evitar una regresión de seguridad.

### R1.6 — Patrones de código a seguir

| Aspecto | Referencia en el repo |
|---|---|
| Estructura de feature | `src/features/{calls,payments,orchestration}/{ports,adapters,application,domain}` |
| Puerto con errores tipados | `ports/voice-provider.ts` — `ConfirmedVoiceProviderError` / `AmbiguousVoiceProviderError` |
| Reserva → envío → marca de resultado | `TelegramSimVoiceProvider.placeCall` |
| Cliente HTTP con timeout | `TelegramBotApiClient.request` — `AbortController` + `clearTimeout` en `finally` |
| Carga de configuración | `loadTelegramAgentBConfig()` — requeridas explícitas, `MISSING_...:KEY`, `parsePositiveInt` |
| Wiring | Sin composition root: los adapters se instancian por route handler |

**Decisión sobre wiring**: se respeta el patrón existente (factory por adapter, instanciada
en el borde). Introducir un contenedor de dependencias sería una divergencia
arquitectónica sin necesidad actual.

---

## Parte 2 — APIs externas

### R2.1 — Telegram Bot API

**Endpoint**: `POST https://api.telegram.org/bot<token>/sendMessage`, mínimo `chat_id` y
`text`. Largo máximo: **4096 caracteres**, contados después del parseo de entities.

**Respuesta**: `{"ok":true,"result":{"message_id":123,...}}`. En error:
`{"ok":false,"error_code":N,"description":"...","parameters":{"retry_after":N}}`.

**Decisión — clasificar por `error_code`, no por `description`**:

| `error_code` | Clasificación | Acción |
|---|---|---|
| 401 | Permanente (config) | Alertar; no reintentar |
| 403 | Permanente | Bot bloqueado, usuario desactivado o conversación nunca iniciada → marcar identidad inutilizable |
| 400 | Permanente, salvo que traiga `parameters.migrate_to_chat_id` | En ese caso, actualizar el `chat_id` y reintentar |
| 429 | Transitorio | Esperar `parameters.retry_after` |
| ≥500 | Transitorio | Backoff |

**Rationale**: la documentación oficial del Bot API **no publica una tabla de errores ni
los strings de `description`**; solo documenta la forma del sobre. Los strings observados
(`Forbidden: bot was blocked by the user`) provienen del código fuente del servidor y no
son un contrato estable. Usarlos para decidir el reintento haría el adapter frágil ante un
cambio de redacción del proveedor. Se usan solo para telemetría, con `includes(...)`.

**Hallazgo que corrige un bug latente**: `message_id` es único **por chat**, no global.
`outbound_deliveries` tiene `UNIQUE (provider, integration_id, provider_message_id)`, así
que persistir el `message_id` pelado puede colisionar entre dos chats distintos. Debe
guardarse compuesto (`chat_id:message_id`). El repositorio ya usa ese patrón en
`telegramProviderCallId(chatId, messageId)`.

**Rate limits (oficiales)**: 1 mensaje por segundo por chat; ~30 por segundo en total.
Irrelevante al volumen del piloto, pero el adapter obedece `retry_after` como autoridad.

**Envío en frío: imposible.** No existe endpoint que resuelva un teléfono o username a
`chat_id`; el identificador solo llega por un update entrante. Esto confirma la decisión
de auto-registro (FR-028) y es la causa del riesgo de producto documentado en el plan.

**Deep links** (`https://core.telegram.org/bots/features#deep-linking`): `t.me/<bot>?start=<payload>`
admite hasta **64 caracteres** en `[A-Za-z0-9_-]`, y al abrirlo el bot recibe un mensaje
cuyo texto es `/start <payload>`. Es el camino para vincular un lead con su `chat_id`. Un
UUID en base64url ocupa 22 caracteres. **El payload es visible y reenviable**: debe ser un
token opaco de un solo uso con TTL, nunca un id de lead en claro. Queda fuera del alcance
de esta feature, pero condiciona la 008.

### R2.2 — WhatsApp Cloud API

**Endpoint**: `POST https://graph.facebook.com/<version>/<phone_number_id>/messages` con
`Authorization: Bearer <token>`. Largo máximo del cuerpo: **4096 caracteres**.

**Decisión — pinear la versión de Graph API en configuración**. La actual es v26.0. Un
bump debe ser un cambio deliberado y revisado, no una constante embebida que se arrastre.

**Respuesta**: el id está en `messages[0].id`, con prefijo `wamid.`, global y estable.
`message_status` es `accepted` — **HTTP 200 significa aceptado, no entregado**.

**Decisión — registrar el éxito como `submitted`, no `delivered`**. La entrega real solo la
confirma un webhook de status que v1 no procesa. Marcar `delivered` afirmaría algo que el
sistema no sabe, y el ledger tiene `CHECK (state <> 'delivered' OR delivered_at IS NOT
NULL)`. Usar `submitted` deja `delivered` disponible para cuando se agreguen los callbacks,
sin necesidad de migración. Esto corrige el borrador inicial del plan.

**Ventana de servicio de 24 horas**: la abre un mensaje o llamada entrante del usuario, y
se reinicia con cada uno. Fuera de la ventana, un mensaje libre falla con **code `131047`**
(HTTP 403, "Re-engagement message").

**Decisión — tratar `131047` como camino esperado, no como excepción.** Meta **no expone
ningún endpoint que informe el estado de la ventana**: hay que calcularlo localmente desde
el último inbound. Ese cálculo es optimista y no autoritativo (skew de reloj, webhooks
perdidos, y un "known issue" que la propia documentación reconoce). Al recibir `131047`, el
sistema cierra la ventana en su estado local y pasa al canal de respaldo, sin registrar un
fallo técnico.

**Nota**: `error_subcode` está deprecado y no aparece en v16.0+. La clasificación se hace
por `error.code` numérico.

| `error.code` | Significado | Reintentable |
|---|---|---|
| `131047` | Ventana de 24h cerrada | No — cambiar de canal |
| `131026` | Destinatario no entregable / no usa WhatsApp | No — identidad inutilizable |
| `131031`, `131042`, `133010`, `190` | Cuenta restringida, pago, número no registrado, token | No — escalar, es configuración |
| `100`, `131051` | Parámetro o tipo inválido | No — defecto del adapter |
| `130429`, `80007`, `4` | Límites de throughput | Sí — backoff con jitter |
| `131056` | Demasiados mensajes al mismo destinatario | Sí — backoff por destinatario |
| `131048` | Spam / calidad degradada | Sí, con espera larga — tratar como interruptor |
| `131000` | Error desconocido | Sí — escalar si persiste |

Meta no devuelve `Retry-After` en estos 429; el backoff es responsabilidad del adapter.

**Links de pago**: no hay prohibición explícita de enviar un link de checkout hacia un
dominio propio. Lo que la política sí prohíbe es pedir o compartir números de tarjeta
completos dentro del chat, y operar en verticales reguladas. Si el pago es central al
producto, esto merece revisión legal, no solo lectura de documentación.

### R2.3 — Contraste que define el diseño del puerto

| | Telegram | WhatsApp |
|---|---|---|
| Idempotencia nativa | No | No |
| Confirmación | Síncrona, mensaje ya creado | Solo "aceptado" |
| Envío en frío | Imposible (requiere `/start`) | Solo con plantilla aprobada |
| Clasificación de error | Por `error_code` | Por `error.code` numérico |

**Decisión**: el puerto adopta el modelo **más débil** de los dos (aceptación asíncrona,
sin idempotencia del proveedor). Un puerto que prometiera la confirmación fuerte de
Telegram no podría ser implementado honestamente por WhatsApp. Cada adapter mapea su error
crudo a un enum interno —`PERMANENT | TRANSIENT | WINDOW_CLOSED | CONFIG_ERROR`— y el caso
de uso decide sobre ese enum, nunca sobre el error del proveedor.

---

## Resolución de los `NEEDS CLARIFICATION` de la especificación

| Marcador | Resolución | Fundamento |
|---|---|---|
| FR-025 — plantillas de WhatsApp | Solo dentro de la ventana de 24h; sin plantillas en v1 | Decisión del usuario. Consecuencia: WhatsApp es inalcanzable en llamadas en frío |
| FR-026 — alta de identidad de Telegram | Auto-registro al escribir al bot | Decisión del usuario, y además es el **único** camino técnicamente posible (R2.1) |
| Confirmación de entrega | Aceptación del proveedor; sin callbacks de estado | Decisión del usuario. Se registra como `submitted` (R2.2) |
