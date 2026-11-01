# Regla 10 de bonificación y dos corridas con Flash

Código evaluado y subido: `10d7b3e5e7b5cdce3c88901cfedd3493346ecce2`. **10/22 turnos aprobados en cada corrida. La negociación todavía no acredita aceptación. Sin despliegue.**

## Cambio implementado

La decisión explícita del usuario del 2026-11-01 se registra en `AGENTS.md`: `offer_course_bonus` exige al menos tres objeciones de precio del modelo registradas en decisiones finales anteriores y la invitación a llamada ofrecida/rechazada o no autorizada. Fuente: `docs/authority/prompt-agente-a-studyx-v2.md:106-120`. No se interpreta precio con regex, no se exige una nueva confirmación adicional y cambiar de curso no reinicia el contador de conversación.

El contador deduplica turnos, comprueba la cita literal contra el inbound/batch y excluye candidatos del turno actual, posteriores, borradores rechazados, acciones aisladas y memorias legadas sin procedencia de decisión. La capacidad visible y la autorización transaccional comparten los hechos y el permiso de llamada con estado efectivo y reconciliación existente. Una llamada incluida en el mismo borrador no habilita el regalo. Se preservan idempotencia, replay exacto y aceptación/alta de paquetes existentes.

Si falta un requisito, `ladder_step_pending` transporta conteo observado/requerido y `missing_steps`, sin texto prescrito. El anexo técnico distingue `defer_payment` de `decline_purchase`: las cuatro postergaciones indicadas por el usuario se clasifican como deferencia; sólo el rechazo definitivo explícito es decline. Anexo/brain **v146**; prompt canónico **v101**, sin editar los documentos de autoridad. Los escenarios y criterios golden quedan intactos; sólo se actualizó metadata de versión del heldout.

## Resultado de las dos muestras

| Caso | Corrida 1 | Corrida 2 | Caso completo en ambas |
|---|---:|---:|---|
| 03 — recomendación única | 1/2 | 1/2 | No |
| 04 — valor/precio | 2/2 | 1/2 | No |
| 06 — escalera y máximo | 3/9 | 3/9 | No |
| 07 — postergación | 2/2 | 2/2 | Sí |
| 14 — negociación/cambio de curso | 2/7 | 3/7 | No |
| Total | **10/22** | **10/22** | |

Sólo 07 pasa completo en ambas. El mismo total esconde seis cambios de resultado por turno entre repeticiones; no demuestra estabilidad. La referencia anterior sobre estos 22 turnos era 8/22 con Flash y 10/22 con Pro (`8950424`); no es una comparación causal aislada porque ahora cambian la regla y el anexo técnico.

No se corrieron las 16: 06 y 14 no cumplieron el requisito operativo previo de que 06/07/14 pasaran completos en ambas muestras, criterio anunciado antes de la segunda corrida y posteriormente confirmado explícitamente por el usuario. Ese filtro no redefine los críticos formales: la aceptación completa sigue exigiendo **41/48 y 07/10/11/12/15 completos**. En el subconjunto sólo está 07, que sí pasa. **No se evaluó el criterio absoluto ni se informa un resultado de aceptación completa.** Ver `pre-full-gate.json`.

## Qué funcionó y qué sigue fallando

- Se conservaron los últimos borradores en **44/44 entregas**: 36 idénticos, dos con diferencias sólo de espacios y seis con eliminación autorizada de ¿/¡ y espacios. Las reparaciones fueron nuevas redacciones del modelo. No hubo recorte ni sustitución posterior por plantilla en estos 44 textos.
- R1 no tuvo rechazos ni reparaciones. Ejecutó dos ofertas: `06/bonus_3` con cuatro objeciones y llamada previa en `bonus_2`, y `14/call_step` con tres e invitación previa en `installments`. Ambas cumplen la nueva regla. R2 no ejecutó ofertas ni registró invitaciones durables.
- **Ninguna muestra ejercitó un rechazo `ladder_step_pending`.** El transporte y la reparación factual de ese rechazo se verificaron en integración, no con una reparación real de Flash en estas muestras. Los hechos llegaron en 16/22 solicitudes de R1 y 20/26 de R2; los restantes snapshots no incluían ladder. El guard transaccional vuelve a leerlos al ejecutar.
- En R1 `06/isolate` falla sólo por el movimiento declarado. La llamada tardía hace que `06/bonus_3` entregue recién el primer curso cuando el escenario espera tres. En `14/call_step` la oferta cumple la regla factual aunque el golden de trayectoria fija la marque prematura. `14/bonus_1` recuerda ese curso efectivamente ofrecido, sin una oferta nueva; no es una promesa nueva sin acción.
- R2 necesitó **cuatro reparaciones en tres turnos**: precio y duplicación de llamada en `14/installments` (termina aprobado), duplicación en `14/isolate` (falla final sólo de move), y `forbidden_promise` en `14/bonus_1`. La primera versión de este último ofrecía un curso concreto sin acción; fue rechazada. La reparación quitó el nombre pero entregó «si sumo un curso extra a tu inscripción […] te ayudaría a avanzar?» sin acción. El juez señala esa insinuación. **No se puede declarar resuelta toda mención de bonificación sin acción ni afirmar que el backend quedó limpio en sentido absoluto.** No se ejecutó esa bonificación.
- Las precondiciones formales no alcanzadas son `06/never_fourth` en R1, y `06/never_fourth` + `14/change` en R2. Conservan sus fallos originales, pero no prueban por sí solas incumplimiento independiente del límite/cambio de curso. Los otros fallos por arrastre no se reclasifican como precondiciones formales.

El resultado acredita el límite factual implementado y mejora la postergación en estas muestras; no acredita que el agente recorra la escalera comercial ni que la reparación elimine toda insinuación de regalo. No se agregaron nuevas reglas o regex después de observar las corridas.

## Consumo y proveedor

Agente y juez solicitaron **deepseek-v4-flash oficial**; el proveedor devolvió `deepseek-flash`. La documentación oficial indica que el alias histórico se sirve actualmente con V4.1-Flash-1017. No se atribuye esa resolución del alias a un cambio local del modelo de producción.

| Corrida | Agente / juez | Solicitudes totales | Tokens entrada / salida | Tokens totales | Costo estimado |
|---|---:|---:|---:|---:|---:|
| 1 | 22 / 21 | 43 | 385.590 / 9.092 | 394.682 | USD 0,035220 |
| 2 | 26 / 20 | 46 | 447.105 / 9.870 | 456.975 | USD 0,036805 |
| Total | 48 / 41 | **89** | 832.695 / 18.962 | **851.657** | **USD 0,072025** |

Los turnos con precondición no alcanzada no llaman al juez semántico; por eso hay 41 juicios para 44 turnos. Hubo cero errores del proveedor y del evaluador. El juez recuperó una llave final sobrante en R1 y ninguna en R2, preservando raw y criterios. Latencia del agente: mediana/máxima **2.983/3.568 ms** en R1 y **2.804/3.414 ms** en R2. La tabla detallada conserva cada intento y su latencia.

Estimación por usage y [tarifas oficiales verificadas el 2026-11-01](https://api-docs.deepseek.com/quick_start/pricing/): fin de semana/horario valle, por millón Flash entrada caché USD 0,003, entrada sin caché USD 0,15, salida USD 0,60. Caché: 190.976 y 246.144 tokens respectivamente. Todos los intentos tienen usage conocido. No es factura. Saldo consultado antes/entre/después: USD 4,73 / 4,72 / 4,68; la diferencia redondeada de la cuenta no sustituye el cálculo por usage. Esas tres consultas GET de saldo no son llamadas de inferencia.

## Evidencia y verificación

[Tabla de 44 turnos: borradores, entrega, rechazo y capa](evidence/2026-11-01-backend-negotiation-ladder/por-turno.md) · [CSV completo con autorización, envío, acciones, trazas y latencias](evidence/2026-11-01-backend-negotiation-ladder/por-turno.csv) · [Resumen calculado](evidence/2026-11-01-backend-negotiation-ladder/resumen.json).

Los originales y los 44 reportes de workflow están en `raw/r1` y `raw/r2`. `r1/r2-ladder-context.json` y `r1/r2-diagnosis.json` documentan los hechos y las limitaciones anteriores. `summarize.py` reproduce las tablas sin modelos; `manifest.json` fija los hashes.

Pasaron **4.890 unitarias, 945 de integración, 75 del evaluador offline**, tipos, lint, build y validación ADK. Las dos observaciones materiales del arquitecto —estado reconciliado y cita literal— quedaron corregidas y cubiertas; los resultados y los incidentes resueltos de fixtures/carga de módulos están en `checks.json`. Sin cambios de timeout para hacer pasar tests. Las bases y las entregas fueron locales desechables. **No se desplegó ni se cambió el modelo de producción.**
