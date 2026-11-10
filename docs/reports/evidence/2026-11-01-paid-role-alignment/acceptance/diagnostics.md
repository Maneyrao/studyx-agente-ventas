# Diagnóstico de aceptación 9482954

Reporte de artefactos existentes; no se alteraron fuentes, resultados ni criterios.

- Resultado: **35/48 aprobados, 13 fallidos, 0 indeterminados**. No cumple ≥41 ni el crítico12 completo;07,10,11,15 completos. Auditoría de48 entregas: cero bonificaciones sin respaldo.
- Los cuatro turnos objetivo tienen cero `paid_mismatch`:05/interest PASS;05/budget PASS;13/syllabus FAIL por temario comprimido y Clase42 omitida;13/duration_followup PASS después de reparar `course_logistics.self_paced`.
- No es cero global:02/goal rechazó `paid_mismatch` para recomendación sin selección y reparó el rol a `alternative`. Otros rechazos:06/installments precio;12/evento postventa egreso;13/duration_followup logística;14/change falta nombre. Lista exacta en JSON.

## Texto entregado

46 borradores finales se conservaron exactamente.11/plan_and_link conserva la narrativa y agrega separadores, etiqueta y enlace Stripe autorizado del backend.

12/verified_access_event es una excepción real: el modelo redactó bienvenida cálida y sugerencia opcional de contraseña; el backend rechazó `POST_SALE_EGRESS_INVALID`. El harness (`live-runner.test.ts:501-507`) llamó explícitamente a `fallbackPostSaleNarrative`, que entregó «Tu acceso ya está habilitado.» más cursos/credenciales/enlace verificados. Los eventos durables recibido→rechazado→nuevo recibido→autorizado prueban esa trayectoria. No fue una transformación estilística silenciosa.

Reproducción offline del patrón existente de catálogo (`egress-guard.ts:106`): captura «damos la bienvenida a studyx, cualquier cosa que necesites me escribís por acá 😊» como `offering`, aunque es una bienvenida. Esto explica el falso positivo de egreso; el log durable sólo guarda el código genérico, no el detalle del verificador. La contingencia pierde la bienvenida y la sugerencia, en tensión con autoridad230; no se modifica aquí.

El fallo crítico12/customer_acknowledgement es distinto: el texto final dice «tu formación», sin celebrar Fotografía Profesional como curso concreto. Borrador y entrega idénticos; juicio original conservado.

## Proveedor y juez

101 solicitudes contabilizadas:51 de turnos del modelo +48 respuestas de juez identificables +1 preparación controlada +1 error del juez. `call-0067` dio `DEEPSEEK_NETWORK_ERROR` en14743ms, tokens desconocidos. No incluye request/schema/turn_id; sólo por orden parece corresponder a06/call_step. El mapper anterior lo asigna al siguiente `call_step`; ese vínculo es inferencia, no correlación demostrada. Informarlo como incidente de la corrida evita atribuirlo falsamente a un turno. Ningún registro queda sin contabilizar. Se corrigió sólo el mapper TMP y se regeneró el resumen: call-0067 figura en global_judge_incidents, sin asignación por turno; se conserva en llamadas/costos por rol.

No hubo discrepancias raw `must`/`must_not` en esta corrida: la normalización v4 no fue ejercitada en vivo. La corrección cuenta con pruebas unitarias; el contrato de salida compatible continúa nombrado v3. La respuesta API muestra ese schema; no muestra un eco de input/evaluator_version.
