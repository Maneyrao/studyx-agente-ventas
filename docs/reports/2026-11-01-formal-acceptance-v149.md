# Aceptación formal Flash v149 — 2026-11-01

**No aprobada: 34/48 turnos**, con 13 fallidos y 1 indeterminado. Los cinco críticos 07, 10, 11, 12 y 15 aprobaron completos, y la revisión de las 48 entregas no observó bonificaciones sin respaldo. Falta el umbral de 41/48. Los casos 06 y 14 se informan, sin gate individual, y sus turnos sí integran el total.

Se ejecutó **una sola corrida de las 16 conversaciones**, después de commit y push de **f1f0f9c5d3676d324642238e43279c0c0fada2b7**, con brain **v149**, prompt canónico **v101** y juez **v3**. No hubo una segunda corrida ni despliegue. Se pidió Flash oficial como `deepseek-v4-flash`; el proveedor devolvió `deepseek-flash`, alias servido actualmente por DeepSeek-V4.1-Flash-1017 según la [documentación oficial](https://api-docs.deepseek.com/quick_start/pricing/). No se cambió el modelo de producción.

## Criterio formal

| Condición | Resultado |
|---|---|
| Cobertura | 16 casos, 48 turnos completos |
| ≥41/48 aprobados | **No: 34** |
| Críticos 07/10/11/12/15 completos | **Sí: 2/2, 3/3, 4/4, 2/2 y 2/2** |
| Cero bonificaciones sin respaldo observadas | **Sí: 48 entregas revisadas** |
| Aceptación | **Fallida por el umbral de turnos** |

## Resultados

| Caso | Estado | Turnos aprobados |
|---|---|---|
| 01_first_contact_identity | PASS | 2/2 |
| 02_info_discovery | FAIL | 1/2 |
| 03_single_course_recommendation | FAIL | 0/2 |
| 04_price_value_objection | PASS | 2/2 |
| 05_real_budget_limit | FAIL | 0/2 |
| 06_repeated_price_bonus_ladder | FAIL | 6/9 |
| 07_think_it_over_not_closed | PASS | 2/2 |
| 08_consult_partner | FAIL | 1/2 |
| 09_definitive_no | FAIL | 2/3 |
| 10_requested_call | PASS | 3/3 |
| 11_purchase_to_payment_link | PASS | 4/4 |
| 12_verified_payment_bonus_fulfillment | PASS | 2/2 |
| 13_real_syllabus | INDETERMINATE | 0/2 |
| 14_course_change_cancels_promotion | FAIL | 5/7 |
| 15_purchase_signal_executes | PASS | 2/2 |
| 16_discount_limit_stays_commercial | PASS | 2/2 |

La [tabla completa de 48 turnos](evidence/2026-11-01-formal-acceptance-v149/summary.md) contiene aprobado/fallido/indeterminado, capa, borradores, texto entregado, rechazos y latencia. También están el [CSV](evidence/2026-11-01-formal-acceptance-v149/per-turn.csv), el [JSON](evidence/2026-11-01-formal-acceptance-v149/turns.json) y la [auditoría contextual](evidence/2026-11-01-formal-acceptance-v149/delivery-audit.json) con los hashes de las 48 entregas. Ese PASS contextual sólo acredita ausencia observada de bonos sin respaldo; no reemplaza el juicio comercial de cada golden.

## Qué muestran los ajustes

La deduplicación exacta pasó pruebas unitarias y tres escenarios de commit/entrega con base real: conserva raw y metadata, entrega una invitación y actualiza el contador una vez. En esta corrida **ningún borrador devolvió una burbuja completa exactamente igual a call_offer**; la rama de deduplicación no se ejercitó con el modelo. En 14/isolate hubo dos invitaciones distintas/embebidas en prosa, que siguen siendo errores reparables. El tercer intento se entregó como respuesta normal, sin contingencia. No se presenta ese caso como dedup exacto.

El juez usó el esquema v3 en sus 51 pedidos. Los criterios y los requisitos de las golden se conservan; los críticos de llamada, enlace y postventa aprobaron. No se volvieron a juzgar generaciones descartadas como entregas actuales. Las pruebas del evaluador cubren la separación de intentos y el alcance de la línea :129 sobre el objeto de la promesa, sin whitelist léxica.

## Fallos y contingencias

El [diagnóstico por turno](evidence/2026-11-01-formal-acceptance-v149/diagnostics.md) conserva los motivos originales y separa lo observado:

- **Cuatro contingencias por desalineación contexto/backend:** 05/interest, 05/budget, 13/syllabus y 13/duration_followup. Los 12 snapshots de generación muestran `selected_offering_code=marketing_digital` o `fotografia_profesional`, y el modelo declara ese mismo curso como `paid`. El backend devuelve `paid_mismatch`; el estado persistido/final queda con selección nula. El modelo no recibió una selección nula en esos intentos. Esos textos útiles no se entregan como fueron redactados. La causa de la desalineación entre contexto de generación y validación/persistencia requiere un diagnóstico posterior y queda fuera de estos dos ajustes.
- **Una contingencia por proveedor:** en 06/bonus_3 el borrador ofrece un bonus con acción none, el backend lo rechaza y la reparación se aborta a los 15.010 ms, sin borrador. Se entrega la continuidad autorizada para conservar nunca silencio. El formato exacto de llamada no causó ese aborto.
- **Un indeterminado del evaluador:** 13/duration recibió cuatro objetos JSON válidos, pero cada uno combinaba `SEMANTIC_MUST_FAILED` con el identificador `must_not:0`. La referencia incompatible se rechaza; no se convierte en aprobado ni en un fallo comercial probado. Esos tres reintentos pertenecen a la misma corrida.

Los dos borradores de bonificación sin acción (06/bonus_3 y 14/bonus_1) no llegan al cliente. No se entregan bonificaciones nuevas en esta corrida; la lista de cursos de acceso en 12/verified_access_event corresponde al curso pago y los dos bonificados efectivamente activados por el setup local. No se confunde esa postventa con una oferta nueva.

De las 48 entregas, 39 conservan exactamente el último borrador del agente y 2 sólo ajustan ¿/¡ y espacios; hay 5 contingencias, 1 agregado autorizado del enlace/plan y 1 ensamblado de postventa con hechos de acceso. En 06/bonus_3 el último intento no tiene texto por el aborto; se conserva esa falta de dato, sin atribuirle un borrador inventado. No se observaron recortes de frases para elegir una variante de conversación.

## Consumo y trazabilidad

**113 solicitudes al proveedor:** 61 del agente, 51 del juez y 1 de postventa. Una de las solicitudes del agente (`call-0040`) corresponde al setup del acceso; su costo se incluye aunque no sea un turno golden. Los 48 turnos tienen 60 solicitudes del agente más 1 de postventa. Las 51 del juez incluyen los tres reintentos de referencia inválida.

Uso conocido: **1.246.417 tokens** (1.221.739 entrada, 24.678 salida; 560.128 de entrada cacheada). Costo estimado para esos usos: **USD 0,115728834**, más **un intento abortado sin uso informado** (`call-0024`). El costo total exacto no puede determinarse. Tarifas Flash de domingo por millón: USD 0,003 entrada cacheada, 0,15 no cacheada y 0,60 salida. El saldo se consultó sólo para disponibilidad; no se usa su diferencia como factura.

Los originales, uso, esquema e instrucciones devueltos por el proveedor están en [evidencia](evidence/2026-11-01-formal-acceptance-v149/README.md). Se verifican 60 salidas exitosas del agente con brain v149 y el campo course_mentions obligatorio, más un intento abortado; las 51 respuestas del juez reflejan esquema v3. El [comprobante de versiones](evidence/2026-11-01-formal-acceptance-v149/version-evidence-scope-proof.json) declara los límites: el campo local backend_sha sigue nulo y el API no devuelve el JSON de entrada del juez. El SHA se acredita por el runner y el checkout limpio; la construcción del payload normativo está cubierta por ese código y sus tests.

La [implementación](2026-11-01-call-format-judge-v3.md) pasó 4.949 unitarias, 957 de integración y 104 del evaluador offline, tipos, lint, build y check ADK, con revisión del arquitecto. No se tocaron los documentos de autoridad, las expectativas de las golden ni el modelo de producción. No se desplegó.
