# Revisión independiente de naturalidad V21

Fecha: 2026-09-05. Evaluador: subagente Codex `/root/rubric_review`, distinto del modelo objetivo `deepseek-v4-flash`. Esta revisión leyó únicamente las dos evidencias V21 indicadas. No llamó APIs, no consultó bases de datos y no reejecutó conversaciones.

## Método y alcance

La fuente ejecutable de la rúbrica V2, `scripts/lib/agent-a-conversation-quality.ts`, exige ocho dimensiones: escucha y contexto, tono natural, progresión comercial, iniciativa apropiada, concisión, ausencia de repetición, cumplimiento del prompt y continuidad entre turnos. La escala es 1–5; un caso pasa sólo si el gate duro está verde, el promedio es al menos 4 y ninguna dimensión queda por debajo de 3. Relevancia se informa como dimensión complementaria solicitada y no entra en ese promedio.

`Tn` identifica el n-ésimo mensaje del cliente y la respuesta que le sigue. En Telegram, “resultado observable” es la descripción sanitizada conservada por la evidencia, no una cita textual del agente. Los SHA-256 siguientes identifican los archivos revisados, no sustituyen el hash de un `quality_review_packet` construido desde un transcript estructurado:

| Procedencia | Archivo | SHA-256 |
| --- | --- | --- |
| Laboratorio | `docs/reports/evidence/2026-09-04-agent-a-v21-final/transcript.md` | `2cfe9b13462ca76d28d8ff22b12016d210f4019c0c579e9ec0813959574e45a8` |
| Telegram | `docs/reports/evidence/2026-09-05-agent-a-v21-telegram-followup/transcript.md` | `6554731634dd65a072fae87b02d8d2f25a68a1b99bc94f8e6451c29c8f2c134d` |

## Laboratorio: `telegram_photography_call_first_cash_link`

**Dictamen del caso:** pasa el umbral conversacional V2, con gate duro verde según la evidencia del propio workflow. Nota independiente: **4,125/5**. Esto evalúa un caso de laboratorio con datos y enlace sintéticos; no certifica Telegram ni la matriz de 20 casos.

| Dimensión | Nota | Evidencia por turno |
| --- | ---: | --- |
| Escucha y contexto | 5 | T1 desambigua correctamente los dos cursos de fotografía. T3 interpreta “Quizás personal” como finalidad de uso; T4 respeta “No quiero una llamada”; T6–T11 conserva plan y datos ya aportados. |
| Tono natural / cordialidad | 3 | Es amable y consistente, pero predomina una fórmula: “¡Perfecto!” abre T3, T4, T7 y T8; “¡Gracias, Inés!” reaparece en T9–T11. “Bienvenido/a” también suena a texto de sistema. |
| Progresión comercial | 4 | Avanza desde desambiguación a curso, precio, plan, consentimiento, intake y link. La segunda oferta de llamada en T3 y la repetición de presentación en T4 agregan roce sin bloquear la venta. |
| Iniciativa apropiada | 4 | Propone la llamada con curso conocido y luego ofrece opciones y el siguiente paso. T3 vuelve a ofrecerla inmediatamente después de T2, pero T4 respeta el veto y no insiste más. |
| Concisión | 4 | Cada respuesta es legible y fácil de contestar. T4 vuelve a enumerar “41 clases, 100% online y en español” aunque esos datos ya estaban en T2 y fueron desarrollados en T3. |
| Ausencia de repetición | 3 | Repite características del curso en T2, T3 y T4, además de los arranques “¡Perfecto!”/“¡Gracias!”. No repite preguntas de intake ya satisfechas. |
| Cumplimiento comercial | 5 | Usa catálogo y precios coherentes; mantiene el tope de dos ofertas, respeta el rechazo, espera solicitud explícita del link, pide los cuatro datos y emite un único link del plan elegido. |
| Continuidad entre turnos | 5 | T8 pide sólo apellido, correo y teléfono; T9 sólo correo y teléfono; T10 sólo teléfono. T11 entrega el link y la evidencia confirma `one_time`, identidad completa y el mismo outbound. |
| Relevancia, complementaria | 4 | Todas las respuestas atienden el tema vigente. Las repeticiones de T3–T4 reducen foco, pero no sustituyen una respuesta solicitada. |

La fortaleza principal es la continuidad del intake: después de “Inés” (T8) y “Valdés” (T9), el agente reduce exactamente los campos pendientes. El punto débil visible es el carácter formular y repetitivo, no una incomprensión del objetivo. La nota difiere del `4,25/5` ya escrito dentro de la evidencia porque esta revisión aplica el anclaje oficial “correcto pero formular” como **3** en tono natural; no se reutilizó aquella autoafirmación como dictamen.

## Telegram V21

**Dictamen del caso:** falla. El gate duro es rojo por catálogo falso, divergencia entre texto y estado, pérdida de identidad y silencio final. La evidencia sanitizada no permite emitir una calificación V2 formal completa porque reemplaza el texto del agente por resúmenes: tono y concisión quedarían inventados. Las seis dimensiones observables están por debajo del umbral.

| Dimensión | Nota | Evidencia por turno |
| --- | ---: | --- |
| Escucha y contexto | 1 | T5 obliga al cliente a repetir que el curso ya estaba en el chat; T6 interpreta “Ninguno, el de fotografía” como ausencia de oferta; T10–T12 no retiene correctamente nombre y correo. |
| Tono natural / cordialidad | ND | No se conserva la redacción exacta de las once respuestas. La repetición y el silencio producen una experiencia poco natural, pero no permiten juzgar elección de palabras o cordialidad. |
| Progresión comercial | 1 | El cliente declara intención de pago en T4, pero el flujo termina en `course_selected`, sin plan ni link. T12 no produce outbound. |
| Iniciativa apropiada | 2 | T4 y T9 intentan llevar la conversación a curso e intake, pero sobre estado incompleto o incorrecto. No se penaliza la falta de oferta de llamada: el contacto reutilizado ya tenía preferencia `chat` y llamada `declined`. |
| Concisión | ND | Los resúmenes no preservan extensión, estructura ni densidad de las respuestas del agente. |
| Ausencia de repetición | 1 | T4–T6 reiteran la identificación del curso; T9–T12 reiteran datos personales. El reclamo de T12 surge precisamente por esa repetición. |
| Cumplimiento comercial | 1 | T6 niega dos cursos reales de fotografía; T8 afirma pago único mientras `selected_payment_plan=null`; T12 contradice el estado y termina en `BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK`. |
| Continuidad entre turnos | 1 | T8 no persiste el plan, T10 no persiste el nombre y T12 invierte qué dato estaba presente. El último turno queda sin respuesta. |
| Relevancia, complementaria | 2 | Algunas intervenciones apuntan al próximo dato necesario, pero el agente no resuelve la intención de pagar y obliga a recircular curso e identidad. |

No corresponde completar `ND` con una nota neutral. Incluso asignando 5 a tono y concisión, el máximo posible con las otras seis notas observadas sería **2,125/5**; el caso seguiría fallando el promedio, seis mínimos por dimensión y el gate duro.

La ausencia de una nueva oferta de llamada no es un defecto demostrable en esta sesión: la propia evidencia registra una preferencia durable por chat y un rechazo previo heredados de la identidad de prueba. Esa reutilización impide usar este caso para evaluar el comportamiento de primera oferta con un contacto nuevo.

## Hotfix y procedencia temporal

La conversación de Telegram es evidencia del comportamiento V21 anterior al hotfix `ca66dfb`. El documento informa 257/257 pruebas focales para tres correcciones léxicas, pero no contiene una reejecución de la conversación real. Por lo tanto:

- las salidas T1–T12 se atribuyen sólo al bundle V21 que efectivamente las produjo;
- no se atribuye al hotfix una mejora de catálogo, plan, identidad, naturalidad ni recuperación en Telegram;
- las pruebas focales no convierten el silencio T12 ni el estado final fallido en un resultado corregido.

## Resultado comparado y límites

El laboratorio muestra una conversación completa, comercialmente correcta y suficientemente natural para aprobar ese caso aislado; sus fricciones son repetición y lenguaje formular. Telegram muestra el patrón opuesto: el cliente debe repetir contexto, la conversación contradice su propio estado y finalmente calla. El guard evita que salga otra afirmación inconsistente en T12, pero esa contención técnica no cuenta como atención conversacional exitosa.

No hay calibración con el dueño comercial, evaluación ciega, satisfacción del cliente ni 20 casos de una misma versión. El laboratorio usa un adaptador local y `example.invalid`; Telegram es una sola conversación, reutiliza memoria previa y no conserva texto exacto del agente. En consecuencia, esta revisión no certifica naturalidad global, disponibilidad, despliegue ni calidad posterior al hotfix. Su costo incremental de API es USD 0.

## Reproducción gratuita

1. Ejecutar `shasum -a 256` sobre los dos archivos de evidencia y comparar con la tabla de procedencia.
2. En laboratorio, numerar cada bloque `Cliente` y la respuesta `Agente` siguiente como T1–T11; cotejar citas y estado con “Resultado verificable”.
3. En Telegram, numerar las filas 1–12 y cotejar los fallos con “Estado durable al finalizar” y “Causas confirmadas”. No reconstruir prosa del agente a partir de “Resultado observable”.
4. Calcular la media de laboratorio sólo con las ocho dimensiones V2: `(5+3+4+4+4+3+5+5)/8 = 4,125`. Relevancia queda fuera.
5. Mantener el gate duro separado: una nota de estilo no puede compensar catálogo, estado, consentimiento, entrega o disponibilidad.
