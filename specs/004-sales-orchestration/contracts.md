# Contracts — congelados en Phase 0

Fuentes de verdad:

- `botpress-agent/src/schemas/contracts.ts` — Zod para el runtime de Botpress.
- `botpress-agent/src/schemas/call-events.ts` — eventos de llamada, Botpress side.
- `src/lib/contracts/inbound-envelope.ts` — Zod para Next.js.
- `src/lib/contracts/call-event.ts` — eventos de llamada, Next.js side.

Paridad se verifica con fixtures compartidos en `tests/fixtures/canonical-envelopes/` y `tests/fixtures/call-events/`.

## InboundEnvelope v1

```
schema_version: 1                         // literal
source: 'botpress'                        // literal
channel: 'emulator' | 'whatsapp'          // el canal SIEMPRE es whatsapp cuando el provider es telegram_sandbox
integration_id: string(1..512)
external_message_id: string(1..512)       // clave de idempotencia
provider_message_id?: string(1..512)
external_conversation_id: string(1..512)
external_user_id: string(1..512)
phone_e164?: string(8..16)                // E.164, validación estricta abajo en contact.service
trace_id: uuid                            // clave de correlación
message:
  type: 'text' | 'audio' | 'image' | 'unsupported'
  text: string(1..4096)                   // en audio: transcripción o marcador si falló
  occurred_at: ISO 8601 con offset
  reply_to_external_message_id: string(1..512) | null
  audio_reference: AudioReference | null  // sólo cuando type = 'audio'
  metadata: MessageMetadata               // por default {}
```

### AudioReference

```
provider_file_id: string(1..512)          // id opaco del archivo en el proveedor (nunca URL)
mime_type: string(1..128)
duration_seconds: int >= 0 | null
transcription_status: 'ok' | 'failed' | 'skipped'
transcription_provider: string(1..64) | null
```

Regla: la URL efímera del audio no viaja nunca. Si hace falta recuperar el original, el adapter del canal lo hace con `provider_file_id`.

### MessageMetadata

```
Record<
  key: string(0..64),
  value: string(0..512) | number | boolean
>
```

Deliberadamente acotado. No es un cajón de sastre.

## CallEvent v1

```
schema_version: 1
event_id: string(1..512)                  // clave de idempotencia por evento
call_id: uuid
event_type: 'requested' | 'started' | 'ended' | 'analyzed'
sequence: int >= 0                        // tolera desorden
occurred_at: ISO 8601 con offset
provider: 'telegram_sandbox' | 'retell'
payload:
  discriminated on event_type
```

### Payloads por tipo

- `requested`: `contact_id`, `conversation_id`, `reason`, `course_of_interest?`, `previous_summary?`.
- `started`: `started_at`.
- `ended`: `ended_at`, `duration_seconds`, `disconnection_reason` ∈ { `user_hangup`, `agent_hangup`, `no_answer`, `busy`, `failed_to_connect`, `voicemail`, `timed_out`, `other` }.
- `analyzed`: `analysis.{ result, nivel_interes?, objecion?, notas? }` con `result` ∈ 9 valores comerciales (venta_confirmada, link_enviado_sin_pago, seguimiento_agendado, no_interesado, derivado_humano, no_es_buen_momento, no_contactar, ya_es_alumno, no_calificado).

### Invariantes

- `event.event_type === event.payload.event_type` (validado en `superRefine`).
- Idempotencia real de DB: `UNIQUE (provider, event_id)` en `call_events`.
- `disconnection_reason` es técnico. `analysis.result` es comercial. No se confunden.
- Estados derivados (`failed`, `no_answer`, `timed_out`) NO llegan por webhook — los calcula el backend.

## Política de versión

- Cambio backward-compatible (agregar campo opcional con default): sube `MINOR` conceptual, `schema_version` sigue en 1.
- Cambio incompatible (renombrar, quitar, cambiar tipo): sube `schema_version` a 2, se mantiene el parser de v1 hasta drenar la cola.
- Todo cambio de shape se refleja simultáneamente en las dos implementaciones Zod y en los fixtures de `tests/fixtures/`. La CI rompe si driftean.

## Punto de anclaje para paridad

El test `tests/contract/zod-parity.test.ts` corre cada fixture contra el Zod de Next.js. Un script `botpress-agent/scripts/validate-fixtures.mjs` los corre contra el Zod de Botpress. Ambos deben coincidir en accept/reject para cada fixture.
