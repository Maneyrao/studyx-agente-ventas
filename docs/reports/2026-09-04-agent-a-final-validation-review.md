# Validación final independiente — freeze V17/canónico V6

Fecha: 2026-09-04. Revisor Codex /root/rubric_review, distinto del generador deepseek-v4-flash. Sólo lectura de fuentes, logs y reportes locales; hashes, métricas y correlaciones recalculadas gratis. Ninguna API, DB, edición de runtime o prompt por este revisor.

**Esta validación no aprueba el candidato.** El primer held-out falla: se pierden nombre y apellido aportados en «Anotá mis datos: Emilia Ríos…», se vuelven a pedir y el link explícitamente solicitado no se entrega. El segundo held-out conserva chat al cambiar de curso y respeta opt-out. Hay mejoras verificables de catálogo y condiciones de acreditación en los casos de ajuste, pero no compensan el fallo held-out ni la repetición de plan pendiente en V17 temprano.

## Fuente congelada y ejecución identificada

Se leyó íntegramente como JSON `.eval/codex-20260904/v17-final-freeze.json`, con SHA-256 `921c10839453e447e85259fb44d35bac08bbe04cfea9a9114b3c6eb46f60e88f`. Al verificarlo se compararon los **312 hashes de archivos** con el árbol actual: cero diferencias.

| Campo | Valor congelado |
| --- | --- |
| Fecha | 2026-09-04T15:04:06.973567+00:00 |
| Commit base | 360cd37201a35bf3c4cceb82a93e809885494529 |
| Brain / canónico | V17 / V6 |
| Next build | yrpeCY9zQGMWpn05z4Rpk |
| ADK SHA | 07a75fcf2fd1cdabfa11e341c401a448be4ec1a4f1bed0449a05b71bf43f8418 |
| Digest de fuente declarado | ce284bd596af556bae5ad618c8164b3e7917751783c68394b8c95180812cf8e0 |
| Canónico V6 SHA | 4e13215642069cae320026c19327916a91d7a7b8954a7fc64a1e63c78b7d57e0 |

El commit base no contiene por sí solo todos los cambios posteriores: el freeze identifica el árbol evaluado. El guard condicional está incluido en este build. Se preservan por separado V14, V15, V16 y V17 temprano; no se promedian versiones para presentar un verde.

La ejecución está en `.eval/codex-20260904/live-v17-final.log`, iniciada 12:04:27 local. Cierra **4 tests aprobados y 1 fallido**, en tres archivos: el held-out de datos/consentimiento falla al esperar URL 6m y obtener []. Cinco tests contienen ocho conversaciones, no cinco conversaciones: seis de ajuste y dos held-out, con 37 entradas en total. La primera ejecución live de los dos guiones held-out suma 11 entradas; los IDs conservan el prefijo histórico heldout_v14, pero el modelo observado es V17. Los tests estaban disponibles en el repositorio: es validación con entradas reservadas de ejecución, no doble ciego ni conversación humana espontánea.

Todos los resultados son processInboundTurn con backend/DB de laboratorio y adaptador local. No prueban Telegram, Botpress Cloud o cobro real. Las rutas de reportes de la tabla son relativas a botpress-agent/evals/results/.

| ID | Rol | Archivo completo | SHA-256 de archivo | SHA-256 de transcripción redactada V2 |
| --- | --- | --- | --- | --- |
| F17-01 | adjustment | `workflow-conversation-2026-09-04T15-04-41-772Z-ba70b971-7380-41ca-9434-cf9d7eb418eb.json` | `2bfc7f53dccce8beff6ca21f821049ac40de08dcc2695fd0ebb3398c3ec716df` | `fef03e3c5932c5fa770c9a6c34912176838f5b24a9ee5b581c67191106f13533` |
| F17-02 | adjustment | `workflow-conversation-2026-09-04T15-04-54-882Z-58d1069d-595e-44de-8bc1-7c4fc770b5ad.json` | `0b69f86996d6a2cf98e93c0eb58faa0156e2bfcf3da9a97a678ec6fd910702b2` | `bf88a5c7ddc227636c481ef1d9795d802a38871055e715aa66d8d37f8b2e6d98` |
| F17-03 | adjustment | `workflow-conversation-2026-09-04T15-05-08-669Z-ffd65570-e126-44dd-81f2-7a89495d186b.json` | `c30c96fd365feedf6ab0a5b391dab261cb55bb04bfad135d7ba9b1a5295c6d67` | `b418c2202a2622758adff0799b03fd93f3207baa7db691f5341db12dab0df41d` |
| F17-04 | adjustment | `workflow-conversation-2026-09-04T15-05-17-873Z-0ac90c11-06f0-4cef-84fb-d343ad5d4aae.json` | `b6b5fe9ada8fc9e6faffc3f83b42338f5c0f726164dd31ee79cbd5460b0e2b4a` | `d1fc47acdeee72369eb38f1841e6a083fab0fbbd42b61166bcc38c40f2736fb0` |
| C17 | adjustment | `workflow-call-declined-2026-09-04T15-05-31-198Z-919b5ac7-b22b-4ba9-99de-6eb278fcd739.json` | `384e02dabf1b66d866d53de7960d798f1002f3aa590eb8074e34a0067e7b0b10` | `cafe04b27a857b3c3eb80ad0d548a3c173b58ad09f1f3d2b284923133e04388d` |
| A17 | adjustment | `workflow-adaptive-sale-2026-09-04T15-05-54-833Z-4f776571-b0ad-4b45-801c-0614ffb6beb8.json` | `7f4d86a2f51bda31a37a0d5038597364f06080323420fce301aaf0bd1b1502ba` | `9ac0b476755ad980deb21236a4ef95d1712f932bceede139142be89829c2140b` |
| H17-01 | heldout_validation | `workflow-heldout-checkpoint-2026-09-04T15-06-15-535Z-192c3390-6188-45cc-9b1d-3b09176da1e3.json` | `079f7959d4d4662ab090cecfd233a7f096cdceb00f8e66bf037183587ba51ebe` | `7111461dfb42dfab57c276c6b85dccea7e38bcc3b8e126736784cd2023404468` |
| H17-02 | heldout_validation | `workflow-heldout-checkpoint-2026-09-04T15-06-28-300Z-fc17bb81-d523-42e8-ab93-04fc4c362328.json` | `df12dd936f41631523183a97703d206e819cb779ea03c99c141d8204d2976dd3` | `fd48a9d427408ce2cd9f210ab9ccfb3f74c94da2653bc733391b17bcd426dd37` |

Cada held-out se representa por su último checkpoint, de seis y cinco entradas respectivamente. Los checkpoints anteriores se usan para secuencia causal, pero no se agregan como conversaciones nuevas. El agregado full-conversations, snapshots por turno y checkpoints adaptativos también duplican estas mismas trazas.

## Qué quedó registrado y entregado

Se recalculó la correlación de **36/36 outbounds** con DB exportada y captura: ID autorizado, outbound ID, turn ID, trace ID, conversación destino, estado submitted, provider ID y contenido coinciden. Una entrada no tiene outbound: H17-02 T5, después de la revocación causal de T4. El ack de opt-out sí cuenta como entrega pero es política determinista, no DeepSeek. No hay silencio técnico en esta ejecución.

| Caso | Resultado observado |
| --- | --- |
| F17-01 | Curso/área visibles en T1, cambio a Excel conservado, T4 aclara «¿?». Sin plan ni link; dos ofertas de llamada. |
| F17-02 | Chat/declined tras veto; T4 contesta cuota mínima USD30 y total360 sin listar los otros planes. Sin link. |
| F17-03 | Responde postergación, conserva monthly_6, T4 entrega una URL6m sólo después de petición explícita y datos completos. |
| F17-04 | paymentReportedAt 15:05:14.675Z y explicación completa de acreditación/inscripción en T3. No se afirma acceso ya entregado. |
| C17 | Chat/declined, una oferta; contenido y precio respondidos; ninguna llamada posterior al veto. |
| A17 | Plan T4, autorización explícita T5, datos+URL6m T6, aviso de pago T7 durable a 15:05:54.793Z. |
| H17-01 | monthly_6 conservado y sin envío durante aplazamiento, pero nombre permanece null tras los datos. T5 no entrega el link solicitado; estado final plan_selected/awaiting contact_details, recordedLinks[]. Aviso de pago T6 sí queda registrado. |
| H17-02 | Curso Redes→Excel y preferencia chat/declined conservados, plan null; revocación T4, ack y bloqueo sin outbound/modelo en T5. |

No debe usarse la columna permission.consentStatus para deducir permiso comercial de link: en estos reportes representa permiso de contacto/opt-out. El permiso de pago se demuestra con el mensaje explícito anterior al efecto y la transición del workflow.

## Held-out H17-01: fallo de extracción/persistencia que impide el cierre

T4 cliente: **«Anotá mis datos: Emilia Ríos, emilia.rios@example.test, teléfono +1 305 555 0188.»**. Snapshot intermedio `workflow-heldout-checkpoint-2026-09-04T15-06-09-293Z-794be9d8-0689-4885-b7dc-7eadc2bfd994.json`, traza `03ccc3a9-0541-4bf9-8c2b-0ac37a83b04a`, turno `97c7980d-3caa-4b63-acfc-d200b7cd2901`.

El backend guarda email y declaredPhone +13055550188, pero **contact.name=null**. El contexto del modelo ya lleva intake_missing [nombre, apellido]. No es falta del dato en el texto del cliente. El primer borrador reconoce a Emilia y afirma «Ya registré tu nombre, apellido, correo y teléfono», a la vez que pide apellido. Ese borrador llega a /decision. El guard elimina correctamente la afirmación de registro no respaldada, dejando entregado «¡Gracias, Emilia! Para dejarlo todo listo, solo me falta confirmar tu apellido. ¿Me lo confirmás?». El proceso no repara la persistencia faltante y la salida pide un dato recién aportado.

T5 cliente: **«Ahora sí quiero avanzar: pasame el enlace de la opción de seis pagos.»**. Snapshot `workflow-heldout-checkpoint-2026-09-04T15-06-12-388Z-5150dbb2-f622-4221-b511-8b53618e0351.json`, traza `ef8ffc70-2374-44cf-9213-e8723ec8b78f`, turno `1cd2b240-e994-4e9e-af5b-267128abed9a`. El modelo interpreta correctamente request_payment_link, pero intake_missing sigue siendo nombre/apellido y may_send_payment_link false. Entrega un nuevo pedido de nombre y apellido; no hay URL. La autorización del cliente existe; el bloqueo proviene de datos no persistidos.

El assert soft de deliveredLinks en la línea56 del test falla y conserva el checkpoint. T6 del guion dice «Lo aboné recién…» y se registra el aviso, aunque el workflow no envió ningún link antes. Ese paso posterior no prueba una venta completada ni compensa la entrega fallida T5. Tampoco implica pago acreditado: sólo es aviso. El defecto combina pérdida de nombre en la extracción/persistencia con una primera generación contradictoria que fue parcialmente contenida por el guard.

H17-01 permanece **fallido** aunque un arreglo posterior corrija su causa. Cualquier repetición de estas mismas entradas después del diagnóstico sería regresión de ajuste, no otro held-out independiente.

## Held-out H17-02: continuidad de chat y opt-out causal

T2 rechaza llamada y T3 cambia a Excel. El estado conserva callPreference chat, callOfferStatus declined, callOfferCount1 y selectedOfferingCode excel_integral, sin nuevo ofrecimiento. T4 pide baja; permission pasa a revoked, evidenceEventId `132a1a77-845b-4732-8527-2a244bbcf252`, revokedTurnId `53a6a402-e493-4aaa-a625-9e4ec94bf40e`, revokedAt 15:06:26.213Z. T5 «Que quede claro que sigo de baja» no genera modelo ni outbound. La evidencia de revocación precede causalmente al turno bloqueado, por lo que el silencio se considera correcto.

## Condición de acreditación: antes y después

En V16 final, F16-04 T3 generaba una condición válida y el backend la eliminaba, dejando «en ese momento» huérfano. Ese fallo está conservado en su informe.

En F17-04 T3 del build congelado, lo entregado es:

> Tu aviso de pago quedó registrado. La inscripción se confirma cuando el equipo verifique que el pago esté acreditado; en ese momento gestionarán tu acceso. 👍

La condición y su consecuencia llegan juntas al adaptador. El pago sólo está informado en DB; la frase no lo declara acreditado ni otorga acceso. Es evidencia favorable de esta salida con el build corregido. No se afirma que cada posible redacción condicional haya quedado cubierta por una conversación; las pruebas locales del literal anterior se documentaron aparte en la revisión V17 temprana.

F17-01 también conserva en T1 «Armado y Reparación de PC, dentro de nuestra Academia de Oficios». F17-02 T4 ya no reenumera todas las opciones ante cuota mínima. Son mejoras de estos casos de ajuste. La secuencia V17 temprana que reabría el plan escogido conserva su resultado fallido y no se volvió a incluir para ocultarlo.

## Métricas separadas por rol y sin mezclar versiones

Recalculadas con summarizeWorkflowMetricsV1 sobre las ocho conversaciones y la DB correspondiente. Los 35 HTTP tienen usage. El laboratorio recibió 37 entradas; dos de H17-02 son opt-out/bloqueo sin modelo.

| Medida | Ajuste: seis conversaciones | Held-out: dos conversaciones |
| --- | --- | --- |
| Entradas / turnos live | 26 / 26 | 11 / 9 |
| HTTP / usage ausente | 26 / 0 | 9 / 0 |
| Tokens input / cache / output | 244911 / 173056 / 6369 | 85239 / 59904 / 2243 |
| Reparación semántica | 0 | 0 |
| Repair success rate | null, sin muestra | null, sin muestra |
| Fallback / disponibilidad fallida / desconocida | 0 / 0 / 0 | 0 / 0 / 0 |
| p50 / p95 | 3314 / 3710 ms | 3384 / 4077 ms |
| numeric_gates_passed | null | null |
| Fallos funcionales detectados por suite | 0 | 1: link no entregado |

Los gates conocidos de latencia, tasa de reparación, fallback y disponibilidad pasan en ambas particiones, pero no hay muestra de éxito de reparación y el helper mantiene null en lugar de inventar 100%. No se importan reparaciones de una versión/campaña anterior para llenar ese denominador. El agregado descriptivo del mismo build tiene 35 HTTP, input330150/cache232960/output8612 y p953982 ms; no sustituye las particiones ni el fallo funcional held-out.

Disponibilidad cero fallos significa que no hubo degradación técnica según el contrato del helper. No significa que el pedido de link se haya resuelto: H17-01 es el contraejemplo explícito. Los reportes mantienen quality_ready, production_ready y stability_certified false.

## Rúbrica V2 completa de cada conversación

Ocho dimensiones, escala1–5; media≥4 y todas≥3 para el umbral descriptivo. Rel es relevancia complementaria fuera de la media. Mismos criterios que los informes previos. El revisor es independiente del modelo generador, pero no es un evaluador humano ciego ni está calibrado con el dueño comercial. El opt-out incluye conducta de política, que no se atribuye a naturalidad del modelo.

| Caso | Rol | Escucha | Tono | Progresión | Iniciativa | Concisión | No repetición | Cumplimiento | Continuidad | Media V2 | Rel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F17-01 | Ajuste | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 3.75 | 4 |
| F17-02 | Ajuste | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 3.75 | 4 |
| F17-03 | Ajuste | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3.875 | 4 |
| F17-04 | Ajuste | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3.875 | 4 |
| C17 | Ajuste | 4 | 3 | 3 | 3 | 4 | 3 | 4 | 4 | 3.5 | 3 |
| A17 | Ajuste | 4 | 3 | 4 | 4 | 4 | 4 | 4 | 4 | 3.875 | 4 |
| H17-01 | Held-out | 2 | 3 | 2 | 2 | 3 | 2 | 2 | 2 | 2.25 | 2 |
| H17-02 | Held-out | 4 | 3 | 4 | 5 | 4 | 4 | 4 | 5 | 4.125 | 5 |

**F17-01.** Escucha/progresión/iniciativa/cumplimiento/continuidad4: conserva curso y área, sigue dos cambios de interés y pregunta por la confusión T4 sin responder «Perfecto». Concisión4: contenido concreto y cierre de aclaración. Tono3: «asesor/a educativo/a» y valoraciones repetidas. No repetición3: diagnóstico de estructura similar y misma invitación de llamada en T2/T3; cambiar de curso permite otro diagnóstico, por lo que no se trata como pregunta idéntica del mismo curso.

**F17-02.** Escucha/progresión/iniciativa/cumplimiento/continuidad4: atiende objeción, respeta chat y T4 se centra en USD30/total360. Concisión4 por la respuesta mínima final. Tono3: apertura con barras y «inversión importante» genérico. No repetición3 porque T3 vuelve a listar todos los planes después de T2, aunque no hubo elección todavía. Mejora frente a V16 final sin afirmar que todas las preguntas sobre plan se resolvieron.

**F17-03.** Escucha/progresión/cumplimiento/continuidad4: responde postergación y entrega sólo con petición explícita+datos. Iniciativa4: permite retomar, pero «el lunes retomamos y avanzamos» es más presuntivo que reconocer simplemente la pausa; el mensaje siguiente deja la iniciativa al cliente («escribime por acá»), por lo que no se cuenta como notificación automática ejecutada o prometida. Concisión/no repetición4: no reabre menú ni datos. Tono3 por «Tranquilo/a», apertura y emoji.

**F17-04.** Escucha/progresión/iniciativa/cumplimiento/continuidad4: contesta estado real y preserva la condición de acreditación. Concisión/no repetición4: la reformulación responde la repregunta sin añadir pasos ajenos. Tono3 por valoración inicial y emoji en cada respuesta. La corrección backend mejora la salida; la DB sólo prueba aviso de pago, no acreditación.

**C17.** Escucha/cumplimiento/continuidad4: respeta veto y sigue Redes. Tono3 por bienvenida con barras. Progresión/iniciativa3: sólo confirma chat T2 y responde precio T4 sin siguiente paso. No repetición3: T3 vuelve a contar casi el mismo contenido, modalidad y duración de T1 al pedir «más del contenido»; el catálogo limitado no habilita inventar temas, pero la repetición no constituye asesoramiento adicional. Concisión4: respuestas posteriores breves.

**A17.** Escucha/progresión/iniciativa/cumplimiento/continuidad4: secuencia permiso→intake→URL→aviso correcta. Concisión/no repetición4: no reabre elección ni datos; repite la condición de pago después del aviso porque corresponde aclarar el nuevo estado. Tono3 por apertura larga y sucesión de «Perfecto/Genial». La simulación V2 conduce una venta completa; no es evidencia de todos los recorridos humanos posibles.

**H17-01.** Escucha2: nombre/apellido explícitos no se conservan y se solicitan de nuevo. Progresión2: no entrega un link pedido y el guion continúa a pago sin ese resultado. Iniciativa2: activa confirmación de datos tras el aplazamiento y después duplica el pedido. Continuidad2: pasa de usar «Emilia» a pedir nombre y apellido ya aportados. Cumplimiento2 por datos no persistidos y repetición evitable; la contención de afirmación falsa y ausencia de link sin intake completo no revierten la falla del flujo. Concisión3: texto claro pero innecesario. No repetición2: T4 apellido, T5 nombre+apellido. Tono3: cordial pero formulario.

**H17-02.** Escucha/progresión/cumplimiento4: reconoce objetivo laboral, mantiene chat al cambiar a Excel y materializa la baja. Iniciativa/continuidad5: no insiste en llamada ni responde tras revocación. Concisión/no repetición4: un diagnóstico por curso y ack corto. Tono3 por «asesor/a educativo/a» y saludo genérico. Supera el umbral descriptivo, pero no compensa H17-01 ni acredita naturalidad del texto determinista de opt-out.

Sólo H17-02 supera el umbral descriptivo de media/mínimo. Media de los seis ajustes3.7708; media de los dos held-out3.1875. Son descripciones de estos textos, no estimaciones representativas de satisfacción o conversión. No se combinan con otras versiones. No hay veinte conversaciones independientes del árbol final ni calibración comercial.

## Estado de validación

El gate funcional held-out es rojo por H17-01 y la calidad sigue pendiente. El resultado verificable es un candidato de laboratorio identificado por freeze, con mejoras reales y un fallo de nombre/intake reproducible. No se certifica producción, canario remoto o despliegue. El coordinador mantiene presupuesto acumulado, ledger, integración y autorizaciones; este informe no reinicia el prior USD0,38 ni deduce gasto de cuenta de una muestra parcial.

Si se corrige extracción/persistencia después de este hallazgo, el freeze debe cambiar y el caso repetido pasa a ser regresión de ajuste. Este primer held-out permanece fallido en sus archivos originales. Ninguna unitaria posterior cambia esa procedencia ni la repetición de plan pendiente en V17 temprano.

## Transcripciones completas entregadas

Datos de contacto sintéticos del laboratorio. Los borradores rechazados no se cuentan como mensajes al cliente; se citan arriba para atribuir la causa. H17-02 T5 no tiene respuesta por revocación durable.

### F17-01

**T1 — Cliente**

> Hola, quería saber qué formaciones tienen en tecnología

**T1 — Agente**

> Hola, bienvenido/a a StudyX 🇺🇸 Soy tu asesor/a educativo/a. En tecnología tenemos la formación de Armado y Reparación de PC, dentro de nuestra Academia de Oficios. ¿Ya tenías pensado estudiar algo de esto o recién estás empezando a averiguar?

**T2 — Cliente**

> Me tienta la de Redes Informáticas

**T2 — Agente**

> ¡Buena elección! Redes Informáticas es parte de nuestra Academia de Oficios y son 16 clases donde vas a conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen. ¿Ya tenías conocimientos previos en el tema o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

**T3 — Cliente**

> Pensándolo mejor, prefiero Excel Integral

**T3 — Agente**

> ¡Excelente elección! Excel Integral es parte de nuestra Academia de Negocios y son 17 clases donde vas a aprender las herramientas elementales, fórmulas y funciones, gráficos y resúmenes de información, entre otras actividades del programa. ¿Ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

**T4 — Cliente**

> ¿?

**T4 — Agente**

> ¿En qué puedo ayudarte? Te estaba contando sobre Excel Integral, pero si tenés otra duda o querés ver otras formaciones, decime y te oriento.

### F17-02

**T1 — Cliente**

> Buenas, me interesa Maquillaje Profesional

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Maquillaje Profesional.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar maquillaje profesional o recién estás empezando a averiguar?
>
> Si preferís, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> Uf, me parece bastante plata la verdad

**T2 — Agente**

> Entiendo, es una inversión importante. Por eso te comento que podés elegir entre 12 pagos mensuales de USD 30, 6 pagos de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

**T3 — Cliente**

> No me llames por favor, sigamos escribiendo

**T3 — Agente**

> Perfecto, seguimos por acá sin problema. 😊
>
> Para avanzar, ¿cuál de las tres opciones de pago te resulta más cómoda: 12 pagos de USD 30, 6 pagos de USD 60 o el pago único de USD 360?

**T4 — Cliente**

> ¿Y la cuota más baja de cuánto sería?

**T4 — Agente**

> La cuota más baja es la de 12 pagos mensuales de USD 30. El total sigue siendo USD 360 en cualquiera de las tres opciones.

### F17-03

**T1 — Cliente**

> Quiero anotarme en Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu inscripción a Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes informáticas o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> Me quedo con las seis cuotas

**T2 — Agente**

> Perfecto, te anoto con el plan de 6 pagos mensuales de USD 60. El total del programa es USD 360 en cualquiera de las opciones.
>
> ¿Querés que avancemos con tu registro para dejarlo listo?

**T3 — Cliente**

> Igual esta semana no puedo, lo dejo para el lunes

**T3 — Agente**

> Tranquilo/a, no hay problema. Quedamos así: el lunes retomamos y avanzamos con tu registro para el plan de 6 pagos mensuales de USD 60.
>
> Cuando quieras, escribime por acá y seguimos. 👍

**T4 — Cliente**

> Ya está, mandame el link. Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

**T4 — Agente**

> ¡Perfecto, Lucía! Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

### F17-04

**T1 — Cliente**

> Me anoto en Excel Integral

**T1 — Agente**

> ¡Excelente decisión! Excel Integral es un curso muy completo de la Academia de Negocios: 17 clases donde vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información. 😊
>
> Para orientarte mejor, ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, puedo contarte más en detalle por una llamada breve.

**T2 — Cliente**

> Ya hice la transferencia recién

**T2 — Agente**

> Perfecto, quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso. 👍

**T3 — Cliente**

> ¿Entonces ya quedé inscripta?

**T3 — Agente**

> Tu aviso de pago quedó registrado. La inscripción se confirma cuando el equipo verifique que el pago esté acreditado; en ese momento gestionarán tu acceso. 👍

### C17

**T1 — Cliente**

> Hola, me interesa Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos.
>
> Redes Informáticas es un curso de la Academia de Oficios, 100% online y en español, con 16 clases para que conozcas el funcionamiento de las redes y sus dispositivos. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

**T2 — Cliente**

> Prefiero no hablar por teléfono, seguimos por chat

**T2 — Agente**

> ¡Perfecto, seguimos por chat!

**T3 — Cliente**

> Contame más del contenido

**T3 — Agente**

> Claro, te cuento. En Redes Informáticas vas a conocer cómo funcionan las redes y cada uno de los dispositivos que las componen, a lo largo de 16 clases 100% online y en español.

**T4 — Cliente**

> ¿Y cuánto sale?

**T4 — Agente**

> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

### A17

**T1 — Cliente**

> Hola, me interesa Redes Informáticas

**T1 — Agente**

> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Me alegra que te interese Redes Informáticas, un curso de la Academia de Oficios donde vas a conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen.
>
> Para orientarte mejor: ¿ya tenías pensado estudiar redes informáticas o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.

**T2 — Cliente**

> Prefiero no hablar por teléfono, sigamos por acá

**T2 — Agente**

> Perfecto, seguimos por acá sin problema. 👍

**T3 — Cliente**

> ¿Y cuánto sale?

**T3 — Agente**

> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

**T4 — Cliente**

> Me quedo con las seis cuotas

**T4 — Agente**

> ¡Perfecto! Te anoto la opción de 6 pagos mensuales de USD 60.
>
> ¿Querés que avancemos con el registro para dejarlo listo?

**T5 — Cliente**

> Sí, mandame el link de pago para avanzar

**T5 — Agente**

> ¡Genial! Para dejarlo registrado y enviarte el link necesito tus datos: nombre, apellido, correo electrónico y teléfono. ¿Me los compartís?

**T6 — Cliente**

> Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

**T6 — Agente**

> ¡Perfecto, Camila! Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

**T7 — Cliente**

> Listo, ya hice el pago

**T7 — Agente**

> ¡Gracias, Camila! Registré tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

### H17-01

**T1 — Cliente**

> Estoy mirando la formación Excel Integral. Me gustaría manejar mejor las planillas.

**T1 — Agente**

> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a del equipo. Excel Integral es ideal para lo que buscás: vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información para trabajar las planillas con mucha más soltura.
>
> Para orientarte mejor: ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles del curso.

**T2 — Cliente**

> La alternativa de seis pagos me encaja; por ahora sólo estoy averiguando.

**T2 — Agente**

> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 queda anotada. Como estás averiguando, no hay apuro: cuando quieras avanzar con la inscripción, avisame y te ayudo con los siguientes pasos.
>
> Mientras tanto, si tenés alguna duda sobre el contenido o el ritmo del curso, estoy por acá para responderte.

**T3 — Cliente**

> Esta quincena paso, lo retomo otro día.

**T3 — Agente**

> Tranquilo/a, no hay problema. Cuando quieras retomarlo, avisame y seguimos desde donde quedamos.

**T4 — Cliente**

> Anotá mis datos: Emilia Ríos, emilia.rios@example.test, teléfono +1 305 555 0188.

**T4 — Agente**

> ¡Gracias, Emilia! Para dejarlo todo listo, solo me falta confirmar tu apellido. ¿Me lo confirmás?

**T5 — Cliente**

> Ahora sí quiero avanzar: pasame el enlace de la opción de seis pagos.

**T5 — Agente**

> ¡Perfecto, Emilia! Para enviarte el enlace de la opción de 6 pagos mensuales de USD 60, solo me falta confirmar tu nombre y apellido. ¿Me los confirmás?

**T6 — Cliente**

> Lo aboné recién, ¿queda registrado el aviso?

**T6 — Agente**

> ¡Gracias, Emilia! Quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

### H17-02

**T1 — Cliente**

> Quisiera conocer Redes Informáticas para mejorar en mi trabajo.

**T1 — Agente**

> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a de la Academia de Oficios. Me alegra que quieras fortalecer tus conocimientos en Redes Informáticas para tu trabajo.
>
> Para orientarte mejor: ¿ya tenés experiencia en el área de redes o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.

**T2 — Cliente**

> Me resulta más cómodo escribir; no quiero que me llamen.

**T2 — Agente**

> Perfecto, seguimos por chat sin problema. 👍

**T3 — Cliente**

> Cambié de idea sobre el curso: prefiero Excel Integral.

**T3 — Agente**

> ¡Claro! Excel Integral es una gran opción. Es un curso de la Academia de Negocios con 17 clases, 100% online, donde vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información.
>
> Para orientarte mejor: ¿ya tenés experiencia usando Excel o partís desde cero?

**T4 — Cliente**

> Dame de baja, no me escriban más.

**T4 — Agente**

> Listo, no te enviaremos más mensajes.

**T5 — Cliente**

> Que quede claro que sigo de baja.
