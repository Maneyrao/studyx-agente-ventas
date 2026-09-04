# Sesión StudyX

## Fase actual
Agente A — candidato plannerless V2. Estado: en curso; READY_FOR_LOCAL_REVIEW, sin rollout ni certificación de Telegram/producción.

## Fases completas
- Recuperación del checkpoint ad15baafb63e8c55cb877f943a74e57c2899deda: worktree agent-a-plannerless-v2 limpio, sin cambios posteriores; rama codex/agent-a-plannerless-v2 conservada.
- Corrección de falsos verdes y causas reproducidas: disponibilidad por turno, entrega local correlacionada, opt-out causal, consentimiento de link, postergación e intake; informes en docs/reports/2026-09-04-agent-a-candidate.md y evidencia adjunta.
- Verificación local: 2428 unitarias/contratos passed, 7 skipped, 7 todo; integración 353 passed/1 skipped; workflow determinístico 2/2, focal final de métricas/eventos/presupuesto 24/24; lint, typechecks, ADK y Next build aprobados. Los skips/TODO no se presentan como pasados.
- Revisión independiente: 41 transcripciones previas y 167 turnos, con rúbrica V2 y citas. No certifica naturalidad del candidato v14.
- Historial anterior del proyecto conservado en docs/reports/evidence/2026-09-04-agent-a/SESSION-before.md, sin revalidar aquí sus otros proyectos/fases.

## Decisiones de arquitectura tomadas
- DeepSeek interpreta y redacta; Next.js autoriza efectos y persiste → se mantiene plannerless V2 → botpress-agent/src/lib/conversation/resolve-agent-a-plannerless.ts y src/features/conversation/domain/agent-turn-policy-v2.ts.
- Prompt brain v14, canónico v4 completo sin cambios → corrige consentimiento/intake sin reinstalar planner ni plantillas comerciales → botpress-agent/src/prompts/agent-a-brain-v1.ts.
- Fallo del modelo no equivale a atención exitosa → silencio técnico siempre visible en disponibilidad; éxito de reparación sin muestra queda null → tests/helpers/agent-a-workflow-measurement.ts y agent-a-workflow-metrics.ts.
- Presupuesto TOTAL USD1, gasto anterior informado USD0.38 y nuevo USD0 → no reiniciar ledger → scripts/agent-a-api-budget.mjs; ledger existente ignorado botpress-agent/evals/results/campaign-budget-20260904.json.

## Invariantes establecidas en esta fase
- Plan más datos no autoriza link sin pedido explícito; postergación/cambio de selección retiran permiso → política backend y regresiones de consentimiento.
- +999 es identidad de canal, no teléfono declarado → contacts.declared_phone nullable; lectura comercial y workflow con DB.
- Link entregado local exige mismo outbound/turn/trace/destino/texto/provider ID y submission durable → helper de medición y captura real del adaptador local.
- Baja exige revocación persistida causal y turno posterior bloqueado → evidence DB y regresiones workflow.
- Opt-out/replay sin evidencia suficiente nunca habilitan disponibilidad verde; usage ausente no equivale a costo cero → métricas triestado y reservas antes de HTTP.

## Tests agregados
- tests/unit/agent-a-workflow-{measurement,http-evidence,metrics,events}.test.ts: falsos verdes, commits rechazados, correlación de entrega, reparación/latencia/usage y replay.
- tests/unit/scripts/agent-a-api-budget.test.ts: cap acumulado, reintentos, reservas y usage malformado.
- tests/unit/conversation/future-notification-claims.test.ts y regresiones de agent-turn-policy-v2/resolve-agent-a-plannerless: promesas, consentimiento, postergación y campo opcional call_offer.
- tests/workflow/agent-a-deterministic-outcomes.test.ts: processInboundTurn real con Next build/PG aislados, modelo fixture, entrega/persistencia, replay y caída503 correctamente fallida.
- tests/workflow/agent-a-heldout-conversations.test.ts: paráfrasis nuevas live, preparadas SIN ejecutar; requieren clave local y ledger acumulado.

## Bloqueos
- DEEPSEEK_API_KEY local vacía → usuario debe provisionarla en .eval/.env.local; cargar sólo esa clave con scripts/run-agent-a-workflow-lab.mjs --paid. No recuperar claves de chats ni ampliar presupuesto.
- Producción eqspozrpzgzvtpowwprg sin contacts.declared_phone → aprobación explícita pendiente según paso5 del traspaso para 20260904010001_contacts_declared_phone.sql; no desplegar lector antes de columna.
- Sin bundle anterior Botpress vinculado al deployment2026-09-03T10:50:31.859Z → cerrar recuperación antes del rollout; export Studio no es backup ADK y apagar plannerless no certifica V1.
- No muestra live v14 ni entrega Telegram observada → completar evaluación y condiciones del runbook docs/reports/2026-09-04-agent-a-rollout-canary.md antes de pedir canario al usuario.
