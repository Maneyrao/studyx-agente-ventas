# Implementation Plan: Entrega Outbound Directa Multicanal

**Branch**: `feat/008-direct-outbound-delivery` | **Date**: 2026-08-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-direct-outbound-delivery/spec.md`

## Summary

El orquestador pasa a entregar mensajes salientes por sí mismo, contactando
directamente a Telegram y WhatsApp, en lugar de encolarlos para que un agente externo
los entregue y reporte después. El objetivo es que un flujo en vivo obtenga una
confirmación concluyente dentro de la misma operación.

**Hallazgo dominante del relevamiento**: el esquema ya modela casi todo lo que la spec
pedía como nuevo, y existe un cliente de Telegram funcional con la taxonomía de errores
correcta. Esta feature es mayormente **generalización y cableado de piezas existentes**,
no construcción desde cero. Lo verdaderamente nuevo es: un puerto de mensajería, la
extensión de los `CHECK` de canal para admitir `telegram`, y el caso de uso de envío
sincrónico.

Reutilizaciones confirmadas:

| Necesidad de la spec | Ya existe | Ubicación |
|---|---|---|
| Identidad de canal por contacto (FR-015/016) | `channel_threads` con `UNIQUE (provider, integration_id, external_conversation_id)` | `20260805010003` |
| Consentimiento y bloqueo (FR-011/012) | `contact_channel_permissions.consent_status`, `contacts.lifecycle_status`, `evaluateTurnPolicy()` | `20260805010004`, `src/features/orchestration/domain/turn-policy.ts` |
| Ventana de 24h de WhatsApp (FR-025/026) | `contact_channel_permissions.reply_window_expires_at` | `20260805010004` |
| Ledger de entregas e idempotencia (FR-006/010) | `outbound_deliveries` + función `enqueue_outbound_delivery(...)` | `20260805010005` |
| Cliente HTTP de Telegram con timeout y errores | `TelegramBotApiClient`, `TelegramApiError`, `TelegramAmbiguousError` | `src/features/calls/adapters/telegram-bot-api.client.ts` |
| Patrón confirmado / ambiguo | `ConfirmedVoiceProviderError` / `AmbiguousVoiceProviderError` | `src/features/calls/ports/voice-provider.ts` |
| Reserva → envío → marca de resultado | `TelegramSimVoiceProvider.placeCall` | `src/features/calls/adapters/telegram-sim-voice.provider.ts` |

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20+

**Primary Dependencies**: Next.js 16.3 (App Router, route handlers), `postgres` 3.4 (SQL
parametrizado, sin ORM), Zod 4 (contratos de entrada/salida), Stripe 22 (no usado en
esta feature)

**Storage**: PostgreSQL vía Supabase. Migraciones aditivas en `supabase/migrations/`,
numeradas `YYYYMMDDNNNNNN_nombre.sql`

**Testing**: Vitest 4 con dos configuraciones separadas — `vitest.config.mts` (unitarias,
`tests/unit/`) y `vitest.integration.config.mts` (`tests/integration/`). Verificación de
base con `supabase db lint --level error` y `supabase test db` (invariantes pgTAP)

**Target Platform**: Servidor Node (Next.js), Supabase gestionado

**Project Type**: Servicio backend orquestador; sin superficie de UI en esta feature

**Performance Goals**: Confirmación de envío en menos de 5 s en el p95 (SC-001). El
presupuesto se reparte: resolución de elegibilidad y destino ≤ 300 ms, llamada al
proveedor con timeout de 5 s heredado del patrón existente
(`TELEGRAM_AGENT_B_REQUEST_TIMEOUT_MS`, default 5.000)

**Constraints**: Migraciones estrictamente aditivas; prohibido `DELETE` sobre tablas
críticas (el rol del orquestador solo tiene `INSERT`/`UPDATE`); aislamiento multi-tenant
por `workspace_id`; ningún envío duplicado ante reintentos o concurrencia

**Scale/Scope**: Volumen de piloto (decenas de envíos por día). El diseño no requiere
throughput alto; requiere corrección estricta bajo concurrencia y reintentos

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Estado | Cómo se satisface |
|---|---|---|
| **I. Fuente Única de Verdad** | ✅ Refuerza | La feature *corrige* una desviación: hoy un agente externo habla con la API del canal. Al mover la entrega al orquestador, la comunicación con APIs externas queda donde la constitución la exige. |
| **II. Menor Privilegio** | ✅ | Los tokens de Telegram y WhatsApp se leen únicamente desde `src/lib/config.ts` en el proceso del orquestador. Ningún agente conversacional recibe credenciales ni una herramienta de envío genérica. |
| **III. Identidad y Segundo Factor** | ⚪ No aplica | Esta feature no entrega datos de cuenta ni ejecuta acciones sensibles; solo transporta contenido ya resuelto. Aplicará en la spec siguiente. |
| **IV. Nunca Eliminar Datos** | ✅ | Las identidades de canal se invalidan con marca lógica (`unusable_at`), nunca con `DELETE`. Todo intento de envío deja rastro en el ledger. |
| **V. Validación de Webhooks** | ⚠️ Aplica parcialmente | La vinculación automática de identidad (FR-028) consume eventos entrantes de Telegram. Ese ingreso **debe** validar el secreto del proveedor antes de tocar lógica de negocio. Ya existe `TELEGRAM_AGENT_B_WEBHOOK_SECRET`; el diseño lo reutiliza y no crea un ingreso sin validar. |
| **VI. Aislamiento de Memoria** | ✅ | Toda resolución de identidad, consentimiento y destino filtra por `contact_id` y por tenant (FR-013). Ninguna consulta de esta feature accede a datos de contacto sin ese filtro. |
| **VII. Scope Acotado** | ✅ | La feature no genera contenido ni decide qué decir; recibe un texto ya resuelto y lo transporta. No puede inventar nada. |
| **VIII. Acciones Irreversibles a Humano** | ⚪ No aplica | No hay movimiento de dinero ni baja de cuenta. Enviar un link de pago no ejecuta un cobro. Aplicará en la spec siguiente. |

### Gate adicional del proyecto: candado sandbox

`sandbox_identities` (migración `20260808010001`) documenta explícitamente que la
presencia de una fila para un `contact_id` **bloquea envíos WhatsApp de producción,
llamadas Retell y cobros**. Este es un invariante de seguridad vigente que la
especificación no capturó.

**Consecuencia obligatoria para el diseño**: el caso de uso de envío directo DEBE
consultar el candado sandbox antes de contactar a cualquier proveedor real, y rechazar
con un motivo propio. Un envío directo que ignore el candado sería una regresión de
seguridad: reintroduciría exactamente el efecto real que la fase 2 se ocupó de bloquear.
Se agrega como requisito derivado **FR-034** y como escenario de prueba obligatorio.

**Veredicto del gate**: PASA, con dos condiciones vinculantes —
(a) el ingreso de eventos de Telegram valida el secreto antes de la lógica de negocio;
(b) el envío directo respeta el candado sandbox.

## Project Structure

### Documentation (this feature)

```text
specs/008-direct-outbound-delivery/
├── plan.md              # Este archivo
├── research.md          # Fase 0
├── data-model.md        # Fase 1
├── quickstart.md        # Fase 1
├── contracts/           # Fase 1
│   ├── message-channel.port.md
│   └── send-outbound.contract.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Fase 2 (/speckit-tasks, no lo crea este comando)
```

### Source Code (repository root)

```text
src/
├── features/
│   ├── messaging/                          # NUEVO — feature de esta spec
│   │   ├── ports/
│   │   │   ├── message-channel.ts          # Puerto + errores confirmado/ambiguo
│   │   │   └── channel-identity-store.ts   # Resolución de destino y permisos
│   │   ├── adapters/
│   │   │   ├── telegram-message.channel.ts # Envía texto plano por Telegram
│   │   │   ├── whatsapp-cloud.channel.ts   # Envía texto por WhatsApp Cloud API
│   │   │   └── postgres-channel-identity-store.ts
│   │   ├── application/
│   │   │   ├── send-outbound-message.ts    # Caso de uso sincrónico
│   │   │   └── link-telegram-identity.ts   # Vinculación automática (FR-028)
│   │   └── domain/
│   │       ├── channel-selection.ts        # Preferencia + respaldo (puro)
│   │       └── delivery-outcome.ts         # Mapeo proveedor → estado del ledger
│   ├── calls/
│   │   └── adapters/
│   │       └── telegram-bot-api.client.ts  # MODIFICADO — se generaliza
│   └── orchestration/
│       └── domain/
│           └── turn-policy.ts              # REUTILIZADO — no se duplica
├── lib/
│   └── config.ts                           # MODIFICADO — loadMessagingChannelsConfig()
└── app/api/                                # Sin rutas nuevas en esta feature

supabase/migrations/
└── 20260818010001_channel_identity_telegram.sql   # NUEVO — aditiva

tests/
├── unit/
│   └── messaging/                          # Selección de canal, mapeo de resultados
└── integration/
    └── direct-outbound-delivery.test.ts    # Idempotencia, concurrencia, consentimiento
```

**Structure Decision**: se sigue la convención ya establecida en el repositorio —
`src/features/<dominio>/{ports,adapters,application,domain}`, verificada en `calls`,
`payments` y `orchestration`. La feature nueva es `messaging`.

No se crea un composition root: el repositorio instancia los adapters en cada route
handler (`src/app/api/agent/calls/[call_id]/dispatch/route.ts`,
`src/app/api/webhooks/voice/telegram/route.ts`). Esta feature respeta ese patrón y expone
una factory por adapter en lugar de introducir un contenedor de dependencias, que sería
una divergencia arquitectónica sin necesidad actual.

**Esta feature no expone rutas HTTP nuevas.** El caso de uso es una función interna que
consumirá la spec siguiente. Es deliberado: agregar un endpoint público de envío antes de
tener un consumidor sería superficie de ataque sin uso, y chocaría con el Principio II.

## Decisiones de diseño relevantes

### D1 — Reutilizar `evaluateTurnPolicy`, no reimplementar el gate

`turn-policy.ts` documenta en su encabezado que la lógica de bloqueo *ya vivió duplicada
una vez*, y que esa duplicación permitía responderle a un contacto bloqueado por un
camino mientras el otro lo suprimía. Reimplementar el chequeo de consentimiento en
`messaging` repetiría el defecto que ese archivo existe para cerrar.

**Decisión**: el gate de elegibilidad de envío se compone sobre `isContactBlocked()` y
`evaluateTurnPolicy()`, extendiéndolos con la dimensión de disponibilidad de canal
(ventana e identidad), que hoy no cubren. La extensión se hace por composición en
`messaging/domain`, sin modificar la política existente.

### D2 — `channel_threads` como tabla de identidades, no una tabla nueva

`channel_threads` ya guarda `(contact_id, provider, integration_id, channel,
external_conversation_id)` con el `UNIQUE` correcto. Para Telegram, el `chat_id` **es**
el identificador de conversación, así que encaja sin forzar la semántica.

**Decisión**: no se crea `contact_channel_identities`. Se usa `channel_threads` y la
migración agrega solo lo que falta: el valor `telegram` en los `CHECK` de canal y una
columna `unusable_at` para la invalidación lógica de FR-022.

Esto contradice la suposición con la que se escribió la spec (que hacía falta una tabla
nueva) y reduce el alcance de la migración de forma sustancial.

### D3 — Generalizar el cliente de Telegram existente

`TelegramBotApiClient.sendMessage` obliga hoy a pasar `correctCallbackData` e
`incorrectCallbackData`, y siempre adjunta un teclado inline de dos botones: es un
cliente de recibos de contexto, no un cliente de mensajería.

**Decisión**: hacer opcional el teclado inline para poder enviar texto plano, sin
cambiar el comportamiento de los llamadores actuales. Además, refinar la taxonomía: hoy
todo lo que no es 429 colapsa en `TELEGRAM_REJECTED`, lo que impide cumplir FR-022
(distinguir el rechazo permanente que invalida la identidad). La clasificación se hace
**por `error_code`** (401/403 permanente; 400 permanente salvo `migrate_to_chat_id`; 429
con `retry_after`; ≥500 reintentable), porque los strings de `description` no son un
contrato estable: la documentación oficial no publica tabla de errores.

**Bug latente que corrige esta tarea**: el `message_id` de Telegram es único *por chat*,
no global, y `outbound_deliveries` tiene `UNIQUE (provider, integration_id,
provider_message_id)`. Persistir el `message_id` pelado puede colisionar entre dos chats
distintos. Debe guardarse compuesto (`chatId:messageId`), como ya hace
`telegramProviderCallId()`.

**Ubicación**: el cliente se mueve a `src/features/messaging/adapters/` por pertenencia
de dominio, y `calls` pasa a importarlo desde ahí. Es un movimiento de archivo con
actualización de imports, sin cambio de comportamiento, y debe ir en su propia tarea
para que el diff quede legible.

### D4 — Envío sincrónico sobre el ledger existente, sin estados nuevos

El flujo es: `enqueue_outbound_delivery(...)` (crea la fila de entrega de forma atómica y
resuelve la idempotencia por el `UNIQUE (provider, integration_id, idempotency_key)`) →
tomar el lease en el acto con `leased_by = 'direct:<clave>'` → llamar al proveedor →
marcar el resultado.

Mapeo de resultados a los estados que ya existen:

| Resultado del proveedor | Estado | Motivo |
|---|---|---|
| Aceptado con id de mensaje | `submitted` | Aceptación del proveedor, que no es entrega — ver abajo |
| Rechazo permanente (identidad inválida) | `dead_letter` + `unusable_at` en la identidad | Reintentar no puede tener otro resultado |
| Ventana de WhatsApp cerrada (`131047`) | *ninguno* — se reintenta por otro canal | No es un fallo: es información sobre disponibilidad |
| Límite de tasa, 5xx | `failed_retryable` con `next_attempt_at` | El mecanismo de reintentos existente lo retoma |
| Timeout o error de red | `failed_retryable`, **nunca** `submitted` | Ambiguo: el mensaje pudo haber salido |

**Corrección posterior al research de APIs**: el éxito se registra como `submitted`, no
como `delivered`. WhatsApp responde `message_status: "accepted"`; HTTP 200 significa
aceptado, no entregado, y la entrega real solo la confirma un webhook de status que v1 no
procesa. Marcar `delivered` afirmaría algo que el sistema no sabe, y además chocaría con
`CHECK (state <> 'delivered' OR delivered_at IS NOT NULL)`. Usar `submitted` deja
`delivered` libre para cuando se agreguen los callbacks, sin migración.

El caso ambiguo es el importante: el sistema no puede afirmar la entrega ni reenviar a
ciegas. Queda reintentable bajo la misma clave de idempotencia, y el `UNIQUE` impide que
el reintento genere un segundo mensaje. El flujo en vivo recibe "no confirmado", que es
la verdad.

### D5 — Vinculación de identidad sobre el ingreso ya validado

FR-028 requiere capturar el `chat_id` cuando el contacto escribe al bot.
`ingestion.service.ts` ya toca `channel_threads` y `reply_window_expires_at`, así que el
punto de captura existe. La vinculación es un `INSERT ... ON CONFLICT DO NOTHING` sobre
el `UNIQUE` existente, lo que satisface la idempotencia de FR-030 por construcción.

Queda por confirmar en Fase 0 si el identificador de chat de Telegram efectivamente llega
en el payload de ingesta o si hay que propagarlo.

## Complexity Tracking

> Sin violaciones de la constitución que justificar. El gate pasa con dos condiciones
> vinculantes, ambas incorporadas al diseño y a los escenarios de prueba obligatorios.

| Decisión que suma complejidad | Por qué es necesaria | Alternativa más simple descartada porque |
|---|---|---|
| Mover `telegram-bot-api.client.ts` a `messaging` | El cliente es genérico y va a tener dos consumidores (`calls` y `messaging`) | Duplicar el cliente en `messaging` divergiría la taxonomía de errores en dos lugares, que es el defecto que D1 evita en la política de turno |
| Extender los `CHECK` de canal en cinco tablas | `telegram` no es un valor admitido hoy en `conversations`, `channel_threads`, `channel_events`, `contact_channel_permissions`, `consent_events` ni `outbound_deliveries` | Mapear Telegram al valor `whatsapp` haría indistinguibles los canales en el ledger y rompería la selección con respaldo |

## Constitution Check — re-evaluación posterior al diseño (Fase 1)

Segunda pasada, ya con `research.md`, `data-model.md` y los contratos escritos.

| Principio | Antes | Después | Qué cambió con el diseño |
|---|---|---|---|
| I. Fuente Única de Verdad | ✅ | ✅ | Sin cambios: el caso de uso vive en el orquestador y no expone endpoint. |
| II. Menor Privilegio | ✅ | ✅ **reforzado** | El diseño decidió **no** exponer ruta HTTP: no hay superficie de envío alcanzable desde afuera hasta que la spec 008 la necesite. |
| III. Identidad y 2FA | ⚪ | ⚪ | Sigue sin aplicar. |
| IV. Nunca Eliminar Datos | ✅ | ✅ | Confirmado en `data-model.md` C2: `unusable_at` / `unusable_reason`, ningún `DELETE`. |
| V. Validación de Webhooks | ⚠️ | ✅ **resuelto** | `research.md` R1.2 demostró que la vinculación de identidad **no necesita un ingreso nuevo**: reutiliza el camino de ingesta ya existente y ya validado. La condición del gate se cumple por no crear superficie, que es mejor que cumplirla validándola. |
| VI. Aislamiento de Memoria | ✅ | ✅ | El contrato del caso de uso pone la resolución por workspace como paso 1, antes de cualquier otra lectura. |
| VII. Scope Acotado | ✅ | ✅ | El puerto recibe `text` ya resuelto; no hay generación de contenido en ninguna capa. |
| VIII. Acciones Irreversibles | ⚪ | ⚪ | Sigue sin aplicar. |
| Candado sandbox (gate del proyecto) | ⚠️ | ✅ **resuelto** | Incorporado como FR-034 en la spec, como paso 2 del contrato del caso de uso y como escenario 4 de integración obligatorio. |

**Veredicto**: PASA sin excepciones pendientes. Las dos condiciones vinculantes del gate
inicial quedaron resueltas por el diseño, no diferidas a la implementación.

### Hallazgos del research que modificaron el diseño

Tres correcciones que valen la pena registrar, porque contradicen suposiciones con las
que se escribió la spec:

1. **El éxito se registra como `submitted`, no `delivered`** — HTTP 200 de WhatsApp
   significa "aceptado", y v1 no procesa callbacks de estado. Marcar `delivered` sería
   afirmar algo que el sistema no sabe.
2. **No hace falta una tabla de identidades nueva** — `channel_threads` ya tiene la forma
   exacta, con el constraint único que FR-016 pedía.
3. **El `chat_id` ya llega y ya se persiste** — lo que falta es dejar de forzar
   `channel = 'whatsapp'` en la ingesta. FR-028 pasó de ser funcionalidad nueva a un
   cambio de una línea con cobertura de no-regresión.

Las tres reducen el alcance. Ninguna afecta las garantías que la spec exige.
