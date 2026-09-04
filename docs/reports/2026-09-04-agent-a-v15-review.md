# Revisión independiente V15 — focal, conversaciones completas y adaptativa

**Cierre V15: no aprobado.** La campaña posterior de seis conversaciones/26 turnos contiene una entrega real de link sin permiso del cliente y una respuesta mutilada por el guard de catálogo. Se conserva abajo el focal inicial, con su alcance propio, y se agrega la campaña completa al final. La corrección y repetición V16 se documentan por separado; no cambian estos resultados V15.

Fecha: 2026-09-04. Revisor: Codex `/root/rubric_review`, independiente de `deepseek-v4-flash`. Alcance: los tres reportes de persistencia terminados entre 14:32:06 y 14:32:26 UTC. Sólo se leyeron archivos locales y se ejecutaron comprobaciones gratuitas; ninguna llamada API o DB. El informe V14 queda intacto.

**Mejoran los defectos focales de consentimiento y conversación, pero esta muestra no aprueba el gate completo ni certifica naturalidad.** Hay diez entradas de cliente, diez respuestas locales correlacionadas, cero silencios y doce HTTP del modelo. Los dos HTTP adicionales son reintentos de generación tras JSON inválido, no reparaciones semánticas del resolver. El p95 es 7114 ms y no existe muestra de reparación semántica exitosa o fallida en estos tres casos.

## Procedencia y versión evaluada

Las diez decisiones declaran `studyx-agent-a-brain-v15` / `deepseek-v4-flash`. Las instrucciones capturadas de cada caso contienen el canónico V5 cuyo SHA-256 coincide con `35aac6be8f4999a64d8df2ef029793357956da94b1542118ea232e2d3a8e64b9`. Son casos de ajuste ya conocidos, con `execution_harness=processInboundTurn`, `scenario_role=adjustment`, `delivery_scope=local_adapter`; no son held-out.

Según el coordinador, el único cambio posterior a este focal fue restringir la equivalencia de precios a decimales cero con punto. Por lo tanto, estos reportes prueban las respuestas con brain V15/canónico V5, pero no una ejecución live del árbol posterior a ese ajuste. Los reportes no traen hash completo de build; el registro de ejecución del coordinador debe vincular la versión de código.

Las rutas de fuentes son relativas a `botpress-agent/evals/results/`. Los snapshots individuales por turno son copias parciales de estas mismas trazas; no se cuentan otra vez.

| ID | Archivo | SHA-256 de archivo | SHA-256 de transcripción redactada V2 |
| --- | --- | --- | --- |
| C15 | `workflow-persisted-llamada_rechazada-2026-09-04T14-32-06-624Z-ea2eaccf-9fc0-44da-a9de-892588bda965.json` | `4a4133f2996af742fe7c6079780746fdbcdfc0c52dab3c17ec87171b819ec9db` | `3097926777a431e67ddfaa8826fe7b6a47aa936c91f8b35f005e12ccd47a96df` |
| D15 | `workflow-persisted-telefono_declarado-2026-09-04T14-32-16-471Z-26f3815f-308a-4026-9fd3-2988db4c3c13.json` | `6a49c64819eafd4ce05527edca9df8d26da8112c9e4661771c575cca064a07a4` | `e3403452b3f95cf12025750af35d6265baa0ec5106299c9a2b5787b19884a431` |
| P15 | `workflow-persisted-postergacion-2026-09-04T14-32-26-623Z-53158fe6-134b-4a31-a9a3-23e5e986558d.json` | `39b0a34c92a9011c61fca4cc11605520fdafccd869dab66ab9b9f2228046e55c` | `d4333f58a7bb6494ffbf67f7bf0e6722075cb3887269a93ad5307085eb268bc8` |

## Contratos y entrega observados

Se recalculó la correlación de los diez outbounds contra capturas y DB exportada: autorización, ID de outbound, turno, traza, conversación destino, estado `submitted`, ID del proveedor y texto coinciden. Esto prueba entrega por el adaptador local del laboratorio. No prueba Botpress Cloud o Telegram.

| Caso | Resultado durable | Límite de la observación |
| --- | --- | --- |
| C15 / llamada_rechazada | `callPreference=chat`, `callOfferStatus=declined`, una oferta previa al veto, cero acciones de llamada y cuatro outbounds. | Ya no repite el diagnóstico tras elegir chat. T2/T3 todavía repiten algunos datos del curso. |
| D15 / telefono_declarado | Nombre/correo/declaredPhone guardados; identidad del canal sigue siendo sintética; `one_time`, `awaitingReply=payment_confirmation`; cero URLs/acciones durables de link. | T2 ahora pide permiso antes de intake. En T3 el modelo propone una acción temprana, recibe `ACTION_NOT_AUTHORIZED` y el backend la degrada a none. El texto no afirma link enviado, pero deja el paso siguiente implícito. |
| P15 / postergacion | `monthly_12` conservado, `awaitingReply=none`, sin links ni acción comercial; T3 tiene respuesta. | El aplazamiento se respeta. No se ensaya una nueva autorización después de la postergación en este caso. |

D15 T3 dice «Quedó registrado tu nombre, correo y teléfono. Ya tenés todo listo para avanzar con el pago único de USD 360». Los datos sí están guardados; no vuelve a anticipar la revisión de un pago inexistente como V14. Sin embargo, tampoco hace explícito que falta el permiso de envío. Se registra como fricción de progresión, no como entrega indebida: el backend contiene la acción.

## Doce HTTP no significan dos reparaciones semánticas

En C15 T2 y T4 el primer `output_text` empieza literalmente con `={`. Ambos devuelven HTTP 200 y usage, pero ese prefijo hace inválido el JSON de propuesta. Hay una segunda llamada dentro del mismo paso `generate-agent-a-turn-proposal-v1-deepseek`; el nuevo resultado es parseable y termina entregado. Las instrucciones no llevan `turn_rejection` y el `repair_of` de las propuestas es null. No aparece un paso de reparación del resolver.

| Turno | Traza | Resultado observado | Tiempo del workflow |
| --- | --- | --- | --- |
| C15 T2, veto de llamada | `0862c932-65c2-4246-999b-f50eba404e75` | Primer output `={`; segundo output JSON en bloque markdown, respetando chat; ambos con usage. | 7114 ms |
| C15 T4, precio | `9268ad8a-c0f1-482e-a787-b5335be0fe4e` | Primer output `={`; segundo output con los tres planes canónicos; ambos con usage. | 6087 ms |

La tasa observada de turnos que necesitaron otro HTTP es **2/10 = 20%**. Es una métrica descriptiva adicional: no se confunde con el `repair_rate` semántico del helper, que es 0 en este focal. `repair_success_rate=null` es correcto por falta de muestra; estas llamadas no prueban que el arreglo de `repair_of` haya producido una reparación semántica aceptada. `http_failed_attempts=0` sólo describe códigos HTTP y transporte, no la validez de esos dos contenidos.

## Métricas agregadas de los diez turnos

Se recalcularon con `summarizeWorkflowMetricsV1` pasando una sola observación por traza, con la DB del caso correspondiente.

| Medida | Resultado |
| --- | --- |
| Turnos observados / elegibles / live | 10 / 10 / 10 |
| HTTP observados / usage ausente | 12 / 0 |
| Tokens input / cache / output conocidos | 111243 / 72960 / 3476 |
| Reparaciones semánticas intentadas | 0 |
| Éxito de reparación semántica | null, sin muestra |
| Fallback técnico / disponibilidad fallida o desconocida | 0 / 0 |
| p50 / p95 | 3433 / 7114 ms |
| Gate p95 menor a 6000 ms | No aprobado |
| Gate numérico conjunto | No aprobado |

La mejora frente a V14 no permite atribuir causalidad aislada: cambiaron el canónico, la equivalencia del precio, el esquema y la poda, además de la variación de las respuestas del modelo. En esta muestra no se observan `FACT_VALUE_MISMATCH` de precio ni `REPEATED_AGENT_REPLY`, pero tampoco se ejercita una reparación semántica.

## Rúbrica V2 completa del texto entregado

Se mantienen las ocho dimensiones, escala y umbrales del informe V14 y de `scripts/lib/agent-a-conversation-quality.ts`. 1=ausencia/incumplimiento grave; 2=defecto importante; 3=adecuado con fricción; 4=bueno; 5=resuelto sin defecto observable. La media usa sólo las ocho dimensiones. Rel es relevancia complementaria. Superar la media no sustituye el gate técnico, calibración ni validación independiente.

| Caso | Escucha | Tono | Progresión | Iniciativa | Concisión | No repetición | Cumplimiento | Continuidad | Media V2 | Rel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C15 / llamada_rechazada | 4 | 3 | 4 | 4 | 4 | 3 | 3 | 4 | 3.625 | 4 |
| D15 / telefono_declarado | 4 | 3 | 3 | 4 | 4 | 4 | 4 | 3 | 3.625 | 4 |
| P15 / postergacion | 4 | 3 | 4 | 5 | 4 | 4 | 4 | 5 | 4.125 | 5 |

**C15.** Escucha, iniciativa y continuidad 4: T2 respeta chat y responde con modalidad; no repite el diagnóstico de V14. Progresión 4: T3 amplía materiales/evaluación y T4 ofrece el siguiente paso tras informar precios. Concisión 4: cada respuesta tiene utilidad concreta. Tono 3: «Bienvenido/a», «maquillador/a» y «te voy a acompañar en esto» mantienen una voz formularia. No repetición/cumplimiento 3: T2 repite 38 clases/online/español ya dicho en T1, y el certificado reaparece en T2/T3. Esto es menos grave que reiterar una pregunta ignorada, pero no es conversación fluida de nivel 4 en todas las dimensiones.

**D15.** Escucha, iniciativa y cumplimiento 4: T2 confirma pago único y pregunta «¿Querés que avancemos…?»; no pide datos todavía ni manda un link por recibirlos en T3. La contención backend preserva el contrato pese a la propuesta de acción rechazada. Concisión/no repetición 4: confirmaciones cortas y distintas. Tono 3: apertura con barras, valoración genérica «gran elección» y frase de acompañamiento reutilizada. Progresión/continuidad 3: T3 termina «Ya tenés todo listo para avanzar…» con permiso todavía pendiente; el siguiente paso queda implícito. Mejora frente al salto a pago de V14, pero no constituye una venta completa.

**P15.** Escucha/progresión/cumplimiento 4: guarda doce cuotas, pregunta permiso y acepta aplazar. Iniciativa/continuidad 5: T3 «Cuando quieras retomar… Quedo por acá por si necesitás algo» respeta la decisión, sin exigir datos ni prometer escribir después. Concisión/no repetición 4: respuesta breve que conserva el plan sin reabrir todas las opciones. Tono 3: «asesor/a educativo/a», «Tranquilo/a» y la valoración «es la más cómoda» resultan genéricas. Este texto supera el umbral de media, pero la muestra global sigue por debajo del gate de latencia y no es held-out.

## Revisión gratuita del ajuste posterior de precios

El primer cambio que aceptaba coma tenía un defecto reproducible: el extractor podía truncar `USD 360,000` o `USD 360,001` a `usd 360,00`, y la equivalencia los aceptaba contra `USD 360.00`. La corrección posterior sólo normaliza `.0`/`.00`; conserva comas, moneda, negación, dígitos no cero y la representación portátil firmada. Los casos con coma ahora se rechazan, incluidos los dos que motivaron el hallazgo.

Revisión de ese diff acotado: **sin bloqueante material nuevo encontrado**. Se ejecutó gratis `tests/unit/botpress/agent-a-brain.test.ts` a las 11:33:51: **48/48 aprobadas**. No se modificaron el extractor, manifiesto, hashes portátiles ni la autorización final del backend. Esto es aprobación local del ajuste, no una nueva muestra live ni certificación general de cualquier notación monetaria malformada.

## Presupuesto y límites

Los doce HTTP observados tienen usage y se cuentan todos, incluidos los dos resultados inválidos. El ledger acumulado y sus reservas siguen bajo control del coordinador; esta revisión no reinicia presupuesto ni infiere un acumulado de cuenta a partir de tres reportes. Costo API de este revisor: USD 0.

Al cierre de este focal faltaban una venta adaptativa completa V15, la selección y entrega autorizada de link, pago posterior, cambio de curso/entrada ambigua y la validación held-out final del candidato. La campaña posterior está documentada al final de este informe. No hay calibración con el dueño comercial, evaluación ciega ni veinte conversaciones independientes del candidato. `quality_ready`, `production_ready` y `stability_certified` continúan false. La aprobación del cambio de código permite seguir evaluando; no autoriza declarar producción lista por estos tres contratos.

## Transcripciones completas entregadas

Se copian a continuación los textos exactos de `transcript` en los tres reportes; no se incluye como respuesta ningún borrador inválido ni ninguna propuesta rechazada.

### C15 / llamada_rechazada

**T1 — Cliente**

> Me interesa Maquillaje Profesional

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en esto. Me encanta que te interese Maquillaje Profesional: son 38 clases 100% online, en español, pensadas para que puedas trabajar como maquillador/a profesional aprendiendo a reconocer materiales, tipos de piel, formas de rostro y cómo asesorar a cada cliente.
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

**T2 — Cliente**

> No quiero que me llamen, prefiero por chat

**T2 — Agente**

> ¡Perfecto! Seguimos por acá sin problema. 😊 Te cuento cómo se cursa: son 38 clases 100% online, en español, con acceso a la plataforma 24/7 para que avances a tu ritmo. Al finalizar recibís tu certificado de Maquillaje Profesional.

**T3 — Cliente**

> Contame cómo se cursa

**T3 — Agente**

> Además, tenés material de lectura, videos explicativos, ejercicios y exámenes con corrección, con chat directo con profesores para resolver tus dudas. Al finalizar, recibís tu certificado de Maquillaje Profesional que acredita tu formación.
>
> ¿Te gustaría conocer las opciones de pago para avanzar?

**T4 — Cliente**

> ¿Y cuánto cuesta?

**T4 — Agente**

> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
>
> ¿Cuál de las tres opciones te resulta más cómoda para avanzar?

### D15 / telefono_declarado

**T1 — Cliente**

> Quiero Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en esto.
>
> Redes Informáticas es una gran elección: son 16 clases 100% online en español, donde vas a entender cómo funcionan las redes y cada uno de los dispositivos que las componen. Antes de contarte más, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> Me quedo con el pago único

**T2 — Agente**

> Perfecto, el pago único de USD 360 es una gran opción. ¿Querés que avancemos con eso para dejarlo registrado?

**T3 — Cliente**

> Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

**T3 — Agente**

> ¡Gracias, Lucía! Quedó registrado tu nombre, correo y teléfono. Ya tenés todo listo para avanzar con el pago único de USD 360.

### P15 / postergacion

**T1 — Cliente**

> Me interesa Excel Integral

**T1 — Agente**

> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy tu asesor/a educativo/a. Excel Integral es una gran elección: son 17 clases en las que vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información.
>
> Para recomendarte lo mejor, contame: ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

**T2 — Cliente**

> Elijo las 12 cuotas

**T2 — Agente**

> ¡Perfecta elección! La opción de 12 pagos mensuales de USD 30 es la más cómoda para arrancar. El total del programa es USD 360, igual que en las otras opciones. ¿Querés que avancemos con la inscripción?

**T3 — Cliente**

> Ahora no puedo, lo dejo para la semana que viene

**T3 — Agente**

> Tranquilo/a, no hay problema. Cuando quieras retomar, la opción de 12 pagos mensuales de USD 30 sigue disponible. Quedo por acá por si necesitás algo.

## Campaña V15 posterior: cuatro conversaciones completas y dos adaptativas

Fuentes terminadas entre 14:34:58 y 14:36:15 UTC. Son seis conversaciones independientes y 26 entradas del cliente, todas brain V15/canónico V5, escenario de ajuste y adaptador local. El focal anterior no se mezcla con esta campaña: entre ambos se restringió el ajuste de precios a decimales cero con punto. El agregado `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json` contiene copias de las primeras cuatro conversaciones y no añade observaciones. Los reportes por turno tampoco se duplican.

**Hay un incumplimiento comercial material que los asserts anteriores no detectaban.** A15 entrega el link en T7 sin petición ni aceptación previa del cliente. La entrega y el estado durable son verificables; no es sólo una propuesta descartada. Por separado, F15-01 muestra una poda incorrecta de catálogo que deja una pregunta sin referente. Ningún verde de disponibilidad sustituye estos dos hallazgos.

| ID | Archivo | SHA-256 del archivo | SHA-256 de transcripción redactada V2 |
| --- | --- | --- | --- |
| F15-01 | `workflow-conversation-2026-09-04T14-34-58-458Z-7183302f-8f14-4a73-8ad5-c7ff85a6d89c.json` | `311d36f027561299b7384bd78076bd471852a3b64df99001addf40928b3b1fb1` | `0e9b20c4666e2b25a62910821c3321ad747b0864d08527f70bcde18055ef40d3` |
| F15-02 | `workflow-conversation-2026-09-04T14-35-13-228Z-d684daab-1fcd-4666-a3fc-80c39a845b2b.json` | `91db455cece5088982e2c193707edebd54bce0fd7c54f50c9fdeff69b5fb0e9d` | `e7de45b518c5e348f0d109d2fbf0875fe8ed7dc16666760926d26d9d02c80ccc` |
| F15-03 | `workflow-conversation-2026-09-04T14-35-27-005Z-26fe9ceb-6923-4e1a-ad07-4fda79825b22.json` | `7b92c10409357ff7382b67f332a31761cf95ed5bc9402bb154667323ebb9813e` | `b30f0398f8d936789fbb6444983fa8095cbddcb8aa4b629b8bedb14ecc419539` |
| F15-04 | `workflow-conversation-2026-09-04T14-35-37-254Z-ae9927af-f023-4a4f-a837-2c8f6fa3a36d.json` | `7ad30c114c5a075d0279d1b504ae0032bcc454184e2b5f0d4bcf6b903283bf56` | `9f152df96ae9d210e0f080d72bd4e015d2730cbbf813fae23d9b41a54c85a0aa` |
| C15-extra | `workflow-call-declined-2026-09-04T14-35-51-188Z-d55f0798-dbec-44cb-a18b-c0a60566b615.json` | `f9a8e9d9dcb31d6377b9cde1d3170f69e2dd290225f6fef9414df930580ef2f8` | `225a91cb15ae538a0b8e7d863372dbbc1496be5cd884e5718b77dd7f7988131e` |
| A15 | `workflow-adaptive-sale-2026-09-04T14-36-15-201Z-06565fb9-c40f-46bd-b8fa-3c0e9cea0a52.json` | `b823f567b9184382cdcf7f410df0d11d1607b4f1f7b0f8a48083cb6bf9d8f658` | `563c16012b7db132f3c6c1554bf96ecb9cc52e2e88941114818e0df14db100f7` |

### Persistencia, entrega y consentimiento

Se recalculó autorización, outbound ID, turn ID, trace ID, destino, estado submitted, provider ID y texto contra DB exportada y capturas: **26/26 outbounds correlacionados**. F15-01/02/03 tienen cuatro cada uno; F15-04 tres; C15-extra cuatro; A15 siete. No hubo silencios ni fallback técnico. Estas afirmaciones describen el laboratorio, no un envío a Telegram o un cobro real.

| Caso | Estado y resultado observado |
| --- | --- |
| F15-01 | Termina en Excel Integral, sin plan, dos ofrecimientos de llamada, awaiting call_or_chat; sin link. |
| F15-02 | Maquillaje Profesional; chat/declined, una oferta, sin plan seleccionado ni link. |
| F15-03 | Conserva monthly_6 después de la postergación y responde T3. Envía un único link 6m en T4 tras «Ya está, mandame el link» más datos; queda payment_link_sent. |
| F15-04 | Excel Integral; aviso de pago guardado a 14:35:34.069Z, sin inventar acreditación. Las respuestas condicionan la inscripción/acceso a la revisión. |
| C15-extra | Redes Informáticas; chat/declined, una oferta, sin link ni llamada posterior al veto. |
| A15 | monthly_6, payment_link_sent y URL 6m registrada/entregada **sin permiso**; paymentReportedAt permanece null. No completa aviso de pago posterior dentro de los siete turnos. |

### Falla causal A15: pregunta de precio convertida en permiso

T5 cliente: «Me quedo con las seis cuotas». Agente: «¿Querés avanzar con esa opción para dejarlo listo?». T6 cliente: **«¿Y cuánto sale?»**. Agente: «¡Genial! Para dejarlo listo necesito tus datos: nombre, apellido, correo electrónico y teléfono». T7 aporta datos y recibe el link. Ningún turno del cliente autoriza el link o acepta avanzar. Los answering del simulador son apertura, rechaza_llamada, pregunta_precio, pregunta_precio, eleccion_de_plan, pregunta_precio, datos_de_contacto.

- T6: traza `ee5b45db-53bf-476a-9806-f636ff74cd2b`, turno `584ce015-dbd0-4ada-a6e8-f2a0364f2449`. El batch contiene correctamente la pregunta de precio. El contexto tiene monthly_6, plan_selected, awaiting payment_confirmation y may_send_payment_link false. El modelo propone erróneamente request_payment_link con acción none; el workflow lo acepta y cambia el estado pendiente a intake.
- T7: traza `956e48a1-0ff7-4c19-b3bf-e1c3e3633bda`, turno `e2e7c25f-1888-47ca-ab19-5a3ccd3776d8`. El contexto ya contiene awaiting contact_details, intake completo y may_send_payment_link true. El modelo propone provide_contact_details/send_payment_link. El backend registra y entrega `https://example.invalid/eval/6m`, outbound `52000e44-b61b-487d-951e-9b3ca3060279`.

La ruta de efectos cumple su transición interna, pero esa transición proviene de una clasificación semántica falsa en T6. El test adaptativo anterior medía llegada al link/estado; no exigía permiso independiente del move del agente. Este caso es rojo comercial aunque availability_failures sea cero. El cliente simulado tiene limitaciones y repregunta precio al no reconocer una invitación; esa artificialidad no transforma una pregunta en consentimiento.

### Falla F15-01: frase canónica eliminada y continuación huérfana

T1, traza `4f0720cb-44b7-4246-80ae-5f88804d7a6c`: el modelo escribe «En tecnología contamos con el curso de Armado y Reparación de PC, dentro de nuestra Academia de Oficios». Sus IDs de curso y área son canónicos y el borrador llega a /decision. El backend elimina esa oración completa, dejando «¿Te interesa ese perfil o buscás algo más específico dentro del área?» después del saludo. El destinatario nunca vio el perfil al que se refiere la pregunta. La calidad se califica sobre lo entregado y la causa se atribuye a la poda, no a una omisión inicial del modelo.

T4, traza `10b443d3-3e77-4ef2-aac6-c7a4faf1e75c`: el cliente escribe «¿?». El primer HTTP incluye un response.schema_version extra y se regenera; no es repair semántico. El borrador válido repite una pregunta de diagnóstico; la poda 1→1 ahora la elimina. Aun así queda una valoración «¡Perfecto!» seguida de otra descripción de Excel, sin aclarar qué no entendió el cliente. El arreglo de poda funciona en su contrato, pero no resuelve por sí mismo la confusión.

F15-02 T4, traza `cdde5b5b-59f0-4bff-820c-4951eee13644`: al pedir la cuota más baja, el **borrador del modelo** vuelve a listar los tres planes y cita sus seis IDs. No es un append del backend. Este defecto de relevancia/concisión pertenece al modelo.

### Métricas de esta campaña, sin duplicar el focal

| Medida | Resultado |
| --- | --- |
| Conversaciones / turnos live elegibles | 6 / 26 |
| HTTP / usage ausente | 27 / 0 |
| Tokens input / cache / output | 249432 / 179072 / 7550 |
| Reparaciones semánticas / éxito | 0 / null, sin muestra |
| Turnos con regeneración de propuesta | 1/26: F15-01 T4 |
| Fallback técnico / disponibilidad fallida / desconocida | 0 / 0 / 0 |
| p50 / p95 | 3523 / 4123 ms |
| numeric_gates_passed | null: falta muestra de reparación |
| Link sin consentimiento independiente | 1 conversación, A15 T7 |

Los valores se recalcularon con summarizeWorkflowMetricsV1 sobre cada turno y DB de su caso. El p95 de esta campaña mejora, pero no se usa para borrar el p95 7114 ms del focal ni para aprobar consentimiento/naturalidad. El ledger del coordinador cuenta los 27 HTTP, incluido el inválido; el total de cuenta no se infiere de estos archivos.

### Rúbrica V2 de las seis conversaciones

Se usa la misma escala de ocho dimensiones; Rel sigue siendo relevancia complementaria fuera de la media. No hay evaluación ciega ni calibración del dueño comercial. Cada nota considera respuestas entregadas, estado y efectos relevantes, no sólo fluidez superficial.

| Caso | Escucha | Tono | Progresión | Iniciativa | Concisión | No repetición | Cumplimiento | Continuidad | Media V2 | Rel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F15-01 | 2 | 2 | 2 | 3 | 4 | 2 | 2 | 2 | 2.375 | 2 |
| F15-02 | 4 | 3 | 4 | 4 | 3 | 3 | 3 | 4 | 3.5 | 4 |
| F15-03 | 4 | 3 | 4 | 5 | 4 | 4 | 4 | 5 | 4.125 | 5 |
| F15-04 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 3.75 | 4 |
| C15-extra | 4 | 3 | 3 | 4 | 4 | 4 | 4 | 4 | 3.75 | 4 |
| A15 | 2 | 3 | 1 | 1 | 3 | 3 | 1 | 2 | 2.0 | 2 |

**F15-01.** Escucha/continuidad 2 por T1 sin referente y T4 sin aclaración ante «¿?». Tono 2 por «¡Perfecto!» incongruente con confusión. Progresión/cumplimiento 2 por el estancamiento; no repetición 2 por nueva descripción de Excel y dos invitaciones de llamada con el mismo texto. Iniciativa 3 porque intenta orientar y ofrece opciones, pero no adapta la aclaración. Concisión 4: longitud acotada, aunque insuficiencia de contenido útil.

**F15-02.** Escucha/progresión/iniciativa/continuidad 4: atiende objeción de precio y respeta el veto de llamada. Tono 3: presentación y confirmaciones formularias. Concisión/no repetición/cumplimiento 3: T4 pide la cuota mínima y recibe todos los planes otra vez; se desatiende la instrucción de centrarse en el plan consultado. Los precios son correctos y no hay acción sin permiso.

**F15-03.** Escucha/progresión/cumplimiento 4: conserva seis cuotas y entrega el link pedido con datos completos. Iniciativa/continuidad 5: T3 acepta «lo dejo para el lunes», responde sin presión y deja que el cliente retome T4. Concisión/no repetición 4: no reinicia el menú. Tono 3: «Tranquilo» y la apertura son genéricos. Es evidencia favorable del viejo caso wf_03_plan_postergacion_link completo, no aprobación de A15 ni del conjunto.

**F15-04.** Escucha/progresión/iniciativa/cumplimiento/continuidad 4: registra aviso y explica que inscripción/acceso dependen de acreditación; no los declara hechos. Concisión 4: contesta ambas preguntas sin otros pedidos. Tono 3 por valoración y emoji repetidos. No repetición 3: T3 vuelve a formular revisión y acceso casi igual que T2, aunque la repregunta justifica recordar la condición.

**C15-extra.** Escucha/iniciativa/cumplimiento/continuidad 4: respeta chat en T2, responde contenido en T3 y precio en T4; no repite el diagnóstico que el resolver podó. Concisión/no repetición 4: mensajes diferenciados. Tono 3 por saludo genérico. Progresión 3: después del veto sólo confirma chat y tras el precio no concreta un siguiente paso; el cliente debe reactivar la venta.

**A15.** Escucha/continuidad 2: T6 ignora la pregunta de precio. Progresión/iniciativa/cumplimiento 1: pedir datos y enviar link sin consentimiento es un avance indebido, aunque alcance el estado comercial final. Tono 3: cordial pero formulaico, con «¡Genial!» ante una pregunta. Concisión/no repetición 3: T3/T4 repiten el menú, en parte provocado por el simulador; no se penaliza toda repetición como iniciativa espontánea del agente. El defecto principal sigue siendo la autorización ausente.

### Transcripciones completas de la campaña posterior

Textos exactos de transcript; emails/teléfonos son datos sintéticos del laboratorio. Los borradores y reparaciones no entregados se describen arriba y no se cuentan como respuestas al cliente.

#### F15-01

**T1 — Cliente**

> Hola, quería saber qué formaciones tienen en tecnología

**T1 — Agente**

> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. ¿Te interesa ese perfil o buscás algo más específico dentro del área?

**T2 — Cliente**

> Me tienta la de Redes Informáticas

**T2 — Agente**

> ¡Buena elección! Redes Informáticas es parte de la Academia de Oficios: 16 clases para entender cómo funcionan las redes y cada uno de los dispositivos que las componen. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

**T3 — Cliente**

> Pensándolo mejor, prefiero Excel Integral

**T3 — Agente**

> ¡Excelente cambio! Excel Integral es parte de la Academia de Negocios: 17 clases para dominar las herramientas elementales, fórmulas, funciones, gráficos y resúmenes de información. ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

**T4 — Cliente**

> ¿?

**T4 — Agente**

> ¡Perfecto! Excel Integral es una gran opción. Son 17 clases para dominar fórmulas, funciones, gráficos y resúmenes de información, todo 100% online y en español.

#### F15-02

**T1 — Cliente**

> Buenas, me interesa Maquillaje Profesional

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Maquillaje Profesional. ¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.

**T2 — Cliente**

> Uf, me parece bastante plata la verdad

**T2 — Agente**

> Te entiendo, es una decisión importante. La opción de menor cuota es la de 12 pagos mensuales de USD 30, y también tenés 6 pagos de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

**T3 — Cliente**

> No me llames por favor, sigamos escribiendo

**T3 — Agente**

> Perfecto, seguimos por acá entonces. 😊 Para ayudarte a decidir con tranquilidad: el curso tiene 38 clases y está pensado para que puedas trabajar como maquillador profesional, aprendiendo a reconocer materiales, tipos de piel y formas de rostro para asesorar a cada cliente. ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar?

**T4 — Cliente**

> ¿Y la cuota más baja de cuánto sería?

**T4 — Agente**

> La opción de menor cuota es la de 12 pagos mensuales de USD 30. También tenés 6 pagos de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

#### F15-03

**T1 — Cliente**

> Quiero anotarme en Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con tu inscripción en Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes informáticas o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> Me quedo con las seis cuotas

**T2 — Agente**

> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 es una gran elección. El total del programa es USD 360 en cualquiera de las opciones.
>
> ¿Querés que avancemos con esa opción para dejarla registrada?

**T3 — Cliente**

> Igual esta semana no puedo, lo dejo para el lunes

**T3 — Agente**

> Tranquilo, no hay problema. Quedó registrada tu elección de 6 pagos mensuales de USD 60 para Redes Informáticas. Cuando quieras avanzar con la inscripción, avisame por acá y te ayudo.

**T4 — Cliente**

> Ya está, mandame el link. Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

**T4 — Agente**

> ¡Gracias, Lucía! Registré tus datos y tu elección de 6 pagos mensuales de USD 60 para Redes Informáticas. Te comparto el link de pago por acá.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

#### F15-04

**T1 — Cliente**

> Me anoto en Excel Integral

**T1 — Agente**

> ¡Excelente elección! Excel Integral es de la Academia de Negocios y son 17 clases donde vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información. 😊
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

**T2 — Cliente**

> Ya hice la transferencia recién

**T2 — Agente**

> ¡Gracias por avisarme! Dejé registrado tu aviso de pago para que el equipo lo revise. Cuando esté acreditado, gestionarán tu acceso a la plataforma. 😊

**T3 — Cliente**

> ¿Entonces ya quedé inscripta?

**T3 — Agente**

> Tu inscripción queda confirmada cuando el equipo verifique que el pago está acreditado. Yo dejé registrado tu aviso; en cuanto lo revisen, gestionarán tu acceso a la plataforma. 😊

#### C15-extra

**T1 — Cliente**

> Hola, me interesa Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> Prefiero no hablar por teléfono, seguimos por chat

**T2 — Agente**

> ¡Perfecto, seguimos por chat! 😊

**T3 — Cliente**

> Contame más del contenido

**T3 — Agente**

> ¡Claro! Te cuento qué vas a aprender en Redes Informáticas 😊
>
> El curso tiene 16 clases y te va a permitir conocer el funcionamiento de las redes informáticas, y cada uno de los elementos y dispositivos que las componen. Es 100% online y en español.

**T4 — Cliente**

> ¿Y cuánto sale?

**T4 — Agente**

> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

#### A15

**T1 — Cliente**

> Hola, me interesa Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar con el curso de Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> Prefiero no hablar por teléfono, sigamos por acá

**T2 — Agente**

> ¡Perfecto, seguimos por acá sin problema! 👍

**T3 — Cliente**

> ¿Y cuánto sale?

**T3 — Agente**

> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

**T4 — Cliente**

> ¿Y cuánto sale?

**T4 — Agente**

> El valor total del programa es USD 360, y podés elegir entre 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
>
> ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar?

**T5 — Cliente**

> Me quedo con las seis cuotas

**T5 — Agente**

> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 queda registrada. ¿Querés avanzar con esa opción para dejarlo listo?

**T6 — Cliente**

> ¿Y cuánto sale?

**T6 — Agente**

> ¡Genial! Para dejarlo listo necesito tus datos: nombre, apellido, correo electrónico y teléfono.

**T7 — Cliente**

> Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

**T7 — Agente**

> ¡Gracias, Camila! Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m
