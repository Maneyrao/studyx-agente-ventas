# Revisión de frontera (Opus, sólo lectura) — HEAD 12d564b

Veredicto: hace falta cambiar cosas; el objetivo es viable. Hallazgos principales:

- La ruta viva es Botpress processInboundTurn (rama brain :1270) → resolveDeterministicRulesTurnV1 + plannerless V2 (:1543-1570) → POST agent_turn_v2 → decision.service.commitAgentDecision (:801) → agent-turn-policy-v2, direct-course-bonus-service, guarda de verdad comercial (:1385).
- commitAgentTurnV3 no tiene llamador en runtime (sólo tests). agent_loop_v3_mode sólo se registra en log.
- Causa raíz de la pregunta del precio ante «qué precio tiene?»: STRONG_PRICE_QUESTION deterministic-sales-rules.ts:150.
- El permiso de bonificación del backend se arma por regex (read-course-bonus-ladder.ts:106-120; read-course-bonus-capability.ts:503, :697). Retirar sólo las reglas de Botpress no alcanza.
- La guarda de verdad comercial está viva y rechaza el turno entero (decision.service.ts:1418-1423).
- sales-flow-markers lee de `messages`, no de audit_log; AGENTS.md:131 está desactualizado.
- La premisa del brain (agent-a-brain-v1.ts:366-383) causa el «?!» mecánico y parte del empuje temprano a la llamada.
- customer.memories es el top-5 vectorial (agent-a-context.ts:710-713); probable pérdida de «trabajar con marcas».

## Regla A después de la migración
El modelo propone offer_course_bonus. El backend valida:
1. enabled;
2. evidencia de precio según spec :60, con la cita en el lote;
3. curso activo;
4. distinto del pago;
5. no repetido;
6. menos de 3;
7. uno por turno;
8. oferta entregada seguida de respuesta del cliente;
9. sin pagar ni aceptar;
10. checkout determinado por el estado;
11. afinidad como pertenencia a un conjunto.

Se retiran instant_trigger, la regex del «sí», el requisito de 2 objeciones y el «siguiente exacto». Un rechazo afecta sólo al efecto (agent-turn-policy-v2.ts:609).

## Reparación
En Botpress, antes del commit:
- **Efecto:** se poda la acción cuando el texto no afirma el efecto. Si lo afirma, una reparación y después se quitan las burbujas que lo afirman.
- **Hecho:** se generaliza el salvage de requisitos a FACT_VALUE_MISMATCH y a la verdad comercial: se quita la oración y se agrega la frase canónica del plan. La reparación también corre después del rechazo del backend (processInboundTurn.ts:2555-2600).
- **Orden:** modelo → reparación → salvage → mensaje con hecho canónico → technicalFallback.

## Estado estructurado
Sin migración: se proyecta en claim-batch, como commercial_state.sales_profile, el último agent_decisions.memory_candidates por (type, key), junto con las tablas de estado de venta y de promoción.

## Conflictos con la autoridad
1. Prompt :120: «El backend decide el momento y el curso», y la oferta va sólo después del «sí». Contradice el objetivo 1.
2. Prompt :110 y :127: plantillas literales («Qué te parece?!»).
3. Retención (:127) sobre un «no» simple contra spec :60, regla 2.
4. AGENTS.md:30 prohíbe recortar dentro de una burbuja.
5. El «sí» a la pregunta del precio no es verificable sin regex.
6. Nunca silencio excluye la manipulación del egreso, el opt-out y la supresión.
