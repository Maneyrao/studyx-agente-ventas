# Spec — Sales orchestration canal-agnóstica

## Intención

Separar de forma verificable el código específico de cada canal (Telegram, Meta WhatsApp, Retell) del código que orquesta la conversación de ventas, la política, la memoria, la calificación y el pago. El día que entre WhatsApp real o Retell real, sólo cambia la implementación de un puerto y una variable de entorno.

## Fronteras channel-specific / channel-agnostic

### Se reimplementa por canal (channel-specific)

- Recepción del evento y firma del webhook.
- Resolución de identidad (Telegram user id → sandbox / tag → E.164).
- Descarga de media (getFile de Telegram / Media API de Meta).
- Mapeo de tipos de mensaje (`voice` → `audio`, etc).
- Extracción de cita / respuesta (`reply_to_message.message_id` / context tag).
- Envío de la respuesta.
- Ventana de respuesta (24 h en WhatsApp; inexistente en Telegram).
- Límites de tamaño y rate del proveedor.

### Se escribe una sola vez (channel-agnostic)

- Contrato canónico de envelope inbound (este documento).
- `processInboundTurn` y todo lo que esté detrás de `actions/` en el ADK.
- Contrato de decisión (Decision v2/v3) y `allowed_actions`.
- Motor de políticas, consentimiento, bloqueo, opt-out.
- Memoria, resúmenes, embeddings, knowledge base.
- Estado comercial, calificación, catálogo, precios.
- Pagos.
- Handoff a Agent B, modelo de eventos, post-call router.
- Regla de supresión durante llamada activa.
- Persistencia en Supabase.
- Proyección a Sheets / Excel y email.

### Trampa a nombrar

La ventana de 24 h de WhatsApp no existe en Telegram. `contact_channel_permissions.reply_window_expires_at` nunca se ejercita desde el sandbox. Mitigación (Fase 12): forzar por SQL una ventana vencida y verificar que el sistema no responde.

## Boundaries de reemplazo (columna "no se toca" en el plan)

| Frontera | Sandbox | Producción | NO se toca |
| -------- | ------- | ---------- | ---------- |
| Canal de Agent A | `channels/telegram.channel.ts` | `channels/whatsapp.channel.ts` | workflow, decisión, política, memoria, KB, ventas, pagos |
| Runtime de Agent B | `providers/voice/telegram-sim.provider.ts` | `providers/voice/retell.provider.ts` | `call.service`, modelo de eventos, post-call router, supresión |
| Identidad | `sandbox_identities` + teléfono sintético | teléfono real | `contacts`, `conversations`, `messages` |
| Pagos | `providers/payments/fake.provider.ts` | `providers/payments/<psp>.provider.ts` | estado de pago, fulfillment |
| Proyección | `providers/sheets/xlsx-file.provider.ts` | `providers/sheets/google-sheets.provider.ts` | outbox, `projection.service` |

## Identidad durante el sandbox

- Teléfono sintético con prefijo `+999` + Telegram user id padded a 10 dígitos (13 dígitos totales; E.164 estricto).
- Tabla `sandbox_identities (provider, external_user_id, contact_id, synthetic_phone)` con `provider LIKE '%_sandbox'` como constraint.
- `contacts` no cambia de forma. `provider` = `'telegram_sandbox'` en `channel_events` y `channel_threads` para aislar unicidad.
- Candado: ninguna acción con efecto real (Retell, Stripe, WhatsApp outbound, Sheets prod) sobre un `contact_id` presente en `sandbox_identities`.

## Los dos bots de Telegram

- **Bot A** reemplaza WhatsApp. Vive en Botpress (`botpress-agent/src/channels/`). Token `TELEGRAM_BOT_A_TOKEN`. Webhook a Botpress. Puebla `sandbox_identities`.
- **Bot B** reemplaza Retell. Vive en el backend (`src/lib/providers/voice/telegram-sim.provider.ts`). Token `TELEGRAM_BOT_B_TOKEN`. Webhook a `/api/webhooks/voice/telegram`. Nunca entra al inbound de Agent A. Nunca crea contactos.

## Eventos de Agent B (corrección del modelo del plan)

Los únicos eventos que un proveedor emite (Retell o simulador de Telegram): `requested`, `started`, `ended`, `analyzed`. Estados derivados por el backend: `failed`, `no_answer`, `timed_out`. Idempotencia por `(provider, event_id)`. `ended` sin `started` previo se resuelve como `failed`. `derivado_humano` como resultado se trata como `no_contactar` con marca en la oportunidad (no hay mano humana en el flujo).

## Invariantes de contrato

- `schema_version` obligatorio en cada envelope y evento.
- Un `external_message_id` no puede procesarse dos veces (idempotencia).
- Un envelope sin `trace_id` UUID válido se rechaza (correlación).
- La URL efímera del audio nunca viaja en el contrato; sólo `provider_file_id`.
- `metadata` es acotada: claves ≤ 64 chars, valores string ≤ 512 chars o número o booleano.
