# Spec 007 — Cierre del loop post-llamada (B → A)

## Contexto

Specs 005 y 006 (16-ago) y el código que las implementa (`codex/agent-a-b-integration`,
mergeado a `main` el 17-ago) cierran A→B: el cliente pide o acepta una llamada por
WhatsApp, el backend crea `call_sessions`, dispatcha contra un `VoiceProvider`
(hoy sólo el simulador de Telegram), y cada evento del proveedor
(`requested`/`started`/`ended`/`analyzed`) se apila en el ledger `call_events` vía
`recordCallEvent`, que recalcula la proyección (`call_sessions.status`,
`.analysis_status`, `.result`) y para ahí.

No hay ningún lado B→A. `recordCallEvent` no dispara efectos. Ningún cron toca
`call_sessions`. `botpress-agent/src/triggers/index.ts` está vacío (boilerplate
comentado). El resultado de la llamada sólo llega al cliente si éste vuelve a
escribir por WhatsApp y `claim-batch` arma el turno en `mode: 'post_call'` con
los hechos `last_call_result` — es decir, sólo si el cliente inicia.

Esta spec cierra ese hueco: cuando una llamada llega a un estado terminal con
análisis disponible (o vence sin análisis), el sistema **inicia** un mensaje de
WhatsApp de cierre, sin esperar a que el cliente escriba.

## Decisión de framing (confirmada con el usuario, 17-ago)

- La ventana de 24h de WhatsApp ya está abierta en el momento de cierre de la
  llamada, porque la llamada nace dentro de una conversación de WhatsApp activa.
  El mensaje de seguimiento es free-form, no requiere plantilla pre-aprobada de
  Meta. Esto NO es una decisión de este spec, es un hecho de la política de
  WhatsApp que simplifica el diseño: no hace falta un mecanismo de plantillas.
- El mensaje de cierre lo arma el **backend con reglas fijas**, no el modelo.
  Motivo: determinismo y auditabilidad. El modelo (Agente A) participa recién
  cuando el cliente responde a ese mensaje — ahí sí es un turno normal, entra
  por `claim-batch` como siempre.

## Restricción dura de esquema (no se toca)

`agent_decisions.turn_id` tiene `UNIQUE` + `FOREIGN KEY (turn_id, turn_direction)
REFERENCES messages(id, direction)` con `turn_direction GENERATED ALWAYS AS
('inbound')`. Toda `agent_decision` necesita un `messages` row real con
`direction = 'inbound'`. No existe hoy un camino para una decisión "sin turno".

En vez de abrir un camino paralelo (una tabla de decisiones de sistema, o una
excepción a la FK), este spec sintetiza un turno inbound legítimo: un evento de
canal de tipo sistema, resuelto al mismo `contact_id` y `channel_thread_id` de
WhatsApp que ya tiene el contacto, seguido de un mensaje inbound que cuelga de
ese evento. Esto reutiliza sin cambios: la FK de `agent_decisions`, el trigger
de inmutabilidad, `delivery_reports`, el flujo de outbound existente. No hay
sistema paralelo.

### Por qué un evento de canal y no otra cosa

`channel_events.event_kind` ya es un CHECK abierto a extensión aditiva
(`'inbound_message' | 'delivery_update' | 'conversation_update'`). Le sumamos
un cuarto valor, `'system_call_result'`, con su propio shape-check: no exige
`external_message_id`/`external_conversation_id` no vacíos (se derivan
determinísticamente del `call_id`, no vienen de un webhook real), pero sí exige
`contact_id` y `channel_thread_id` resueltos (igual que hoy) para que el
trigger `enforce_message_source_event_context` no tenga que cambiar.

`external_event_id` se deriva como `system:call_result:<call_id>` — esto le da
gratis la idempotencia: `channel_events_provider_event_uq` (`UNIQUE (provider,
integration_id, external_event_id)`) rechaza un segundo intento sobre la misma
llamada sin lógica adicional en el reconciliador.

## Alcance

**Dentro**: detectar `call_sessions` en estado terminal (`completed`, `failed`,
`no_answer`, `timed_out`, `cancelled`) sin seguimiento emitido; mapear
`result`/`status` a un mensaje de cierre determinístico; sintetizar el turno
inbound de sistema; commitear una `agent_decision` de schema existente (v2/v3,
`decision_kind: 'reply'`, `response_type` existente — no hace falta un
`response_type` nuevo, el contenido ya es texto libre); reusar el pipeline de
outbound/`delivery_reports` ya construido para WhatsApp.

**Fuera**: mensaje de seguimiento por voz (Retell real) — sigue sin existir
`retell.provider.ts`, no es parte de este spec. Reintentos de llamada
automáticos — nunca se re-marca (regla ya congelada en spec 005). Cualquier
cambio al modelo/prompt de Agente A — el mensaje de cierre no lo arma el LLM.

## Mapeo resultado → mensaje (backend, reglas fijas)

Reusa la tabla de ruteo ya definida en `specs/005-agent-a-b-communication/spec.md`
(post-call router table), con la variante operativa de "quién escribe":

| `call_sessions.status` | `result` | Acción |
|---|---|---|
| `completed` | `venta_confirmada` | Confirmación de postventa — **gateada**: sólo se emite si hay pago verificado en el sistema de pagos; si no, cae en `link_enviado_sin_pago`. |
| `completed` | `link_enviado_sin_pago` | Seguimiento de pago único: recordatorio cordial, sin presión, con el link ya enviado en la llamada. |
| `completed` | `seguimiento_agendado` | Confirma fecha/canal acordado en la llamada; no reabre la oferta. |
| `completed` | `no_interesado` | Cierre cordial, sin nueva oferta, deja la puerta abierta. |
| `completed` | `no_contactar` | No se emite mensaje. Se revoca el contacto (opt-out) — mismo efecto que `intent = 'opt_out'` hoy. |
| `completed` | `ya_es_alumno` / `no_calificado` / `no_es_buen_momento` | Cierre neutral, sin reclamo comercial, continuidad de relación. |
| `completed` | `derivado_humano` | Cierre neutral + nota interna; NO se activa handoff humano (spec 005 lo mantiene apagado). |
| `no_answer` / `failed` (busy/failed_to_connect) | — | Ofrece reintentar la llamada; nunca auto-remarca. |
| `timed_out` | — | Mismo mensaje que `no_answer` (ambiguo desde el punto de vista del cliente). |
| `cancelled` | — | No se emite mensaje — la cancelación fue una acción explícita de otro lado del sistema. |
| `completed`, `analysis_status = 'failed'` o sigue `pending` tras el timeout de espera | — | Mensaje neutral de continuidad ("¿cómo quedamos?"), sin afirmar ningún resultado — no hay análisis fiable que citar. |

Todos los textos van versionados en un módulo de plantillas (no en el código
del reconciliador), igual que `prompt_version` versiona los prompts del modelo.

## Disparador

Reutiliza el patrón cron existente (`src/app/api/cron/*`), no un trigger de
Botpress: el problema es puramente de backend/DB (leer `call_sessions`,
escribir `messages`/`agent_decisions`), Botpress sólo participa como canal de
salida al final (igual que cualquier otro outbound de WhatsApp hoy). Esto
evita depender de que `botpress-agent/src/triggers/index.ts` deje de estar
vacío — ese es un problema de otro alcance (arranque de llamada desde
Botpress), no de cierre de llamada hacia WhatsApp.

Nuevo cron `post-call-followup`: cada corrida selecciona `call_sessions` en
estado terminal (`updated_at` más viejo que un pequeño margen de gracia, para
dar tiempo a que llegue el evento `analyzed` antes de resolver con
`analysis_status: pending`) que no tengan ya un `channel_events` con
`external_event_id = 'system:call_result:<id>'`. Antijoin simple, sin tabla de
"pendientes" nueva — el propio `channel_events` es el registro de lo ya hecho.

## Requisitos funcionales

- FR-1: Una llamada en estado terminal con seguimiento pendiente genera como
  máximo un mensaje de cierre. Reintentos del cron son no-op por la UNIQUE de
  `external_event_id`.
- FR-2: El texto del mensaje se decide 100% por `status`/`result`, nunca por
  el modelo.
- FR-3: `no_contactar` no genera mensaje; genera revocación de contacto.
- FR-4: `cancelled` no genera mensaje.
- FR-5: Si el contacto ya está bloqueado/opt-out al momento de correr el cron
  (por cualquier motivo, incluida una llamada previa), no se emite mensaje —
  mismo guardrail que ya rige cualquier outbound comercial.
- FR-6: El mensaje de cierre entra al mismo `channel_thread_id` de WhatsApp
  que el contacto ya tenía abierto — no crea un thread nuevo.
- FR-7: Si no hay `channel_thread_id` de WhatsApp resuelto para el contacto
  (caso degenerado — no debería ocurrir si la llamada nació de WhatsApp), el
  reconciliador registra error y no revienta: pausa ese caso, no bloquea el
  resto del lote.
- FR-8: La decisión resultante es indistinguible en forma de cualquier otra
  `agent_decision` de `decision_kind: 'reply'` — mismo pipeline de commit,
  mismo `delivery_reports`, misma auditoría.

## Fuera de la constitución existente (no reabre nada)

- No cambia ninguna migración ya aplicada.
- No introduce una segunda tabla de "decisiones de sistema" — reusa
  `agent_decisions` tal cual.
- No activa handoff humano.
- No reintenta llamadas automáticamente.
- No requiere plantillas de WhatsApp (ventana de 24h ya abierta).

## Preguntas ya resueltas (no volver a levantar)

- ¿Quién arma el mensaje? → Backend, reglas fijas.
- ¿Necesita plantilla de WhatsApp? → No, ventana de 24h abierta.
- ¿Cron o trigger de Botpress? → Cron; Botpress es sólo canal de salida.
- ¿Tabla nueva de decisiones? → No; se sintetiza un turno inbound de sistema
  reusando `channel_events` + `messages` + `agent_decisions` tal como existen.
