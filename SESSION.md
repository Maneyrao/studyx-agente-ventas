# Sesión StudyX

## Fase actual
PHASE 3 — ruta única, conversación natural y canario. Estado: en curso

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
- Dos validadores podaban “para dejarlo registrado” y “me falta… para dejarlo registrado”; ambos están corregidos y la simulación limpia pasa 9/9 turnos, pero falta una inferencia limpia del modelo real.
- El ledger registra USD 1,03011768 sobre USD 1,05 y el remanente no alcanza para reservar otro request → elevar el tope acumulado a USD 1,08 para una única corrida completa.
- Producción continúa en `07328e23f97054aeb92a108562f70b6ef3a88bb4` / Brain V20 → desplegar V21 únicamente si la corrida paga termina con llamada, fases, persistencia, link y entrega local correlacionada; luego verificar recepción visible en Telegram.
