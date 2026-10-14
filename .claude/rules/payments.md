---
paths:
  - "src/lib/providers/payments/**"
  - "src/app/api/payments/**"
  - "src/app/api/webhooks/payments/**"
  - "src/lib/services/payment.service.ts"
  - "src/lib/contracts/payments.ts"
---

# Pagos — reglas de subsistema

## Invariantes
- Una redirección de navegador NUNCA es prueba de pago.
- Pago confirmado sólo por webhook firmado Y verificado contra la API del PSP.
- Deduplicar webhooks por `provider + event_id`.
- Checkout idempotente por `opportunity_id + action + version`.
- Sólo se emite cobro sobre una oferta con producto, precio, moneda y
  condiciones confirmadas desde el catálogo. El modelo nunca redacta un precio.
- Nunca cobrar a un contacto con fila en `sandbox_identities`.
- Descuento, reembolso o excepción: no automatizable en esta etapa.
- A puede seleccionar un plan canónico y pedir su enlace en un mismo turno.
  No exigir una fase previa ni reinterpretar esa selección mediante regex.
  `request_payment_link` sin `select_payment_plan` usa la selección durable;
  un campo incidental del modelo no reemplaza un plan confirmado.
- Una continuación con `conversation_only=true` persiste plan e intención
  pendiente, pero no crea checkout, llamada ni enlace de prueba.

## Estados
`not_created -> pending -> paid | failed | expired | refunded`
Fulfillment separado: `not_requested -> requested -> completed | failed`.
