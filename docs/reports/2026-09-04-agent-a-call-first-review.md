# Agente A — prioridad de llamada para prueba supervisada

Fecha: 2026-09-04, cierre de fuente de prompt a las 16:33 UTC; informe a las 16:38 UTC. Base revisada: `d5b786af65162c54721f9dc8ab0cbf7820b701e1`, rama `codex/agent-a-plannerless-v2`. Se leyó el prompt canónico completo y su preámbulo, el contrato de call_offer, la autorización y los antecedentes de persistencia y entrega. La nueva instrucción del usuario autoriza preparar y desplegar una prueba supervisada con llamada prioritaria; este informe no sustituye la verificación ni la ejecución de despliegue del coordinador.

## Resultado y alcance

Se dejó un cambio de prompt revisable: **brain V20 / canónico V9**, con las 322 líneas del canónico y su módulo generado equivalentes. SHA-256 del Markdown: `6d724acf6e366571bc6ce94d5013d007654442a67562daf67e672542c1eba17b`.

La invitación inicial queda requerida cuando hay curso canónico conocido, capacidad autorizada, ningún ofrecimiento previo y el turno elige o consulta ese curso, también mediante secondary_moves. Tiene prioridad sobre diagnóstico, datos y cierre por chat. Una pregunta concreta recibe respuesta breve sin sumar otra pregunta de diagnóstico, datos o pago en ese turno. Rechazo, preferencia por chat y veto prevalecen. La llamada sigue siendo opcional para el cliente; se preservan el máximo de dos invitaciones y la segunda sólo ante más información sin aceptación ni rechazo. Un área sola o un curso desconocido no habilita la acción.

Al continuar por chat, el diagnóstico se hace una vez si aún hace falta, aprovechando lo ya respondido. Se conservan presentación, precio y cierre con consentimiento vigente. El modelo nunca escribe una URL: el backend agrega únicamente el link de pago autorizado. Se quitó la prohibición general de «links de cualquier tipo», que contradecía esa entrega. También se reconciliaron las instrucciones de presentación en tres mensajes y precio en cuatro con el límite de dos response.messages; se conservan los tres aspectos y los cuatro contenidos, respectivamente.

Archivos de este cambio:

- `docs/prompts/studyx-agent-a-canonical.md`
- `botpress-agent/src/prompts/agent-a-brain-v1.ts`
- `botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts`
- `scripts/generate-agent-a-prompt-module.mjs`
- `tests/unit/botpress/agent-a-brain-prompt.test.ts`
- `tests/unit/botpress/agent-a-canonical-prompt.test.ts`
- `tests/unit/prompts/canonical-prompt-v2.test.ts`

El revisor no modificó runtime, policy, backend, workflow ni catálogo. El coordinador ajusta aparte la descripción de call_offer en el esquema wire y prepara el nuevo recorrido. No se añadió un planner, una máquina de estados ni una frase fija de invitación.

## Contradicciones e impedimentos concretos de la base

| Hallazgo en d5b786a | Efecto | Tratamiento o límite |
| --- | --- | --- |
| Fase 2 exigía diagnóstico antes de cualquier información y la política prefería llamada al consultar el curso. | Competían dos próximos pasos en un turno con una sola pregunta. | El diagnóstico queda después de la primera invitación habilitada, al continuar por chat. |
| El preámbulo requería primera invitación sólo para select_course/count0, y ask_course_information sólo para count1. | Un curso ya guardado con primera consulta informativa podía pasar sin llamada. | V20 incluye ambos movimientos y sus secundarios con count0. |
| El preámbulo decía que nada en el contexto establece una obligación de turno. | Contradecía la obligación explícita de primera invitación. | Se conserva que estado no equivale a fase completada y se distingue la política explícita de llamada. |
| La prohibición de cualquier link coexistía con el envío de pago en Fase 5. | Podía desalentar la entrega autorizada o volver incoherente la respuesta. | Se distingue URL escrita por el modelo de link canónico agregado por backend. |
| La autorización valida invitaciones presentes pero no exige que exista una inicial. | Un modelo que omita call_offer puede tener respuesta técnicamente válida sin cumplir la prioridad comercial. | El prompt transmite la obligación; el nuevo workflow del coordinador comprueba count1 y awaiting call_or_chat en T1. Las unitarias de prompt no demuestran cumplimiento del modelo. |

El último punto fue comunicado al coordinador antes de congelar. No es una afirmación de que la nueva corrida haya omitido la oferta: todavía no había transcripción V20 al cerrar esta revisión de fuente.

## Capacidad, estado y recuperación

La capacidad de oferta del contexto requiere curso seleccionado, permiso de responder, preferencia desconocida y contador menor que dos. La autorización del backend mantiene el curso conocido, el veto y el límite de ofertas. No corresponde ampliar a un área sin curso sólo para forzar prioridad. La posibilidad de solicitar una llamada real también depende de las comprobaciones de llamada activa y rechazo previo del backend; ofrecerla no equivale a iniciarla ni a prometer atención inmediata.

Una invitación real contabilizada deja `call_or_chat`, salvo que deba conservarse un intake con consentimiento pendiente. La negativa deja preferencia chat/estado declined y no aumenta de nuevo el contador. El plan seleccionado se guarda y no constituye consentimiento de pago. Solicitar explícitamente el link con datos incompletos conserva `contact_details`; el último dato con ese permiso permite materializarlo. Los datos espontáneos sin permiso no autorizan el link, y una postergación revoca el permiso pendiente. Son contratos que deben verse en DB y salida correlacionada, no deducirse del texto del agente.

Una propuesta rechazada puede recibir una reparación correlacionada y acotada. Un fallo de proveedor o una reparación fallida no debe transformarse en una oferta simulada para aparentar cumplimiento: la ruta técnica debe conservar evidencia del fallo y computarlo en disponibilidad. La prioridad de llamada no autoriza volver a un planner ni a respuestas comerciales de reemplazo. La nueva fuente necesita su propia prueba de comportamiento; no hereda un verde de la fixture anterior.

Para links, `may_send_payment_link` por sí sola no acredita una URL configurada ni el consentimiento. El materializador vuelve a validar curso, plan y datos; `config-payment-link.resolver.ts` resuelve `PAYMENT_LINK_12M`, `PAYMENT_LINK_6M` y `PAYMENT_LINK_CONTADO`. Si falta la configuración válida, la materialización informa `LINK_CONFIG_MISSING`; no corresponde improvisar otra URL o cambiar el plan. La configuración estructural aceptada no demuestra por sí sola que Stripe mantenga ese link activo con el precio esperado. El coordinador controla esa comprobación para el entorno desplegado.

## Evidencia gratuita de este ajuste

Todos los logs están en `.eval/codex-20260904/deploy-supervised/`.

| Log | Resultado | Qué demuestra |
| --- | --- | --- |
| `call-first-prompt-red.log` | 5 fallos / 25 aprobadas | Los nuevos contratos de versión y prioridad fallaban contra la fuente anterior. |
| `call-first-prompt-green.log` | 30/30 | Primera implementación de prioridad y generación del canónico. Hash provisional, sustituido después. |
| `call-first-phase-scope-red.log` | 2 fallos / 28 aprobadas | Reproduce contradicción de obligación y cantidad de mensajes. |
| `call-first-prompt-final-green.log` | **79/79**, cuatro archivos | Prompt ensamblado, versión/hash y equivalencia completa del generado; regresiones unitarias del brain con proveedor simulado. Fuente definitiva V20/V9 indicada arriba. |
| `call-first-prompt-lint.log` | Exit0; 0 errores, 2 advertencias | Scripts/tests sin error; los dos archivos de prompt dentro de Botpress están ignorados por el ESLint raíz. No se declara lint de esos archivos. El agente de integración controla typecheck/check/build del adapter. |

`git diff --check` pasó. El comando final focal fue `vitest run --config vitest.config.mts tests/unit/botpress/agent-a-brain-prompt.test.ts tests/unit/botpress/agent-a-canonical-prompt.test.ts tests/unit/prompts/canonical-prompt-v2.test.ts tests/unit/botpress/agent-a-brain.test.ts`, inicio 13:33:20 local. Ninguna de estas comprobaciones hizo API paga ni DB. Las pruebas de contenido de instrucciones verifican que se transmiten las reglas y que el canónico no quedó truncado; **no califican comprensión, naturalidad ni adherencia del modelo en producción**.

## Recorrido corto para la prueba supervisada

Propuesta revisable de siete mensajes del cliente; es un caso de ajuste compartido antes de ejecutar, no un held-out. Debe usar conversación nueva, curso vigente confirmado, contador0 y un link real del plan elegido previamente comprobado por el coordinador. Los datos de abajo son sintéticos, no un destinatario al que contactar.

| Turno del cliente | Comportamiento esperado y evidencia |
| --- | --- |
| 1. «Hola, me interesa Redes Informáticas.» | Curso canónico guardado y una invitación real y opcional a llamada. No diagnóstico/intake/cierre simultáneo. count1, offered y call_or_chat. |
| 2. «Prefiero seguir por acá, no quiero que me llamen.» | Respeta el rechazo; diagnóstico breve si todavía hace falta. chat/declined, count1 y sin solicitud de llamada. |
| 3. «Empiezo desde cero y quiero aprender a resolver problemas de redes en pequeños comercios.» | Usa el objetivo para la presentación con hechos confirmados; no repite diagnóstico ni inventa requisitos. |
| 4. «¿Cuánto cuesta y cómo se puede pagar?» | Presenta los planes canónicos, total USD360 y cierre por opción sin mezclar información no autorizada. |
| 5. «Elijo las seis cuotas.» | Guarda monthly_6 y consulta si quiere avanzar. No envío ni interpretación automática de consentimiento. |
| 6. «Mis datos: Daniel Suárez; daniel.suarez@example.test; +1 305 555 0122.» | Persiste nombre, email y teléfono declarado sin reemplazar identidad de canal; no URL porque aportar datos no da permiso. |
| 7. «Sí, ahora enviame el enlace de las seis cuotas.» | Una sola acción y URL canónica para monthly_6, con captura y DB de ese turno. No declara pago acreditado, inscripción ni acceso otorgado. |

El coordinador preparó, por separado, `tests/workflow/agent-a-call-first-sale.test.ts`, de ocho turnos: agrega una repregunta por el importe de la cuota elegida, y pide permiso antes de aportar los datos. Esta variante también es ajuste. Debe conservar su checkpoint antes de cada assertion; una captura con texto sin el outbound autorizado, mismo turno/traza/destino/provider y estado de entrega no cuenta como prueba de salida.

## Qué está probado y qué falta

El antecedente gratuito definitivo V19 es `workflow-call-ledger-fixture-2026-09-04T15-47-44-258Z-ad049eed-437e-4c1b-8856-e5431f967915.json`: cuatro salidas correlacionadas, contador `0/1/1/1` y awaiting `none/call_or_chat/none/none`. Demostró que una frase informativa no consume oferta, una paráfrasis real sí, y el veto se conserva. **No demostró que el modelo ofrezca la llamada primero**: el primer texto era informativo y el proveedor fixture. La revisión completa está en `2026-09-04-agent-a-final-v19-review.md`.

La evaluación pagada V19 anterior a ese arreglo mantiene sus fallos de repetición de opciones y anticipación del pago. Los dos primeros held-out fallidos y V3 aprobada con 25% de reparación permanecen intactos. Ningún resultado anterior se renombra como V20 ni se promedian versiones para mejorar una nota.

Al cerrar este informe quedan por verificar con la fuente V20: invitación inicial real sin pregunta competidora, rechazo durable, continuidad por chat sin repetir diagnóstico o menú, datos y consentimiento correctos, y entrega del link por el workflow del entorno elegido. La prueba supervisada de Telegram y el estado real del despliegue pertenecen al coordinador; aquí no se certifican. El gasto acumulado informado antes de V20 era USD0,823283696 sobre un tope de USD1; este revisor no hizo nuevas llamadas, y toda ejecución posterior debe usar el mismo ledger central.

**Estado de esta entrega: fuente de prompt estable y controles locales aprobados con los límites descritos, lista para integración y prueba supervisada. No es aprobación global de calidad conversacional ni confirmación de despliegue.**

### Anexo 16:41 UTC — manifests y fixtures vigentes

El gate completo del coordinador detectó un manifest con versión anterior y dos fixtures del runner sensibles a `PAYMENT_LINK_12M` del entorno. Se reprodujo el mismatch por separado y los otros dos fallos con una URL local ficticia. Se actualizó únicamente `prompt_version` a V20 en los manifests activos `studyx-agent-a-brain-v1-heldout.json` y `studyx-agent-a-conversational-baseline.json`, sin cambiar casos ni reportes. Dos fixtures en `agent-a-conversation-runner.test.ts` ahora fijan explícitamente su propia configuración mediante vi.stubEnv; su afterEach existente la restaura. No se cambió el runner ni se relajó la comparación de URL. **95/95 pruebas focales aprobadas**, incluso con una URL externa al fixture en el entorno, en `call-first-manifest-runner-green.log`. RED conservados: `call-first-manifest-runner-red.log` y `call-first-runner-env-red.log`. El prompt y su hash permanecen iguales.

### Anexo 16:45 UTC — primera conversación live V20: fallida

Fuente íntegra leída: `botpress-agent/evals/results/workflow-call-first-sale-2026-09-04T16-40-59-391Z-8ebe8071-1ce8-49e0-840a-ff5944c35ad8.json`, SHA-256 `a1fa1cae6ebacb4c6bfc44e5a58ab475e8954ec8f833e42b9181ffcde9cd4237`. Es **una conversación de ajuste**, ocho turnos con DeepSeek, ejecutada por el coordinador mediante processInboundTurn y adaptador local. El revisor sólo leyó el archivo; participa en el ajuste del prompt y esta nota no constituye una calificación ciega externa.

Se correlacionaron **8/8 salidas** entre evidencia del turno, outbound autorizado en DB y captura, comparando ID, turnId, traceId, conversación destino, submitted, provider ID y contenido exacto. No hubo fallback ni fallo de disponibilidad. Nueve HTTP completan ocho turnos: reparación intentada1/8=12,5%, aceptada1/1, p95 total5398ms. El gate de frecuencia de reparación está rojo. Estos números no corrigen los fallos de contenido.

La primera llamada sí cumple: T1 dice «Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas», sin pregunta competidora. T2 respeta «No quiero una llamada…» con «¡Perfecto, seguimos por chat!» y una pregunta de diagnóstico. T3 contesta modalidad y personaliza el objetivo del negocio, sin reiterar diagnóstico. T4 presenta las opciones; T5 confirma «plan de 6 pagos mensuales de USD60» y solicita permiso para avanzar. El estado final conserva monthly_6, chat/declined y count1. No hubo otra oferta ni llamada ejecutada.

**Fallo T6, introducido al preparar la salida.** Ante «¿De cuánto es cada una de las cuotas que elegí?», la propuesta enviada a /decision responde correctamente: «Cada cuota del plan que elegiste es de USD60, durante6meses. El total es USD360». La captura contiene únicamente «El total es USD360». La traza `fdcc2ea6-ede3-4e19-ae58-4988af31363c` registra REPEATED_AGENT_REPLY, sin reparación; el backend elimina justamente la oración que responde. El assert original `/60/` también coincidía dentro de `360`: ese verde superficial es inválido y el coordinador lo está corrigiendo. No hay reapertura del menú en este caso, pero tampoco una respuesta útil a la cuota.

**Fallo T8 de intake y de reparación semántica.** T7 autoriza explícitamente el enlace y el agente pide los cuatro datos. T8 aporta «nombre Camila; apellido Duarte; correo camila.duarte@example.test; teléfono +1 305 5550168». El claim ya conserva email/teléfono y publica `intake_missing=[nombre,apellido]`; la DB final tiene name=null, email correcto y teléfono declarado separado del canal sintético. No se envía link: stage plan_selected, awaiting contact_details, recordedLinks y deliveredLinks vacíos. La corrección de extracción pertenece al coordinador y measurement.

Hay además un error del modelo durante la reparación, no un fallo de extracción del correo. La primera propuesta T8 anuncia datos registrados y send_payment_link; ADK la rechaza por ACTION_NOT_AUTHORIZED y MISSING_INTAKE de nombre/apellido. La segunda lleva `repair_of.rejection_id=044e7916-6c0d-4629-bc8a-2d6749b4aa81`, attempt1 y acción none, pero dice «Ya tengo tu nombre y apellido registrados. Solo me falta tu correo electrónico…». El contexto y authorized_alternatives siguen indicando que faltan nombre/apellido. El backend elimina la afirmación falsa de registro y deja entregado «¡Gracias, Camila! Solo me falta tu correo electrónico para dejarlo todo listo». Traza `389fbe7d-a2f3-4865-a461-c9dad28a6fd5`. La reparación fue aceptada técnicamente y protegió la acción; **no reparó la comprensión ni la solicitud de datos**. No se puede usar successful1/1 como éxito conversacional.

| Dimensión V2, escala1–5 | Nota | Evidencia de la conversación completa |
| --- | --- | --- |
| Comprensión | 3 | Comprende interés, rechazo y elección T1–T5; T6 no responde la unidad consultada y T8 solicita un dato ya recibido. |
| Relevancia | 3 | T3 responde «cómo se cursa»; el total de T6 reemplaza la cuota solicitada. |
| Continuidad | 3 | Mantiene chat y plan, no reitera diagnóstico; T8 contradice datos actuales y bloquea el siguiente paso. |
| Cordialidad | 4 | T2 acepta el rechazo sin presión y conserva trato respetuoso. T1 y T3 son algo extensos, sin hostilidad. |
| Iniciativa | 3 | Llamada inicial y avance comercial adecuados; después del formulario propone una tarea equivocada al cliente. |
| Cumplimiento comercial | 2 | Respeta veto, precios y permiso previo; no completa identidad ni entrega el link solicitado con datos aportados. |

Media descriptiva3/5; **no aprobada**. No se detectó otro bloqueo comercial independiente en T1–T7 fuera de los anteriores. Permanecen pendientes corregir y volver a observar importe visible, intake completo y link autorizado/capturado. Las unitarias y el despliegue por sí solos no resuelven esta conversación. No se modificó su snapshot ni se la convierte retrospectivamente en una aprobada si luego pasa la regresión.

### Anexo 16:53 UTC — regresión V20 posterior: contratos observados aprobados

Se leyeron los ocho turnos y la evidencia completa de `botpress-agent/evals/results/workflow-call-first-sale-2026-09-04T16-51-29-866Z-7380aeae-cbab-41b2-97c7-dc4efa9bb8d2.json`, SHA-256 `912bdbe9619cc213a9a8af2848f3abb7d0d296f0bd946506ecf72a441bf817d9`. Es una **nueva ejecución del mismo caso de ajuste**, posterior a las correcciones de extracción, validación de solicitudes de intake y diferenciación del plazo de cuotas frente a duración académica. No es held-out. El primer intento fallido permanece arriba y su snapshot no cambia.

La revisión acotada del diff de esas correcciones no identifica otro bloqueante material. El plazo de pago sólo se reconoce con importe, cantidad de cuotas y mensualidad canónicos, y conserva el rechazo de duración académica impropia. La validación ADK diferencia pedir un dato de afirmar que ya está registrado. Son detectores conservadores con límites léxicos; esta revisión no certifica comprensión exhaustiva de toda paráfrasis. El diagnóstico posterior precisa que la oración sobre seis meses de pago chocaba con el guard de duración académica; la aparición de REPEATED_AGENT_REPLY en el evento del primer intento no demuestra por sí sola la causa de la poda final.

**Persistencia y salida:** 8/8 capturas coinciden con el outbound autorizado por ID, turno, traza, conversación destino, submitted, provider ID y texto exacto. La DB guarda Camila Duarte, camila.duarte@example.test y teléfono declarado +13055550168, separado del identificador sintético de canal. Conserva redes_informaticas/monthly_6, chat/declined/count1, stage payment_link_sent y awaiting none. Sólo T8 tiene acción send_payment_link; recordedLinks y deliveredLinks contienen una vez `https://example.invalid/eval/6m`. T7 es la solicitud explícita previa, con los datos aún pendientes: no se adelanta el envío.

| Turnos | Evaluación sobre el texto entregado |
| --- | --- |
| T1–T2 | Invitación real inicial: «podemos coordinar una llamada breve». Después del rechazo: «Seguimos por chat, sin problema» y una sola pregunta diagnóstica. No otra oferta ni llamada ejecutada. |
| T3 | Contesta cómo se cursa, reconoce el objetivo del negocio y no repite diagnóstico. La personalización es breve, sin desarrollar una aplicación concreta. |
| T4–T5 | Tres planes y total correctos; T5 guarda seis cuotas y pide permiso. T4 omite el cierre por opción: la iniciativa de elegir la aporta el simulador en T5. Es una limitación de la ejecución de las fases, sin bloquear el contrato de pago observado. |
| T6 | «El plan que elegiste es de 6 pagos mensuales de USD 60 cada uno. El total del programa es USD 360.» Contesta la cuota, conserva la elección y no reabre menú. La oración útil llega completa. |
| T7–T8 | Tras permiso pide los cuatro datos, recibe el formulario y entrega el único link. «Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso» conserva condición y verificación humana; no afirma pago, matrícula o acceso consumados. |

Rúbrica manual V2 de esta conversación: **comprensión4, relevancia4, continuidad4, cordialidad4, iniciativa3, cumplimiento comercial4**; media descriptiva23/6=3,83 sobre5. Comprensión y continuidad mejoran porque T6 responde la pregunta concreta y T8 aprovecha los datos; la iniciativa no obtiene4 porque el agente deja las opciones sin próximo paso explícito en T4. No hay una nueva calibración humana ni revisión ciega externa; quien escribe también participó en el prompt. Esta nota no convierte los ocho asserts en una aprobación global de naturalidad.

Ocho turnos, ocho HTTP, p95 total4400ms, cero reparaciones, fallback0 y disponibilidad fallida/desconocida0. Con cero reparaciones, la tasa de éxito de reparación es **null por falta de muestra**, no100%; el agregado numeric_gates_passed también es null por ese límite. Los fallos funcionales T6/T8 del primer intento quedan resueltos **en esta regresión observada**. No aparece otro bloqueo material para continuar la prueba supervisada autorizada. La entrega verificada sigue siendo local_adapter y la URL es de laboratorio: el despliegue, configuración real y canario de Telegram deben acreditarse por separado por el coordinador.
