# Plan de implementación — venta interpretada por el modelo

Base: `d8c87c8` (rama `claude/agent-a-model-owned-sales`).
Autoridad: AGENTS.md, secciones finales «Venta interpretada por el modelo» y siguientes.
Revisión de frontera: `02-boundary-review-opus.md`. Inventario: `01-inventory-haiku.md`.

Ruta viva:
1. Botpress `processInboundTurn` (rama del brain, :1270);
2. `resolveDeterministicRulesTurnV1` y plannerless V2 (:1543-1570);
3. POST `agent_turn_v2`;
4. `decision.service.commitAgentDecision` (:801): agent-turn-policy-v2, direct-course-bonus-service y la guarda de verdad (:1385).

`commitAgentTurnV3` está muerto: no se edita.

## Bloque 1 — refactor(agent-a): restore model-owned commercial interpretation
**Botpress:**
- Se retiran del runtime las Reglas B, C, D y E, la tarea y el chequeo de promoción (`promotionTaskV1`, `draftFulfillsPromotionTaskV1`), los respaldos fijos de bonificación, retención, llamada y precio, el último recurso «pregunta del precio», `authorizeRuleBonusInContextV1`, `resolveDeterministicRulesTurnV1`/`finalizeDeterministicRulesCandidateV1` con su cableado (processInboundTurn.ts:1553-1570 y los sitios de reparación del backend) y las inyecciones del brain (agent-a-brain-v1.ts:166-197, :304-345).
- La premisa del brain (:366-383) pasa a la versión de cierre sin invasión: sin lista de «?!», sin «sí o sí», sin «avanza o llamada».

**Backend (permiso de bonificación):**
- Se retiran `instant_trigger`, la regex del «sí», el requisito de 2 objeciones, el «siguiente exacto de la tabla» y `readSalesFlowFlagsV1`/sales-flow-markers como fuente de decisión.
- El permiso queda como en AGENTS.md (punto 2: evidencia de precio citada; o rechazo de compra citado, una sola vez, para la retención).
- La afinidad es pertenencia a un conjunto: fila de la tabla, puentes universales, «Combinalo con» del manual o curso nombrado literalmente.
- Se conservan: límites (3, uno por turno), checkout por estado, oferta entregada y respondida, sin aceptar ni pagar, cambio de bonificado con 1, aceptación automática en el link, transacciones e idempotencia.

**Respaldo único:**
- Un solo texto natural para errores reales del proveedor o del backend, el P0 actual.
- Ante caída del proveedor con pregunta de precio o pago y sin curso, se mantiene la respuesta con datos canónicos (es un hecho, no copy comercial).

**Versiones:**
- brain v158; `REVIEWED_SOURCE_HASHES` y la etiqueta de provenance; pins de tests.

## Bloque 2 — refactor(agent-a): separate conversational copy from effects
- El efecto rechazado poda sólo la acción (agent-turn-policy-v2.ts:609 y plannerless `pruneRejectedActionV1` antes de reparar).
- Si el texto afirma el efecto: una reparación; si falla, se quitan las burbujas que lo afirman.
- Hecho incorrecto (FACT_VALUE_MISMATCH, verdad comercial, requisitos, controles duros nuevos): una reparación; si falla, se quita la oración y se agrega el hecho canónico, y se revalida. También después del rechazo del backend (processInboundTurn.ts:2555-2600). El backend devuelve los valores en conflicto, además de los códigos.
- Controles duros nuevos (validación factual): título oficial/universitario/gubernamental; empleo o ingresos garantizados; licencia estatal (debe decir que no la reemplaza); cupos, descuentos o fechas inventadas; 699; beca.
- Nuevo campo de la propuesta, `turn_reasoning` (interno, opcional en el esquema; nunca se envía ni se valida). Se persiste en la evidencia del turno.

## Bloque 3 — feat(agent-a): persist structured commercial context
- `commercial_state.sales_profile`, proyectado en claim-batch desde la última `agent_decisions.memory_candidates` por (type, key), más el estado de venta y la promoción: objetivo, experiencia, interés tentativo, curso seleccionado, objeción, preferencia de canal, promoción vigente, bonificados, datos faltantes, próximos efectos permitidos, retención usada.
- Fichas del manual como hechos de catálogo (generador desde el manual + índice, sin importes; aborta ante 699, «beca» o «$»). Al modelo le llegan la ficha del curso en foco y las de los candidatos a bonificar.
- Prompt de autoridad editado (canónico v104): material de Gabi en nuestra voz, sin beca ni 699, cierre sin invasión, decisiones del 03/11 como guía.

## Bloque 4 — test(agent-a): add natural sales regression coverage
- Tests sin proveedor de la Fase 7 y del pedido nuevo.
- Escenario golden de la conversación de Marketing (fallos y aciertos del dueño).
- Las corridas con DeepSeek, después.
