---
paths:
  - "src/lib/providers/voice/**"
  - "src/app/api/webhooks/voice/**"
  - "src/lib/services/call.service.ts"
  - "src/lib/contracts/voice.ts"
  - "src/features/calls/**"
  - "src/app/api/agent/calls/**"
---

# Agent B / Retell — reglas de subsistema

## Lo que Retell emite realmente (verificado en su doc)
`call_started`, `call_ended`, `call_analyzed`, `transcript_updated`.

## Trampas que el modelo de eventos DEBE respetar
- NO existe evento `ringing`. No modelarlo.
- NO existe evento `failed`. Una llamada fallida es `call_ended` SIN
  `call_started` previo. `failed` es un estado DERIVADO, no un evento.
- Si la llamada no conecta, `call_started` no se dispara pero `call_ended` y
  `call_analyzed` sí. Nunca asumir `started` antes de `ended`.
- El resultado de negocio llega en `call_analyzed` (campo `call_analysis`),
  no en `call_ended`.
- Retell reintenta hasta 3 veces (timeout 10 s). Los duplicados son esperables.
  Idempotencia por `event_type + call_id`. Tolerar desorden vía `sequence`.
- Firma: header `x-retell-signature`. Verificar antes de procesar.

## Invariantes
- El post-call router emite EXACTAMENTE UNA acción de seguimiento por llamada.
  Un `analyzed` posterior actualiza el registro, no dispara otra acción.
- Con llamada en `started`, `/api/agent/ingest` devuelve `may_respond = false`.
  Agent A suprime y no compite con la voz. Agent A no tiene lógica de llamadas.
- Sin consentimiento de llamada o sin teléfono verificado: `request_call` se rechaza.
- `derivado_humano` no dispara contacto humano (no existe): se trata como
  `no_contactar` + marca en la oportunidad.
- Separar `disconnection_reason` (técnico: buzón, cortó) de `result` (comercial).

## Despacho canónico
- `call_sessions` es la autoridad del despacho. Construir el proveedor después
  de adquirir `claimDispatch`: un error previo a la petición es un fallo
  confirmado; un resultado incierto conserva `dispatch_ambiguous`.
- Un rechazo puede no producir webhook. Ejecutar `runPostCallFollowup` al
  confirmar `failed`, conservando la clave `post-call:<call_id>` y el marcador
  `system:call_result:<call_id>` para no duplicar avisos con replay o webhook.
- Agent A redacta el seguimiento con su prompt canónico y el workspace de la
  llamada; no existe `renderPostCallFollowup` ni un reemplazo textual del
  backend. Conservar la primera redacción y sus hechos de egress antes del
  envío. Si el modelo falla, dejar recuperación pendiente.
- Generar el seguimiento con `after` de Next después de responder al
  despacho/webhook; el modelo puede demorar más que el timeout del caller.
