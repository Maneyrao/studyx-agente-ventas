# Transcripciones del candidato por workflow real

**Proveedor fixture, sin llamadas pagas.** Textos simulados para comprobar contratos; no son evaluación de naturalidad. Backend Next build de producción local, PostgreSQL aislado y captura de adaptador. Ningún mensaje de esta corrida salió a Telegram.

Fuente completa: `workflow-deterministic-outcomes-2026-09-04T14-00-11-856Z-ddcfbbea-98e1-404f-b678-38fb675d8597.json.gz`, SHA-256 original `e88d094d40d4bc7c9883a9635bf612af97de27d0234db0ef91981ef4cabc78e9`.

## Turno 1

Cliente: Me interesa Redes Informáticas

Propuesta antes de validar:
> Hola, ¿qué te gustaría aprender en esta formación?

Salida del adaptador:
> Hola, ¿qué te gustaría aprender en esta formación?

Turno `c7a4d205-4641-452b-aad3-3b7e55e2be10` · trace `ca6ad886-5a38-43e8-8a51-f9dc9dc9683e` · outbound `462f01e9-4c50-4411-986d-740d0ea993b0` · estado `submitted_to_botpress` · latencia local 1210 ms.

Decisión persistida: `AGENT_A_PLANNERLESS_V2`; acción `null`.

## Turno 2

Cliente: Mejor prefiero Excel Integral

Propuesta antes de validar:
> ¿Qué uso te gustaría darle a lo que aprendas?

Salida del adaptador:
> ¿Qué uso te gustaría darle a lo que aprendas?

Turno `ae69734b-b7a0-4568-bd52-35f472ed6286` · trace `99ec2a5e-07f2-4972-9580-0f11e9898168` · outbound `a69000f5-9fd9-43c4-b39a-5123cdd2a138` · estado `submitted_to_botpress` · latencia local 1043 ms.

Decisión persistida: `AGENT_A_PLANNERLESS_V2`; acción `null`.

## Turno 3

Cliente: No quiero llamadas, sigamos por chat

Propuesta antes de validar:
> Seguimos por acá. ¿Qué dudas te quedan?

Salida del adaptador:
> Seguimos por acá. ¿Qué dudas te quedan?

Turno `09b8b65c-0e53-4688-b2c3-798fd4320f8b` · trace `c6683ef9-e1e2-4bff-9ea3-577ed19b8dc0` · outbound `fea363ea-e747-41ae-9d97-d2334352c133` · estado `submitted_to_botpress` · latencia local 1042 ms.

Decisión persistida: `AGENT_A_PLANNERLESS_V2`; acción `null`.

## Turno 4

Cliente: Elijo las seis cuotas

Propuesta antes de validar:
> ¿Querés que te prepare el enlace para avanzar?

Salida del adaptador:
> ¿Querés que te prepare el enlace para avanzar?

Turno `d2673f22-5301-45ad-8b5c-84b2ae1cadc0` · trace `31f60ca6-96b8-471a-aa51-8b81e5cc2057` · outbound `3776375b-008d-45ef-87c2-e39ea6b07a6a` · estado `submitted_to_botpress` · latencia local 1040 ms.

Decisión persistida: `AGENT_A_PLANNERLESS_V2`; acción `null`.

## Turno 5

Cliente: Soy Celina Duarte, celina.duarte@example.test, teléfono +1 305 555 0158

Propuesta antes de validar:
> Gracias por compartir tus datos. ¿Deseás avanzar con el pago?

Salida del adaptador:
> Gracias por compartir tus datos. ¿Deseás avanzar con el pago?

Turno `69bfd1ee-343b-4484-ae79-8df27d2062af` · trace `36eaaae9-98b4-462e-b1ab-5c73942aa450` · outbound `c6522974-1911-4d15-84d8-09f50617ef27` · estado `submitted_to_botpress` · latencia local 1056 ms.

Decisión persistida: `AGENT_A_PLANNERLESS_V2`; acción `null`.

## Turno 6

Cliente: Por ahora lo dejo para la semana próxima

Propuesta antes de validar:
> Podés retomarlo cuando te resulte cómodo.

Salida del adaptador:
> Podés retomarlo cuando te resulte cómodo.

Turno `80a6c85b-0a51-47d7-b087-a381e68ec7a9` · trace `95c72f73-65ee-4440-bbe9-8c0c215b39a5` · outbound `c2663337-25ed-499f-9474-54182f0626be` · estado `submitted_to_botpress` · latencia local 1040 ms.

Decisión persistida: `AGENT_A_PLANNERLESS_V2`; acción `null`.

## Turno 7

Cliente: Ahora sí, enviame el link de las seis cuotas

Propuesta antes de validar:
> Acá tenés el enlace para avanzar con el pago.

Salida del adaptador:
> Acá tenés el enlace para avanzar con el pago.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Turno `699261c3-a348-4551-b6e0-a1c5ce3c2b33` · trace `a5074769-8384-4e28-9a3a-6cf312ede8d0` · outbound `27ffe725-18bb-46ea-90c6-e9d67c26d5be` · estado `submitted_to_botpress` · latencia local 1038 ms.

Decisión persistida: `AGENT_A_PLANNERLESS_V2`; acción `send_payment_link`.

## Turno 8

Cliente: Ya realicé el pago

Propuesta antes de validar:
> Gracias por avisar. El pago todavía necesita verificarse.

Salida del adaptador:
> Gracias por avisar. El pago todavía necesita verificarse.

Turno `9144edf5-5a86-4c31-a522-3fde2b745ecc` · trace `79f97327-dd67-4aa0-ba3e-e352eb859544` · outbound `6ebdb356-7720-4918-926f-0921e3150b76` · estado `submitted_to_botpress` · latencia local 1042 ms.

Decisión persistida: `AGENT_A_PLANNERLESS_V2`; acción `null`.

## Turno 9

Cliente: No me escribas más, quiero que me den de baja

Salida del adaptador:
> Listo, no te enviaremos más mensajes.

Turno `63fabeec-2f74-476a-955b-80b2615a50ac` · trace `4b54dac7-5061-4cc5-a84e-7c46b981a03e` · outbound `965d90b1-1d16-41ab-97f9-27511d36d145` · estado `submitted_to_botpress` · latencia local 1028 ms.

Decisión persistida: `EXPLICIT_OPT_OUT_ACK`; acción `null`.

## Turno 10

Cliente: ¿Y cuánto sale el curso?

Salida del adaptador:
*(silencio; ver motivo persistido)*

Turno `6127d3c2-05f0-4749-97d4-6f6f4e4c0911` · trace `5f8cd94d-f790-45ef-8a83-7073159b7177` · outbound `null` · estado `null` · latencia local 1030 ms.

Decisión persistida: `CONSENT_REVOKED`; acción `null`.

## Replay del link

Mismo turno `699261c3-a348-4551-b6e0-a1c5ce3c2b33` y outbound `27ffe725-18bb-46ea-90c6-e9d67c26d5be`. Capturas nuevas: 0; HTTP al modelo: 0.

## Persistencia final

```json
{
  "contact": {
    "phone": "+9998530401089",
    "declaredPhone": "+13055550158",
    "name": "Celina Duarte",
    "email": "celina.duarte@example.test",
    "lifecycleStatus": "active",
    "blockedAt": null,
    "phoneIsSynthetic": true
  },
  "permission": {
    "consentStatus": "revoked",
    "evidenceEventId": "2eb8570c-26c9-4444-b819-40585d6fe419",
    "revokedAt": "2026-09-04T14:00:09.752Z",
    "revokedTurnId": "63fabeec-2f74-476a-955b-80b2615a50ac"
  },
  "state": {
    "selectedOfferingCode": "excel_integral",
    "selectedPaymentPlan": "monthly_6",
    "stage": "payment_link_sent",
    "callPreference": "chat",
    "callOfferStatus": "declined",
    "callOfferCount": 0,
    "awaitingReply": "none",
    "paymentReportedAt": "2026-09-04T14:00:09.709Z",
    "humanReviewRequestedAt": null
  },
  "decisions": [
    {
      "turnId": "c7a4d205-4641-452b-aad3-3b7e55e2be10",
      "outboundId": "462f01e9-4c50-4411-986d-740d0ea993b0",
      "createdAt": "2026-09-04T14:00:02.249Z",
      "reasonCode": "AGENT_A_PLANNERLESS_V2",
      "responseType": "commercial_reply",
      "hasResponse": true,
      "businessActionType": null,
      "promptVersion": "studyx-agent-a-brain-v14",
      "modelName": "deepseek-v4-flash"
    },
    {
      "turnId": "ae69734b-b7a0-4568-bd52-35f472ed6286",
      "outboundId": "a69000f5-9fd9-43c4-b39a-5123cdd2a138",
      "createdAt": "2026-09-04T14:00:03.346Z",
      "reasonCode": "AGENT_A_PLANNERLESS_V2",
      "responseType": "commercial_reply",
      "hasResponse": true,
      "businessActionType": null,
      "promptVersion": "studyx-agent-a-brain-v14",
      "modelName": "deepseek-v4-flash"
    },
    {
      "turnId": "09b8b65c-0e53-4688-b2c3-798fd4320f8b",
      "outboundId": "fea363ea-e747-41ae-9d97-d2334352c133",
      "createdAt": "2026-09-04T14:00:04.404Z",
      "reasonCode": "AGENT_A_PLANNERLESS_V2",
      "responseType": "commercial_reply",
      "hasResponse": true,
      "businessActionType": null,
      "promptVersion": "studyx-agent-a-brain-v14",
      "modelName": "deepseek-v4-flash"
    },
    {
      "turnId": "d2673f22-5301-45ad-8b5c-84b2ae1cadc0",
      "outboundId": "3776375b-008d-45ef-87c2-e39ea6b07a6a",
      "createdAt": "2026-09-04T14:00:05.459Z",
      "reasonCode": "AGENT_A_PLANNERLESS_V2",
      "responseType": "commercial_reply",
      "hasResponse": true,
      "businessActionType": null,
      "promptVersion": "studyx-agent-a-brain-v14",
      "modelName": "deepseek-v4-flash"
    },
    {
      "turnId": "69bfd1ee-343b-4484-ae79-8df27d2062af",
      "outboundId": "c6522974-1911-4d15-84d8-09f50617ef27",
      "createdAt": "2026-09-04T14:00:06.533Z",
      "reasonCode": "AGENT_A_PLANNERLESS_V2",
      "responseType": "commercial_reply",
      "hasResponse": true,
      "businessActionType": null,
      "promptVersion": "studyx-agent-a-brain-v14",
      "modelName": "deepseek-v4-flash"
    },
    {
      "turnId": "80a6c85b-0a51-47d7-b087-a381e68ec7a9",
      "outboundId": "c2663337-25ed-499f-9474-54182f0626be",
      "createdAt": "2026-09-04T14:00:07.594Z",
      "reasonCode": "AGENT_A_PLANNERLESS_V2",
      "responseType": "commercial_reply",
      "hasResponse": true,
      "businessActionType": null,
      "promptVersion": "studyx-agent-a-brain-v14",
      "modelName": "deepseek-v4-flash"
    },
    {
      "turnId": "699261c3-a348-4551-b6e0-a1c5ce3c2b33",
      "outboundId": "27ffe725-18bb-46ea-90c6-e9d67c26d5be",
      "createdAt": "2026-09-04T14:00:08.643Z",
      "reasonCode": "AGENT_A_PLANNERLESS_V2",
      "responseType": "commercial_reply",
      "hasResponse": true,
      "businessActionType": "send_payment_link",
      "promptVersion": "studyx-agent-a-brain-v14",
      "modelName": "deepseek-v4-flash"
    },
    {
      "turnId": "9144edf5-5a86-4c31-a522-3fde2b745ecc",
      "outboundId": "6ebdb356-7720-4918-926f-0921e3150b76",
      "createdAt": "2026-09-04T14:00:09.709Z",
      "reasonCode": "AGENT_A_PLANNERLESS_V2",
      "responseType": "commercial_reply",
      "hasResponse": true,
      "businessActionType": null,
      "promptVersion": "studyx-agent-a-brain-v14",
      "modelName": "deepseek-v4-flash"
    },
    {
      "turnId": "63fabeec-2f74-476a-955b-80b2615a50ac",
      "outboundId": "965d90b1-1d16-41ab-97f9-27511d36d145",
      "createdAt": "2026-09-04T14:00:10.763Z",
      "reasonCode": "EXPLICIT_OPT_OUT_ACK",
      "responseType": "opt_out_ack",
      "hasResponse": true,
      "businessActionType": null,
      "promptVersion": "studyx-agent-a-sales-v17",
      "modelName": "deterministic:opt-out-ack-v1"
    },
    {
      "turnId": "6127d3c2-05f0-4749-97d4-6f6f4e4c0911",
      "outboundId": null,
      "createdAt": "2026-09-04T14:00:11.834Z",
      "reasonCode": "CONSENT_REVOKED",
      "responseType": null,
      "hasResponse": false,
      "businessActionType": null,
      "promptVersion": "studyx-agent-a-sales-v17",
      "modelName": "policy:opt-out"
    }
  ],
  "outbound": [
    {
      "externalConversationId": "wfd-8859d36c-dd6f-4002-a26f-77fb8a7a9146",
      "id": "462f01e9-4c50-4411-986d-740d0ea993b0",
      "turnId": "c7a4d205-4641-452b-aad3-3b7e55e2be10",
      "traceId": "ca6ad886-5a38-43e8-8a51-f9dc9dc9683e",
      "authorizedOutboundId": "462f01e9-4c50-4411-986d-740d0ea993b0",
      "content": "Hola, ¿qué te gustaría aprender en esta formación?",
      "deliveryState": "submitted",
      "providerMessageId": "71df5b72-7728-4799-9a9c-e47288b093c9"
    },
    {
      "externalConversationId": "wfd-8859d36c-dd6f-4002-a26f-77fb8a7a9146",
      "id": "a69000f5-9fd9-43c4-b39a-5123cdd2a138",
      "turnId": "ae69734b-b7a0-4568-bd52-35f472ed6286",
      "traceId": "99ec2a5e-07f2-4972-9580-0f11e9898168",
      "authorizedOutboundId": "a69000f5-9fd9-43c4-b39a-5123cdd2a138",
      "content": "¿Qué uso te gustaría darle a lo que aprendas?",
      "deliveryState": "submitted",
      "providerMessageId": "5b75137a-568c-48a5-9c8b-2cd88e8da9eb"
    },
    {
      "externalConversationId": "wfd-8859d36c-dd6f-4002-a26f-77fb8a7a9146",
      "id": "fea363ea-e747-41ae-9d97-d2334352c133",
      "turnId": "09b8b65c-0e53-4688-b2c3-798fd4320f8b",
      "traceId": "c6683ef9-e1e2-4bff-9ea3-577ed19b8dc0",
      "authorizedOutboundId": "fea363ea-e747-41ae-9d97-d2334352c133",
      "content": "Seguimos por acá. ¿Qué dudas te quedan?",
      "deliveryState": "submitted",
      "providerMessageId": "e65ea9e5-d687-4a33-8833-a992449d5260"
    },
    {
      "externalConversationId": "wfd-8859d36c-dd6f-4002-a26f-77fb8a7a9146",
      "id": "3776375b-008d-45ef-87c2-e39ea6b07a6a",
      "turnId": "d2673f22-5301-45ad-8b5c-84b2ae1cadc0",
      "traceId": "31f60ca6-96b8-471a-aa51-8b81e5cc2057",
      "authorizedOutboundId": "3776375b-008d-45ef-87c2-e39ea6b07a6a",
      "content": "¿Querés que te prepare el enlace para avanzar?",
      "deliveryState": "submitted",
      "providerMessageId": "014b763f-9e19-40e8-b0a4-8b7322f5a8f2"
    },
    {
      "externalConversationId": "wfd-8859d36c-dd6f-4002-a26f-77fb8a7a9146",
      "id": "c6522974-1911-4d15-84d8-09f50617ef27",
      "turnId": "69bfd1ee-343b-4484-ae79-8df27d2062af",
      "traceId": "36eaaae9-98b4-462e-b1ab-5c73942aa450",
      "authorizedOutboundId": "c6522974-1911-4d15-84d8-09f50617ef27",
      "content": "Gracias por compartir tus datos. ¿Deseás avanzar con el pago?",
      "deliveryState": "submitted",
      "providerMessageId": "15198c08-d0d4-48a0-92b4-3fd7828054c9"
    },
    {
      "externalConversationId": "wfd-8859d36c-dd6f-4002-a26f-77fb8a7a9146",
      "id": "c2663337-25ed-499f-9474-54182f0626be",
      "turnId": "80a6c85b-0a51-47d7-b087-a381e68ec7a9",
      "traceId": "95c72f73-65ee-4440-bbe9-8c0c215b39a5",
      "authorizedOutboundId": "c2663337-25ed-499f-9474-54182f0626be",
      "content": "Podés retomarlo cuando te resulte cómodo.",
      "deliveryState": "submitted",
      "providerMessageId": "ec0e9445-9690-4f3c-8e56-7450e47d467b"
    },
    {
      "externalConversationId": "wfd-8859d36c-dd6f-4002-a26f-77fb8a7a9146",
      "id": "27ffe725-18bb-46ea-90c6-e9d67c26d5be",
      "turnId": "699261c3-a348-4551-b6e0-a1c5ce3c2b33",
      "traceId": "a5074769-8384-4e28-9a3a-6cf312ede8d0",
      "authorizedOutboundId": "27ffe725-18bb-46ea-90c6-e9d67c26d5be",
      "content": "Acá tenés el enlace para avanzar con el pago.\n\n6 pagos mensuales de USD 60: https://example.invalid/eval/6m",
      "deliveryState": "submitted",
      "providerMessageId": "67735427-1295-424d-9614-a3a1ee9594f6"
    },
    {
      "externalConversationId": "wfd-8859d36c-dd6f-4002-a26f-77fb8a7a9146",
      "id": "6ebdb356-7720-4918-926f-0921e3150b76",
      "turnId": "9144edf5-5a86-4c31-a522-3fde2b745ecc",
      "traceId": "79f97327-dd67-4aa0-ba3e-e352eb859544",
      "authorizedOutboundId": "6ebdb356-7720-4918-926f-0921e3150b76",
      "content": "Gracias por avisar. El pago todavía necesita verificarse.",
      "deliveryState": "submitted",
      "providerMessageId": "b264c63b-3ad0-48e5-9db7-36f12d0d74e0"
    },
    {
      "externalConversationId": "wfd-8859d36c-dd6f-4002-a26f-77fb8a7a9146",
      "id": "965d90b1-1d16-41ab-97f9-27511d36d145",
      "turnId": "63fabeec-2f74-476a-955b-80b2615a50ac",
      "traceId": "4b54dac7-5061-4cc5-a84e-7c46b981a03e",
      "authorizedOutboundId": "965d90b1-1d16-41ab-97f9-27511d36d145",
      "content": "Listo, no te enviaremos más mensajes.",
      "deliveryState": "submitted",
      "providerMessageId": "d796ef65-55cf-421c-b619-5d65c775a2ba"
    }
  ],
  "outboundCount": 9,
  "deliveryStates": [
    "submitted",
    "submitted",
    "submitted",
    "submitted",
    "submitted",
    "submitted",
    "submitted",
    "submitted",
    "submitted"
  ],
  "recordedLinks": [
    "https://example.invalid/eval/6m"
  ],
  "deliveredLinks": [
    "https://example.invalid/eval/6m"
  ],
  "deliveryScope": "local_adapter"
}
```

## Caída del proveedor detectada

Fuente: `workflow-deterministic-unavailable-2026-09-04T14-00-12-900Z-a7dee92b-e17e-486f-a474-5710cb7190ce.json.gz`; SHA-256 original `5e57cc3b1f9207bed3244a7e6c4f2eb466feb2b008b17703a80e76f264669068`.

Se inyectó HTTP 503 en la frontera DeepSeek. No hubo respuesta visible; la decisión silenciosa segura se conserva como un fallo de disponibilidad, sin aprobación de atención.

```json
{
  "metrics": {
    "observed_turns": 1,
    "duplicate_traces_ignored": 0,
    "eligible_model_turns": 1,
    "live_model_turns": 0,
    "fixture_model_turns": 1,
    "unknown_provider_model_turns": 0,
    "http_attempts": 1,
    "http_failed_attempts": 1,
    "usage_missing_attempts": 1,
    "cached_usage_missing_attempts": 1,
    "known_input_tokens": null,
    "known_cached_input_tokens": null,
    "known_output_tokens": null,
    "repair_attempted_turns": 0,
    "repair_successful_turns": 0,
    "repair_outcome_unknown_turns": 0,
    "repair_rate": 0,
    "repair_success_rate": null,
    "technical_fallback_turns": 1,
    "technical_fallback_rate": 1,
    "availability_failed_turns": 1,
    "availability_unknown_turns": 0,
    "latency_sample_count": 1,
    "latency_missing_turns": 0,
    "p50_ms": 1025,
    "p95_ms": 1025,
    "gates": {
      "p95_below_6000ms": true,
      "repair_rate_at_most_5_percent": true,
      "repair_success_at_least_80_percent": null,
      "fallback_rate_at_most_2_percent": false,
      "availability_failures_zero": false
    },
    "numeric_gates_passed": false,
    "quality_ready": false,
    "production_ready": false,
    "stability_certified": false,
    "limitations": [
      "STABILITY_NOT_CERTIFIED",
      "NATURALNESS_AND_REMOTE_DELIVERY_NOT_EVALUATED",
      "NO_LIVE_MODEL_SAMPLE",
      "FIXTURE_SAMPLE_NOT_VALID_FOR_QUALITY",
      "NO_REPAIR_SAMPLE",
      "USAGE_INCOMPLETE_NOT_ZERO_COST"
    ]
  },
  "decisions": [
    {
      "turnId": "c2c1f6be-a9ac-440e-9028-63508e5d4bc5",
      "outboundId": null,
      "createdAt": "2026-09-04T14:00:12.883Z",
      "reasonCode": "BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK",
      "responseType": null,
      "hasResponse": false,
      "businessActionType": null,
      "promptVersion": "studyx-conversation-interpreter-v1.7+studyx-conversation-composer-v2+studyx-sales-behavior-v1",
      "modelName": "policy:conversation-pipeline-v1-unavailable"
    }
  ],
  "capture_count": 0
}
```

## Métricas del recorrido comercial

```json
{
  "observed_turns": 10,
  "duplicate_traces_ignored": 0,
  "eligible_model_turns": 8,
  "live_model_turns": 0,
  "fixture_model_turns": 8,
  "unknown_provider_model_turns": 0,
  "http_attempts": 8,
  "http_failed_attempts": 0,
  "usage_missing_attempts": 0,
  "cached_usage_missing_attempts": 8,
  "known_input_tokens": 0,
  "known_cached_input_tokens": null,
  "known_output_tokens": 0,
  "repair_attempted_turns": 0,
  "repair_successful_turns": 0,
  "repair_outcome_unknown_turns": 0,
  "repair_rate": 0,
  "repair_success_rate": null,
  "technical_fallback_turns": 0,
  "technical_fallback_rate": 0,
  "availability_failed_turns": 0,
  "availability_unknown_turns": 0,
  "latency_sample_count": 8,
  "latency_missing_turns": 0,
  "p50_ms": 1042,
  "p95_ms": 1210,
  "gates": {
    "p95_below_6000ms": true,
    "repair_rate_at_most_5_percent": true,
    "repair_success_at_least_80_percent": null,
    "fallback_rate_at_most_2_percent": true,
    "availability_failures_zero": true
  },
  "numeric_gates_passed": null,
  "quality_ready": false,
  "production_ready": false,
  "stability_certified": false,
  "limitations": [
    "STABILITY_NOT_CERTIFIED",
    "NATURALNESS_AND_REMOTE_DELIVERY_NOT_EVALUATED",
    "NO_LIVE_MODEL_SAMPLE",
    "FIXTURE_SAMPLE_NOT_VALID_FOR_QUALITY",
    "NO_REPAIR_SAMPLE"
  ]
}
```
