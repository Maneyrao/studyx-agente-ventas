# Revisión independiente V16 — campaña final de 13 conversaciones

Fecha: 2026-09-04. Evaluador Codex /root/rubric_review, distinto del modelo generador deepseek-v4-flash. Sólo se leyeron archivos locales y se recalcularon hashes, métricas y correlaciones; ninguna llamada API, DB o producción. Costo propio USD 0.

**Los gates numéricos de esta campaña pasan, pero la calidad conversacional no queda aprobada.** El arreglo de catálogo conserva ahora la frase útil, el flujo adaptativo V2 llega al link con permiso previo y luego registra el aviso de pago. Persiste repetición de opciones y aparece un defecto backend que elimina una condición válida de acreditación. Se registra el resultado completo, sin elegir sólo los turnos favorables.

## Procedencia

Fuentes completas entre 14:50:56 y 14:53:22 UTC, todas escenario de ajuste, processInboundTurn y delivery_scope local_adapter. Son 13 conversaciones y 48 entradas del cliente. Hay 46 turnos live de brain V16/canónico V5; el opt-out y su bloqueo posterior son dos turnos de política sin modelo. Sus versiones deterministas propias no implican que la conversación haya usado brain V17.

El guard de descriptor de área estaba corregido para esta campaña. La regresión V16 de consentimiento de 14:43 queda en su informe anterior y no se suma aquí. Los cambios propuestos para V17/canónico V6 todavía no pertenecen a esta evidencia. No hay hash completo de build dentro de los snapshots; su correspondencia con árbol/commit debe quedar en el registro del coordinador.

Los agregados workflow-conversations y workflow-persisted-outcomes, checkpoints adaptativos y archivos workflow-turn duplican trazas de estos reportes completos. No se cuentan como casos adicionales. Las rutas siguientes son relativas a botpress-agent/evals/results/.

| ID | Archivo | SHA-256 del archivo | SHA-256 de transcripción redactada V2 |
| --- | --- | --- | --- |
| F16-01 | `workflow-conversation-2026-09-04T14-50-56-039Z-a96695a1-357a-45be-a56f-3cd6668f76ca.json` | `8a30ac72bfdbe7f62675919b5715a3724bcb31fe04bb7c7bb8b6fc7734606d8a` | `f23561e4dc9d72555b10299649c91acdfcfbc44c7d23f75d74aca86073925762` |
| F16-02 | `workflow-conversation-2026-09-04T14-51-09-691Z-839b72e7-67ea-459f-9766-cd09b7040019.json` | `025a9e0929d04b01791ffa106275d3cda73f8599579a31867c172826f23ba38b` | `198c3a70f2a2ab531d5a98718bba3c1c91c0601c4d4543b36c31344f7832a342` |
| F16-03 | `workflow-conversation-2026-09-04T14-51-23-026Z-8b662a24-e6dc-4251-bdad-652d39ee7470.json` | `d31f7b5d470c4dcaf152b630fdab4d21cfe4534cd280e00cdf4a4163ebcfdf06` | `36f098ffadebe7fa4e0e31942b62d6d6d2cf3db36869d8d0d4d97b27b3ba0418` |
| F16-04 | `workflow-conversation-2026-09-04T14-51-32-546Z-caa34754-ed55-4be2-91cd-ecf9e0e4b064.json` | `8e87d1270c90b2950b4e1d4ca102aea5e8eadcc037c0e6431723966dd6bc20b0` | `86a3f612583d79722e8a78066db76c4ee3f050fb63df4241cf59cdd85ee8968b` |
| C16 | `workflow-call-declined-2026-09-04T14-51-46-243Z-13ff04f7-81a1-4c82-adc4-cc57915a3eb1.json` | `3d1740976355240f51f1dbc5c9c1b03ec468c8005bb76dd3aa903f56f5dab3ed` | `521c24bdfbc57d1008d90d80c0806c89c457e9957322ecc8a977e94702fc58bf` |
| P16-curso | `workflow-persisted-curso_cambiado-2026-09-04T14-51-57-055Z-0d77d739-5fad-4a2a-927a-28a7b9b14f5d.json` | `c255c7232c465760f4dd148d6bb3af304f272b7fb51bab7bbd0138ae3c80e6f9` | `9852dea490bd38dcc13e00b757c833a231b518fe1ebab7a34648ebfc6d058d27` |
| P16-chat | `workflow-persisted-llamada_rechazada-2026-09-04T14-52-11-954Z-80074a31-29d6-498b-9886-ecde7ce3f750.json` | `521f8754485eda23db2e1f0fce72fdc7c5d2db28f3af56663106aa02907f79e5` | `ec18dcb2a03b20a4bf7c521a4990e17ee4d0746808406b9482a57d1c7c9bf7b5` |
| P16-datos | `workflow-persisted-telefono_declarado-2026-09-04T14-52-24-620Z-f2921575-f282-433b-8854-50d89e2c08fc.json` | `c5dbd27911e59ef91ca1dc116b3cd95d71a8dd7f111d18541356508bdfb609dd` | `eb34b0ee69bc967745db16ca5576e50906125670c16ea40741506c6a35d7b73c` |
| P16-link | `workflow-persisted-link_autorizado-2026-09-04T14-52-35-067Z-df402150-4ae6-43a1-b021-966c54359eeb.json` | `293a3870c31eb4547b9853aa4f4fafd65920cbbe3a740cad21ced0410a6303fe` | `43739f24665c588b2e2fc6afd309526b436d808d2a8ba7cb945c9f25ec10b256` |
| P16-post | `workflow-persisted-postergacion-2026-09-04T14-52-44-591Z-a38e2940-26c9-465c-9278-571b01f63aa2.json` | `7adc8daf1d3d76d6442aaff0d9cf2eafa4f57d561150556008fd49c70d7b997a` | `468d502fd7123b14562d893557a1b852cb6744d4191ed7ac667ab9fe860022ef` |
| P16-pago | `workflow-persisted-pago_informado-2026-09-04T14-52-54-192Z-63899903-e2d1-4ede-9482-3b6a1d2883ab.json` | `0791e469f5fc566f494eebd6a73a080cfbd96ef04212efca31e9613c464fb8b3` | `47bc7014bddd5e5c593ab90061953904e98abf9bf7a9d9ac03aff6e760a628d8` |
| P16-optout | `workflow-persisted-opt_out-2026-09-04T14-52-59-700Z-93619d90-b5ce-4be3-8d27-30b15abd45d4.json` | `b38a1b31e42ccc23a95a42721bfe09fa14545588aa9ad76c1567f11643bcf40a` | `713c9f24296feb70a4b10269411b916b953d2787c27e39f8a1a63a0c7b9801c8` |
| A16 | `workflow-adaptive-sale-2026-09-04T14-53-22-417Z-06e1b94e-9341-49af-a41d-3ad0f7d149ac.json` | `6b1e1fe359c84d328b74e04b2e66e4f069d1148d8995c12611476cb54439eef8` | `62c252c82e8c9eaea1d01f57b5285345e08994fd31d3f03ea9eb45ec357c9d71` |

## Resultado durable y entrega

Se recalculó para cada outbound la coincidencia de ID autorizado, outbound ID, turn ID, trace ID, destino, estado submitted, provider ID y texto con la captura local. **47/47 outbounds coinciden.** La única entrada sin respuesta es P16-optout T3, después de revocación explícita y durable; no se clasifica como silencio técnico.

| Caso | Resultado verificable |
| --- | --- |
| F16-01 / cambio de curso | Excel Integral final, sin plan/link, dos ofertas de llamada; T1 conserva curso y área canónicos y T4 responde a «¿?» con aclaración. |
| F16-02 / objeción y chat | Maquillaje, chat/declined, una oferta y ninguna llamada después del veto; sin plan/link. |
| F16-03 / postergación y link | monthly_6 conservado; T3 responde aplazamiento, T4 pide explícitamente link con datos completos y recibe una URL 6m. |
| F16-04 / aviso de pago | paymentReportedAt 14:51:29.623Z. T2 es correcto; T3 sufre la poda descrita abajo. No hay acreditación ni acceso efectivamente entregado. |
| C16 / llamada rechazada | Chat/declined, una oferta, cuatro respuestas, sin acciones de llamada. |
| P16-curso | Cambia Redes→Excel, selectedOfferingCode excel_integral, sin plan/link. |
| P16-chat | Chat/declined, una oferta; responde modalidad y precio sin insistir en llamada. |
| P16-datos | one_time/plan_selected/awaiting payment_confirmation. Nombre/email/declaredPhone guardados; identidad del canal sintética distinta. Acción prematura reparada y cero URLs. |
| P16-link | monthly_6/payment_link_sent; petición explícita T3 y una URL 6m correlacionada. |
| P16-post | monthly_12/plan_selected/awaiting none; postergación respondida y ninguna URL. |
| P16-pago | Aviso de pago a 14:52:50.965Z; T3 explica que el acceso todavía depende de acreditación, sin inventarla. |
| P16-optout | consentStatus revoked; T2 ack y T3 bloqueado sin modelo ni outbound, con evidencia causal de revocación. |
| A16 / adaptativa V2 | monthly_6; permiso explícito T5, URL T6, aviso de pago T7 a 14:53:22.382Z; chat/declined y una oferta. |

En A16, el cliente elige «Me quedo con las seis cuotas» en T4 y **autoriza «Sí, mandame el link de pago para avanzar» en T5**. T6 aporta datos y la acción send_payment_link corresponde al turno `307010a5-19e7-46b4-807e-79c1950f3a6d`; T7 confirma haber pagado y el aviso queda durable. El simulador V2 conoce explícitamente su plan y etiqueta esa autorización; sus transcripciones anteriores V1 mantienen su procedencia y sus fallos. El éxito de esta secuencia no exonera el link no consentido V15.

En P16-optout la revocación lleva evidenceEventId `0e946b8c-495e-4ff0-96f3-2302ed8c49aa`, revokedTurnId `13a478a6-c898-453e-ba32-af1a3f6c9722`, revokedAt 14:52:57.610Z. El turno posterior `9338dc68-47a5-4f46-abc9-33d9a442e3c3` produce CONSENT_REVOKED, sin respuesta/outbound, después del ack. El silencio es causal, no una inferencia basada sólo en la foto final del contacto.

## Reparación semántica y métricas

P16-datos T3, traza `f04cfeb3-3af5-4ac7-b50b-93ac28a39052`: la primera respuesta `ca68378d-47a6-4b98-8406-7806d4db8f69` propone provide_contact_details/send_payment_link pese a awaiting payment_confirmation. El resolver rechaza ACTION_NOT_AUTHORIZED. La segunda respuesta `fb8a44cd-03f0-4b3f-9b32-3ce9405d78c4` conserva el significado del turno, cambia acción a none y lleva repair_of con rejection_id `5f6344c2-ab89-4cb5-ac3c-5ba94fa3f10f`, attempt 1, coincidente con el contexto de rechazo. El evento confirma repaired true y el texto entregado pide la confirmación que faltaba. Es reparación semántica real, no reintento de parseo.

Hay otras cuatro trazas con REPEATED_AGENT_REPLY y repair_attempted false: A16 T2, C16 T2, P16-curso T3 y P16-chat T2. Son podas locales de preguntas repetidas, no cuatro llamadas adicionales ni reparaciones semánticas exitosas. El único HTTP adicional de la campaña es la reparación de P16-datos.

| Medida | Resultado recalculado |
| --- | --- |
| Conversaciones / entradas / elegibles live | 13 / 48 / 46 |
| HTTP / usage ausente / HTTP fallidos | 47 / 0 / 0 |
| Tokens input / cache / output | 437666 / 306816 / 11742 |
| Repair intentadas / exitosas | 1 / 1 |
| Repair rate / success rate | 2,1739% / 100% (una observación) |
| Fallback técnico / disponibilidad fallida / desconocida | 0 / 0 / 0 |
| p50 / p95 | 3410 / 3852 ms |
| Máximo observado | 6007 ms, P16-datos T3 |
| numeric_gates_passed | true, para esta campaña solamente |

Los valores se calcularon con summarizeWorkflowMetricsV1 sobre cada turno y DB del caso. 1/1 reparación no certifica confiabilidad de reparación en producción. El p95 excluye turnos sin modelo conforme al helper y no se combina con la muestra adversarial 14:43 para ocultar su resultado. Las 47 llamadas tienen usage; el gasto de cuenta y reservas se concilian en el ledger del coordinador, sin reiniciar el prior USD 0,38.

## Defecto material nuevo: condición de acreditación eliminada

F16-04 T3 pregunta «¿Entonces ya quedé inscripta?». Traza `ed6a1eb7-4194-459f-8601-d2171b3dea8f`, turno `2bafcc4e-98a8-4613-ab90-039eead254cb`, respuesta DeepSeek `87928e6b-bdad-4685-8eff-d96cd7e86234`.

Texto generado y proposal enviado a /decision:

> Tu aviso de pago quedó registrado para revisión del equipo. La inscripción se confirma cuando el pago esté acreditado; en ese momento gestionarán tu acceso.

Texto finalmente autorizado/entregado, outbound `fbf75d2f-6339-4c0c-91e8-5ad67fc375d4`:

> Tu aviso de pago quedó registrado para revisión del equipo. en ese momento gestionarán tu acceso.

El backend elimina «La inscripción se confirma cuando el pago esté acreditado;». El modelo había condicionado correctamente el acceso. La salida deja minúscula tras punto, referencia «ese momento» sin antecedente y omite la condición de acreditación que respondía la duda. El usuario puede interpretar que basta la revisión, sin acreditación. No se observa entrega efectiva de acceso, pero sí una degradación material de la explicación. El evento plannerless muestra cero rechazos/reparaciones y availability_failures cero: las métricas técnicas no capturan este defecto textual. Corregirlo requiere preservar la condición válida, no calificar el original V16 como correcto por el borrador.

La mejora de F16-01 también es visible: T1 ahora conserva «Armado y Reparación de PC, dentro de nuestra Academia de Oficios» en la salida y T4 contesta «¿Tenés alguna duda puntual sobre Excel Integral o querés que te cuente cómo funciona el curso?». Desaparecen el perfil huérfano y «¡Perfecto!» ante «¿?» de V15 en esta muestra.

## Rúbrica V2 completa

Ocho dimensiones 1–5; media de ocho, umbral al menos 4 y ninguna dimensión menor que 3. Rel es relevancia fuera de la media. Se mantiene la escala de los informes anteriores. Son notas de revisión independiente del modelo generador, **no evaluación ciega ni calibrada por el dueño comercial**. No se fusionan casos de distinto candidato y no se convierte un gate numérico en aprobación de calidad.

| Caso | Escucha | Tono | Progresión | Iniciativa | Concisión | No repetición | Cumplimiento | Continuidad | Media V2 | Rel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F16-01 | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 3.75 | 4 |
| F16-02 | 4 | 3 | 3 | 3 | 3 | 2 | 3 | 4 | 3.125 | 3 |
| F16-03 | 4 | 3 | 4 | 5 | 4 | 4 | 4 | 5 | 4.125 | 5 |
| F16-04 | 3 | 2 | 3 | 3 | 4 | 3 | 2 | 2 | 2.75 | 2 |
| C16 | 4 | 3 | 3 | 4 | 4 | 4 | 4 | 4 | 3.75 | 4 |
| P16-curso | 4 | 3 | 4 | 4 | 3 | 3 | 4 | 4 | 3.625 | 4 |
| P16-chat | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3.875 | 4 |
| P16-datos | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3.875 | 4 |
| P16-link | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3.875 | 4 |
| P16-post | 4 | 3 | 4 | 5 | 4 | 4 | 4 | 5 | 4.125 | 5 |
| P16-pago | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3.875 | 4 |
| P16-optout | 5 | 3 | 5 | 5 | 4 | 5 | 4 | 5 | 4.5 | 5 |
| A16 | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3.875 | 4 |

**F16-01.** Escucha/progresión/iniciativa/cumplimiento/continuidad 4: sigue tecnología→Redes→Excel y en T4 aclara la confusión. Concisión 4: respuestas acotadas con datos concretos. Tono 3: «Bienvenido/a» y valoraciones estándar. No repetición 3: T2/T3 tienen el mismo formato y la misma oferta de llamada; la nueva pregunta diagnóstica cambia de curso, por lo que no se penaliza como diagnóstico repetido del mismo curso.

**F16-02.** Escucha/continuidad 4: responde la objeción y respeta chat. Tono 3: «La buena noticia» y emoji en el siguiente cierre conservan un registro genérico. Progresión/iniciativa/concisión/cumplimiento 3: T3 vuelve a enumerar planes al confirmar chat y T4 agrega otras opciones después de dar la mínima solicitada. No repetición 2: tres turnos consecutivos con el menú completo, aunque el último sólo pide USD 30. Tampoco aparece diagnóstico en T1; no se declara flujo comercial completo sólo por precios correctos.

**F16-03.** Escucha/progresión/cumplimiento 4: conserva monthly_6 y entrega sólo con petición explícita. Iniciativa/continuidad 5: acepta postergar sin forzar datos ni iniciar envío; deja que el cliente retome. Concisión/no repetición 4: confirma el plan sin reabrir los tres. Tono 3 por apertura y «Tranquilo/a» genéricos. «Me escribís por acá» condiciona la continuación al cliente, no promete una notificación automática el lunes.

**F16-04.** Escucha/progresión/iniciativa 3: T2 registra el pago y T3 intenta explicar el estado, pero la salida ya no expresa correctamente la condición. Tono/continuidad 2 por frase truncada y «en ese momento» huérfano. Cumplimiento 2 por perder la condición de acreditación en la respuesta a inscripción. Concisión 4: es breve; no repetición 3 porque repite aviso/revisión. Se atribuye la degradación al backend, no al modelo.

**C16.** Escucha/iniciativa/cumplimiento/continuidad 4: tras el veto explica contenido y luego precio sin nuevas llamadas. Concisión/no repetición 4: distingue turnos y no repite el diagnóstico podado. Tono 3 por apertura genérica. Progresión 3: T2 sólo confirma chat y T4 no da un siguiente paso; depende de que el cliente continúe.

**P16-curso.** Escucha/progresión/iniciativa/cumplimiento/continuidad 4: cambia a Excel y mantiene ese referente en T3. Tono 3 por «excelente elección». Concisión/no repetición 3: al preguntar contenido repite casi íntegros temas y duración ya dichos, además de la misma invitación a llamada de T1; la repregunta sí justifica recordar contenido, pero no una presentación duplicada completa.

**P16-chat.** Escucha/progresión/iniciativa/cumplimiento/continuidad 4: respeta veto, explica modalidad en T3 y propone plan tras responder precio T4. Concisión/no repetición 4: temas diferenciados y diagnóstico no reiterado. Tono 3 por saludo y confirmaciones estándar. La pregunta de T3 invita al tema que efectivamente consulta el cliente después.

**P16-datos.** Escucha/progresión/iniciativa/cumplimiento/continuidad 4: T2 pregunta permiso; T3 reparado reconoce datos y explicita «En cuanto confirmes que querés avanzar…», sin URL prematura. Concisión/no repetición 4: no repite el intake ni ofrece todos los planes. Tono 3 por bienvenida formularia y primer mensaje largo. La acción rechazada sigue documentada; la nota describe lo entregado y su resultado durable.

**P16-link.** Escucha/progresión/iniciativa/cumplimiento/continuidad 4: plan separado del permiso, datos y única URL correspondientes en T3. Concisión/no repetición 4: no reabre elección ni datos. Tono 3 por «asesor/a educativo/a» y «excelente elección». No hay aviso de pago posterior en este caso, por lo que no acredita esa fase.

**P16-post.** Escucha/progresión/cumplimiento 4: monthly_12 sigue guardado sin link. Iniciativa/continuidad 5: la respuesta a postergar acepta y deja retomar al cliente. Concisión/no repetición 4: sólo recuerda el plan pertinente. Tono 3: valoraciones «gran elección», «Tranquilo/a» y emoji en todos los turnos. T1 omite diagnóstico, por lo que tampoco se declara venta completa.

**P16-pago.** Escucha/progresión/iniciativa/cumplimiento/continuidad 4: T3 «Todavía no» contesta directamente el acceso y lo condiciona a acreditación, sin la poda de F16-04. Concisión/no repetición 4: reformula brevemente el estado en lugar de repetir el anuncio. Tono 3: apertura promocional genérica. La DB confirma aviso, no pago acreditado.

**P16-optout.** Escucha/progresión/iniciativa/no repetición/continuidad 5: cesa el contacto conforme a petición y el siguiente mensaje permanece bloqueado por revocación durable. Concisión/cumplimiento 4: ack breve, sin insistencia. Tono 3 por apertura con barras. Estas notas incluyen comportamiento de política; el ack no es una respuesta generada por DeepSeek y no debe atribuirse a naturalidad del modelo.

**A16.** Escucha/progresión/iniciativa/cumplimiento/continuidad 4: elige plan, pide permiso, reúne datos, entrega y registra aviso, con cada transición basada en mensaje del cliente. Concisión/no repetición 4: no repite el menú una vez elegido ni reclama datos guardados. Tono 3 por saludo y múltiples «Perfecto/Genial». T2 «Así te cuento lo que más te sirva» no pregunta ni desarrolla contenido, por lo que parte del avance depende de la iniciativa del simulador; no se le asigna perfección de venta humana.

Tres conversaciones superan el umbral descriptivo de media y mínimo: F16-03, P16-post y P16-optout. Diez no lo alcanzan. Esto no es una estimación ciega de éxito sobre tráfico real y no invalida los contratos focales correctos. La falla de F16-04 debe preservarse aunque una versión posterior la corrija.

## Revisión de la propuesta V17, sin atribuirle estos resultados

La propuesta acotada del coordinador limita la secuencia de precios a su primera presentación y el cierre por opción a cuando todavía no existe plan elegido. Cuando ya hay elección, confirma el importe/condiciones que el cliente pregunta sin reabrir la elección, salvo que pida cambiar. Es coherente con «El curso y el plan no se piden: ya están elegidos» en la fase de datos y elimina la contradicción de «Usá siempre cierre por opción». No agrega planner, plantilla ni permiso. Es razonable para probar como V17/canónico V6; esta revisión conceptual no certifica su resultado ni cambia las notas V16.

La calidad está pendiente; los indicadores quality_ready, production_ready y stability_certified permanecen false. Esta campaña no es held-out, no tiene calibración del dueño comercial y no demuestra funcionamiento remoto. El coordinador mantiene control de presupuesto, commit, despliegue y canario.

## Transcripciones completas entregadas

Textos exactos de los trece reportes; datos de contacto sintéticos de laboratorio. No se incluyen borradores rechazados como respuestas entregadas. En P16-optout T3 no existe mensaje del agente por revocación, tal como muestra la evidencia.

### F16-01

**T1 — Cliente**

> Hola, quería saber qué formaciones tienen en tecnología

**T1 — Agente**

> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesoría educativa. En tecnología tenemos la formación en Armado y Reparación de PC, dentro de nuestra Academia de Oficios. ¿Ya tenías pensado estudiar algo de esto o recién estás empezando a averiguar?

**T2 — Cliente**

> Me tienta la de Redes Informáticas

**T2 — Agente**

> ¡Buena elección! Redes Informáticas es parte de nuestra Academia de Oficios y son 16 clases donde vas a entender cómo funcionan las redes y cada uno de los dispositivos que las componen. ¿Ya tenés conocimientos previos en el tema o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

**T3 — Cliente**

> Pensándolo mejor, prefiero Excel Integral

**T3 — Agente**

> ¡Perfecto! Excel Integral es de nuestra Academia de Negocios y son 17 clases donde vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. ¿Ya tenés conocimientos previos en Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

**T4 — Cliente**

> ¿?

**T4 — Agente**

> ¿Tenés alguna duda puntual sobre Excel Integral o querés que te cuente cómo funciona el curso?

### F16-02

**T1 — Cliente**

> Buenas, me interesa Maquillaje Profesional

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con el curso de Maquillaje Profesional.
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

**T2 — Cliente**

> Uf, me parece bastante plata la verdad

**T2 — Agente**

> Te entiendo. La buena noticia es que podés elegir cómo pagarlo: 12 pagos mensuales de USD 30, 6 pagos de USD 60 o un pago único de USD 360. El total es el mismo en las tres opciones, así que podés acomodarlo a tu presupuesto.

**T3 — Cliente**

> No me llames por favor, sigamos escribiendo

**T3 — Agente**

> Perfecto, seguimos por acá sin problema. 😊 ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar: 12 pagos de USD 30, 6 pagos de USD 60 o el pago único de USD 360?

**T4 — Cliente**

> ¿Y la cuota más baja de cuánto sería?

**T4 — Agente**

> La opción de menor cuota es la de 12 pagos mensuales de USD 30. También tenés 6 pagos de USD 60 o un pago único de USD 360.

### F16-03

**T1 — Cliente**

> Quiero anotarme en Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con tu inscripción en Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> Me quedo con las seis cuotas

**T2 — Agente**

> Perfecto, te dejo anotado el plan de 6 pagos mensuales de USD 60. El total del programa es USD 360 en cualquiera de las opciones.
>
> ¿Querés avanzar con la inscripción para que te envíe el link de pago?

**T3 — Cliente**

> Igual esta semana no puedo, lo dejo para el lunes

**T3 — Agente**

> Tranquilo/a, no hay problema. Queda anotado tu plan de 6 pagos mensuales de USD 60, y cuando quieras avanzar el lunes, me escribís por acá y te paso el link de pago.

**T4 — Cliente**

> Ya está, mandame el link. Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

**T4 — Agente**

> ¡Perfecto, Lucía! Ya quedó registrado tu plan de 6 pagos mensuales de USD 60. Te envío el link de pago ahora mismo.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

### F16-04

**T1 — Cliente**

> Me anoto en Excel Integral

**T1 — Agente**

> ¡Excelente elección! Excel Integral es parte de la Academia de Negocios y en 17 clases vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. 😊
>
> Para recomendarte lo mejor, contame: ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

**T2 — Cliente**

> Ya hice la transferencia recién

**T2 — Agente**

> Gracias por avisarme. Dejo registrado tu aviso de pago para que el equipo lo revise y, si está acreditado, gestione tu acceso.

**T3 — Cliente**

> ¿Entonces ya quedé inscripta?

**T3 — Agente**

> Tu aviso de pago quedó registrado para revisión del equipo. en ese momento gestionarán tu acceso.

### C16

**T1 — Cliente**

> Hola, me interesa Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu consulta sobre Redes Informáticas.
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

> Claro, te cuento. En Redes Informáticas vas a conocer cómo funcionan las redes y cada uno de los elementos y dispositivos que las componen, a lo largo de 16 clases prácticas.
>
> Es 100% online y en español. ¿Te gustaría que te cuente también cómo se cursa y qué incluye?

**T4 — Cliente**

> ¿Y cuánto sale?

**T4 — Agente**

> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

### P16-curso

**T1 — Cliente**

> Hola, me interesa Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con el curso de Redes Informáticas. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

**T2 — Cliente**

> Pensándolo mejor prefiero Excel Integral

**T2 — Agente**

> ¡Excelente elección! Excel Integral es de la Academia de Negocios y son 17 clases 100% online. Vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. ¿Ya tenés experiencia con Excel o partís desde cero?

**T3 — Cliente**

> ¿Y qué se aprende ahí?

**T3 — Agente**

> En Excel Integral vas a dominar desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. Son 17 clases 100% online, en español, y avanzás a tu ritmo.
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

### P16-chat

**T1 — Cliente**

> Me interesa Maquillaje Profesional

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Maquillaje Profesional. ¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles.

**T2 — Cliente**

> No quiero que me llamen, prefiero por chat

**T2 — Agente**

> ¡Perfecto, seguimos por chat sin problema!

**T3 — Cliente**

> Contame cómo se cursa

**T3 — Agente**

> El curso de Maquillaje Profesional es 100% online y en español. Son 38 clases con material de lectura, videos explicativos y ejercicios prácticos, y podés avanzar a tu ritmo con acceso a la plataforma 24/7.
>
> Además contás con profesores disponibles por chat para consultas y un certificado al finalizar. ¿Te gustaría que te cuente las opciones de pago?

**T4 — Cliente**

> ¿Y cuánto cuesta?

**T4 — Agente**

> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

### P16-datos

**T1 — Cliente**

> Quiero Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu consulta sobre Redes Informáticas.
>
> Este curso de 16 clases te permite conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen. Antes de contarte más, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> Me quedo con el pago único

**T2 — Agente**

> Perfecto, el pago único de USD 360 queda elegido. ¿Querés que avancemos con el registro para enviarte el link de pago?

**T3 — Cliente**

> Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

**T3 — Agente**

> ¡Gracias, Lucía! Quedó registrado tu nombre, correo y teléfono. En cuanto confirmes que querés avanzar con el pago único de USD 360, te envío el link por acá.

### P16-link

**T1 — Cliente**

> Quiero anotarme en Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a. Veo que te interesa Redes Informáticas, ¡excelente elección! Para orientarte mejor: ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.

**T2 — Cliente**

> Me quedo con las seis cuotas

**T2 — Agente**

> ¡Perfecto! Elegís 6 pagos mensuales de USD 60, el total del programa es USD 360. ¿Querés que avancemos con la inscripción?

**T3 — Cliente**

> Mandame el link. Soy Ana Ríos, ana.rios@example.test, teléfono +1 305 555 0177

**T3 — Agente**

> ¡Gracias, Ana! Quedó registrado tu plan de 6 pagos mensuales de USD 60. Te envío el link de pago por acá.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

### P16-post

**T1 — Cliente**

> Me interesa Excel Integral

**T1 — Agente**

> ¡Excelente elección! Excel Integral es un curso de la Academia de Negocios con 17 clases, ideal para dominar fórmulas, funciones, gráficos y resúmenes de información. 😊
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

**T2 — Cliente**

> Elijo las 12 cuotas

**T2 — Agente**

> Perfecto, la opción de 12 pagos mensuales de USD 30 es una gran elección. 😊 ¿Querés avanzar con esa opción para dejarlo registrado?

**T3 — Cliente**

> Ahora no puedo, lo dejo para la semana que viene

**T3 — Agente**

> Tranquilo/a, no hay problema. Cuando quieras retomar la semana que viene, seguimos con la opción de 12 pagos mensuales de USD 30. 😊

### P16-pago

**T1 — Cliente**

> Me anoto en Excel Integral

**T1 — Agente**

> ¡Excelente decisión! Excel Integral es ideal para dominar desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información. Son 17 clases 100% online.
>
> Para orientarte mejor: ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

**T2 — Cliente**

> Ya hice la transferencia

**T2 — Agente**

> Perfecto, quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

**T3 — Cliente**

> ¿Entonces ya tengo acceso al campus?

**T3 — Agente**

> Todavía no, el acceso se habilita recién cuando el equipo confirma que el pago está acreditado. Tu aviso quedó registrado y ellos gestionan el alta.

### P16-optout

**T1 — Cliente**

> Hola, quiero info de Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a y te voy a ayudar con el curso de Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> No me escribas más, quiero que me den de baja

**T2 — Agente**

> Listo, no te enviaremos más mensajes.

**T3 — Cliente**

> ¿Y cuánto sale ese curso?

### A16

**T1 — Cliente**

> Hola, me interesa Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con el curso de Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> Prefiero no hablar por teléfono, sigamos por acá

**T2 — Agente**

> Perfecto, seguimos por acá sin problema 👍
>
> Así te cuento lo que más te sirva.

**T3 — Cliente**

> ¿Y cuánto sale?

**T3 — Agente**

> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

**T4 — Cliente**

> Me quedo con las seis cuotas

**T4 — Agente**

> ¡Perfecto! Quedó elegido el plan de 6 pagos mensuales de USD 60.
>
> ¿Querés que avancemos con eso para dejarlo registrado?

**T5 — Cliente**

> Sí, mandame el link de pago para avanzar

**T5 — Agente**

> ¡Genial! Para dejarlo registrado y enviarte el link, necesito tu nombre, apellido, correo electrónico y teléfono.

**T6 — Cliente**

> Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

**T6 — Agente**

> ¡Perfecto, Camila! Quedó registrado tu nombre, correo y teléfono.
>
> Te envío el link de pago para el plan de 6 pagos mensuales de USD 60.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

**T7 — Cliente**

> Listo, ya hice el pago

**T7 — Agente**

> ¡Gracias, Camila! Registré tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.
