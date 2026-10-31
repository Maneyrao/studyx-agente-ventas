# Hechos de negociación y comparación parcial de modelos

Se añade `commercial_state.negotiation` al contexto de Agent A. Es información de estado; no modifica permisos ni incorpora un escalón calculado, instrucciones de venta o nuevas condiciones para bonificar. La escalera sigue perteneciendo a `docs/authority/prompt-agente-a-studyx-v2.md:106–120` y las validaciones de bonificación conservan la autoridad de `docs/authority/spec-backend-bonificacion.md`.

| Hecho expuesto | Fuente y alcance |
|---|---|
| `price_objections.count` | Total sin tope de fuentes registradas anteriores al turno, dentro de conversación/contacto/workspace. Une decisiones confirmadas que registraron `price_objection` y memorias aceptadas. Prioriza `memory.decision_id`, luego fuente exacta y, sólo con una candidata inequívoca, el representante del batch. No deduplica distintas decisiones por compartir batch. Los IDs de procedencia se limitan a los últimos 20; el total no está limitado. Los registros heredados ambiguos conservan su fuente y se identifican por separado. |
| `price_only_barrier` | Interpretación del agente, con cita literal del cliente y fuente. Usa el protocolo técnico de memoria `type=constraint`, `key=price_only_barrier`, `value=confirmed|other_barriers_reported`. La ausencia de observación o un curso diferente produce `unknown`; no equivale a una negativa. No se interpreta lenguaje del cliente mediante regex. |
| `call_invitation` | Estado y cantidad de invitaciones del ciclo actual, junto al permiso actual de ofrecer una llamada. Una negativa histórica y una falta de autorización son datos separados. El cálculo de `may_offer_call` conserva su expresión anterior. |
| `delivered_bonus_offers` | Bonificados cuya oferta tuvo entrega confirmada a WhatsApp según el reader existente. Se distingue de cursos meramente ofrecidos, aceptados o efectivamente activados. `null` indica falta de evidencia; `[]` significa una lista conocida sin ofertas entregadas. |

El recuento representa **objeciones registradas**, no todas las menciones semánticas de precio que pudo haber hecho una persona. Una confirmación registrada por el agente conserva su interpretación y procedencia; la literalidad de la cita no constituye una segunda validación semántica independiente.

Las observaciones se construyen en el servidor desde la propuesta finalmente autorizada y los mensajes entrantes del batch. Workspace, conversación, contacto, curso e identificadores de fuente los aporta el backend. Se insertan atómicamente en `agent_decisions.negotiation_observations`; la fecha se obtiene de la decisión confirmada. Borradores rechazados y auditoría previa al commit no alimentan el estado. Un replay conserva la misma decisión. La columna tiene validación estructural e inmutabilidad por migración aditiva `20261031010001_agent_negotiation_observations.sql`.

Se conserva `diagnostics` como métricas sin PII. Su contrato no se amplía con citas ni se inventan métricas ausentes. Si falla el reader de negociación se informa desconocido y se conserva la respuesta del flujo normal. El contador comercial existente, limitado a dos, no cambia y no se usa como total histórico.

## Juez y evaluación

El error de `06/bonus_2` se reprodujo offline con las cuatro respuestas originales: cada una tenía un objeto JSON completo y una `}` final sobrante, sin truncamiento. El parser intenta primero JSON estricto; sólo puede retirar ese único cierre cuando el resto es un objeto completo. Conserva el original y registra `trailing_closing_brace_removed`. Se siguen rechazando truncados, texto adicional, objetos concatenados y dos cierres sobrantes. Las validaciones de veredicto, coherencia, requisitos, citas y evidencia permanecen intactas; las cuatro fixtures recuperadas conservan sus fallos semánticos.

La selección `03,04,06,07,14` contiene **22 turnos**. El adaptador oficial de evaluación permite comparar `deepseek-v4-flash` y `deepseek-v4-pro` modificando sólo el nombre enviado en solicitudes del agente. La configuración y el guard de producción permanecen en Flash. Ambas corridas usan juez Flash, criterios idénticos, timeout del agente de 15 s y del juez de 30 s, base local nueva y reserva exclusiva de resultado. La telemetría identifica modelo interno, solicitado y devuelto por separado, uso de tokens y reparaciones. Un subconjunto de 22 turnos no se presenta como aceptación completa de 48.

## Verificación previa a las llamadas pagadas

- 4.879 pruebas unitarias aprobadas; 17 omitidas y 7 pendientes.
- 928 pruebas de integración aprobadas y 1 omitida sobre base desechable con migraciones limpias; embeddings de fixture sin llamadas a proveedores.
- 67 pruebas offline del juez, proveedor, selección y comparación aprobadas.
- Tipos, lint, build y validación offline de Botpress aprobados.
- Arquitecto: implementación y método de comparación aprobados.

Las nuevas fixtures limpian únicamente sus trabajos y memorias para no contaminar la cola compartida. La prueba que reaplica migraciones históricas ahora restaura el DDL capturado y retira sólo las sobrecargas que ella introdujo, evitando reinstalar una versión anterior del trigger de inmutabilidad.

No se editaron documentos de autoridad, criterios golden ni modelo de producción. No se agregaron bloqueos para ofrecer una bonificación. No se desplegó ni se aplicó la migración a producción. Los resultados y costos de las dos corridas se registran aparte después de fijar el SHA.
