# Medición de campaña live — Agente A, 2026-09-04

Este informe cierra la campaña live V14–V19 y conserva cada ronda, freeze y cohorte de validación por separado. No acredita despliegue ni entrega por Telegram. Los resultados provienen de `processInboundTurn`, backend local y capturas del adaptador local, con DeepSeek real. La evaluación conversacional independiente está en [agent-a-live-review.md](2026-09-04-agent-a-live-review.md).

**V19 terminó con 31 entradas aprobadas y los gates numéricos satisfechos en esa muestra:** 32 HTTP, reparación 1/1 (3,23 %), p95 4.157 ms y cero fallos de disponibilidad observados. Es ajuste/regresión, sin una validación nueva sobre esa fuente. El acumulado conservador final es **USD 0,823283696**, incluyendo USD 0,38 previos y la reserva histórica sin usage; margen USD 0,176716304. Ninguna muestra certifica estabilidad ni despliegue.

La primera evaluación heldout V17 y la validación independiente V2 fallaron por intake; la primera V3 pasó después de las correcciones. V3 tiene cuatro turnos y una reparación exitosa: su tasa del 25 % falla el umbral del 5 %. Ambos fallos iniciales y el primer PASS de V3 quedan preservados, separados de todas las regresiones posteriores.

## Estado y procedencia

- **V14 abortada:** un focal de apertura; siete conversaciones completas de persistencia; dos conversaciones completas de la suite `full`; un primer turno de `wf_03` con snapshot y un turno posterior sin snapshot. El coordinador detuvo el proceso con exit 143 al encontrar el defecto de `repair_of` en el esquema enviado al proveedor. Se conserva toda la evidencia, incluida la reserva pendiente.
- **V15 focal completado a las 14:32:26 UTC:** tres casos, diez entradas; `llamada_rechazada`, `telefono_declarado`, `postergacion`. Vitest: 3 passed y 5 skipped. Observa el esquema con `repair_of`, la poda de repetición 1→1 y la comparación canónica de precios.
- **V15 completas + adaptativa:** produjo evidencia adicional y un falso verde comercial confirmado en la adaptativa v1; no aprueba calidad ni permiso de entrega. Después del focal, el coordinador restringió la normalización decimal a punto para no aceptar erróneamente `360,000` como `360,00`. No cambió prompt ni metadata; por eso el focal V15 y el ajuste posterior se desglosan aunque ambos declaren brain v15.
- **Heldout:** primera ejecución terminada con un test fallido y otro aprobado, 11 entradas en dos conversaciones. Su estado permanente es `first_run_failed`.
- **V16 temprana:** regresión de consentimiento completada a las 14:43:12 UTC, ocho entradas. Usó el backend anterior al build final: se registra como ajuste, no como validación de la combinación congelada.
- **V16 final:** freeze a las 14:46:27 UTC; completas, persistidas y adaptativa v2 terminadas entre 14:50 y 14:53 UTC: trece conversaciones, 48 entradas, 11 tests passed. Esta muestra conserva el vínculo con ese freeze y no se atribuye al prompt posterior.
- **V17 temprana:** regresión de ocho entradas completada a las 14:56:39 UTC, brain v17 / canónico v6. Conserva consentimiento y plan, pero todavía reabre opciones en T6. Esa ronda precede a la corrección del guard de pago condicional y no demuestra el resultado de la corrección.
- **V17 final:** completas + adaptativa terminadas con 26 entradas; la ejecución conjunta con heldout finalizó exit 1, con 4 tests passed y 1 failed. `.eval/codex-20260904/v17-final-freeze.json` conserva el freeze de las 15:04:06 UTC, source digest `ce284bd596af556bae5ad618c8164b3e7917751783c68394b8c95180812cf8e0`, Next build `yrpeCY9zQGMWpn05z4Rpk` y ADK SHA-256 `07a75fcf2fd1cdabfa11e341c401a448be4ec1a4f1bed0449a05b71bf43f8418`. La fase final se separa de V17 temprana por ese freeze y del heldout por su rol de validación.
- **Corrección de intake posterior:** freeze a las 15:15:03 UTC. H1 original pasó como regresión de seis entradas. La nueva validación independiente V2 falló en T3, con formulario multilínea y `name=null`; se detuvo allí y conserva tres entradas. El analizador distingue V2 mediante `validation_generation=2` o el prefijo `workflow-intake-heldout-v2`, porque su rol original también es `heldout_validation`.
- **Intake final V17:** freeze a las 15:20:00 UTC. Primera V3 independiente: PASS, cuatro entradas; replay V2: PASS, cuatro entradas. `.eval/codex-20260904/live-v17-intake-final.log` conserva los dos resultados. V3 se identifica por `scenario_role=heldout_validation_v3` y manifiesto de primeras trazas; cualquier repetición posterior es regresión.
- **V18 final:** doce entradas, dos conversaciones y dos tests PASS bajo freeze de las 15:27:01 UTC: regresión de consentimiento y replay V3. Su tasa de reparación del 16,67 % falla el gate; el replay no es una primera validación. Log `live-v18-final.log`.
- **V19 final:** canónico v8 revisa acceso después de acreditación, seguimiento futuro y llamada inmediata. Freeze a las 15:30:45 UTC; 31 entradas, siete conversaciones y cuatro tests PASS en tres archivos, exit 0. La muestra combina completas, regresión de consentimiento y replay V2; no hereda un resultado heldout de versiones anteriores. Log `live-v19-final.log`.

Los eventos identifican la versión `studyx-agent-a-brain-v14` a `v19`, modelo `deepseek-v4-flash`. Las huellas de reportes se conservan en el snapshot de agregación. Los JSON originales no contienen un hash del bundle ejecutado: la asociación con el build final se consulta en el [informe del candidato](2026-09-04-agent-a-candidate.md).

## Conciliación de V14: 36 reservas, 34 HTTP en snapshots, 32 en conversaciones completas

| Evidencia | Cantidad | Tratamiento |
| --- | ---: | --- |
| HTTP de nueve conversaciones completas con DB | 32 | Se deduplican por trace y respuesta del proveedor. |
| HTTP de apertura focal y primer turno de `wf_03`, sin DB exportada | 2 | Se incluyen en costo y latencia; disponibilidad desconocida. |
| Reserva 35, respuesta 200 y usage, sin snapshot de turno | 1 | Se conserva el gasto; no se inventan salida, reparación ni latencia. |
| Reserva 36, sin usage ni snapshot | 1 | Se conserva íntegra la reserva USD 0,019266720. |
| **Total ledger V14** | **36** | **34 capturadas + 1 con usage sin captura + 1 reservada.** |

La reserva 35 es `9393a237-b6c0-40a4-8e65-02aadade8c24`, a las 14:18:10.290 UTC: input 9.104, cache 6.400, output 319; contabiliza USD 0,001700440. La reserva 36 es `85724a1c-6082-4712-98c7-a2fb0b69d242`, a las 14:18:13.060 UTC, `status=reserved`, `usage=null`. Ninguna se elimina ni se cobra como cero.

El log conserva una traza sin snapshot, `a66e11ab-922a-41f2-8e85-f56daf3e9333`, turno `c3374a98-9301-4e7c-8b40-d4bb7d460e02`, con contexto y ruta de selección de plan. Su posición temporal es consistente con las dos reservas finales, pero el ledger no guarda trace ni ID del proveedor: **no se afirma una unión directa demostrada entre esas reservas y esa traza**. Esa carencia limita cualquier tasa global que pretendiera incluir el turno abortado.

Las 34 llamadas capturadas se conciliaron unívocamente con el ledger por usage completo y la reserva calculada a partir del tamaño exacto del request. El UUID local del ledger es distinto del ID de respuesta de DeepSeek. El análisis conserva ambos cuando hay coincidencia; no los confunde ni une llamadas solamente por el texto del cliente.

## Métricas V14 reconstruidas

Se usa `summarizeWorkflowMetricsV1`, incluyendo todos los turnos elegibles con snapshot, los silencios y cada HTTP observado. Opt-out ACK y bloqueo posterior no entran en el denominador de modelo. El turno abortado sin snapshot queda explícitamente fuera: sus resultados y tiempo no se reconstruyen como cero.

| Medida | Conversaciones completas con DB | Todos los snapshots V14 |
| --- | ---: | ---: |
| Entradas observadas | 30 | 32 |
| Turnos elegibles de modelo | 28 | 30 |
| HTTP observados | 32 | 34 |
| Input / cache / output conocidos | 295.194 / 199.168 / 9.211 | 312.884 / 205.824 / 9.786 |
| Reparaciones intentadas / exitosas | 4 / 0 | 4 / 0 |
| Tasa de reparación | 14,29 % | 13,33 % |
| Éxito de reparación | 0 % | 0 % |
| p50 / p95 | 3.727 / 6.051 ms | 3.727 / 6.051 ms |
| Fallback técnico observado | 0 | 0 |
| Disponibilidad: fallos / desconocidos | 0 / 0 | 0 / 2 |

Los gates `p95<6000`, reparación `<=5 %` y éxito de reparación `>=80 %` fallan. El gate de disponibilidad del conjunto con snapshots parciales es `null`; una DB ausente no demuestra disponibilidad. Los fallbacks observados son cero, pero el turno sin snapshot impide certificar cero fallbacks en la ronda completa.

Las cuatro reparaciones fallidas corresponden a dos repeticiones y dos rechazos de precio. Los precios estaban correctamente citados: el ADK comparaba `usd 360.00` con `usd 360` como cadenas diferentes. La poda ya retiraba la pregunta dentro de un mensaje compuesto, pero el resolver desechaba el resultado porque seguía habiendo un mensaje. Las reescrituras no incluían `repair_of`, ausente del esquema enviado al proveedor. Son defectos de V14 preservados; los verdes funcionales posteriores no los convierten en reparaciones exitosas.

## Focal V15: reintentos JSON fuera de reparación semántica

| Medida | Tres casos, diez entradas |
| --- | ---: |
| Turnos elegibles / HTTP | 10 / 12 |
| Input / cache / output conocidos | 111.243 / 72.960 / 3.476 |
| Intentos HTTP adicionales | 2 |
| Respuestas con JSON inválido | 2 |
| Reparaciones semánticas intentadas / exitosas | 0 / 0 |
| Éxito de reparación | `null`, sin muestra |
| p50 / p95 | 3.433 / 7.114 ms |
| Fallback técnico / fallos de disponibilidad / desconocidos | 0 / 0 / 0 |

Los dos primeros outputs empiezan con `={"schema_version":1,...}`: el prefijo `=` invalida JSON. Ambos HTTP respondieron 200 con usage. Los segundos intentos entregaron JSON válido dentro de un bloque fenced. No hubo contexto `turn_rejection`, por lo que son reintentos de parseo, no la reparación semántica medida por `repair_attempted`.

- Chat rechazando llamada: trace `0862c932-65c2-4246-999b-f50eba404e75`; respuesta inválida `1b773a3a-0860-44b9-8967-84d816d3a1ba`; 7.114 ms.
- Consulta de precio: trace `9268ad8a-c0f1-482e-a787-b5335be0fe4e`; respuesta inválida `55a485df-abc0-4100-9a4b-58d3faec4405`; 6.087 ms.

`http_failed_attempts=0` significa que no hubo error HTTP/transporte; no significa que todos los outputs fueran utilizables. Los doce intentos cuentan en usage y costo. Este focal falla `p95<6000`; el éxito de reparación permanece desconocido. Los asserts funcionales 3/3 no aprueban esos gates ni certifican naturalidad, estabilidad o Telegram.

## V15 de ajuste y regresión temprana V16

| Medida | V15 completas + adaptativa v1 | V16 temprana de consentimiento |
| --- | ---: | ---: |
| Turnos elegibles / HTTP | 26 / 27 | 8 / 9 |
| Input / cache / output conocidos | 249.432 / 179.072 / 7.550 | 86.286 / 46.848 / 2.173 |
| Reparaciones semánticas intentadas / exitosas | 0 / 0 | 1 / 1 |
| Tasa / éxito de reparación | 0 % / `null` | 12,5 % / 100 % |
| p50 / p95 | 3.523 / 4.123 ms | 3.338 / 6.121 ms |
| Disponibilidad: fallos / desconocidos | 0 / 0 | 0 / 0 |

V15 de ajuste tiene un HTTP adicional por esquema inválido: trace `10b443d3-3e77-4ef2-aac6-c7a4faf1e75c`, respuesta `b701ae04-0724-4ea2-bc66-bb74f3128479`. Su JSON agrega `response.schema_version`, campo que el objeto estricto no acepta. El parser local devuelve `BRAIN_INVALID_SCHEMA`; el siguiente output sin ese campo pasa. No fue una reparación semántica. El gate numérico conjunto queda `null` porque no existe muestra de reparación; además la adaptativa falla permiso comercial, como se documenta abajo.

La regresión V16 conserva siete entradas sin solicitud explícita y cero links; la octava pide el link y entrega una URL correlacionada. T7 propuso una acción no autorizada, recibió `ACTION_NOT_AUTHORIZED` y la reparación real quedó registrada como `repaired=true`: **1/1 demuestra ese caso, no estabilidad de reparación**. Las dos exportaciones `workflow-consent-price-before-request-2026-09-04T14-43-09-028Z-ea7ba77f-f23c-4d98-90bc-3e9c04577bf9.json` y `workflow-consent-price-after-request-2026-09-04T14-43-12-398Z-2b23d063-80ef-4841-9f4b-5b7411dbca6f.json` se deduplican: son ocho turnos, no quince. Fallan p95 y tasa de reparación en esta muestra dirigida al defecto.

El freeze final está en `.eval/codex-20260904/v16-final-freeze.json`: base `360cd37201a35bf3c4cceb82a93e809885494529`, source digest `a7706ccd4d9738bc793a15a147539851ba87d02c099e5ccf471349113a3415c1`, Next build `iDyTdpGXkP8pLclAk8ufU` y bundle ADK SHA-256 `be8e145509b15b0efe223f96a68e37922e54e3e0f5b2cfbfd9548cea1bc78972`. Las pruebas posteriores se agrupan separadas por versión y por este instante; V16 temprana no se atribuye a ese backend.

## V16 final y V17 temprana: números y alcance

| Medida | V16 final: 13 conversaciones | V17 temprana: 1 regresión |
| --- | ---: | ---: |
| Entradas / turnos elegibles de modelo | 48 / 46 | 8 / 8 |
| HTTP / respuestas JSON sintácticamente inválidas | 47 / 0 | 9 / 0 |
| Input / cache / output conocidos | 437.666 / 306.816 / 11.742 | 86.958 / 48.512 / 2.220 |
| Reparaciones intentadas / exitosas | 1 / 1 | 1 / 1 |
| Tasa de reparación | 2,17 % | 12,5 % |
| p50 / p95 | 3.410 / 3.852 ms | 3.388 / 5.344 ms |
| Fallback técnico / disponibilidad fallida / desconocida | 0 / 0 / 0 | 0 / 0 / 0 |
| Gates numéricos conjuntos | `true` | `false`: tasa de reparación |

Los números V16 final satisfacen los cinco umbrales en esta muestra. El éxito de reparación es 1/1, no una estimación estable de un 100 % general. `quality_ready`, `production_ready` y `stability_certified` permanecen `false`; los números no sustituyen la rúbrica conversacional, la validación separada ni Telegram. El log `.eval/codex-20260904/live-v16-final-adjustment.log` confirma 11 tests passed en tres archivos. Los dos turnos no elegibles de modelo pertenecen al control determinístico de opt-out.

V17 temprana usa el prompt completo canónico v6 de 322 líneas. Su freeze de prompt es `.eval/codex-20260904/v17-prompt-freeze.json`, a las 14:56:09 UTC, SHA-256 `28a1a095b9629a77fb16e34903605493a0132e5baf2ae759ac6112bb585f0ed0`. El test de regresión pasó, pero T6 «¿Y cuánto sale?» responde otra vez con las tres opciones y pregunta «¿Cuál te resulta más cómoda para avanzar?», aunque la DB conserva `monthly_6`. Esto sigue siendo un defecto de continuidad, no se oculta detrás de la preservación del plan ni de p95 verde. La fuente es `workflow-consent-price-after-request-2026-09-04T14-56-39-737Z-8ef80647-7e23-4c8d-a583-625b59a19d0e.json`, trace T6 `136dacba-8f52-4d90-89c5-3742409ef11e`.

## Cierre V17 final: ajuste aprobado, primer heldout fallido

| Medida | V17 final de ajuste | Primer heldout |
| --- | ---: | ---: |
| Entradas observadas / turnos elegibles de modelo | 26 / 26 | 11 / 9 |
| HTTP / intentos adicionales | 26 / 0 | 9 / 0 |
| Input / cache / output conocidos | 244.911 / 173.056 / 6.369 | 85.239 / 59.904 / 2.243 |
| Reparaciones intentadas / exitosas | 0 / 0 | 0 / 0 |
| Éxito de reparación | `null`, sin muestra | `null`, sin muestra |
| p50 / p95 | 3.314 / 3.710 ms | 3.384 / 4.077 ms |
| Fallback técnico / disponibilidad fallida / desconocida | 0 / 0 / 0 | 0 / 0 / 0 |
| Gates numéricos conjuntos | `null` | `null` |
| Resultado funcional | Completa + adaptativa aprobadas | 1 caso falla, 1 pasa |

No hubo muestra de reparación en esta combinación final: no se trasladó el éxito 1/1 de V16 o V17 temprana para convertir su `null` en aprobado. El heldout mantuvo respuesta y persistencia, pero no cumplió el efecto comercial solicitado. Por eso sus contadores de disponibilidad pueden ser cero mientras el test y la candidatura siguen fallidos.

El caso `heldout_v14_consent_after_deferral` llegó a seis entradas. En T5, «Ahora sí quiero avanzar: pasame el enlace de la opción de seis pagos», trace `ef8ffc70-2374-44cf-9213-e8723ec8b78f`, el agente pidió confirmar nombre y apellido. La exportación conservó `name=null`, email/teléfono declarados presentes y `deliveredLinks=[]`. El nombre se había aportado previamente; esto demuestra la discordancia de intake, no que faltara permiso del cliente. Evidencia final: `workflow-heldout-checkpoint-2026-09-04T15-06-15-535Z-192c3390-6188-45cc-9b1d-3b09176da1e3.json`. El segundo caso, cambio de curso y opt-out, completó cinco entradas y pasó.

`.eval/codex-20260904/live-v17-final.log` conserva el fallo `expected [] to deeply equal [ 'https://example.invalid/eval/6m' ]`. El manifiesto exclusivo `.eval/codex-20260904/heldout-first-run-20260904.json`, SHA-256 `302e7e52449f87ddfbb7975e9d86e2e225af22fc8911a6dd47e31d6db403e676`, fija las once trazas, dos conversaciones, hashes de reportes, freeze y estado `first_run_failed`. El analizador no sobrescribe ese manifiesto. Cualquier traza posterior de la cohorte original se agrupa como `heldoutReplayRegression` y no reemplaza esta evaluación inicial.

## Corrección de intake: regresión H1 y primera validación V2

| Medida | Replay H1, regresión | Primer heldout V2 |
| --- | ---: | ---: |
| Entradas / turnos modelo / HTTP | 6 / 6 / 6 | 3 / 3 / 3 |
| Input / cache / output conocidos | 57.327 / 39.936 / 1.423 | 28.248 / 19.968 / 583 |
| p50 / p95 | 3.178 / 4.466 ms | 3.699 / 3.926 ms |
| Reparaciones intentadas / éxito | 0 / `null` | 0 / `null` |
| Fallback técnico / disponibilidad fallida / desconocida | 0 / 0 / 0 | 0 / 0 / 0 |
| Resultado funcional | PASS | FAIL en T3 |

La fuente corresponde a `.eval/codex-20260904/v17-intake-fix-freeze.json`, SHA-256 `29ec24ad188aad9d23a1aa9351b83489c01f45c2707b041ad0349e432a9b5414`, source digest `2a14823755366b69a266b6113e02f44923c52b7e9b3475941f02e7a0934dbae1` y Next build `OuBWJr4XW-BRz4fVURLZ-`. El ADK conserva el hash del freeze V17 final; el cambio fue del backend.

H1 demuestra que el primer formato de nombre ya pasa, sin convertir la evaluación inicial fallida en verde. El conjunto V2, escrito independientemente por el revisor, detectó que separar nombre y correo por salto de línea sin coma todavía dejaba `name=null`. Su T3, trace `cb7aec31-cfb2-4e37-b237-0a1f30e80ddc`, se conserva en `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-15-44-699Z-abd0e729-7f72-42a8-a5cc-a916029a9356.json`. No llegó a evaluar los pasos posteriores ni se contabilizan como aprobados.

El manifiesto exclusivo `.eval/codex-20260904/heldout-v2-first-run-20260904.json`, SHA-256 `d0c31b5dde890fa8e8ea3dd28f7df41d8bc131fd502220032ff487bdfcf2a107`, fija sus tres trazas con estado `first_run_failed`. La etiqueta normalizada de cohorte del analizador es `heldout_validation_v2`; los reportes originales usan `scenario_role=heldout_validation` y `validation_generation=2`. Una repetición de V2 se agrupará como `heldoutV2ReplayRegression`, sin mezclarse con el primer heldout, H1 ni la primera ejecución V2. Los gates numéricos conjuntos de ambas últimas muestras permanecen `null` por falta de reparación; tampoco sustituyen el fallo funcional de V2.

## Intake final V17: primer heldout V3 y replay V2

| Medida | Primera V3 independiente | Replay V2, regresión |
| --- | ---: | ---: |
| Entradas / turnos modelo / HTTP | 4 / 4 / 5 | 4 / 4 / 4 |
| Input / cache / output conocidos | 48.271 / 33.280 / 1.284 | 37.924 / 26.624 / 1.127 |
| Reparaciones intentadas / exitosas | 1 / 1 | 0 / 0 |
| Tasa / éxito de reparación | 25 % / 100 % | 0 % / `null` |
| p50 / p95 | 3.190 / 5.945 ms | 3.265 / 4.883 ms |
| Fallback técnico / disponibilidad fallida / desconocida | 0 / 0 / 0 | 0 / 0 / 0 |
| Gates numéricos conjuntos | `false`: tasa de reparación | `null`: sin muestra de reparación |
| Resultado funcional | PASS | PASS |

El freeze `.eval/codex-20260904/v17-intake-final-freeze.json` tiene SHA-256 `f170752213fc901c5ae175c6c544b1534ab4ab8cd8a3fe4abf1e40a9bf7ea1d4`, source digest `326afd2ff850a5794c8efa994d7b4f7c2fe62e1062f7308b027a806f855ced49` y Next build `s8IzT7-sga5DjW5i3PTBq`. No se atribuyen sus resultados al siguiente prompt V18.

La primera V3 queda fija en `.eval/codex-20260904/heldout-v3-first-run-20260904.json`, SHA-256 `f493fec372bb5c231e480e30ee430c17e4d8b63b09f615c722b8d6d52df1aec7`, estado `first_run_passed`, cuatro trazas de la conversación `heldout-intake-v3-f1036303-258b-4301-b73a-db5e8cf54a95`. Su checkpoint final es `workflow-intake-heldout-v3-checkpoint-2026-09-04T15-20-41-436Z-9697f7aa-70e8-442d-8cba-379243c961f1.json`. Los cinco HTTP tienen usage; el intento adicional corresponde a reparación semántica, no a error JSON. El éxito 1/1 es evidencia de ese caso y no convierte en estable el mecanismo de reparación.

El replay de V2 termina en `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-20-56-532Z-223dc148-49cc-4bf1-84a3-5ca175702c86.json`. Sus cuatro trazas están bajo `heldoutV2ReplayRegression`. La primera V2 permanece `first_run_failed` en su manifiesto; esta regresión no se suma a su denominador ni la reemplaza.

## Fuentes finales V18 y V19: gates y límites

| Medida | V18 final, 2 conversaciones | V19 final, 7 conversaciones |
| --- | ---: | ---: |
| Entradas / turnos elegibles de modelo | 12 / 12 | 31 / 31 |
| HTTP / intentos adicionales | 14 / 2 | 32 / 1 |
| Input / cache / output conocidos | 136.011 / 82.688 / 3.510 | 306.295 / 206.336 / 8.232 |
| Reparaciones intentadas / exitosas | 2 / 2 | 1 / 1 |
| Tasa / éxito de reparación | 16,67 % / 100 % | 3,23 % / 100 % |
| p50 / p95 | 3.345 / 5.853 ms | 3.360 / 4.157 ms |
| Fallback técnico / disponibilidad fallida / desconocida | 0 / 0 / 0 | 0 / 0 / 0 |
| HTTP sin usage / latencias faltantes | 0 / 0 | 0 / 0 |
| Gates numéricos conjuntos | `false`: tasa de reparación | `true` en esta muestra |
| Vitest funcional | 2 tests PASS | 4 tests PASS |

V18 corresponde al freeze `.eval/codex-20260904/v18-final-freeze.json`, SHA-256 `ee9e75003720321390c9aa358879b2cb3c4f124adc3ec501097093a20cc6c5ae`, source digest `55d9ff2f1a82e6c051dbefcd0f5997bf7c5e7f4d65c21a59ca4e0d07e4264458` y ADK SHA-256 `fb3bc590eb0c50eee751a7e73fdf24cbb00b1cdf8bb8464dcefe8663eba254dd`. V19 corresponde a `.eval/codex-20260904/v19-final-freeze.json`, SHA-256 `9719884d3dfab67ad6d17e2067c4ddff0419e20e0ee9035003019400f4fbb823`, source digest `5deffc384d3b30771f51d11b55ac14371ce7657f8ed9fedc1b5389b1b4ea8693` y ADK SHA-256 `52730e46212ebeb82634e170813b7389c9a6bb8634085d3ad9c94eeaee94b153`. Ambas usan Next build `QcD9WJ8pmq1dOexcAN784`; no son el mismo bundle ADK. No hay trazas de estas versiones sin freeze correlacionable ni anteriores a su freeze.

La tabla usa `sourceCohorts.v18/v19.afterFreeze`: incluye todos los turnos de cada fuente y conserva debajo sus particiones. Es una vista alternativa; **no se suma** otra vez a los totales de rondas o presupuesto. V18 se divide en consentimiento (8 turnos, 9 HTTP, reparación 1/1, p95 5.853 ms) y replay V3 (4 turnos, 5 HTTP, reparación 1/1, p95 5.561 ms). V19 se divide en completas + consentimiento (27 turnos/HTTP, sin reparación, p95 3.996 ms) y replay V2 (4 turnos, 5 HTTP, reparación 1/1, p95 5.860 ms). Los replays aislados tienen tasa de reparación del 25 %: ese defecto medido no se oculta al mostrar el gate conjunto de V19.

Las tres reparaciones de V18/V19 tienen `rejection_codes=[ACTION_NOT_AUTHORIZED]` y evento `repaired=true`: V18, trazas `18e32423-afab-46f5-9385-5b9a964c7b98` y `c60d1810-5154-41ea-a966-f93565f94cfd`; V19, `f72dc9a6-e5cd-4f98-800f-ae98d6e17b79`. Todos los intentos cuentan en costo y latencia. No se observaron reintentos de JSON inválido ni errores HTTP en estas dos rondas. El éxito 1/1 de V19 prueba ese intento concreto, no una tasa estable de éxito general.

La disponibilidad cero de V19 se apoya en los 31 snapshots con DB y resultado de workflow, incluyendo cada turno elegible; no se infiere de los 4 asserts Vitest. Las latencias incluyen el flujo local completo hasta el adaptador y la reparación. No miden entrega remota ni tiempos de Telegram. `quality_ready`, `production_ready` y `stability_certified` permanecen `false`; la naturalidad se evalúa en la revisión conversacional enlazada y el estado de despliegue en el informe del candidato.

| Cohorte independiente inicial | Fuente | Entradas preservadas | Resultado inicial permanente | Repeticiones posteriores |
| --- | --- | ---: | --- | --- |
| Original | V17 final | 11 | FAIL | H1: 6 entradas en V17, regresión PASS |
| V2 | V17 intake fix | 3 | FAIL | 4 en V17 + 4 en V19, regresiones PASS |
| V3 | V17 intake final | 4 | PASS funcional; gate reparación falla | 4 en V18, regresión PASS |

Los tres hashes de manifiestos siguen iguales a los publicados antes de los replays. **V19 no tiene una primera cohorte independiente propia.** Ni sus 31 entradas ni el replay V3 bajo V18 se presentan como validación reservada nueva.

## Presupuesto acumulado sin reinicio

**Incidente comercial posterior al focal:** `workflow-adaptive-sale-2026-09-04T14-36-15-201Z-06565fb9-c40f-46bd-b8fa-3c0e9cea0a52.json` termina con un link de seis cuotas, pero su secuencia `answering` nunca contiene `autoriza_link` ni `pide_link`. T6 pregunta «¿Y cuánto sale?» y T7 aporta datos. La acción durable y URL de T7, turno `e2e7c25f-1888-47ca-ab19-5a3ccd3776d8`, quedaron falsamente verdes bajo el contrato anterior. Disponibilidad, persistencia y entrega local no equivalen a consentimiento.

El replay gratuito del reporte original falla ahora con `PAYMENT_WITHOUT_EXPLICIT_CUSTOMER_PERMISSION`. El gate v2 comprueba permiso del cliente antes de cada URL/acción durable y no acepta autorización posterior; un registro sin turno correlacionable tampoco pasa. La suite escribe checkpoints con DB, captura y `answering` completo en cada turno. El simulador v2 elige plan al recibir un menú sin pregunta y puede aceptar una invitación a avanzar tras elegirlo; siempre expresa un pedido de link explícito. Se mantiene el máximo de siete turnos. V1 y sus reportes permanecen como evidencia histórica; las corridas live nuevas de v2 están desglosadas en V16 y V17 finales y no corrigen retroactivamente V15. Focal gratuito: 15/15 unitarias; esto valida el arnés, no el comportamiento live.

Corte estable del focal V15: 48 reservas, 47 con usage y una sin usage. Ledger leído sin modificaciones; snapshot `live-measurement-snapshot-2026-09-04T14-33-29-539Z.json`, SHA-256 del ledger `a7054caa7c5675df717de2f5fff7e3c1f9a06c85235b3de729c8ce074460a481`.

| Componente | USD contabilizados |
| --- | ---: |
| Gasto previo informado por el usuario | 0,380000000 |
| V14, incluyendo reserva sin usage | 0,083872616 |
| Focal V15 | 0,022454280 |
| **Acumulado al terminar focal V15** | **0,486326896** |
| Margen entonces bajo tope USD 1 | 0,513673104 |

El gasto previo sigue siendo informado, no conciliado contra una factura. Los nuevos importes son el criterio conservador del wrapper: input miss 0,44, cache 0,014 y output 1,32 USD por millón; no se presentan como factura final. La campaña continúa bajo el mismo ledger. El saldo de esta tabla es un corte histórico y no autoriza gasto por fuera del control centralizado.

Corte posterior antes de V16 final: snapshot `live-measurement-snapshot-2026-09-04T14-49-03-229Z.json`, SHA-256 del ledger `13e65ed96612db3b0896309bc1618f8b511ac715991aa76773637508f56dc796`. Son 84 reservas y 82 HTTP capturados conciliados; sólo faltan las reservas históricas 35 y 36 ya explicadas. V15 de ajuste suma USD 0,043431408 y V16 temprana USD 0,020876952. Acumulado conservador: **USD 0,550635256**, margen entonces **USD 0,449364744**. El archivo no cambió durante esa lectura.

Corte posterior a V17 temprana, sin API activa: snapshot `live-measurement-snapshot-2026-09-04T14-58-09-162Z.json`, SHA-256 del ledger `edb72b0050399b8dd1fc9b3219a5811fb5599ff45bb4412c418a22b04e2f11f0`. **140 reservas = 138 HTTP capturados conciliados + las dos reservas históricas sin snapshot.** V16 final suma USD 0,077368864; V17 temprana USD 0,020525808. Acumulado conservador **USD 0,648529928**, margen entonces **USD 0,351470072**. Sigue intacta la reserva sin usage USD 0,019266720; el ledger permaneció estable durante la lectura.

**Cierre después del primer heldout fallido:** `.eval/codex-20260904/live-measurement-snapshot-2026-09-04T15-07-42-332Z.json`, ledger SHA-256 `be948f91f2f33a791c9eaba81697d777a883b1a48628ed3f6d18d7e25cf5e5ef`. **175 reservas = 173 HTTP capturados conciliados + las dos reservas históricas sin snapshot.** V17 final de ajuste agrega USD 0,042446064 y el primer heldout USD 0,014946816. Acumulado conservador **USD 0,705922808**, margen entonces **USD 0,294077192**. El ledger permaneció estable durante la lectura y la reserva sin usage sigue íntegra. Estos números no incluyen futuras regresiones o nuevas pruebas.

**Cierre tras H1 y V2:** `.eval/codex-20260904/live-measurement-snapshot-2026-09-04T15-17-25-006Z.json`, ledger SHA-256 `175bb3eec68cdca6d45788fb6a6e37c87dc68fba4a546bf7a90e581feca3001e`. **184 reservas = 182 HTTP capturados conciliados + las dos reservas históricas sin snapshot.** H1 agrega USD 0,010089504 y V2 USD 0,004692312. Acumulado conservador **USD 0,720704624**, margen entonces **USD 0,279295376**. La reserva sin usage USD 0,019266720 permanece intacta y el ledger no cambió durante la lectura.

**Corte tras primera V3 y replay V2:** `.eval/codex-20260904/live-measurement-snapshot-2026-09-04T15-24-03-898Z.json`, ledger SHA-256 `0c73dfa8346e0181629024563c1b4676476133ee223d3fb16bde6cb488811229`. **193 reservas = 191 HTTP capturados conciliados + las dos reservas históricas sin snapshot.** Primera V3 agrega USD 0,008756840 y replay V2 USD 0,006832376. Acumulado conservador **USD 0,736293840**, margen entonces **USD 0,263706160**. La reserva sin usage sigue íntegra y el ledger no cambió durante la lectura. Este corte precede a la regresión V18 prevista.

**Cierre final tras V19:** `.eval/codex-20260904/live-measurement-snapshot-2026-09-04T15-33-09-712Z.json`, SHA-256 del snapshot `5b3a6bfcedf145b03d5483890c07ea527438afa91cef3d18171a3014d032992c`, ledger SHA-256 `d118ddc49db2aa7ba3aa480809f3b4dcbebb5d5cfc6b0da8b56d2a19f8c41332`. Se ejecutó una agregación después del FIN del coordinador; el ledger permaneció estable durante la lectura.

| Cierre de costo | USD conservadores |
| --- | ---: |
| Acumulado anterior a V18 | 0,736293840 |
| Fuente V18, incluyendo replay V3 | 0,029252952 |
| Fuente V19, incluyendo replay V2 | 0,057736904 |
| **Total acumulado final** | **0,823283696** |
| **Margen bajo tope USD 1** | **0,176716304** |

**239 reservas = 237 HTTP capturados conciliados + reserva 35 con usage sin captura + reserva 36 sin usage.** El ledger tiene 238 respuestas con usage y una reserva sin usage por USD 0,019266720 que permanece íntegra. No hay HTTP de reportes sin conciliación, trazas sin clasificar ni reintentos borrados del denominador. La campaña nueva contabiliza USD 0,443283696; los USD 0,38 previos siguen incorporados una sola vez. Este cierre no inventa evidencia del turno V14 sin snapshot ni certifica cero fallos para esa parte desconocida de la campaña.

## Reproducción del análisis sin API ni DB

```sh
node --import tsx .eval/codex-20260904/aggregate-live-measurement.mjs
```

El script lee únicamente ledger, JSON de workflow y logs locales. No importa el runner pago ni lee archivos de entorno. Produce un snapshot JSON nuevo con escritura exclusiva: métricas del helper, inventario de trazas, hashes de reportes, IDs de respuesta, SHA del request, conciliación de reservas y trazas sólo presentes en logs. Primero deduplica por `traceId`, conserva DB cuando aparece en un checkpoint posterior y distingue los HTTP por `traceId + response.id`; sin ID usa el ordinal y hash del request para no borrar reintentos idénticos.

La clasificación usa brain version de los eventos y el contexto de la conversación para ACKs determinísticos. Los cortes temporales son explícitos: V14 finaliza antes de las 14:20 UTC; el focal V15 termina antes de las 14:33 UTC; V16 temprana precede a su freeze final; V17 se divide antes/después de sus freezes. V18 y V19 verifican sus propios freezes. Rol, generación y prefijo de reporte separan los conjuntos heldout. Los manifiestos inmutables distinguen primeras ejecuciones de futuras regresiones. La vista `sourceCohorts` vuelve a agrupar por fuente, sin modificar esos roles ni sumar dos veces costo o turnos.

Los cuatro argumentos opcionales registran el estado comunicado por el coordinador para V17 final y la creación inicial de los manifiestos heldout original/V2/V3; no alteran un manifiesto existente ni ejecutan pruebas. El cierre final usó `adjustment_complete_first_heldout_failed first_run_failed first_run_failed first_run_passed`. La conciliación durante una corrida es provisional porque el ledger y los snapshots progresan en momentos distintos; se registra si el ledger cambió durante la lectura. Todos los snapshots anteriores quedan preservados.

## Anexo: corrección final del contador de llamadas, sin nueva API

Después del cierre pago V19 se detectó y corrigió un falso contador en la metadata de llamadas. El coordinador verificó el arreglo con workflow gratuito: 3/3 tests aprobados a las 15:47:39 UTC y cuatro turnos fixture con contador de llamadas `0/1/1/1`. Esa evidencia comprueba el comportamiento del contador con propuestas controladas; no agrega una muestra del modelo ni mide su naturalidad, latencia real o tasa de reparación.

La fuente final queda en `.eval/codex-20260904/v19-call-final-freeze.json`, a las 15:47:41 UTC: SHA-256 del freeze `3c4164a424715680c4842cea924c363a2764039d7b33187a43a4584160594fa9`, source digest `a98f6e57ce2604c3cde29c5595c11ffee5598e26679516c3acfb83e80625430e`, Next build `IrwZGDZAUGAKWeW7Jjxmn` y ADK SHA-256 `b9376e34f04dc8d2cc47c587e9576b58140f057cf78658e60fd7f3c881c3fdf1`.

**Todas las estadísticas pagadas V19 de este informe pertenecen a `v19-final-freeze.json`, anterior a esta corrección.** No se atribuyen al nuevo freeze ni se presenta su fixture como certificación de calidad o producción. El agregado final `live-measurement-snapshot-2026-09-04T15-33-09-712Z.json` permanece intacto. No se regeneraron métricas ni costos: siguen **239 reservas, USD 0,823283696 acumulados y USD 0,176716304 de margen**, según el ledger final confirmado sin nuevas llamadas por el coordinador.
