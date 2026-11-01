# Aceptación interrumpida — 06ec3e5

- SHA evaluado: `06ec3e5ac85825bb51cfec23df10d0c22b72298d`.
- Corrección: `d803e22`; instrumentación: `06ec3e5`; ambos publicados. Sin despliegue.
- Proveedor configurado: NVIDIA NIM `deepseek-ai/deepseek-v4.1-flash`. v8 usó DeepSeek oficial v4-flash: referencia, no juez.
- **Gate no acreditado. No hay porcentaje de calidad válido.** No se completaron 48 turnos ni los críticos 07/10/11/12/15.
- Cinco intentos finalizados registrados, todos NIM_ABORTED a ~15 s; pudo quedar otro en vuelo. Total exacto no certificado. Tokens y costo desconocidos, no cero.
- Cero borradores recibidos; dos fallbacks técnicos observados en el transporte sintético. Caso 02/info interrumpido; otros 45 turnos no ejecutados.
- No se evaluó si d2c836a evita promesas de bonificación sin acción.
- No se repitió la corrida, no se cambiaron timeouts/modelo/prompt/expectativas y no se desplegó.
- Limitación: se conservaron parciales; no se produjo la exportación final de auditoría antes de que el runner retirara la base sintética.

| Caso/turno | Estado | Capa | Borrador original | Texto entregado | Rechazos backend | v8 |
|---|---|---|---|---|---|---|
| 01_first_contact_identity/greeting | ERROR TÉCNICO; SIN JUICIO | provider_transport | No recibido | No quiero suponer algo incorrecto. Dime qué necesitas o a qué curso te refieres y lo resolvemos por aquí. | [] | Aprobado |
| 01_first_contact_identity/continuity | ERROR TÉCNICO; SIN JUICIO | provider_transport | No recibido | No quiero suponer algo incorrecto. Dime qué necesitas o a qué curso te refieres y lo resolvemos por aquí. | [] | Aprobado |
| 02_info_discovery/info | INTERRUMPIDO | execution_interrupted | No recibido | Sin resultado final preservado | — | Aprobado |
| 02_info_discovery/goal | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 03_single_course_recommendation/recommend | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 03_single_course_recommendation/test_close_reply | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 04_price_value_objection/interest | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 04_price_value_objection/expensive | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 05_real_budget_limit/interest | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 05_real_budget_limit/budget | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 06_repeated_price_bonus_ladder/select | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 06_repeated_price_bonus_ladder/value | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 06_repeated_price_bonus_ladder/installments | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 06_repeated_price_bonus_ladder/isolate | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 06_repeated_price_bonus_ladder/call_step | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 06_repeated_price_bonus_ladder/bonus_1 | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 06_repeated_price_bonus_ladder/bonus_2 | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 06_repeated_price_bonus_ladder/bonus_3 | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 06_repeated_price_bonus_ladder/never_fourth | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 07_think_it_over_not_closed/plans | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 07_think_it_over_not_closed/think | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 08_consult_partner/context | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 08_consult_partner/partner | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 09_definitive_no/interest | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 09_definitive_no/hidden_friction | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 09_definitive_no/definitive | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 10_requested_call/request | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 10_requested_call/data | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 10_requested_call/available | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 11_purchase_to_payment_link/buy | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 11_purchase_to_payment_link/data | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 11_purchase_to_payment_link/confirm | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 11_purchase_to_payment_link/plan_and_link | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 12_verified_payment_bonus_fulfillment/verified_access_event | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 12_verified_payment_bonus_fulfillment/customer_acknowledgement | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 13_real_syllabus/syllabus | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 13_real_syllabus/duration_followup | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 14_course_change_cancels_promotion/interest | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 14_course_change_cancels_promotion/price_1 | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 14_course_change_cancels_promotion/installments | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 14_course_change_cancels_promotion/isolate | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 14_course_change_cancels_promotion/call_step | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 14_course_change_cancels_promotion/bonus_1 | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 14_course_change_cancels_promotion/change | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Fallido |
| 15_purchase_signal_executes/context | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 15_purchase_signal_executes/signal | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 16_discount_limit_stays_commercial/context | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |
| 16_discount_limit_stays_commercial/discount | NO EJECUTADO | — | No ejecutado | No ejecutado | — | Aprobado |

## Evidencia de transporte

- call-0001: NIM_ABORTED; HTTP sin respuesta; 15011 ms; contenido y usage ausentes.
- call-0002: NIM_ABORTED; HTTP sin respuesta; 15017 ms; contenido y usage ausentes.
- call-0003: NIM_ABORTED; HTTP sin respuesta; 15018 ms; contenido y usage ausentes.
- call-0004: NIM_ABORTED; HTTP sin respuesta; 14996 ms; contenido y usage ausentes.
- call-0005: NIM_ABORTED; HTTP sin respuesta; 15002 ms; contenido y usage ausentes.

## Validación técnica anterior a la aceptación

- 4.836 unitarias/contratos aprobadas; 919 integraciones/replay aprobadas, 1 omitida.
- TypeScript, lint, build y chequeo offline ADK aprobados; revisión arquitectónica sin hallazgos materiales pendientes.
- La validación técnica no sustituye la aceptación comercial.

## Bloqueo

La ejecución se interrumpió tras cancelaciones repetidas al plazo de 15 segundos del cliente. No se ha determinado por qué NIM no respondió dentro de ese plazo. Resolver o cambiar el presupuesto de tiempo y autorizar otra corrida sería trabajo posterior; no se hizo en esta ejecución.
