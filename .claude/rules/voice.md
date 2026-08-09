---
paths:
  - "src/lib/providers/voice/**"
  - "src/app/api/webhooks/voice/**"
  - "src/lib/services/call.service.ts"
  - "src/lib/contracts/voice.ts"
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
