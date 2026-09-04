# Revisión independiente de transcripciones existentes — Agente A

Fecha de revisión: 2026-09-04. Evaluador: subagente Codex `/root/rubric_review`, independiente del modelo objetivo `deepseek-v4-flash` y del coordinador que modifica runtime/prompt. No se llamó a APIs, no se generaron conversaciones, no se consultó producción. Las notas son el juicio de este revisor; no constituyen calibración humana ni medición de satisfacción de clientes.

Las transcripciones existentes no certifican naturalidad ni disponibilidad. En los tres archivos del workflow hay **12 conversaciones y 42 turnos de cliente; dos turnos de postergación quedan sin respuesta**. Los dos casos están separados; no son una única conversación duplicada. Hay persistencia parcial verificable, pero faltan correlaciones de entrega y bloqueo de opt-out. Dos conversaciones envían un link sin solicitud explícita de avance/link visible. La variante runner `final-1` además deja consultas sin contestar aunque sus casos figuren `passed`.

## Cobertura y procedencia

Se leyó completo el traspaso del 4/9, las instrucciones aplicables del repositorio, el prompt canónico completo y el esquema V2. Se calificaron todas las transcripciones del 4/9 presentes al comenzar esta revisión: **12 del workflow real y 29 de las cinco variantes v13 del runner histórico**. Estas últimas sirven para localizar defectos, nunca para certificar el workflow. Los 26 archivos anteriores (98 transcripciones) se inventarían al final y no se califican como candidato actual. No se seleccionó únicamente la corrida final ni sólo ejemplos favorables.

Checkpoint del árbol al empezar: branch `codex/agent-a-plannerless-v2`, HEAD `ad15baafb63e8c55cb877f943a74e57c2899deda`, sin cambios reportados por `git status --short`. Este informe identifica resultados por SHA-256: no asume que fueron generados con ese HEAD. La mayoría fueron generados antes del commit; los archivos workflow no incluyen commit, hash de prompt, parámetros efectivos, flags o identidad de build.

Todas las rutas de fuentes de la tabla son relativas a `botpress-agent/evals/results/` dentro de este worktree. `Tn` identifica el n-ésimo mensaje del cliente y la respuesta siguiente hasta el próximo mensaje de cliente; un turno sin respuesta sigue contando. Los hashes por transcripción se calculan después de redactar correo/teléfono con el algoritmo oficial.

| Fuente | Archivo | Fecha UTC del reporte | Casos / turnos | SHA-256 de archivo |
| --- | --- | --- | --- | --- |
| W | `workflow-conversations-latest.json` | 2026-09-04T12:47:25.184Z | 4 / 15 | `486f505339f20163ffb8fc02fa129275808fc070c0029abb6eaabacedfac3675` |
| P | `workflow-persisted-outcomes.json` | 2026-09-04T12:48:58.633Z | 7 / 21 | `1ccf70ba0f2013ff7d22c9f75d21a9a2433360b4a9aba7ab5ba78372036d87df` |
| A | `workflow-adaptive-sale.json` | 2026-09-04T12:49:18.426Z | 1 / 6 | `e2a43c97d046afc02622fc3636591babe6b2b9d2c5509d0531b292d34fa5c1eb` |
| F | `happy-path-v13focal-1.json` | 2026-09-04T10:41:59.822Z | 5 / 21 | `77853dd8fa313d32c18276e46472856a8e07d6c462c3bcd6c64ad8f192f7a75c` |
| I2 | `happy-path-v13iter2-1.json` | 2026-09-04T10:45:50.719Z | 6 / 26 | `276b1d5b1927c071042bed2f8d2f9df3a608f48ef67c534a9f138b77e099558e` |
| I3 | `happy-path-v13iter3-1.json` | 2026-09-04T10:58:14.090Z | 6 / 26 | `8572932dbb0e5b52d12c7c05e9ada9e592f4750a1afd5541390526752b31f4e4` |
| C4 | `happy-path-v4canon-1.json` | 2026-09-04T11:55:18.230Z | 6 / 26 | `918e21a0c58b2389769ab8d7acc9e7c310fe538ced2c7e2d8cd51bc97c70814c` |
| FIN | `happy-path-final-1.json` | 2026-09-04T11:59:19.308Z | 6 / 26 | `98f70cccb85de1334578acd9f22e55c0f027bcf804ffdf48fe2af1109c8ecd5f` |

Las fuentes W/P/A declaran `execution_harness=processInboundTurn`, `evaluated_route=plannerless-v2`. En P/A las decisiones no determinísticas exportadas informan `studyx-agent-a-brain-v13`/`deepseek-v4-flash`; el ACK de opt-out es determinístico v17. F/I2/I3/C4/FIN declaran `runner_reimplementation`: las tres primeras guardan SHA base `1ad468d7…` con árbol dirty; C4/FIN guardan `04fda380…` con árbol dirty. Ninguna de esas cinco acredita por sí sola el código del checkpoint.

## Criterio de puntuación V2

La documentación `docs/operaciones/rubrica-conversacional-agente-a.md` todavía describe cinco dimensiones V1. La fuente ejecutable `scripts/lib/agent-a-conversation-quality.ts:195` define ocho dimensiones V2, que se usan aquí. Un caso sólo pasa el evaluador formal si su gate duro pasa, promedio ≥4 y ninguna dimensión <3. No se asigna gate duro verde cuando la evidencia necesaria falta.

| Columna | Dimensión V2 / aspecto solicitado | Criterio aplicado |
| --- | --- | --- |
| Esc | listening_context / comprensión | Entiende pregunta, curso, elección, veto y datos ya aportados. |
| Tono | natural_tone / cordialidad | Cordial y profesional; 3 cuando predominan fórmulas, «bienvenido/a», «asesor/a» y agradecimientos incongruentes. |
| Prog | commercial_progression | Lleva al paso adecuado sin depender de que un cliente guionado salve una omisión. |
| Ini | appropriate_initiative / iniciativa | Responde primero; respeta chat, postergaciones y autorización de acciones. |
| Conc | concision | Brevedad útil; un silencio o «gracias» que omite lo pendiente no es concisión excelente. |
| NoRep | no_repetition | Evita repetir diagnóstico, opciones o respuestas completas sin una nueva necesidad. |
| Cump | prompt_compliance / cumplimiento comercial | Catálogo, planes, consentimiento de link, datos faltantes, límites de promesas y prompt completo. |
| Cont | turn_continuity / continuidad | Resuelve el turno actual y retoma correctamente el anterior. Silencio técnico: 1. |
| Rel | Relevancia solicitada, complementaria | Mide si el contenido contesta la pregunta concreta; no se incorpora al promedio V2 de ocho dimensiones. |

Anclajes: 1=incumplimiento grave/ausencia; 2=defecto importante; 3=adecuado con fricción; 4=bueno; 5=resuelto sin el defecto observable. Las notas evalúan la conversación completa. Una cita identifica el turno que explica la principal deducción; los aciertos también se conservan. Los incumplimientos de estilo/fases se registran sin convertirlos en autorización para reinstalar un planner rígido.

Los textos de apertura siguen mostrando cargos genéricos con barras y no una persona con nombre consistente. En varios casos se hace una pregunta de diagnóstico y se vuelve a formular sin usar la respuesta; pedir diagnóstico no demuestra escuchar. La cordialidad correcta no compensa preguntas omitidas, enlaces no autorizados ni promesas futuras.

## Workflow real: los doce casos disponibles

`ROJO` identifica un fallo observado; `INCOMPLETO` identifica evidencia insuficiente para aprobar el gate duro completo. En ambos casos el dictamen formal permanece no certificado. La media de la tabla es orientativa y no un porcentaje de naturalidad.

| Fuente / caso | Esc | Tono | Prog | Ini | Conc | NoRep | Cump | Cont | Media V2 | Rel | Gate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| W / `wf_01_consulta_y_cambio_de_curso` | 3 | 2 | 3 | 3 | 3 | 2 | 2 | 3 | 2.625 | 3 | INCOMPLETO |
| W / `wf_02_objecion_precio_y_rechazo_llamada` | 4 | 3 | 4 | 4 | 4 | 3 | 3 | 4 | 3.625 | 4 | INCOMPLETO |
| W / `wf_03_plan_postergacion_link` | 2 | 3 | 2 | 2 | 3 | 4 | 2 | 1 | 2.375 | 2 | ROJO |
| W / `wf_04_aviso_de_pago` | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 3.750 | 4 | INCOMPLETO |
| P / `curso_cambiado` | 4 | 3 | 3 | 3 | 3 | 2 | 2 | 3 | 2.875 | 4 | INCOMPLETO |
| P / `llamada_rechazada` | 4 | 3 | 4 | 4 | 3 | 2 | 2 | 3 | 3.125 | 4 | INCOMPLETO |
| P / `telefono_declarado` | 4 | 3 | 3 | 2 | 4 | 4 | 1 | 4 | 3.125 | 4 | ROJO |
| P / `link_autorizado` | 4 | 3 | 4 | 3 | 4 | 4 | 3 | 4 | 3.625 | 4 | INCOMPLETO |
| P / `postergacion` | 2 | 3 | 1 | 2 | 3 | 4 | 2 | 1 | 2.250 | 2 | ROJO |
| P / `pago_informado` | 4 | 3 | 3 | 3 | 4 | 3 | 1 | 4 | 3.125 | 4 | ROJO |
| P / `opt_out` | 4 | 3 | 5 | 5 | 4 | 5 | 3 | 5 | 4.250 | 5 | INCOMPLETO |
| A / `adaptive` | 4 | 3 | 3 | 2 | 4 | 4 | 1 | 4 | 3.125 | 4 | ROJO |

**W / wf_01_consulta_y_cambio_de_curso** — T3 retoma Excel, pero repite diagnóstico y llamada de T2; T4 «¿Me confirmás si ya tenías pensado estudiar Excel…?» responde a «¿?» repitiendo la misma pregunta.
Hash de transcripción redactada: `f50b9e3953334cbfdb0ce014b6f1abf7f9f9ccb9469a398026fe7be87b7773d2`.

**W / wf_02_objecion_precio_y_rechazo_llamada** — T3 «seguimos por acá» respeta el veto, aunque repite las tres opciones recién dadas; T4 contesta exactamente «12 pagos mensuales de USD 30».
Hash de transcripción redactada: `bf32ebf877038d62a5b53b23ffa6628a6dcee6312af35975f68dd8fa2e99f268`.

**W / wf_03_plan_postergacion_link** — T3 «Igual esta semana no puedo, lo dejo para el lunes» no recibe respuesta. T4 vuelve sólo porque el cliente guionado entrega datos y solicita el link.
Hash de transcripción redactada: `daf044c1d7adcc59e89fdabadb51bf9c2b8e2009b2dcf547830d29b6fac8a0dd`.

**W / wf_04_aviso_de_pago** — T2 «si está acreditado» y T3 «cuando el equipo verifique» mantienen la diferencia entre aviso y pago verificado; T1 omite la pregunta de diagnóstico.
Hash de transcripción redactada: `9a15529235df6f06f3624f06c39ce7f3113d3442d5c13ddffe352829700f2431`.

**P / curso_cambiado** — T2 cambia correctamente a Excel, pero repite diagnóstico y llamada. T3 «herramientas elementales… fórmulas… gráficos» vuelve sobre el temario ya explicado en T2.
Hash de transcripción redactada: `097f357382d702443a7a2ef025c9b5aee3e8409747a7c6ffa3641b76ab2083d8`.

**P / llamada_rechazada** — T2 sigue por chat y el estado registra declined/count=1. La misma pregunta «¿ya tenías pensado estudiar maquillaje…?» reaparece en T1, T2 y T3; T3 agrega «varios meses» sin duración concreta trazable en el reporte.
Hash de transcripción redactada: `15b19cdc8141a7111be230e699079b58799f275213fb8674be9910fd042e2bcc`.

**P / telefono_declarado** — T2 sólo elige «pago único»; T3 entrega datos y recibe link sin petición explícita de avance/link. declaredPhone sí conserva el teléfono comercial separado del +999 sintético.
Hash de transcripción redactada: `78b20ea8c17bd7eadcde797fa13cab580d2b679d8712a1f2e45b656a3ab0bd4f`.

**P / link_autorizado** — T3 pide «Mandame el link» y aporta datos: la respuesta contiene /6m y DB monthly_6/send_payment_link. Falta correlación mensaje/turno/adaptador en este reporte.
Hash de transcripción redactada: `c7d5fc4663b0fb48118ce3ac07aa7b1372a85dcd9044db95a898fd522e9983c6`.

**P / postergacion** — T3 «Ahora no puedo, lo dejo para la semana que viene» queda sin respuesta; la decisión es BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK. La elección monthly_12 persiste.
Hash de transcripción redactada: `7572318f2d40cfd12ca1a0c56060b5ae268ef40c8d8ebde53b2ae78bc9d59512`.

**P / pago_informado** — T3 distingue acceso de aviso, pero promete «te avisan por acá». paymentReportedAt existe; humanReviewRequestedAt=null y no hay acción registrada que pruebe ese mensaje futuro.
Hash de transcripción redactada: `6d9aad3ef5d51922baf3228315bc03a6690ee954c4d2c7c051ed5b8ceee4c566`.

**P / opt_out** — T2 «Listo, no te enviaremos más mensajes» es breve y detiene venta. EXPLICIT_OPT_OUT_ACK aparece, pero el export no contiene consentimiento/bloqueo persistido ni un turno posterior de comprobación.
Hash de transcripción redactada: `3f015c09931ef0e5ed9caf03f01e653280a791ff088726a667c1aa0a6ee89cdf`.

**A / adaptive** — T2 acepta chat pero no continúa información; T4 sólo elige seis cuotas y T5 entrega datos: recibe /6m sin autorización explícita de link/avance. T6 registra aviso sin afirmar acreditación.
Hash de transcripción redactada: `c1462aac529110df2b3484b43f756685a51f051b6b6cf63ceaea6a137823209c`.

Observaciones de evidencia y límites por dimensión: los casos de curso/cambio muestran comprensión de la elección; los de chat muestran veto persistido y ausencia posterior de nuevas ofertas; precios visibles respetan 12×30, 6×60 y 360. Sin embargo, postergar no recibe contención ni continuidad, el intake se inicia por mera selección de plan, y algunas respuestas de pago añaden seguimiento no probado. La repetición reduce tanto tono natural como utilidad.

## Reconstrucción del silencio y del falso verde

| Etapa | wf_03_plan_postergacion_link (W) | postergacion (P), evidencia independiente |
| --- | --- | --- |
| Entrada | T3: «Igual esta semana no puedo, lo dejo para el lunes». | T3: «Ahora no puedo, lo dejo para la semana que viene». |
| Contexto previo visible | Redes Informáticas, elección seis cuotas; el agente había pedido cuatro datos. | Excel Integral, elección 12 cuotas; el agente había pedido cuatro datos. |
| Contexto enviado al modelo | No exportado; no inferir capabilities ni memoria exacta del texto visible. | No exportado. |
| Generación y propuesta | No se conserva texto crudo, proveedor request ID ni outcome de cada intento. | No se conserva texto crudo ni outcome por intento. |
| Rechazo y repair | No exportado. No puede afirmarse si hubo timeout, parse inválido, rechazo semántico o repair agotado. | No exportado; el motivo final tampoco identifica la causa primaria. |
| Commit/decisión | W no guarda decisiones ni IDs. El handoff atribuye la clasificación BRAIN_UNAVAILABLE; W por sí solo no permite verificar esa decisión exacta. | db.decisions[2]: reasonCode=BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK, hasResponse=false, responseType=null, businessActionType=null, modelName=policy:conversation-pipeline-v1-unavailable. |
| Persistencia | W no guarda snapshot DB. | selectedPaymentPlan=monthly_12, stage=plan_selected, awaitingReply=contact_details; ningún link. |
| Salida | Ninguna respuesta entre T3 y T4; delivered_turns=3, silent_turns=1 para cuatro entradas. | Transcript termina en usuario T3; outboundCount=2 y dos deliveryStates=submitted para tres entradas. |
| Recuperación posterior | T4 cliente aporta datos y pide link; la salida /6m no recupera la atención faltante de T3. | No hay turno de reanudación registrado. |

En el checkpoint, `tests/workflow/agent-a-full-conversations.test.ts:43` incluye `BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK` en `SILENCIOS_DELIBERADOS_V1`; líneas 129–137 restan del total de silencios un conteo global de decisiones sin respuesta. Esta lógica acepta un fallo técnico como atención exitosa y no correlaciona turno por turno. El síntoma puede demostrarse gratuitamente leyendo W: dos mensajes de cliente consecutivos y ningún assistant para T3.

Los logs existentes `.eval/api-v13focal.log`, `api-v13iter2.log`, `api-v13iter3.log`, `api-v4canon.log` y `api-final.log` corresponden al runner anterior. La búsqueda del caso y frase de wf_03 en ellos no recuperó una traza de ese turno; `api-final.log` termina alrededor de 11:59 UTC, antes de W (12:47). No atribuyo una causa de generación/repair a partir de logs de otro harness. El siguiente diagnóstico debe recuperar una traza correlacionada, no adivinar el rechazo a partir del silencio.

En el checkpoint, `tests/helpers/agent-a-workflow-db-evidence.ts:117` calcula `deliveredLinks` a partir de textos de mensajes outbound. P/A muestran `submitted`, pero no exportan por enlace un `message_id`/`turn_id` común a autorización, fila y captura del adaptador. La URL en transcript sugiere salida capturada; el arreglo debe probar esa correspondencia. Ninguno de los tres reportes prueba entrega Telegram.

## Variantes v13 del runner: todas las 29 transcripciones existentes del 4/9

Estos resultados comparan defectos ya observados. `NO_CERTIFICA_WORKFLOW` conserva la limitación del harness aunque su `status` original sea passed. `ROJO_CONTENIDO` señala una afirmación comercial no respaldada visible; `ROJO_RUNNER` incluye el fallo reportado por su propio gate. Las cinco variantes repiten escenarios y no son 29 casos independientes de held-out.

| Fuente / caso | Esc | Tono | Prog | Ini | Conc | NoRep | Cump | Cont | Media V2 | Rel | Estado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| F / `base_01_reopen_after_link` | 2 | 3 | 1 | 2 | 4 | 1 | 2 | 1 | 2.000 | 2 | ROJO_RUNNER |
| F / `base_04_which_payment` | 3 | 3 | 3 | 3 | 4 | 3 | 3 | 3 | 3.125 | 3 | NO_CERTIFICA_WORKFLOW |
| F / `base_05_prefers_chat` | 4 | 3 | 4 | 4 | 4 | 4 | 1 | 4 | 3.500 | 4 | ROJO_CONTENIDO |
| F / `base_08_expensive` | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 3.750 | 4 | NO_CERTIFICA_WORKFLOW |
| F / `base_17_report_without_link` | 2 | 3 | 2 | 2 | 4 | 2 | 1 | 2 | 2.250 | 2 | ROJO_CONTENIDO |
| I2 / `base_01_reopen_after_link` | 5 | 3 | 4 | 4 | 4 | 5 | 3 | 4 | 4.000 | 5 | NO_CERTIFICA_WORKFLOW |
| I2 / `base_04_which_payment` | 4 | 3 | 3 | 3 | 4 | 3 | 3 | 4 | 3.375 | 4 | NO_CERTIFICA_WORKFLOW |
| I2 / `base_05_prefers_chat` | 4 | 3 | 3 | 4 | 4 | 3 | 1 | 3 | 3.125 | 4 | ROJO_CONTENIDO |
| I2 / `base_08_expensive` | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 3.750 | 4 | NO_CERTIFICA_WORKFLOW |
| I2 / `base_14_intake_gate` | 5 | 3 | 5 | 4 | 4 | 5 | 3 | 5 | 4.250 | 5 | NO_CERTIFICA_WORKFLOW |
| I2 / `base_17_report_without_link` | 2 | 3 | 2 | 2 | 4 | 1 | 2 | 1 | 2.125 | 2 | NO_CERTIFICA_WORKFLOW |
| I3 / `base_01_reopen_after_link` | 5 | 3 | 4 | 4 | 4 | 5 | 3 | 4 | 4.000 | 5 | NO_CERTIFICA_WORKFLOW |
| I3 / `base_04_which_payment` | 3 | 3 | 3 | 3 | 4 | 3 | 3 | 3 | 3.125 | 3 | NO_CERTIFICA_WORKFLOW |
| I3 / `base_05_prefers_chat` | 2 | 3 | 2 | 3 | 3 | 1 | 1 | 2 | 2.125 | 2 | ROJO_CONTENIDO |
| I3 / `base_08_expensive` | 4 | 3 | 4 | 4 | 4 | 4 | 2 | 4 | 3.625 | 4 | NO_CERTIFICA_WORKFLOW |
| I3 / `base_14_intake_gate` | 3 | 3 | 2 | 2 | 4 | 4 | 2 | 2 | 2.750 | 3 | NO_CERTIFICA_WORKFLOW |
| I3 / `base_17_report_without_link` | 2 | 3 | 2 | 2 | 4 | 2 | 2 | 1 | 2.250 | 2 | NO_CERTIFICA_WORKFLOW |
| C4 / `base_01_reopen_after_link` | 5 | 3 | 4 | 4 | 4 | 5 | 3 | 4 | 4.000 | 5 | NO_CERTIFICA_WORKFLOW |
| C4 / `base_04_which_payment` | 3 | 3 | 2 | 2 | 4 | 1 | 2 | 2 | 2.375 | 3 | NO_CERTIFICA_WORKFLOW |
| C4 / `base_05_prefers_chat` | 3 | 3 | 3 | 3 | 3 | 2 | 1 | 3 | 2.625 | 3 | ROJO_CONTENIDO |
| C4 / `base_08_expensive` | 4 | 3 | 4 | 4 | 3 | 4 | 3 | 4 | 3.625 | 4 | NO_CERTIFICA_WORKFLOW |
| C4 / `base_14_intake_gate` | 3 | 3 | 2 | 2 | 4 | 4 | 2 | 2 | 2.750 | 3 | NO_CERTIFICA_WORKFLOW |
| C4 / `base_17_report_without_link` | 2 | 3 | 2 | 2 | 4 | 1 | 2 | 1 | 2.125 | 2 | NO_CERTIFICA_WORKFLOW |
| FIN / `base_01_reopen_after_link` | 5 | 3 | 4 | 4 | 4 | 5 | 3 | 4 | 4.000 | 5 | NO_CERTIFICA_WORKFLOW |
| FIN / `base_04_which_payment` | 1 | 3 | 1 | 2 | 4 | 3 | 2 | 1 | 2.125 | 1 | NO_CERTIFICA_WORKFLOW |
| FIN / `base_05_prefers_chat` | 2 | 3 | 2 | 3 | 4 | 2 | 2 | 2 | 2.500 | 2 | NO_CERTIFICA_WORKFLOW |
| FIN / `base_08_expensive` | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 3.750 | 4 | NO_CERTIFICA_WORKFLOW |
| FIN / `base_14_intake_gate` | 3 | 3 | 2 | 2 | 4 | 4 | 2 | 2 | 2.750 | 3 | NO_CERTIFICA_WORKFLOW |
| FIN / `base_17_report_without_link` | 2 | 3 | 2 | 2 | 4 | 1 | 2 | 1 | 2.125 | 2 | NO_CERTIFICA_WORKFLOW |

**F / base_01_reopen_after_link** — T4 y T5 repiten «Gracias, Ariana.»; faltaba teléfono y no lo pide. T5 no responde al saludo. El propio status era failed.
Hash V2: `1841f313aa2f1103efbe1f0026de4803ba7b50a8bcfd2703e126f8dbe6c8c827`.

**F / base_04_which_payment** — T4 «¡Gracias! Quedó registrado tu plan… ¿me confirmás tu nombre y apellido?» contesta parcialmente el monto, pero deriva otra vez a datos en vez de explicar la opción.
Hash V2: `78c182f883c410ab36244e05a7a76717b5c4e9e852bd8fa3b022910dfd3d841b`.

**F / base_05_prefers_chat** — T2 respeta chat. T4 «no necesitás experiencia previa»/«solo… conexión a internet» afirma requisitos no confirmados por catálogo; diagnostic FACT_VALUE_MISMATCH/repairAttempted=true.
Hash V2: `915f3fc60fb449c443d351c5e0ba41306ad9f1c4840686431a9d586dbc34a596`.

**F / base_08_expensive** — T3 reconoce objeción sin inventar otra financiación. T4 repite la cuota correcta, aunque «Perfecto» trata una pregunta como aceptación y vuelve al cierre.
Hash V2: `862da2068e73e4d0956d7e3a438b0b1144c28c56cff42bef4146584bc4678893`.

**F / base_17_report_without_link** — T4 no contesta «¿Qué necesitás de mí?»; dice «te contactarán por acá», una promesa de seguimiento sin evidencia de esa acción.
Hash V2: `85dafcee59d6101a3afee95dac14bcd73565266e26097b51de7b285b79d2328d`.

**I2 / base_01_reopen_after_link** — T3 solicita los cuatro datos tras autorización explícita; T4 devuelve el link correcto; T5 «¿En qué más puedo ayudarte?» retoma el saludo sin repetir el link.
Hash V2: `14cb6c9b1ed5c8dbca3a985a4fc554566c16b68bfc046a6ca89db7c2a8e50d64`.

**I2 / base_04_which_payment** — T4 «6 pagos mensuales de USD 60, por un total de USD 360» sí aclara el plan. Vuelve a exigir todos los datos y presupone que quiere el link.
Hash V2: `25f080b77a35fbc1b50784a8b052414ebf44efc2abebcca92c1017d3078209c6`.

**I2 / base_05_prefers_chat** — T2 respeta chat pero repite diagnóstico. T4 «no necesitás experiencia previa» agrega una condición no confirmada; los diagnostics conservan FACT_VALUE_MISMATCH.
Hash V2: `e049ee7529b593ccb4d5ad59026396ab9cbbfcd5cdac6eb36f4c8e4c63625ced`.

**I2 / base_08_expensive** — T3 «Te entiendo» reconoce presupuesto y presenta la menor cuota. T4 responde la cuota; «Exacto» es un arranque mecánico para una pregunta.
Hash V2: `34815e67b8ded01570e06d6ae4dacd59726f8ba2b1843092ce94d866ae692c25`.

**I2 / base_14_intake_gate** — T4 «me falta… correo electrónico y… teléfono» pide sólo lo que falta después del nombre. T5 /12m llega tras autorización T3 y datos completos.
Hash V2: `17ddda859e5e22d0de32758dec8dc020f8e45db9f4b5e9952b18c34e2ac36b8c`.

**I2 / base_17_report_without_link** — T4 repite casi textual la respuesta de T3 y no responde qué datos necesita. Conserva correctamente la verificación humana de pago.
Hash V2: `6b4a1a290fba49a11913d32504be668d9333929cfce2e90aed86eee9d55dab68`.

**I3 / base_01_reopen_after_link** — T4 agradece datos y envía contado tras autorización T3. T5 contesta «Buenas tardes» con un saludo contextual, sin repetir link.
Hash V2: `dbe6fef32ec5ca23c7c633363ef988843c6ea2e8bcbd39df87b0e3dc6493d495`.

**I3 / base_04_which_payment** — T4 «¡Gracias! Quedó registrado… ¿me confirmás tu nombre y apellido?» responde sólo parcialmente la pregunta sobre el plan y vuelve al intake.
Hash V2: `489bca691d625b7d453130109ee0d9af0afc167a422ff92196ab11b6073d0706`.

**I3 / base_05_prefers_chat** — T3 repite casi completa la respuesta anterior a la pregunta de duración; T4 «No necesitás experiencia previa» persiste pese a FACT_VALUE_MISMATCH/repairAttempted=true.
Hash V2: `e7ce73168a69f0509f2bacc122cecce5f2dd6b210a834a28558c5ecf07f55792`.

**I3 / base_08_expensive** — T3 trata objeción y T4 informa la menor cuota. T1 ofrece llamada sin ninguna pregunta de diagnóstico, incumpliendo el prompt completo vigente.
Hash V2: `668d8bb8342a1afc56d92136a1ff00c560d6b108bae5f5a7b42ba0d45665bd97`.

**I3 / base_14_intake_gate** — T4 sólo «¡Gracias, Nadia!» cuando siguen faltando correo/teléfono. T5 funciona porque el cliente guionado los ofrece sin que el agente los solicite.
Hash V2: `8e3d47f835ab138ab7f70fd43d3e987bcd24cb4fcd39f7ed7966e8eb7400ea00`.

**I3 / base_17_report_without_link** — T4 «Entiendo tu consulta» vuelve a explicar acreditación; no identifica datos faltantes ante «¿Qué necesitás de mí?».
Hash V2: `b74eac4b8abda06cf338e4fcb2343001c5f6c2c8d2233c019f8815250471c66c`.

**C4 / base_01_reopen_after_link** — T3 pide datos tras autorización; T4 link contado; T5 saluda por nombre sin recircular pago. Apertura y fases siguen formularias.
Hash V2: `a64c1e25d53476cf47162e07c0e2a21c692f1cc13bf130a70964f44d1093c9d8`.

**C4 / base_04_which_payment** — T4 «¡Gracias! Quedó registrada la opción…» repite casi exactamente T3 y la misma lista de datos; no explica el plan como aclaración.
Hash V2: `fc7384658f822d65baf05ae162349df169ea18387dd6bee42b0b18a2d8eb2d96`.

**C4 / base_05_prefers_chat** — T3 agrega precio/cierre a una pregunta de duración. T4 afirma «no necesitás experiencia previa» y reitera las tres cuotas; FACT_VALUE_MISMATCH todavía aparece.
Hash V2: `257749f0aca30843591b1f848a72801c7feac92037b989c07830e5af690e9e81`.

**C4 / base_08_expensive** — T3 quita presión y T4 identifica la menor cuota. T2 acumula planes, total, todo lo incluido y cierre en una respuesta larga.
Hash V2: `f57c3696059db392d35563ca6e417a24e1bbdf25f66fd0c8e070b9f133edcfa6`.

**C4 / base_14_intake_gate** — T4 «¡Gracias, Nadia!» no pide correo/teléfono. T5 /12m depende del siguiente turno previsto por el test, no de una conducción completa.
Hash V2: `d31ac45f8c19412dea33964cc359fcb0c32b9647aaea8fec9843c8d01fee21a0`.

**C4 / base_17_report_without_link** — T4 «Exacto» a una pregunta abierta y repetición de T3: no contesta qué necesita. No afirma que el pago ya esté acreditado.
Hash V2: `85f7df480d489ec408484752ea62d6617d942f15790159279646dce74d5bcdd8`.

**FIN / base_01_reopen_after_link** — T4 «Te envío el link de pago ahora mismo» acompaña salida contado autorizada; T5 responde al saludo por nombre. Texto anterior al commit ad15baaf y del runner.
Hash V2: `c8bbd472b9e09baf7ac7e662295d136c91ae3133b43647c530784fb14bb99146`.

**FIN / base_04_which_payment** — T4 «Cuando hagas el pago, avisame…» responde a «¿Qué pago me estás dando?» sin decir plan, monto ni total. status=passed no detectó este fallo.
Hash V2: `97c4491eeaa696c3562b2a3076b5c38170ba97d5642a94ec9021b6058de6b282`.

**FIN / base_05_prefers_chat** — T2 repite diagnóstico; T4 a «¿Y qué necesito para arrancar?» responde «El curso te prepara para trabajar…». Desapareció el requisito inventado, pero también la respuesta útil.
Hash V2: `8bbdb52a60fd4c32f8001afb54e16a8a88ddd5ec7d996d6538e1d764e89a62b5`.

**FIN / base_08_expensive** — T3 reconoce objeción y T4 da cuota/total correctos. El diagnóstico no se usa para personalizar; mantiene redacción estandarizada.
Hash V2: `4a1b19eb48ec05dd0700241c022feca636c30181186c4054987975fa885232ea`.

**FIN / base_14_intake_gate** — T4 sólo «¡Gracias, Nadia!» omite correo/teléfono pendientes. El guion los entrega en T5 y entonces recibe /12m.
Hash V2: `f48f98523db2d4c203c4ef25dd274ebe84bf5bafb8ca1d4957559fda11c31a41`.

**FIN / base_17_report_without_link** — T4 «Exacto, tu aviso de pago quedó registrado…» ignora «¿Qué necesitás de mí?» y repite T3. El status=passed no equivale a atención resuelta.
Hash V2: `75cbbbbf110d76c4eda5244f9cc59bcbc2f57078304b6d03800ece45b677a991`.

La progresión más resuelta del runner fue I2/base_14: pide sólo correo/teléfono después del nombre. I3, C4 y FIN regresan a «¡Gracias, Nadia!» y el caso sigue verde porque el cliente del test entrega los datos igualmente. FIN/base_05 evita el requisito inventado que seguía visible en C4, pero responde temario en vez de requisitos; por eso no se trata como éxito conversacional. FIN/base_04 y FIN/base_17 también conservan `status=passed` mientras dejan la pregunta actual sin respuesta.

## Presupuesto y límites de certificación

Costo incremental de esta revisión: **USD 0 de API**. Se conserva el último gasto informado de **USD 0,38** y el tope acumulado de USD 1; no se reinicia presupuesto. Los reportes W/P/A no contienen uso ni costo; los cinco reportes v13 tienen token_usage por turno, pero no un libro de gasto monetario posterior al último saldo informado. No existe aquí evidencia suficiente para sumar un nuevo gasto posterior a USD 0,38 ni para acreditar que el margen restante sea exactamente USD 0,62.

Los `token_usage` del runner aparecen tanto por turno como en un `runtime` resumen: sumarlos recursivamente duplicaría entradas. Además faltan tarifas efectivas/cache y garantías de contabilizar intentos fallidos. No se convierte ese conteo parcial en gasto de cuenta.

No hay calibración con el dueño comercial recuperada, evaluación ciega entre variantes ni 20 conversaciones independientes de una única versión por el workflow. El revisor leyó la procedencia para distinguir harnesses: no debe presentarse como evaluación ciega. Ningún puntaje es autoevaluación de DeepSeek. No se emite `rubric.ready=true`, `READY_FOR_SUPERVISED_TELEGRAM` ni certificación de producción. Este informe tampoco certifica replay: los exports conservan conteos finales, no una secuencia de replay correlacionada.

## Reproducción gratuita

1. Desde el worktree, verificar los SHA-256 de los ocho archivos fuente con `shasum -a 256 botpress-agent/evals/results/workflow-*.json botpress-agent/evals/results/happy-path-{v13focal,v13iter2,v13iter3,v4canon,final}-1.json`.
2. Leer el JSON completo de cada fuente: W usa `conversations[].transcript`; P usa `cases[case_id].transcript`; A usa `transcript`; los runners usan `results[].transcript` y `quality_review_packet[]`.
3. Numerar Tn por cada mensaje con role=user, incluso si no lo sigue un assistant; cotejar citas y conteos con la tabla. No agregar un placeholder de respuesta inexistente.
4. Regenerar cada hash con `buildConversationQualityReviewPacketV2` de `scripts/lib/agent-a-conversation-quality.ts`, que proyecta role/text, redacta correo/teléfono y calcula SHA-256 de JSON.stringify. Los 29 hashes existentes del runner se recalcularon y coincidieron; los doce workflow se calcularon con el mismo algoritmo.
5. Calcular cada promedio sumando las ocho columnas V2 y dividiendo por ocho; Rel queda fuera. No aprobar un caso por promedio cuando Gate sea rojo, incompleto o harness distinto.
6. Leer las líneas del gate y helper en el checkpoint con `git show ad15baafb63e8c55cb877f943a74e57c2899deda:tests/workflow/agent-a-full-conversations.test.ts` y el equivalente de `tests/helpers/agent-a-workflow-db-evidence.ts`; cambios posteriores deben evaluarse con reportes nuevos.

Las fuentes originales son archivos locales ignorados por Git. Los hashes de este informe detectan sustitución pero no archivan el contenido por sí solos; el coordinador debe conservar copia identificada antes de nuevas corridas. No se sobrescribió ningún reporte durante esta revisión.

## Inventario histórico no usado como certificación del candidato

Los siguientes 26 archivos contienen 98 transcripciones de versiones/rutas anteriores. Se inventarían íntegramente por procedencia; sus textos no se han calificado en esta revisión del candidato del 4/9. No se los cuenta como nuevas conversaciones aprobadas ni se extrapolan puntajes de los casos de igual nombre.

| Archivo | Prompt declarado | Transcripciones | SHA-256 |
| --- | --- | --- | --- |
| `happy-path-20260902181031.json` | studyx-agent-a-brain-v5 | 1 | `f1f4da98f5d94dbfdb5aa6445acb6eb09f5384ab572b2a7f0938dc513ce97e0b` |
| `happy-path-20260902181335.json` | studyx-agent-a-brain-v5 | 1 | `d0299c3094c0db259991f24cd831fa75049011cfacf105f65eb6e3ae7aeed24c` |
| `happy-path-20260902181939.json` | studyx-agent-a-brain-v5 | 1 | `e50170dd73600ec5ca916d6840b5f70aa77b111819bf943fcdfdc7763fedb9ab` |
| `happy-path-20260902182035.json` | studyx-agent-a-brain-v5 | 20 | `3ffe7bdcdc8b8e008228434fb1894ee6ffe754b57e123ebd9fe8569f9a813cf7` |
| `happy-path-20260902182842.json` | studyx-agent-a-brain-v5 | 6 | `650bb22cb2b403a0a50677cd4438aca108aab7c21f290332bb802af6b2e2e82d` |
| `happy-path-20260902183310.json` | studyx-agent-a-brain-v5 | 6 | `95a0d089cd7678d554a2a5570ca86cfbf094f8d9490a1bbb297f3f9d4fb8b802` |
| `happy-path-20260902184527.json` | studyx-agent-a-brain-v5 | 6 | `ac578a071e0099d9653253e98b8832f26789b1d2008727727d444091c2281f75` |
| `happy-path-20260902185228.json` | studyx-agent-a-brain-v5 | 2 | `0ae8327b8d964b16a2c1ef306c43357232e43cb1fbf15c58f1e6053530add014` |
| `happy-path-20260902191543.json` | studyx-agent-a-brain-v5 | 2 | `d061306f3d810876420bcdfd90567559bf81946d238aca4204b9b0f7d3879c00` |
| `happy-path-20260902192331.json` | studyx-agent-a-brain-v5 | 2 | `cbf05f4cd70a13f9d11fdedec06c571fc5b13e7a22cd015476ac2ccdd5f5f30a` |
| `happy-path-20260902193556.json` | studyx-agent-a-brain-v6 | 2 | `88dd89cd3e56d6f1e7d788352182821cc0b9417aab4529017ecf67d4c582f747` |
| `happy-path-20260902194258.json` | studyx-agent-a-brain-v7 | 1 | `a7c886d35b92e1c44af45d305d60507594b900d98dc8e9f2b0816dda7ba42dc8` |
| `happy-path-20260902194351.json` | studyx-agent-a-brain-v7 | 6 | `7ad3a0ed5c01a6daa6e7df1d2cb0414a1637487dd9eff10395e29f96a57687a2` |
| `happy-path-20260902194705.json` | studyx-agent-a-brain-v8 | 1 | `19c4f35c450e09b056ab1c3efd1d880bb9851021794a0f46343123a3424d5591` |
| `happy-path-20260902195128.json` | studyx-agent-a-brain-v8 | 1 | `c7ff0d26d95b3472a0383ee6b09054631d5512c52a10c677dc3195c95432e5fc` |
| `happy-path-20260902195834.json` | studyx-agent-a-brain-v9 | 1 | `65eea79c23f51e5da36febece2c76d1d41054730d5031028128492a297a16573` |
| `happy-path-20260902200254.json` | studyx-agent-a-brain-v9 | 20 | `740f5d0844e2f1902e031e09d5fcc2da402e172a8518e738ef9f0a25196760da` |
| `happy-path-20260902225222.json` | studyx-agent-a-brain-v9 | 3 | `39bf4a27ba87048a1f3782d99fbb7a044481a80a0a3ed47f11925a2d5308afd8` |
| `happy-path-20260902225419.json` | studyx-agent-a-brain-v9 | 3 | `c52d110a64add912eeac5741fdc41a487131a15f5ef6d3920ee3a311fd216614` |
| `happy-path-20260902230733.json` | studyx-agent-a-brain-v9 | 3 | `d94d7f73d3b9fae88f4305c5c5889986aca7264240ee851ca38536f676736874` |
| `happy-path-20260902230935.json` | studyx-agent-a-brain-v9 | 3 | `f8fac014268abcad11091e4d89cae45d60eccd9246e94f87dce1758d0bee7b0f` |
| `happy-path-20260902232045.json` | studyx-agent-a-brain-v9 | 3 | `9ff4e8ebe3bb052a98a12c768cf5dabad9ab7859134ea1eeb05b62c6bec825d8` |
| `happy-path-vague-debug-20260902.json` | studyx-agent-a-sales-v17 | 1 | `8df89f9d28569f7386bbba0586793bf5a4f75a7d2aa26a47f8a0bc332b25684a` |
| `happy-path-vague-exact-20260902.json` | studyx-agent-a-sales-v17 | 1 | `721f15ddf1b1fcdbc0e2f143976f6e0efcf6159bc2dc4fdbbff11b1e19d2db7e` |
| `happy-path-vague-exact2-20260902.json` | studyx-agent-a-sales-v17 | 1 | `42f3e913a7be00a241e6b0eca7eb3ef01135f0ec3d9503937797c1fde2031685` |
| `happy-path-vague-fix-20260902.json` | studyx-agent-a-sales-v17 | 1 | `cb51bf9875e8663fec44c6fabed7360a1ea8b3a1f23a25cc62749e6abda443a0` |

## Cierre de revisión independiente del diff local

Revisión iterativa contra `ad15baafb63e8c55cb877f943a74e57c2899deda`, cerrada el 4/9 después de las correcciones de los responsables. **Sin bloqueantes materiales pendientes en el alcance revisado.** Esta aprobación corresponde al código y la evidencia local; no cambia los puntajes de las transcripciones históricas ni certifica el candidato conversacional nuevo.

Se revisaron las correcciones de intake/consentimiento, el prompt V14, estado comercial, promesas de notificaciones futuras, catálogo y beneficios, deduplicación de links, evidencia HTTP/DB/adaptador, contador de disponibilidad, reportes, métricas y control acumulado del presupuesto. Los hallazgos concretos que regresaron a implementación incluyeron consentimiento perdido al elegir chat, consentimiento/plan heredados tras cambiar curso, promesas posteriores ocultas por una primera cláusula legítima, falsos positivos de catálogo, negación de descuentos aplicada a otra cláusula, anuncio de link nuevo conservado tras deduplicación y fallback técnico con texto contado como disponibilidad. Las correcciones preservan el esquema plannerless y no introducen plantillas comerciales.

El cierre también revisó `tests/workflow/agent-a-heldout-conversations.test.ts` por lectura: separación entre elección de plan y autorización del link; postergación; cambio de curso; aviso de pago; opt-out durable. Este revisor no ejecutó esa suite ni ninguna prueba de workflow con API/DB. Su naturalidad y sus resultados reales requieren transcripciones nuevas.

La medición de links entregados exige correlación del outbound con autorización, turno, traza, destino, estado, ID del proveedor y texto capturado. El silencio sólo puede excusarse con causa durable anterior o simultánea a la decisión. En replay, la ausencia de DB queda desconocida; una respuesta previa requiere el outbound correspondiente y el silencio previo requiere permiso causal. Un fallback técnico previo sigue siendo fallo. Las métricas incluyen intentos fallidos y usage ausente, deduplican trazas y dejan ratios sin muestra o resultados de reparación sin evidencia en `null`. Los reportes son archivos únicos inmutables y `quality_ready`, `production_ready`, `stability_certified` permanecen en `false`.

El runner pagado conserva el gasto previo de al menos USD 0,38, exige tope de USD 1 y ledger existente, reserva antes de cada HTTP y conserva la reserva si falta usage válido. Cada retry es una nueva entrada. Se verificó el entorno explícito de DB/backend loopback y la carga exclusiva de la clave DeepSeek; no se cargan variables de backend de producción. Costo de API de esta revisión: **USD 0**. El coordinador sigue siendo responsable de la contabilidad y ejecución de cualquier corrida posterior.

Verificación gratuita final ejecutada por este revisor a las 10:59:25: `./node_modules/.bin/vitest run --config vitest.config.mts tests/unit/agent-a-workflow-metrics.test.ts tests/unit/agent-a-workflow-events.test.ts tests/unit/scripts/agent-a-api-budget.test.ts` → **3 archivos, 24 pruebas aprobadas** (16 métricas, 1 eventos, 7 presupuesto). Las suites unitarias no acreditan entrega por Telegram ni migración o despliegue remoto. El detector textual de cursos desconocidos sigue teniendo el límite léxico documentado para nombres en minúscula sin un objeto explícito de curso; las validaciones de códigos y movimientos se aplican aparte.

Hashes de los archivos del último cierre acotado, para detectar modificaciones posteriores:

| Archivo | SHA-256 |
| --- | --- |
| `scripts/agent-a-api-budget.mjs` | `c4a6322b1e6949b12041c65b798a730f00699952595e6db96578ab52839a988f` |
| `scripts/run-agent-a-workflow-lab.mjs` | `ffcc34a73be75789ab1c3c80a0999150f57ee3ee43d50579773da46222098c89` |
| `tests/helpers/agent-a-workflow-metrics.ts` | `2d0c632e32a059d107826edfed6a6dc1629f13ef385354bf605e9a26bc64bfd4` |
| `tests/helpers/agent-a-workflow-report.ts` | `6f78370dc4690e57a34ac145e676d86e16248c54e041422cb649a89dfb75ef73` |
| `tests/workflow/agent-a-heldout-conversations.test.ts` | `25261a593671cef317cb3df3666bd9a7e584032ab19d7dced68e0e041e8cc628` |
