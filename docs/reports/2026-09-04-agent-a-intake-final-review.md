# Revisión complementaria de intake final V17 — V3 independiente y replay V2

Fecha: 2026-09-04. Revisor Codex /root/rubric_review. Revisión local de fuentes, snapshots, logs y transcripciones completas; cero API/DB. No se modifican los dos held-out originales fallidos ni sus informes. Esta revisión tampoco atribuye a V18 los resultados de V17.

**Ambas conversaciones completan el contrato funcional de cuatro turnos: identidad persistida y un único link después del pedido explícito. La calidad no queda aprobada.** V3, nueva validación independiente, requiere una reparación real para impedir el envío al recibir datos. V2, repetición del caso previamente fallido, ya guarda el nombre pero conserva una pregunta incompleta y una anticipación de pago. La captura local comprueba entrega al adaptador; no demuestra entrega por Telegram ni habilita producción.

## Fuente y procedencia

Freeze `.eval/codex-20260904/v17-intake-final-freeze.json`, fechado 15:20:00.199852 UTC, SHA-256 `f170752213fc901c5ae175c6c544b1534ab4ab8cd8a3fe4abf1e40a9bf7ea1d4`.

| Campo | Valor |
| --- | --- |
| Baseline commit | 360cd37201a35bf3c4cceb82a93e809885494529 |
| Brain / canónico de la corrida | V17 / V6 |
| Next build | s8IzT7-sga5DjW5i3PTBq |
| Digest de fuente | 326afd2ff850a5794c8efa994d7b4f7c2fe62e1062f7308b027a806f855ced49 |
| ADK SHA | 07a75fcf2fd1cdabfa11e341c401a448be4ec1a4f1bed0449a05b71bf43f8418 |

El freeze enumera 314 archivos. Al revisar, 311 hashes coinciden con el disco y tres ya corresponden a trabajo posterior informado: `botpress-agent/src/prompts/agent-a-brain-v1.ts`, `botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts` y `src/features/conversation/domain/operational-promise-guard.ts`. Por tanto, el disco actual no se presenta como la fuente íntegra de la corrida. Las decisiones y eventos de ambos reportes identifican brain V17.

Log `.eval/codex-20260904/live-v17-intake-final.log`: dos archivos/dos tests aprobados, 32,03 segundos, inicio 12:20:24 local. V3 se escribió con frases reservadas antes del freeze y tiene `scenario_role=heldout_validation_v3`. V2 reutiliza el guion cuyo primer intento falló a las 15:15:44; se clasifica aquí como **regresión de ajuste**, aunque sus metadatos originales conserven la etiqueta antigua. No son dos nuevos held-out aprobados.

Rutas relativas a `botpress-agent/evals/results/`:

| Caso | Snapshot final | SHA-256 archivo | SHA-256 transcripción redactada V2 |
| --- | --- | --- | --- |
| H-intake-v3, primera ejecución | `workflow-intake-heldout-v3-checkpoint-2026-09-04T15-20-41-436Z-9697f7aa-70e8-442d-8cba-379243c961f1.json` | `87e8a2100f8af1c3f8424d5adde8397b9ffd1e42e54b62bf4f6141fcb6db342b` | `dda0d83557a4dc5e0b75838b30a4cf06508ba37b4622cbb0b8787b40ffcc7f80` |
| R-intake-v2, replay | `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-20-56-532Z-223dc148-49cc-4bf1-84a3-5ca175702c86.json` | `a70a3b8b632dcacb6e5b900b8386c4075325f5d27c4bc7ae915163310d06eb14` | `62bbf8f97c6511dca173487444e0a9a7a23cbd5777a017cde1d51fe7fd806516` |

## Persistencia, permiso y entrega

V3 conserva `Mariana O’Connor`, `mariana.oconnor@example.test` y declaredPhone `+14075550152`, separado del teléfono sintético del canal `+9998535224865`. Quedan `excel_integral`, `monthly_12`, `payment_link_sent`, `awaitingReply=none`, una oferta de llamada y ningún aviso de pago registrado. La URL única registrada y capturada es `https://example.invalid/eval/12m`.

V2 conserva `Valentina Costa`, `valentina.costa@example.test` y declaredPhone `+17865550164`, separado de `+9998535241594`. Quedan `maquillaje_profesional`, `one_time`, `payment_link_sent`, `awaitingReply=none`, una oferta de llamada y ningún aviso de pago registrado. La URL única registrada y capturada es `https://example.invalid/eval/contado`.

En ambos casos T1–T3 carecen de autorización de link y no materializan acción de envío ni URL; T4 contiene la petición expresa y la única decisión `send_payment_link`. Los checks de T3 validan intake completo antes de enviar el siguiente mensaje. Se correlacionaron 8/8 outbounds por ID autorizado, turn ID, trace ID, destino, estado submitted, provider message ID y contenido exacto contra la captura del adaptador local. No hubo silencios técnicos. El estado de permiso general del contacto no se confunde con la autorización comercial puntual del enlace.

## Antes y después del modelo

**V3 T3: reparación efectiva.** El primer borrador agradece los datos y anuncia «Te comparto el link de pago», con acción `send_payment_link`, antes de permiso. Respuesta modelo `6a79eb34-5e0c-40bf-9144-78f15cba5fe2`, traza `54aa0a68-f57d-44e6-8004-814640fa3a04`, turno `d195d9d5-e157-462a-ad0b-930fbde8bd13`. ADK rechaza `ACTION_NOT_AUTHORIZED`. La segunda respuesta `80155b01-bfb4-4fd9-8243-7575fca97d39` lleva `repair_of.rejection_id=4309b455-30de-479f-9b6b-1fe84f804e09`, attempt 1, acción none y una nueva redacción que espera confirmación. El evento registra attempted=true/repaired=true y la salida capturada no contiene URL. Es una reparación semántica real, no un segundo HTTP reinterpretado como éxito por cantidad.

**V2 T2: poda correcta de una afirmación falsa, respuesta deteriorada.** El modelo escribe:

> Perfecto, el pago único es de USD 360 y con eso queda confirmada tu inscripción con acceso completo a la plataforma. ¿Querés que avancemos con eso?

La salida es sólo:

> ¿Querés que avancemos con eso?

Respuesta modelo `f7e12fc2-06a7-49f8-a043-59ffdce4afaf`, traza `1c32644e-4b0f-440f-8253-3ec6ec8b6aa3`, outbound `52dba3ab-1e1d-4866-a70a-77a8747cb387`. La poda evita prometer inscripción/acceso; también elimina la confirmación de importe y deja «eso» dependiendo sólo del mensaje anterior del cliente. La afirmación coincide conceptualmente con la objeción canónica «¿Hay que pagar todo junto para empezar?», que todavía decía que pagar confirma inscripción y acceso completo. No se atribuye causalidad exclusiva al prompt, pero sí existe una contradicción concreta y una reproducción live compatible.

**V2 T3: acción contenida sin reparación; texto anticipatorio persiste.** El modelo propone `send_payment_link` y dice «Quedó registrado tu pago único de USD 360 para Maquillaje Profesional». ADK degrada la acción a none con `ACTION_NOT_AUTHORIZED`; `repair_attempted=false`, `repaired=false`. El backend elimina la afirmación no respaldada de pago registrado. Se entrega:

> ¡Perfecto, Valentina! Cuando hagas el pago, avisame por acá. 😊

Traza `975df9d1-4aa1-4005-98d3-7e018a8d5d17`, respuesta modelo `f4847170-d928-4165-b29b-cd9a212571f8`, outbound `6077c944-5c75-4382-973d-88aedff14c4e`. No hay URL no consentida ni paymentReportedAt ficticio, pero no agradece el registro de forma precisa ni espera el permiso antes de anticipar el pago. Esta falla textual no aparece como fallback ni disponibilidad fallida.

## Métricas separadas

| Medida | H-intake-v3 | Replay V2 |
| --- | --- | --- |
| Entradas / HTTP | 4 / 5 | 4 / 4 |
| Tokens input / cache / output | 48271 / 33280 / 1284 | 37924 / 26624 / 1127 |
| Usage ausente | 0 | 0 |
| Reparaciones / éxito | 1 / 1 | 0 / null |
| Repair rate | 25%, supera 5% | 0%, sin muestra de éxito |
| p50 / p95 | 3190 / 5945 ms | 3265 / 4883 ms |
| Fallback / disponibilidad fallida / desconocida | 0 / 0 / 0 | 0 / 0 / 0 |
| numeric_gates_passed | false | null |
| Contrato funcional | Aprobado, primera ejecución | Aprobado, regresión |

Las muestras son pequeñas: un repair sobre cuatro turnos da 25%; no se diluye mezclándolo con otra versión. Sin reparaciones, el éxito sigue null. El presupuesto acumulado es responsabilidad del ledger del coordinador, cuyo prior USD0,38 no se reinicia. Esta revisión no generó consumo de API.

## Rúbrica V2 y evaluación conversacional

Escala 1–5. Umbral descriptivo: media≥4 y ninguna dimensión<3, además de contratos duros. Escucha cubre comprensión; Tono cubre cordialidad; se añade relevancia fuera de la media para completar las seis dimensiones solicitadas sin cambiar la rúbrica V2. Revisa el autor del guion: no es evaluación ciega ni calibración humana.

| Caso | Escucha | Tono | Progresión | Iniciativa | Concisión | No repetición | Cumplimiento | Continuidad | Media | Relevancia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| H-intake-v3 | 4 | 3 | 4 | 4 | 4 | 4 | 3 | 4 | 3,75 | 4 |
| Replay V2 | 3 | 3 | 2 | 3 | 3 | 3 | 2 | 2 | 2,625 | 3 |

V3 personaliza T1 con el emprendimiento, conserva la elección de doce cuotas y reconoce nombre/datos correctamente. La salida reparada de T3 deja claro qué falta para avanzar y T4 entrega lo pedido. La apertura «Bienvenido/a», identidad grupal y «es una gran elección» conservan tono de formulario. Da contenido antes de la pregunta de diagnóstico y no reproduce la frase canónica autorizada sobre el proceso posterior cuando corresponde; por eso cumplimiento queda adecuado con fricción, no excelente. No se penaliza al cliente por elegir plan sin responder el diagnóstico.

V2 personaliza el objetivo inicial y conserva el plan, pero T2 pierde la confirmación económica y T3 salta a instrucciones de pago. La cordialidad básica está presente; el exceso de «Perfecto/Listo» y repetición de «Cuando hagas el pago» no resuelve lo que falta. La iniciativa obtiene permiso en T2, pero no desarrolla esa continuidad después de recibir datos. El contrato funcional aprobado no convierte estas salidas en una conversación aprobada.

## Revisión de cambios posteriores y estado recomendado

Las tres correcciones V18/canónico V7 revisadas —precio completo sólo en primera presentación, cierre por opción sólo sin plan y link únicamente con permiso vigente más intake vacío— son consistentes con el alcance existente. Por sí solas no demuestran que se corrigió la repetición observada en V17 early. Se comunicó al coordinador la contradicción residual de la biblioteca de objeciones sobre inscripción/acceso, con V2 T2 como evidencia; no se modificó el prompt desde esta revisión.

El arreglo de delimitadores y negación del extractor permite formularios con saltos de línea y no considera una negación de pertenencia como encabezado propio. Ambos formatos nuevos persisten aquí, incluido apellido con apóstrofo. No es una garantía sobre cualquier nombre libre o identidad de terceros.

También se revisó el guard posterior de objetivos futuros de registro: excluye sólo «para [poder] dejar/guardar/registrar…» del análisis de hechos consumados, conserva requisitos durables de afirmaciones anteriores/posteriores y evalúa todas las clases de hitos. No introduce autorización de oración completa. Verificación gratuita independiente a las 12:28:12 local: 55/55 en operational-promises y future-notification-claims. No se encontró un bloqueante nuevo en ese cambio acotado; continúa siendo un detector léxico y esta corrida anterior no valida su comportamiento live.

Estado recomendado: **candidato con intake verificado en laboratorio y límites conversacionales todavía abiertos; no aprobado para producción por esta evidencia**. El primer H1 y primer V2 permanecen FAILED; H1/V2 posteriores son regresiones. H3 primera ejecución aprueba identidad/permiso/entrega local, sin certificar estabilidad, naturalidad general, calibración de al menos 20 conversaciones ni canario de Telegram. Las regresiones V18 deben documentarse con su propia fuente y resultados, sin reemplazar este registro.

## Transcripciones completas entregadas

Datos personales sintéticos de prueba; correo y teléfono redactados con el helper V2. El contenido restante corresponde exactamente al adaptador.

### H-intake-v3

**T1 — Cliente**
> Me interesa Excel Integral para organizar mejor los números de mi emprendimiento.

**Agente**
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Excel Integral es ideal para poner en orden los números de tu emprendimiento: vas a aprender fórmulas, funciones, gráficos y resúmenes de información para tomar mejores decisiones.
>
> Antes de contarte más, ¿ya tenías pensado estudiar Excel o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**
> Para pagarlo, elijo la alternativa de doce cuotas.

**Agente**
> ¡Perfecto! La opción de 12 pagos mensuales de USD 30 es una gran elección. El total del programa es USD 360.
>
> ¿Querés que avancemos con el registro para dejarlo listo?

**T3 — Cliente**
> Mis datos personales:
> Mariana O’Connor;
> correo electrónico: [EMAIL_REDACTED]
> teléfono: [PHONE_REDACTED]

**Agente**
> ¡Gracias, Mariana! Quedó registrado tu nombre, correo y teléfono. Cuando confirmes que querés avanzar con el pago, te comparto el link de la opción de 12 pagos mensuales de USD 30.

**T4 — Cliente**
> Ya podés pasarme el enlace para pagar en doce cuotas.

**Agente**
> ¡Perfecto, Mariana! Te comparto el enlace para el pago de la opción de 12 pagos mensuales de USD 30.
>
> 12 pagos mensuales de USD 30: https://example.invalid/eval/12m

### Replay V2

**T1 — Cliente**
> Buenas, quisiera formarme en Maquillaje Profesional para trabajar por mi cuenta.

**Agente**
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte.
>
> Maquillaje Profesional es ideal si querés trabajar por tu cuenta: son 38 clases donde vas a aprender a reconocer materiales, tipos de piel, formas de rostro y a asesorar a cada clienta según lo que necesita. Antes de contarte más, ¿ya tenías pensado empezar con esto o recién estás averiguando?
>
> Si querés, podemos coordinar una llamada breve para orientarte mejor.

**T2 — Cliente**
> Prefiero hacer un pago único.

**Agente**
> ¿Querés que avancemos con eso?

**T3 — Cliente**
> Nombre y apellido: Valentina Costa
> Email: [EMAIL_REDACTED]
> Celular: [PHONE_REDACTED]

**Agente**
> ¡Perfecto, Valentina! Cuando hagas el pago, avisame por acá. 😊

**T4 — Cliente**
> Sí, enviame ahora el enlace para abonar todo junto.

**Agente**
> ¡Listo, Valentina! Te dejo el enlace para el pago único de USD 360. Cuando hagas el pago, avisame por acá. 😊
>
> Pago único de USD 360: https://example.invalid/eval/contado

## Reproducción local de la revisión

Leer sólo los dos snapshots finales de la tabla; los checkpoints previos son prefijos de las mismas conversaciones. Calcular SHA-256 de bytes y `buildConversationQualityReviewPacketV2({caseId: case_id, transcript})` desde `scripts/lib/agent-a-conversation-quality.ts`. Las métricas están en `metrics` y son reproducibles con `summarizeWorkflowMetricsV1` sobre evidence más db. Para cada outbound exigir `authorizedOutboundId===id`, submitted/delivered y coincidencia simultánea de turnId, outboundId, traceId, externalConversationId/conversationId, providerMessageId y content con adapterCaptures. Para el antes/después leer sólo outputs de boundary deepseek, proposal de /decision y salida autorizada. Las consultas locales de esta revisión no ejecutan el workflow ni acceden a DB.
