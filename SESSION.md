# Sesión StudyX

## Fase actual
PHASE 3 — ruta única, conversación natural y canario. Estado: V21 desplegado; canario Botpress Cloud fallido antes del handler

## Fases completas
- PHASE 0: fallos y silencios son observables; N3 cuenta como fallo conversacional.
- PHASE 1: contexto acotado e intake autoritativo llegan al Brain y se miden en el workflow.
- PHASE 2: propuesta, rechazo estructurado y una reparación quedan detrás del mismo backend autoritativo.

## Decisiones de arquitectura tomadas
- El Brain recibe el canónico completo más contexto vigente → la charla real confirmó V20 en 20/20 decisiones → `botpress-agent/src/prompts/agent-a-brain-v1.ts`.
- La llamada es el primer objetivo después de resolver curso → cumple la prioridad comercial sin bloquear la atención por chat → prompt V21 y políticas ADK/backend.
- Catálogo, canal, baja y postergación requieren evidencia del lote actual → una etiqueta del modelo no puede inventar estado → `catalog-resolution.ts`, `channel-preference-evidence.ts` y `payment-choice-policy.ts` con espejos Botpress.
- El link lo materializa el backend después de curso, plan, pedido explícito e intake completo → el modelo nunca escribe ni elige una URL → `agent-turn-policy-v2.ts` y `materialize-payment-link-action.ts`.
- La identidad contextual depende de una pregunta realmente entregada en la misma conversación y destino → permite respuestas separadas sin confiar en metadata ajena → `ingestion.service.ts` y `contact-identity.ts`.

## Invariantes establecidas en esta fase
- “Fotografía” devuelve sólo los dos cursos pertinentes y no avanza sin desambiguar → tests de `catalog-resolution` y workflow de regresión.
- El primer turno elegible ofrece llamada, con máximo dos, y un rechazo real impide nuevas ofertas → validador ADK, política backend y tests de preferencia.
- La última elección explícita del lote decide llamada o chat → helper espejo y `agent-a-call-preference-boundary.test.ts`.
- “Inés” no posterga ni cierra la compra; una negativa temporal no se vuelve baja permanente → binder, validador, backend y corpus espejo de pago.
- Cada dato de contacto persiste antes de pedir el siguiente; intake incompleto no puede declararse registrado → extractor contextual y truth guard.
- Un link requiere una única acción canónica, outbound durable y captura correlacionada → integración vertical y workflow real de 11 turnos.

## Tests agregados
- `tests/workflow/agent-a-telegram-regression.test.ts`: reproduce fotografía, llamada, rechazo, fases, intake separado, link y entrega correlacionada por el workflow real.
- `tests/workflow/agent-a-deterministic-outcomes.test.ts`: ejecuta el mismo intake `Inés` → `Valdés` → correo → teléfono por workflow, backend y PostgreSQL reales; exige una sola propuesta por turno y verifica el link contra la captura correlacionada del adaptador.
- `tests/integration/contact-contextual-intake.test.ts`: demuestra persistencia de nombre y apellido desde pedidos realmente entregados y aislamiento por conversación/proveedor/destino.
- `tests/unit/conversation/agent-a-call-preference-boundary.test.ts`: demuestra evidencia actual, orden de lote, rechazo y solicitud natural de llamada en ADK/backend.
- `tests/unit/orchestration/catalog-resolution.test.ts`: demuestra candidatos pertinentes ante coincidencia parcial.
- `tests/unit/payments/payment-link.test.ts` y `tests/unit/botpress/payment-choice-mirror.test.ts`: distinguen postergación, baja, datos de intake y paridad backend/Botpress.
- Suites de contexto, Brain, rechazo y policy: demuestran reparación precisa, próximo campo pendiente, call-first y ausencia de bypass por etiquetas inventadas.

## Bloqueos
- La corrida limpia con DeepSeek V21 pasó 11/11 turnos, sin reparación, fallback ni silencio; persistió identidad completa y correlacionó un único link. Gasto final USD 1,048747608 de USD 1,08.
- Producción ejecuta `767cad87d2105a6cb1e2fa3554439e5f565fb3c9` / Brain V21. Vercel `dpl_EgnjgaYTSMnjGGWzEnhCvikw7n3G` está `READY`; Botpress publicó el bundle `7381b476d4beb56375d0cd538b7db4e30113b45a0ca1af66957b011ed074b182` y preservó Telegram registrado.
- El canario Botpress Cloud Webchat quedó sin respuesta en el primer turno. Webchat almacenó el mensaje, Botpress no emitió logs y PostgreSQL no recibió el evento; la frontera falló antes del backend y no consumió DeepSeek.
- La recepción remota sigue sin certificarse. Antes del canario supervisado en `@amsterdam_reservas_bot` hay que restaurar la activación del `Conversation` handler; no se paga ningún enlace.
