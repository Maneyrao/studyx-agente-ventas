# CONTRATO HIPOTÉTICO — Señal de Agente B → Orquestador

> **Estado 22-08-2026:** fuera del camino crítico. Retell no existe todavía y este contrato no debe implementarse ahora. Sólo se conserva como referencia para un smoke sintético de llamadas. La ejecución vigente está definida en `docs/contracts/agent-a-operational-mvp.md`.

Este archivo es la única fuente de verdad para esta feature. Los agentes de ejecución no leen `specs/`, `docs/superpowers/`, `README.md` ni documentos de análisis. Si algo no está definido aquí, paran y reportan; no infieren.

## 0. Decisiones cerradas

- El Agente B no ejecuta acciones de negocio: sólo emite una señal.
- El Agente A/orquestador decide, registra y ejecuta.
- B expone una sola herramienta; se eliminan las ocho herramientas de voz anteriores.
- Sólo `intencion_compra` genera un outbound en esta fase.
- A envía el link sin repetir precio, certificados, títulos, clases semanales ni credenciales.
- Existen exactamente tres planes: `12m`, `6m` y `contado`.
- Las tres URLs de pago ya fueron provistas por el dueño; se inyectan por entorno y nunca se escriben en prompts ni código.
- El alta al campus es manual. El sistema deja `estado_alta=pendiente_operador`.
- La proyección de esta fase es un `.xlsx` local de smoke; no se considera almacenamiento durable en Vercel.
- El endpoint de señal no espera el envío físico. Registra y encola en menos de 2 segundos.

## 1. Endpoint

`POST /api/agent-b/signal`

Headers obligatorios:

- `x-studyx-tools-secret`: igual a `AGENT_B_TOOLS_SECRET`; distinto de `STUDYX_SIGNING_SECRET`.
- `idempotency-key`: obligatorio porque Retell puede reintentar.
- `content-type: application/json`.

Body:

```json
{
  "call_id": "7f3a9c2e-1111-4222-8333-123456789abc",
  "conversation_id": "c_9182",
  "signal": "intencion_compra",
  "nivel_interes": "alto",
  "curso_interes": "reparacion-de-celulares",
  "plan": "12m",
  "email_lead": "juan@gmail.com",
  "objecion": "precio",
  "observaciones": "Cobra el viernes",
  "emitted_at": "2026-08-22T18:04:11Z"
}
```

Obligatorios: `call_id`, `signal`, `emitted_at`. `call_id` es el UUID interno de `call_sessions.id` que A entrega a Retell como variable dinámica; no es `provider_call_id`. `observaciones` admite como máximo 280 caracteres. `nivel_interes`, `curso_interes`, `plan`, `email_lead`, `objecion` y `conversation_id` admiten `null`; `conversation_id` es sólo fallback de auditoría.

Respuesta aceptada:

```json
{
  "ok": true,
  "signal_id": "c4ce08a4-fcc8-46a1-a367-4d98bd664213",
  "accepted": true,
  "next_action": "enviar_link_pago",
  "reason": null
}
```

`signal_id` es el UUID de `channel_events.id`; no existe ni se crea una tabla separada de señales.

Códigos:

| Situación | HTTP | Resultado |
|---|---:|---|
| Señal válida y llamada `in_progress` | 200 | `accepted:true` |
| Replay con misma idempotency key | 200 | mismos IDs, cero efectos nuevos |
| Secreto inválido | 401 | sin escritura |
| Body inválido | 422 | `accepted:false` |
| Llamada inexistente o cerrada | 409 | `reason:call_not_active` |
| Contacto bloqueado o sin consentimiento | 200 | `reason:contact_not_contactable` |
| Plan sin URL | 200 | `reason:plan_not_configured` |

## 2. Señales y acciones determinísticas

| `signal` | Acción | Proyección |
|---|---|---|
| `intencion_compra` | `enviar_link_pago` | `etapa=proposal`, `estado_pago=pendiente` |
| `objecion_precio` | `ninguna` | `etapa=proposal`, `objecion=precio` |
| `seguimiento` | `ninguna` | etapa sin cambio, `proximo_contacto` |
| `no_interesado` | `ninguna` | `etapa=lost` |
| `no_contactar` | `ninguna` | `etapa=lost` y revocación append-only |
| `ya_es_alumno` | `ninguna` | `etapa=out_of_funnel` |

El mapeo vive en una constante de dominio. Ningún modelo elige la acción.

## 3. Persistencia e idempotencia

Se reutiliza el mecanismo de la spec 007:

1. `channel_events.event_kind='system_buy_signal'`.
2. `external_event_id='system:buy_signal:<call_id>:<idempotency-key>'`.
3. La UNIQUE existente da idempotencia.
4. Se crea un `messages` inbound sintético vinculado al evento.
5. Se llama a `commitAgentDecision` con una decisión determinística.
6. Se encola la proyección a Excel.

Prohibido crear una tabla paralela de decisiones, editar migraciones existentes o crear otro camino de mensajes canónicos.

### 3.1 Corrección obligatoria: entrega física diferida

El estado actual no posee un consumidor productivo del outbox para turnos sintéticos. `commitAgentDecision` crea y actualmente toma una lease suponiendo que el workflow Botpress llamante enviará inmediatamente. Eso no ocurre en `POST /api/agent-b/signal`.

La implementación debe:

- Añadir a `commitAgentDecision` un modo explícito `inline_botpress | deferred_outbox`; el default sigue siendo `inline_botpress` para no cambiar Agent A.
- Para la señal de B usar `deferred_outbox`: decisión, outbound, delivery y outbox quedan atómicamente creados, pero no tomados por un workflow inexistente.
- Un worker protegido por `CRON_SECRET` reclama el outbox con `SKIP LOCKED`, revalida bloqueo/consentimiento y envía mediante `@botpress/client` usando el `external_conversation_id` canónico.
- Tras `createMessage`, registrar la entrega con `recordDeliveryReport` y el `provider_message_id` real.
- Un timeout después de iniciar el envío es ambiguo: se pausa para reconciliación, nunca se reenvía a ciegas.
- B nunca recibe credenciales de Botpress ni escribe en el canal.

Un smoke que sólo encuentre `outbound_messages` en PostgreSQL no prueba entrega. Debe existir un gate adicional con Telegram Development que confirme un mensaje físico y su `delivery_report`.

## 4. Mensaje fijo de A

```text
{nombre}, te dejo el link para inscribirte en {curso} con el plan {plan_label}:
{link}

Cualquier duda me escribís por acá.
```

`plan_label`: `12 cuotas`, `6 cuotas`, `pago único`.

Reglas duras:

- Ningún número de precio.
- Ninguna mención de certificados o títulos.
- Ninguna mención de clases en vivo semanales.
- Ningún link hardcodeado en prompt o código.
- Ninguna credencial de acceso.

## 5. Resolver de links

```ts
resolvePaymentLink({ plan, curso_slug }) -> { url, plan, source }
```

- Exactamente `12m`, `6m`, `contado`.
- Configuración: `PAYMENT_LINK_12M`, `PAYMENT_LINK_6M`, `PAYMENT_LINK_CONTADO`.
- Sin Stripe SDK, Authorize.net ni `offering_payment_configs`.
- Una URL faltante produce `plan_not_configured`.
- Nunca inventar URL ni usar otro plan como fallback.

## 6. Proyección local a Excel

Usa `sheet_projection_rows` como outbox y `contact_id` como clave estable. Actualiza la misma fila; nunca hace append como operación primaria.

Columnas exactas:

```text
fecha_alta | contact_id | telefono | nombre | etapa_comercial | curso_interes |
plan | estado_pago | fecha_pago | estado_alta | call_id | ultima_senal | trace_id
```

`estado_alta` nace como `pendiente_operador`. El software nunca lo cambia; una edición humana a `hecha_por_operador` debe preservarse en futuros upserts.

El `.xlsx` local es sólo evidencia de smoke. Vercel tiene filesystem efímero; producción requiere luego un provider durable detrás del mismo puerto.

## 7. Fuera de alcance

- Provisionamiento automático del campus.
- Google Sheets.
- API real de Stripe o Authorize.net.
- Provider Retell real y verificación de firma, hasta recibir credenciales.
- Las otras ocho herramientas de voz.
- Transferencia humana en vivo.
- Cambios de precio o promociones decididos por el modelo.

## 8. Invariantes

- Un `(channel, external_message_id)` produce como máximo un inbound.
- Bloqueado o sin consentimiento nunca recibe outbound comercial.
- Un outbound sólo es `sent/submitted` con confirmación del canal.
- Trazabilidad: `call_id → signal_id → turn_id → delivery → fila Excel`.
- Reprocesar señal u outboxes no duplica WhatsApp ni Excel.
- Agent B emite; Agent A/orquestador ejecuta.

## 9. Variables

```text
AGENT_B_TOOLS_SECRET=
PAYMENT_LINK_12M=
PAYMENT_LINK_6M=
PAYMENT_LINK_CONTADO=
CRON_SECRET=
TELEGRAM_AGENT_B_BOT_TOKEN=
BOTPRESS_BOT_TOKEN=
BOTPRESS_BOT_ID=
BOTPRESS_WORKSPACE_ID=
SHEETS_PROVIDER=xlsx_local
XLSX_OUTPUT_PATH=
GEMINI_API_KEY=
```

Todos los secretos se inyectan por entorno y nunca se imprimen, commitean ni pasan por argumentos de procesos.

## 10. Criterio de aceptación

`node scripts/smoke-agent-b-signal.mjs` ejecuta por HTTP:

| # | Caso | Esperado |
|---:|---|---|
| 1 | `intencion_compra` activa | 1 evento, inbound, decisión, outbound y fila |
| 2 | Mismo replay | mismos IDs, cero efectos nuevos |
| 3 | `call_id` inexistente | 409, cero escrituras |
| 4 | Contacto bloqueado | `accepted:false`, cero outbound y fila |
| 5 | Plan sin URL | `plan_not_configured`, cero outbound |
| 6 | `no_contactar` | consentimiento revocado, cero outbound, fila `lost` |

Además, antes de declarar la tanda terminada:

- `flush-outbounds` con provider fake: diez ejecuciones producen un único envío lógico.
- Telegram Development: una señal controlada produce exactamente un mensaje físico, un Botpress message ID y un delivery report.
- Agent A responde un saludo y un segundo turno recupera memoria seleccionada.
- Las 23 fuentes de conocimiento están proyectadas en el epoch vigente.
