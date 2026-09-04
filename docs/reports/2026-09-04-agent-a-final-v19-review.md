# Revisión final V19 — evidencia local, calidad y límites

Fecha: 2026-09-04. Revisor Codex /root/rubric_review. Sólo lectura de fuente, logs, snapshots y cálculos locales; cero API/DB. No se editan los reportes previos. La corrida V19 es ajuste/regresión: ninguno de sus siete casos se presenta como un nuevo held-out.

**V19 completa 31 entradas de siete conversaciones y correlaciona 31/31 salidas con DB y captura local. Las métricas agregadas cumplen sus umbrales numéricos, pero la calidad sigue sin aprobar y aparece un estado de llamada que no corresponde al texto entregado.** La consulta de precio posterior al plan elegido vuelve a abrir el menú; el modelo registra como call_offer una invitación a contar contenido por chat; y una reparación evita un link no consentido pero deja texto que anticipa el pago. Cuatro tests aprobados no certifican estos aspectos.

## Fuente congelada y procedencia

Freeze `.eval/codex-20260904/v19-final-freeze.json`, 15:30:45.559339 UTC, SHA-256 `9719884d3dfab67ad6d17e2067c4ddff0419e20e0ee9035003019400f4fbb823`. Se comprobaron **314/314 hashes iguales** al cerrar la lectura local, sin diferencias en los archivos enumerados.

| Campo | Valor |
| --- | --- |
| Baseline commit | 360cd37201a35bf3c4cceb82a93e809885494529 |
| Brain / canónico | V19 / V8 |
| Canónico SHA-256 | 67adca0e95055f32943717af84cb22d211a624c631eb79848cf296c688ffa575 |
| Digest de fuente | 5deffc384d3b30771f51d11b55ac14371ce7657f8ed9fedc1b5389b1b4ea8693 |
| Next build, conservado desde V18 | QcD9WJ8pmq1dOexcAN784 |
| ADK SHA | 52730e46212ebeb82634e170813b7389c9a6bb8634085d3ad9c94eeaee94b153 |

Log `.eval/codex-20260904/live-v19-final.log`: tres archivos, cuatro tests aprobados; inicio 12:30:46 local, duración 108,35 s, último snapshot 15:32:34.730 UTC. `agent-a-full-conversations` contiene cuatro casos completos más una conversación de rechazo de llamada, aunque el archivo informe dos tests. Se contabilizan esos cinco diálogos más consentimiento/precio y replay de intake V2. Se excluyen como duplicados el agregado de cuatro conversaciones, el prefijo before-request de siete turnos y los checkpoints de intake de uno a tres turnos.

Los dos primeros held-out fallidos se mantienen FAILED. El replay V2 siguiente a su diagnóstico no restablece independencia. V3 primera ejecución de V17 conserva su PASS funcional de cuatro turnos y repair rate 25%; V3 repetida en V18 es regresión. Esta fuente V19 no ejecutó un nuevo held-out ni pretende reemplazar aquellas evidencias.

## Resultados persistidos y entrega

| Caso | Entradas / salidas correlacionadas | Resultado durable observado |
| --- | --- | --- |
| wf_01_consulta_y_cambio_de_curso | 4 / 4 | Excel Integral queda seleccionado tras Redes; ningún plan ni link. Se preserva la descripción canónica de PC dentro de Oficios. |
| wf_02_objecion_precio_y_rechazo_llamada | 4 / 4 | Maquillaje Profesional; callPreference=chat, declined, una oferta; ningún plan/link. |
| wf_03_plan_postergacion_link | 4 / 4 | Plan monthly_6 conservado; postergación sin URL; identidad Lucía Ferrer completa y única URL 6m sólo ante pedido de T4. |
| wf_04_aviso_de_pago | 3 / 3 | paymentReportedAt=15:31:34.283Z; sin link ni pago acreditado. Defecto: callOfferCount=1/offered y awaiting=call_or_chat pese a no haberse ofrecido llamada en el texto. |
| Rechazo de llamada | 4 / 4 | Redes; chat/declined/count1; no nueva llamada ofrecida después del rechazo; continúa contenido/precio por chat. |
| Consentimiento y precio | 8 / 8 | monthly_6; identidad Camila Ortiz completa; ninguna URL T1–T7; única URL 6m después del permiso T8. |
| Replay intake V2 | 4 / 4 | Valentina Costa, correo y declaredPhone completos; ninguna URL T1–T3; única URL contado tras pedido T4. |

Las tres URLs son canónicas de laboratorio (`https://example.invalid/eval/6m`, dos conversaciones; `https://example.invalid/eval/contado`, una). DB y adaptador coinciden por ID autorizado, turnId, traceId, destino, estado submitted, provider message ID y contenido exacto. En las tres identidades capturadas, el teléfono declarado permanece separado del identificador sintético del canal. No hay llamadas ejecutadas ni acceso entregado por estas pruebas. La ausencia de link antes de permiso se comprueba por acción durable, URL registrada y texto capturado; no sólo por una frase del modelo.

Este conjunto V19 no vuelve a ejercitar opt-out; su evidencia causal anterior permanece en los informes históricos. Tampoco observa entrega real en Telegram, Stripe o una acreditación bancaria. La entrega local es verificable, pero su alcance es el adaptador de pruebas.

## Hallazgos materiales, con origen del texto

### 1. Plan elegido persistido, pero la conversación vuelve a pedir elegirlo

Consentimiento/precio T5: «Me quedo con las seis cuotas». El agente confirma seis pagos de USD60 y total USD360. En T6 el cliente sólo vuelve a preguntar cuánto cuesta. Modelo, proposal /decision y salida coinciden literalmente:

> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Traza `85073036-4aab-42bf-a50e-29991a1b3ce2`, turno `f98ea694-ff96-4ad6-9047-4fde4fd33d04`, respuesta modelo `a86b5a0a-5fff-4cc4-a886-a460cfd5972b`, outbound `7b61714f-b31a-4d2a-8602-a22dab97615c`. No es una poda que haya eliminado la mención del plan. El modelo produce ask_payment_options y la salida vuelve a abrir una decisión ya tomada. T3/T4 también repiten el menú completo, y T2 repite la pregunta de diagnóstico de T1. El backend conserva correctamente monthly_6, como muestra T7; esa corrección de estado no subsana la continuidad textual.

**Comparación V18, sin promedio entre versiones.** En `workflow-consent-price-after-request-2026-09-04T15-28-05-235Z-fa6a58f7-327a-4163-a6d7-c537f8c47bb4.json`, T6 decía «…podés elegir 6 pagos…, 12 pagos… o un pago único». V18 reabría el menú; V19 añade otra vez la pregunta de elección. Las correcciones de alcance del canónico no resolvieron esta regresión de calidad. El SHA-256 del snapshot V18 es `4067865f4bc1a565e5e71e5a1841cafbf6a45bb9248905d98ae0c493107cc82c`; su transcripción V2 tiene SHA `d6e3157550c0bad4e0b4736b8144e75ad92656aac0a73802bb7126422a2f995d`.

### 2. Oferta de llamada contabilizada sin una oferta en lenguaje natural

wf_04 T1 incluye en `response.call_offer`:

> Si querés, puedo contarte más en detalle cómo funciona el curso.

Esa frase se entrega sin modificación. No menciona teléfono, llamada ni otro canal: ofrece explicar contenido. Aun así, el estado final tiene `callOfferCount=1`, `callOfferStatus=offered`, `awaitingReply=call_or_chat`. Traza `132cf26a-2f7d-4631-8029-2f273c515ab9`, turno `b4713755-7972-43f4-b472-8178b5a20db6`, respuesta modelo `53463072-fcb6-472b-b6d5-b853def61a3c`, outbound `7b0e1c73-9167-4734-9ea3-d2fbe93575ec`.

Esto consume una oportunidad de llamada y deja una espera por elección de canal que nunca fue planteada. No se observa una llamada no consentida; el defecto comprobado es el registro y la continuidad del estado. El máximo de dos ofertas y la presencia de un campo no bastan para certificar que cada oferta ocurrió. Se comunicó al coordinador; esta revisión no modifica el runtime ni convierte el resultado de los asserts existentes en un fallo de test que no ocurrió.

### 3. Reparación real de consentimiento, con calidad residual

Replay V2 T3 aporta el formulario completo pero no pide link. La primera respuesta `01b4eff4-0a2f-4653-9bb0-80430da4c8b3` propone send_payment_link y anuncia «Te envío el link». ADK rechaza ACTION_NOT_AUTHORIZED. La segunda respuesta `ffa2ec4f-9122-47df-bec4-0f731c8545c1` incluye `repair_of.rejection_id=6cf75e69-c7a1-4aac-b816-88203182a021`, attempt1 y acción none. Traza `f72dc9a6-e5cd-4f98-800f-ae98d6e17b79`, turno `92d5525d-c18e-422b-8b8b-31859e85a5ad`.

Salida reparada y capturada, outbound `f538c75c-2772-4d1c-b2dd-ac3138ef1fa1`:

> ¡Gracias, Valentina! Ya quedaron registrados tus datos. Cuando hagas el pago, avisame por acá y el equipo lo revisará para gestionar tu acceso.

El dato de identidad sí está respaldado y no sale URL. La reparación elimina la acción y su anuncio, pero no espera permiso de forma explícita: anticipa el pago al recibir datos. La explicación del acceso no dice que ya se entregó; sí omite la condición explícita de acreditación que la frase canónica exige. El evento repair_success=true demuestra que la validación estructural/comercial acepta el nuevo intento, no que la conversación reparada sea excelente. T4 entrega el enlace correcto tras el pedido expreso.

### 4. Correcciones observadas y límites de atribución

wf_01 T1 entrega intacta la descripción de Armado y Reparación de PC dentro de Academia de Oficios; no vuelve el referente huérfano producido por el guard de pertenencia de V15. wf_04 T3 entrega completa la condición «La inscripción se confirma cuando el equipo verifica que el pago esté acreditado; en ese momento gestionan tu acceso». No se observó la poda previa que eliminaba su condición. wf_03 no queda mudo y entrega la única URL en el mismo turno de petición+datos, tras respetar la postergación. Son verificaciones acotadas, no pruebas de ausencia total de regresiones.

Los tres cambios finales de canónico V19 son coherentes: inscripción/acceso requieren verificación; un dato desconocido no promete «lo verifico y te digo»; una objeción postventa respeta la política opcional de llamada sin prometer inmediatez. Mantienen 322 líneas y la redacción del modelo, sin agregar planner ni plantillas de salida nuevas. No permiten atribuir cualquier mejora a una sola línea, ni corrigen por sí mismos el call_offer mal clasificado o la repetición observada.

## Métricas V19, con denominadores explícitos

| Medida | V19, siete conversaciones |
| --- | --- |
| Entradas modelo / HTTP | 31 / 32 |
| Usage ausente / proveedor desconocido | 0 / 0 |
| Input / cache / output tokens | 306295 / 206336 / 8232 |
| Reparaciones semánticas | 1/31 = 3,2258% |
| Reparaciones exitosas | 1/1 = 100%, una sola observación |
| Fallback / disponibilidad fallida / desconocida | 0 / 0 / 0 |
| p50 / p95 | 3360 / 4157 ms |
| numeric_gates_passed | true |
| quality_ready / production_ready / stability_certified | false / false / false |

El agregado corresponde a una única fuente y sólo a sus 31 turnos. En el subcaso intake V2 la tasa de reparación es 1/4=25%; no se oculta esa concentración detrás del agregado. Consentimiento/precio V19 no necesitó reparación, pero conserva el fallo de calidad del menú. Los p95 por caso son: wf01 4157, wf02 3841, wf03 3486, wf04 3615, rechazo 3973, consentimiento 3721 e intake 5860 ms.

V18 queda separado: consentimiento 8 entradas/9HTTP, repair1/8, p955853; replay V3 4 entradas/5HTTP, repair1/4, p955561. Sus dos métricas numéricas son false por frecuencia de reparación. No se mezclan con V19 para mostrar una mejora global ni se reclasifica V3 como una segunda validación nueva.

El costo acumulado y sus reservas se consultan en el informe de medición y ledger del coordinador. No se reinicia el prior USD0,38 ni se infiere gasto de cuenta a partir de tokens de este subconjunto. Esta revisión no consumió APIs. La ausencia de más llamadas previstas tampoco convierte las condiciones pendientes en aprobadas.

## Rúbrica de conversación V2

Escala 1–5; media≥4, ninguna dimensión<3 y contratos duros cumplidos para el umbral descriptivo. Se puntúa texto realmente entregado y estado observado. Escucha cubre comprensión; Tono cubre cordialidad; relevancia se añade fuera de la media para completar las seis dimensiones pedidas. El revisor conoce el código y escribió los guiones independientes de intake: no es evaluación ciega ni calibración humana de naturalidad.

| Caso | Escucha | Tono | Progresión | Iniciativa | Concisión | No repetición | Cumplimiento | Continuidad | Media | Relevancia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| wf01 | 4 | 3 | 3 | 3 | 4 | 4 | 3 | 3 | 3,375 | 3 |
| wf02 | 4 | 3 | 3 | 3 | 4 | 3 | 3 | 4 | 3,375 | 4 |
| wf03 | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 3,75 | 4 |
| wf04 | 4 | 3 | 4 | 2 | 4 | 4 | 2 | 3 | 3,25 | 4 |
| Rechazo de llamada | 4 | 3 | 3 | 3 | 4 | 4 | 3 | 3 | 3,375 | 4 |
| Consentimiento/precio | 2 | 3 | 2 | 3 | 2 | 2 | 2 | 2 | 2,25 | 3 |
| Replay intake V2 | 4 | 3 | 3 | 3 | 4 | 4 | 2 | 3 | 3,25 | 3 |

Ninguno de los siete supera el umbral completo. No se promedian versiones anteriores para alterar esta conclusión.

- **wf01:** entiende los cambios y mantiene Excel; el «¿?» final recibe otra elección entre información y otra formación, sin aclarar qué causó la confusión. «Buena elección/Perfecto» y «ese área» reducen naturalidad; información y diagnóstico no siempre siguen la secuencia indicada.
- **wf02:** responde la preocupación económica y respeta chat. Al pedir la cuota mínima, vuelve a listar las otras dos en vez de detenerse en USD30. La apertura y los cierres siguen formulados de modo genérico.
- **wf03:** reconoce postergación sin presión ni prometer recordatorio y retoma exactamente el plan al pedir link. Conserva una apertura genérica y no comunica la frase canónica del proceso posterior al completar datos con permiso; progreso funcional bueno, cumplimiento parcial.
- **wf04:** diferencia aviso de acreditación y responde la duda sobre inscripción con condición humana completa. La iniciativa y cumplimiento bajan por el call_offer que registra una llamada inexistente, además de presentar contenido antes de diagnóstico.
- **Rechazo:** respeta preferencia y contesta contenido/precio. T3 aporta información breve pero vuelve a preguntar si quiere precisamente más explicación después de que ya la pidió; T2 no desarrolla el tema pendiente.
- **Consentimiento/precio:** seis cuotas persisten y la seguridad del link se mantiene, pero repetir diagnóstico y menú transforma una consulta de confirmación en otra elección. La exactitud económica no sustituye escucha ni continuidad.
- **Replay intake:** nombre, plan y permiso se conservan, y ya no queda sólo «¿…con eso?» en T2. La reparación de T3 anticipa pago y omite condición explícita de acreditación; tono cordial pero repetidamente formulario. El PASS de persistencia no equivale a cumplimiento conversacional.

## Estado real recomendado

**Candidato verificable en laboratorio; no aprobación de naturalidad, estabilidad ni producción.** Quedan el fallo repetido de plan, el registro de oferta de llamada sin oferta real y el texto anticipatorio tras datos. Las pruebas muestran barreras efectivas contra URL no autorizada, persistencia de identidad, conservación de plan y entrega local, pero no satisfacen por sí solas la aceptación de calidad del traspaso.

Este informe no despliega, no comprueba un canario de Telegram y no autoriza una alternativa de rollback. Un backup offline de 360cd3, si se prepara, es una alternativa identificada; no prueba recuperar exactamente la producción previa. El coordinador debe asociar el commit final, estado real del despliegue y condiciones pendientes. Los primeros FAILED y las regresiones permanecen disponibles para revisión.

## Procedencia reproducible y transcripciones

Las tablas y transcripciones siguientes se generan sólo de los siete snapshots finales ya enumerados. Se usa SHA-256 de bytes y `buildConversationQualityReviewPacketV2` para redactar correos/teléfonos y calcular su hash. Las métricas se recalculan con `summarizeWorkflowMetricsV1` sobre evidence+db; las salidas se correlacionan por todos los campos indicados. Leer outputs de boundary deepseek y proposal /decision permite distinguir borrador, reparación y entrega. No se ejecuta el workflow al reproducir esta revisión.

Rutas relativas a `botpress-agent/evals/results/`:

| Caso | Snapshot | SHA-256 archivo | SHA-256 transcripción redactada |
| --- | --- | --- | --- |
| wf01 | `workflow-conversation-2026-09-04T15-31-01-120Z-42b828cc-c04d-4ab7-89e7-6216669bb6e5.json` | `58ff0bebda7a4e5af5d3c0e45fa4ba1ed0bc7ac8caa9d1996693060bd2daa0ad` | `f73a6b124a647100066a0b464eb672dc3436a93d155681602a292daf10f18c9d` |
| wf02 | `workflow-conversation-2026-09-04T15-31-14-762Z-46efb7c8-9172-4499-8e7a-17b97054fc39.json` | `0beb6e37c292e07a6e36ef0d0b1236dd16d3b8b7baa598e38528cdfc74e5cc73` | `c2cc79164357c412066d19adb227cb8ea9176896ba4cd3caa981e77f6df5a2ce` |
| wf03 | `workflow-conversation-2026-09-04T15-31-28-000Z-2247434f-4348-4808-8925-3f04723388aa.json` | `809aaea5d4cf9e2cd68e2d9124a789712791a4d8305ab1ddd4b58e6e95cd98f3` | `34fad59ad915d0016b8b943b346d59524bd1168e5c995b04f0e6f60436c38e4b` |
| wf04 | `workflow-conversation-2026-09-04T15-31-37-124Z-20422641-8b0e-4a6a-8035-5f857bd66042.json` | `14716f4e6341227ac86f7b829cb346285226f54aa2b4da246fd22d177547325e` | `85efd4ca98e10b039830292457db0c96fe3dcd0e5303c5e1a0da5be5c52af991` |
| Rechazo de llamada | `workflow-call-declined-2026-09-04T15-31-51-129Z-54486f79-3e0d-4472-ad5b-7376259e56e4.json` | `06ec99740494f2c0004c2d038d2e11dcc678e08ef1988f2d928aa750ef7d4fdd` | `0cb019778f033300bada9f69a9c4fbab365f86653764a65f0b956968af8140c5` |
| Consentimiento/precio | `workflow-consent-price-after-request-2026-09-04T15-32-17-896Z-02cb4b12-bc9d-4d66-80bb-f9f7013f4cb2.json` | `c73f3baeb783c00bc313ee1e7d73d87fe5578979838f57916c1738d3d7758181` | `4f16546f8ac5bee47e609544ca7dfc7725967ef535c89ba55aee1fa6f1165bb6` |
| Replay intake V2 | `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-32-34-730Z-86f817a3-5a15-4a2d-b12f-3c4d0a52d00a.json` | `edc6265d6ee0e7c5d1cd76fea2997dd45bb3d04150e4d4204fda7223254f77c6` | `5d3101e15f4afd6485f5299ce01ac2208eb08d3eba75fb8c0412b7da871f8e16` |

### wf01

**T1 — Cliente**
> Hola, quería saber qué formaciones tienen en tecnología

**Agente**
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesoría educativa. En tecnología tenemos la formación en Armado y Reparación de PC, dentro de nuestra Academia de Oficios. ¿Te interesa ese área o buscás algo más específico?

**T2 — Cliente**
> Me tienta la de Redes Informáticas

**Agente**
> ¡Buena elección! Redes Informáticas es parte de nuestra Academia de Oficios y te permite conocer cómo funcionan las redes y cada uno de los dispositivos que las componen. Son 16 clases, 100% online y en español.
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

**T3 — Cliente**
> Pensándolo mejor, prefiero Excel Integral

**Agente**
> ¡Perfecto! Excel Integral es de nuestra Academia de Negocios y son 17 clases, 100% online y en español. Vas a aprender las herramientas elementales, fórmulas y funciones, gráficos, resúmenes de información y mucho más.
>
> ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

**T4 — Cliente**
> ¿?

**Agente**
> ¿Querés que te cuente más sobre Excel Integral o preferís que te ayude a encontrar otra formación que se ajuste a lo que buscás?

### wf02

**T1 — Cliente**
> Buenas, me interesa Maquillaje Profesional

**Agente**
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy asesor/a educativo/a de StudyX. Me alegra que te interese Maquillaje Profesional.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar maquillaje profesional o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**
> Uf, me parece bastante plata la verdad

**Agente**
> Te entiendo. Por eso te comento que podés elegir entre 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

**T3 — Cliente**
> No me llames por favor, sigamos escribiendo

**Agente**
> Perfecto, seguimos por acá sin problema. 😊
>
> ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar?

**T4 — Cliente**
> ¿Y la cuota más baja de cuánto sería?

**Agente**
> La opción de menor cuota es la de 12 pagos mensuales de USD 30. También tenés 6 pagos de USD 60 o un pago único de USD 360.

### wf03

**T1 — Cliente**
> Quiero anotarme en Redes Informáticas

**Agente**
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con tu inscripción en Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**
> Me quedo con las seis cuotas

**Agente**
> Perfecto, te anoto en el plan de 6 pagos mensuales de USD 60. El total del programa es USD 360. ¿Querés que avancemos con el pago?

**T3 — Cliente**
> Igual esta semana no puedo, lo dejo para el lunes

**Agente**
> Tranquilo/a, no hay problema. Queda anotado tu plan de 6 pagos mensuales de USD 60. Cuando quieras retomar el lunes, avisame y seguimos con el pago.

**T4 — Cliente**
> Ya está, mandame el link. Soy Lucía Ferrer, [EMAIL_REDACTED], mi teléfono es [PHONE_REDACTED]

**Agente**
> ¡Perfecto, Lucía! Ya quedó registrado tu plan de 6 pagos mensuales de USD 60. Te envío el link para que completes el pago.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

### wf04

**T1 — Cliente**
> Me anoto en Excel Integral

**Agente**
> ¡Excelente elección! Excel Integral es un curso de la Academia de Negocios con 17 clases, 100% online y en español. Vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información.
>
> Para orientarte mejor: ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, puedo contarte más en detalle cómo funciona el curso.

**T2 — Cliente**
> Ya hice la transferencia recién

**Agente**
> Perfecto, quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

**T3 — Cliente**
> ¿Entonces ya quedé inscripta?

**Agente**
> Tu aviso de pago quedó registrado. La inscripción se confirma cuando el equipo verifica que el pago esté acreditado; en ese momento gestionan tu acceso.

### Rechazo de llamada

**T1 — Cliente**
> Hola, me interesa Redes Informáticas

**Agente**
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**
> Prefiero no hablar por teléfono, seguimos por chat

**Agente**
> Perfecto, seguimos por chat entonces 👍

**T3 — Cliente**
> Contame más del contenido

**Agente**
> Claro, te cuento. El curso de Redes Informáticas tiene 16 clases y está pensado para que entiendas cómo funcionan las redes y cada uno de los dispositivos que las componen.
>
> Se cursa 100% online, en español, y vas a poder avanzar a tu ritmo con el material disponible en la plataforma. ¿Te gustaría que te cuente cómo se organizan las clases y qué incluye?

**T4 — Cliente**
> ¿Y cuánto sale?

**Agente**
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

### Consentimiento/precio

**T1 — Cliente**
> Hola, me interesa Redes Informáticas

**Agente**
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos y estoy para ayudarte con Redes Informáticas. ¿Ya tenías pensado estudiar este curso o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles.

**T2 — Cliente**
> Prefiero no hablar por teléfono, sigamos por acá

**Agente**
> Perfecto, seguimos por acá sin problema 👍
>
> Contame, ¿ya tenías pensado estudiar Redes Informáticas o recién estás empezando a averiguar?

**T3 — Cliente**
> ¿Y cuánto sale?

**Agente**
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

**T4 — Cliente**
> ¿Y cuánto sale?

**Agente**
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

**T5 — Cliente**
> Me quedo con las seis cuotas

**Agente**
> Perfecto, 6 pagos mensuales de USD 60. El total sigue siendo USD 360. ¿Querés que avancemos con la inscripción para dejarlo registrado?

**T6 — Cliente**
> ¿Y cuánto sale?

**Agente**
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

**T7 — Cliente**
> Soy Camila Ortiz, [EMAIL_REDACTED], mi teléfono es [PHONE_REDACTED]

**Agente**
> Gracias, Camila. Quedó registrado tu nombre, correo y teléfono. Ya tenés elegido el plan de 6 pagos mensuales de USD 60. ¿Querés que te envíe el link de pago para avanzar?

**T8 — Cliente**
> Sí, ahora mandame el link de las seis cuotas

**Agente**
> Perfecto, Camila. Te envío el link de pago de las 6 cuotas de USD 60.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

### Replay intake V2

**T1 — Cliente**
> Buenas, quisiera formarme en Maquillaje Profesional para trabajar por mi cuenta.

**Agente**
> Hola, bienvenido/a a StudyX 🇺🇸 Soy tu asesora educativa. Veo que te interesa Maquillaje Profesional para trabajar por tu cuenta, ¡excelente objetivo! Para orientarte mejor: ¿ya tenés experiencia en maquillaje o arrancás desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

**T2 — Cliente**
> Prefiero hacer un pago único.

**Agente**
> Perfecto, el pago único de USD 360 es una gran opción. ¿Querés que avancemos con la inscripción para dejarlo registrado?

**T3 — Cliente**
> Nombre y apellido: Valentina Costa
> Email: [EMAIL_REDACTED]
> Celular: [PHONE_REDACTED]

**Agente**
> ¡Gracias, Valentina! Ya quedaron registrados tus datos. Cuando hagas el pago, avisame por acá y el equipo lo revisará para gestionar tu acceso.

**T4 — Cliente**
> Sí, enviame ahora el enlace para abonar todo junto.

**Agente**
> ¡Perfecto, Valentina! Te envío el enlace para el pago único de USD 360.
>
> Pago único de USD 360: https://example.invalid/eval/contado


## Anexo fechado — 2026-09-04 15:41 UTC: arreglo posterior de call_offer y fixture

La corrida pagada V19 de 15:30–15:32 es **anterior** a este cambio. Su call_offer informativo contado como llamada permanece como fallo observado en la sección 2. No se modifica aquella transcripción, su nota ni su freeze. El gasto pagado no cambia por las comprobaciones de este anexo.

El primer arreglo posterior hace que `visibleCallOffer` en agent-turn-policy-v2 exija `solicitsACall` también en el campo dedicado. Agent A Brain aplica `solicitsACallV1` para no rechazar por presupuesto un campo que sólo tiene información. Conserva la prosa del modelo y cambia exclusivamente su clasificación para autorización/conteo. El recorrido nuevo en agent-a-deterministic-outcomes usa backend y DB locales, con proveedor fixture y sin llamada al modelo remoto.

Log `.eval/codex-20260904/v19-call-ledger-workflow-free.log`, inicio 12:40:32 local, tres tests aprobados, 16,71s. Sus cuatro checkpoints call-ledger-fixture de 15:40:33–15:40:36 demuestran esta secuencia:

| Turno | Contenido del campo dedicado | callOfferCount / status | awaitingReply |
| --- | --- | --- | --- |
| 1 | «Si querés, puedo contarte más en detalle cómo funciona el curso.» | 0 / not_offered | none |
| 2 | «Si querés, coordinamos una llamada.» | 1 / offered | call_or_chat |
| 3 | «Seguimos por chat.» después de veto | 1 / declined | none |
| 4 | «Te puedo contar más por acá.» | 1 / declined | none |

Snapshot final `botpress-agent/evals/results/workflow-call-ledger-fixture-2026-09-04T15-40-36-971Z-6dc6731c-d0d8-42be-a5a2-827129844c74.json`, SHA-256 `2343ae46a21df707ccf261335fd86a0267b09421046a5bbc7050c0def42f53fa`. Se verificaron 4/4 salidas por ID/turno/traza/destino/estado/provider/texto. Declara provider=fixture, api_cost_usd=0, cuatro fixture_model_turns y cero live_model_turns. No es una reevaluación de comprensión ni naturalidad. El revisor sólo leyó los snapshots; la ejecución de workflow/DB la hizo el coordinador.

**La revisión independiente detectó una regresión en esta primera variante del arreglo.** Al colocar en call_offer «¿Hablamos por teléfono?» o «¿Quieres que te llame para explicarte el curso?», con may_offer_call=false, call_offer_count=2, call_offer_status=declined y preferencia chat, `authorizeAgentTurnV2` devuelve ok=true y `validateAgentATurnProposalV1` devuelve null. Son ofertas de llamada reales no cubiertas por los detectores existentes. Antes, cualquier texto no vacío en el campo dedicado era rechazado en ese estado; por eso la ampliación de aceptación introduce este bypass. La reproducción usa funciones puras y un contexto del snapshot V19 cargado en memoria, sin API/DB ni cambios de código. El control «¿Querés que coordinemos una llamada?» sigue rechazado en ambas capas, y el texto informativo pasa correctamente.

Por lo tanto, a las 15:41 UTC se aprueba únicamente la evidencia de la fixture acotada y se mantiene **pendiente la aprobación del arreglo completo** hasta resolver esas ofertas reales. Los cuatro pasos verdes no cubren los nuevos negativos. Esta observación fue comunicada al coordinador; cualquier corrección y comprobación posterior debe quedar añadida con su propia hora, sin transformar este intento en un éxito retrospectivo.


### Revisión posterior — 2026-09-04 15:44 UTC: canal de voz en el campo declarado

La segunda variante usa un detector conservador de canal de voz dentro de call_offer, sin exigir una conjugación de solicitud específica. La comprobación pura independiente confirma que «¿Hablamos por teléfono?» y «¿Quieres que te llame para explicarte el curso?» ya se rechazan en backend y ADK cuando cap=false y el contacto rechazó llamadas; el texto informativo sigue pasando. Esto resuelve los dos ejemplos iniciales.

Permanece, en esa segunda variante, un alcance demasiado amplio de la excepción NOT_AN_OFFER: «Ya registré tus datos. ¿Hablamos por teléfono?» y «Entendido, seguimos sin llamada. ¿Quieres que te llame para explicarte el curso?» devuelven backend ok=true, entrega íntegra y ADK null con count=2/declined/chat. Un reconocimiento de datos o negación en otra oración exime la oferta real que sigue. Se reprodujo con intake completo para evitar confundirlo con la autorización de registrar datos. También se comunicó la variante separada por coma. No se agregaron llamadas pagas ni fixtures desde el revisor. A esta hora la aprobación sigue pendiente de acotar esa excepción; el hallazgo no afecta la evidencia positiva del recorrido fixture anterior.


### Revisión posterior — 2026-09-04 15:47 UTC: excepción acotada por cláusula

La tercera variante segmenta el campo declarado por oraciones, signos interrogativos, comas y conjunciones antes de aplicar la excepción de negación/reconocimiento. No modifica el detector narrativo histórico fuera de call_offer. Se repitieron en funciones puras las cinco ofertas informadas: dos preguntas directas, reconocimiento de datos seguido por punto, por coma y negación de otra oración. **Las cinco ahora son rechazadas por backend y ADK** con count2/declined/chat. El texto informativo original y «Entendido, seguimos sin llamada» siguen aceptados en ambas capas.

Verificación gratuita independiente, inicio 12:46:55 local: **116/116 unitarias aprobadas** en agent-turn-policy-v2, agent-a-brain y operational-promises. Esta revisión acotada no identifica otro bloqueante material en el cambio y aprueba la corrección de las regresiones reportadas. Es una aprobación local del código y de esos contratos, no una certificación semántica exhaustiva del detector ni de la calidad conversacional.

| Fuente revisada | SHA-256 |
| --- | --- |
| `src/features/conversation/domain/agent-turn-policy-v2.ts` | `20a6d214ab0dcd47f3c0866c41887b6dc4a13ad700a7459b28046bb2b348585e` |
| `src/features/conversation/domain/operational-promise-guard.ts` | `6a7d7690d949fa0cd4b7bb749c2d5c8a95d4f515a57ea8345f752cc2ad339cdd` |
| `botpress-agent/src/lib/conversation/agent-a-brain.ts` | `a7e150183a78d1f5bd7d8c23a68bf274ccc5d5afa57fedd0ffe43b1375a83256` |

El último workflow disponible al emitir esta nota, v19-call-final-workflow-free de 15:44, precedía a los builds call-scope de 15:46. No se lo atribuye a esta tercera variante. El coordinador está completando el fixture y freeze definitivos. La corrida pagada V19 permanece anterior a todas las variantes; sus transcripciones, métricas y rúbrica siguen intactas. No hubo más API/DB desde este revisor ni se considera resuelta la repetición de plan o la anticipación de pago.


### Cierre del anexo — 2026-09-04 15:50 UTC: fixture definitiva y fuente final

Verificado el freeze `.eval/codex-20260904/v19-call-final-freeze.json`, fechado 15:47:41.402662 UTC, SHA-256 `3c4164a424715680c4842cea924c363a2764039d7b33187a43a4584160594fa9`. **314/314 archivos enumerados coinciden** con el disco en la revisión final. Brain V19 y canónico V8 se conservan; los artefactos finales corresponden al arreglo posterior del conteo de llamadas.

| Campo | Fuente final posterior al live |
| --- | --- |
| Digest de fuente | a98f6e57ce2604c3cde29c5595c11ffee5598e26679516c3acfb83e80625430e |
| Next build | IrwZGDZAUGAKWeW7Jjxmn |
| ADK SHA | b9376e34f04dc8d2cc47c587e9576b58140f057cf78658e60fd7f3c881c3fdf1 |
| Baseline commit del freeze | 360cd37201a35bf3c4cceb82a93e809885494529 |

Log `.eval/codex-20260904/v19-call-scope-workflow-free.log`: inicio 15:47:39 UTC, tres tests aprobados, duración16,68s. El freeze se escribió durante esta ejecución; no se presenta como una validación independiente reservada. Los checkpoints definitivos del caso de llamada muestran:

| Turno / checkpoint UTC | Texto del campo dedicado entregado | Count / status / awaiting |
| --- | --- | --- |
| T1 / 15:47:41.069 | «Si querés, puedo contarte más en detalle cómo funciona el curso.» | 0 / not_offered / none |
| T2 / 15:47:42.137 | «¿Hablamos por teléfono?» | 1 / offered / call_or_chat |
| T3 / 15:47:43.198 | «Seguimos por chat.» tras «Prefiero seguir por chat» | 1 / declined / none |
| T4 / 15:47:44.258 | «Te puedo contar más por acá.» | 1 / declined / none |

Snapshot definitivo `botpress-agent/evals/results/workflow-call-ledger-fixture-2026-09-04T15-47-44-258Z-ad049eed-437e-4c1b-8856-e5431f967915.json`, SHA-256 `f01a84d4d4d492d0504268bc48cb59780fc1e6c8d684311fde87ae01d64dd503`. **Cuatro salidas de cuatro correlacionadas** por outbound autorizado, turno, traza, destino, submitted, provider ID y texto exacto. El estado final es chat/declined/count1/awaitingnone. El proveedor es fixture, costo0, live_model_turns0, fixture_model_turns4, disponibilidad fallida0 y desconocida0. Los snapshots anteriores del mismo caso son prefijos, no conversaciones adicionales.

Esto cierra la verificación local del arreglo causal de call_offer: no gasta una oferta por prosa informativa, cuenta la paráfrasis real de llamada, respeta el veto posterior y conserva la respuesta por chat. Las regresiones puras de excepción entre cláusulas también quedaron rechazadas como se documentó arriba. Se aprueba este cambio acotado con evidencia de persistencia y salida local; no queda pendiente el defecto específico de conteo en la fuente final.

**La evaluación de calidad pagada sigue siendo la de V19 anterior al arreglo.** El falso conteo observado allí permanece en su transcripción y rúbrica como antecedente corregido después mediante fixture. La fuente final no tuvo otra evaluación pagada de naturalidad; siguen sin resolverse por esta evidencia la repetición del menú/elección y el texto que anticipa pago. Ningún anexo certifica producción, estabilidad, despliegue ni Telegram. El revisor no hizo API/DB; leyó la ejecución gratuita coordinada y mantuvo intactos los primeros held-out fallidos y la primera V3 aprobada con repair25%.
