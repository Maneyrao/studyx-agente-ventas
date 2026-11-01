# Aceptación de la alineación paid — 2026-11-01

**La regresión paid_mismatch quedó corregida en los cuatro turnos objetivo, pero la aceptación formal no aprobó: 35/48**, con 13 fallos y cero indeterminados. Pasaron 07, 10, 11 y 15; **12 falló** en el agradecimiento posterior al alta. No se alcanzó el mínimo de 41. La revisión contextual de las 48 entregas no encontró bonificaciones sin respaldo.

Código comprometido y subido antes de la única corrida: **94829544b571b947739acbeecfc931c96d3a28ef**. Brain **v149**, prompt canónico **v101**, evaluador lógico **v4**, esquema JSON del juez **v3 compatible**. Se ejecutaron las 16 conversaciones una sola vez con `deepseek-v4-flash` oficial; el proveedor devolvió `deepseek-flash`, alias actual de DeepSeek-V4.1-Flash-1017 según su [documentación](https://api-docs.deepseek.com/quick_start/pricing/). Sin despliegue, cambio de prompt, cambio de modelo de producción ni modificación de expectativas golden.

## Criterio formal

| Condición | Resultado |
|---|---|
| Cobertura | 16 casos, 48 turnos |
| ≥41/48 | **No: 35** |
| 07 completo | Sí, 2/2 |
| 10 completo | Sí, 3/3 |
| 11 completo | Sí, 4/4 |
| 12 completo | **No: 1/2** |
| 15 completo | Sí, 2/2 |
| Bonificaciones sin respaldo observadas | 0 en 48 entregas revisadas |
| Aceptación | **Fallida por umbral y crítico 12** |

06 y 14 se informan sin gate individual; todos sus turnos se incluyen en el total de 48.

## Los cuatro turnos de la regresión

| Turno | paid_mismatch en esta corrida | Resultado golden |
|---|---|---|
| 05/interest | 0 | PASS |
| 05/budget | 0 | PASS |
| 13/syllabus | 0 | FAIL: temario incompleto |
| 13/duration_followup | 0 | PASS, tras reparar logística sin respaldo |

Se verificaron los contextos reales incluidos en las instrucciones del proveedor: el modelo recibió `marketing_digital` o `fotografia_profesional` y declaró ese mismo curso como `paid`. Las respuestas se entregaron sin la contingencia de identidad anterior. En duración se rechazaron `course_logistics`/`self_paced`, conservando luego el curso correcto; ese control factual sigue activo.

El [replay de las 12 propuestas originales](evidence/2026-11-01-paid-role-alignment/offline-replay.md) también elimina los 12 paid_mismatch y mantiene ocho rechazos controlados de curso incorrecto o bono sin efecto. La reconstrucción del foco del servidor no escribe selección de compra ni altera los permisos de bonificación. Las [pruebas de implementación](2026-11-01-paid-role-alignment.md) incluyen 4.964 unitarias, 960 de integración y 115 del evaluador offline aprobadas.

Fuera de esos cuatro turnos hubo un paid_mismatch válido en 02/goal: el contexto realmente no tenía selección; el borrador declaró `paid` y la reparación lo cambió a `alternative`. Se entregó una recomendación de curso sin regalo ni selección de compra. No se clasifica como reaparición de la regresión corregida.

## Juez y fallos pendientes

El juez deriva el código desde el identificador válido de requisito. Las cuatro respuestas históricas con must_not:0/código MUST_FAILED ahora siguen siendo **FAIL**, sin indeterminado ni pedidos extra al modelo. En esta corrida no hubo pares de código/tipo contradictorios; la normalización está cubierta por ese replay y los tests. Los 48 juicios terminaron sin indeterminados.

El crítico **12/customer_acknowledgement** recibió «Qué bueno, Ana. Entonces ya podés entrar y ver el contenido de tu formación», seguido de una pregunta de acceso. El juez lo rechazó por no celebrar el curso concreto como pide la autoridad :230. Pago, alta y entrega de accesos aprobaron; el fallo es la respuesta posterior al agradecimiento.

En **13/syllabus**, el borrador no presenta la Clase 42 por separado y agrupa u omite contenidos autorizados. Sí menciona “examen final” dentro del grupo de clases 34–41; el fallo es de completitud, no ausencia total de esa expresión. La identidad del curso ya no lo bloquea; el contenido incompleto conserva su fallo original.

Apareció además un falso positivo de egreso en la narrativa de postventa: el registro durable contiene `POST_SALE_EGRESS_INVALID` y el harness usa luego su contingencia factual. La reproducción offline de la regex existente OFFERING_PATTERN captura parte de la bienvenida a Studyx como si fuera un curso. El detalle fino del motivo no está guardado en el evento durable; esa causalidad se documenta como inferencia reproducida desde el texto y la regla. No se cambia este guard ni se afirma que sea una transformación estilística silenciosa. La primera fila de acceso del caso 12 aprobó con los bloques factuales; el fallo crítico pertenece al agradecimiento siguiente.

En las trayectorias 06 y 14 se ejecutaron **cero** `offer_course_bonus` y no hubo rechazos `ladder_step_pending`. La ausencia de ofertas indebidas en esta corrida no ejercita la escalera, el máximo de tres ni la cancelación de un paquete real ofrecido por el modelo. El paquete de acceso del caso 12 pertenece al setup controlado. La protección de bonificaciones conserva su cobertura de tests y mutaciones offline; no se atribuye esa cobertura a la corrida actual.

## Resultados por caso

| Caso | Estado | Turnos aprobados |
|---|---|---|
| 01_first_contact_identity | PASS | 2/2 |
| 02_info_discovery | PASS | 2/2 |
| 03_single_course_recommendation | FAIL | 0/2 |
| 04_price_value_objection | PASS | 2/2 |
| 05_real_budget_limit | PASS | 2/2 |
| 06_repeated_price_bonus_ladder | FAIL | 4/9 |
| 07_think_it_over_not_closed | PASS | 2/2 |
| 08_consult_partner | FAIL | 1/2 |
| 09_definitive_no | PASS | 3/3 |
| 10_requested_call | PASS | 3/3 |
| 11_purchase_to_payment_link | PASS | 4/4 |
| 12_verified_payment_bonus_fulfillment | FAIL | 1/2 |
| 13_real_syllabus | FAIL | 1/2 |
| 14_course_change_cancels_promotion | FAIL | 4/7 |
| 15_purchase_signal_executes | PASS | 2/2 |
| 16_discount_limit_stays_commercial | PASS | 2/2 |

La [tabla completa de 48 turnos](evidence/2026-11-01-paid-role-alignment/acceptance/summary.md) incluye aprobado/fallido, capa, borradores, texto entregado, rechazos y latencia. También están el [CSV](evidence/2026-11-01-paid-role-alignment/acceptance/per-turn.csv), el [JSON](evidence/2026-11-01-paid-role-alignment/acceptance/turns.json), la [auditoría contextual](evidence/2026-11-01-paid-role-alignment/acceptance/delivery-audit.json) y el [diagnóstico](evidence/2026-11-01-paid-role-alignment/acceptance/diagnostics.md). Los scores originales se conservan.

## Consumo y alcance

**101 solicitudes:** 51 del agente —incluye una de setup fuera de los 48 turnos—, 49 del juez y una de postventa. Las 49 del juez incluyen 48 respuestas exitosas y un error de red dentro de esta misma corrida; el incidente call-0067 no tiene turno confirmado y se informa globalmente, sin asignarlo por conjetura a una fila.

Uso conocido: **1.087.467 tokens** (1.068.001 entrada, 19.466 salida; 457.728 de entrada cacheada). Costo estimado para el uso informado: **USD 0,104593734**, más **un intento del juez sin uso reportado**. El total exacto no se puede calcular. Tarifas dominicales por millón: USD 0,003 cache hit, 0,15 entrada sin caché, 0,60 salida. El saldo sólo se usa para disponibilidad.

46 textos del agente se conservan exactamente; en 11/plan_and_link se agrega el enlace/plan autorizado. El turno de acceso postventa usa la contingencia factual tras el rechazo de egreso descrito. No se observaron contingencias de identidad en los cuatro objetivos ni recortes para escoger frases del borrador.

La evidencia de ejecución corresponde al checkout limpio y al SHA del runner. El campo durable local backend_sha mantiene la limitación nula ya documentada; el API devuelve las instrucciones y esquema, pero no el input JSON del juez. No se presentan datos no grabados como prueba por pedido. Los originales, sus hashes y la reproducción están en el [índice de evidencia](evidence/2026-11-01-paid-role-alignment/acceptance/README.md).

Se corrigió la regresión prioritaria y la referencia del juez dentro del alcance autorizado. La aceptación sigue **fallida**; no hubo segunda corrida ni despliegue.
