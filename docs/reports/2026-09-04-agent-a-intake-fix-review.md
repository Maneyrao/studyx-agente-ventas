# Revisión del primer arreglo de intake — replay y validación independiente V2

Fecha: 2026-09-04. Revisor Codex /root/rubric_review. Sólo lectura de código, logs, snapshots y cálculos locales; cero API/DB. Los dos primeros held-out fallidos permanecen intactos en sus fuentes. Este informe corresponde al primer arreglo de extracción, anterior a los cambios posteriores de delimitador y negación.

**El replay H1 pasa, pero la nueva validación V2 falla en T3.** El extractor guarda nombres detrás de encabezados personales cuando los separa una coma o punto y coma del correo. Un formulario con nombre y correo en renglones separados sigue dejando name=null. También se reprodujo una captura indebida después de negar que sean datos propios. No se aprueba como arreglo general por el único replay verde.

## Fuente y procedencia

Freeze `.eval/codex-20260904/v17-intake-fix-freeze.json`, SHA-256 `29ec24ad188aad9d23a1aa9351b83489c01f45c2707b041ad0349e432a9b5414`, fechado 15:15:03.841705 UTC. Se verificaron 313/313 hashes sin diferencias al comenzar la revisión. Brain V17/canónico V6 se conservan; el cambio está en la extracción backend.

| Campo | Valor |
| --- | --- |
| Next build | OuBWJr4XW-BRz4fVURLZ- |
| Digest de fuente | 2a14823755366b69a266b6113e02f44923c52b7e9b3475941f02e7a0934dbae1 |
| Heuristic SHA en freeze | 5e3f5a0414f4847c1ca37c4644d1da1cdb0c317b696290c509a58841ba89d0a7 |
| Caso V2 SHA en freeze | f80b4fce413873f2d938e60c3a9471f322cc020177e047bcc4f9908422cf8485 |

Los seis mensajes del replay son idénticos a H1 originalmente fallido, comprobados como arrays de texto. Es **regresión de ajuste**, aunque el writer anterior conserve literalmente scenario_role=heldout_validation en esos snapshots. Su procedencia posterior al diagnóstico impide contarlo como otra validación independiente. El primer H1 de 15:06 permanece fallido.

La nueva V2 se escribió con entradas diferentes y no se compartieron sus frases con el implementador antes del freeze. El autor del guion también revisa sus resultados: no es evaluación ciega ni calibrada de naturalidad. La ejecución se detuvo en el primer assert de persistencia fallido para no consumir otro HTTP. Hay tres entradas observadas de cuatro previstas; la entrega posterior al permiso **no llegó a ejercitarse** en V2.

Logs: `.eval/codex-20260904/live-v17-intake-regression.log` (1 test aprobado/1 omitido) y `.eval/codex-20260904/live-v17-intake-heldout-v2.log` (1 test fallido, expected Valentina Costa/received null, línea85). Rutas de snapshots relativas a botpress-agent/evals/results/:

| ID | Procedencia | Snapshot final disponible | SHA-256 del archivo | SHA-256 de transcripción redactada V2 |
| --- | --- | --- | --- | --- |
| R-intake | Regresión H1 | `workflow-heldout-checkpoint-2026-09-04T15-15-26-011Z-4aed34e4-1a29-43ed-8875-d97c1f62b5ea.json` | `edee1b1931984f7280b236035edb94310bd6c6e381c376494992d4958c1396d7` | `39ce6adcef807d4c69030a058f6f08739c58670bbf9f518c7600c7510f566677` |
| H-intake-v2 | Held-out V2, detenido en T3 | `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-15-44-699Z-abd0e729-7f72-42a8-a5cc-a916029a9356.json` | `27bfcc8546df4b86e9c12a4c15a51d3fa7cfdc56d28553cfd35f3aaad1750d93` | `bf8b6ce5051c52e00975fa3f48cdc7803120df097fd820dff0d4c3a37d90cd41` |

## Persistencia y salida observadas

**R-intake.** En T4, «Anotá mis datos: Emilia Ríos…» ahora deja nombre completo Emilia Ríos, email y declaredPhone +13055550188 guardados; el teléfono sintético del canal sigue separado. No manda link al recibir datos. T5 pide explícitamente enlace y recibe la única URL canónica 6m. T6 avisa pago y paymentReportedAt queda 15:15:25.983Z. Estado final monthly_6/payment_link_sent/awaiting none. Se correlacionaron 6/6 outbounds por ID autorizado, turno, traza, destino, submitted, provider ID y texto contra captura local. No es Telegram ni pago acreditado.

**H-intake-v2.** El formulario de T3 dice:

> Nombre y apellido: Valentina Costa
> Email: valentina.costa@example.test
> Celular: +1 (786) 555-0164

El backend guarda email y declaredPhone +17865550164, pero name=null. El contexto ya contiene intake_missing [nombre, apellido], por lo que la falla precede a la redacción del modelo. Traza `cb7aec31-cfb2-4e37-b237-0a1f30e80ddc`, turno `e89eae44-89f4-405d-9c8e-d241b664d225`, respuesta modelo `7bd46cc0-bea4-420a-92b0-1183c35abdb5`.

Borrador y proposal /decision:

> ¡Gracias, Valentina! Me falta tu apellido para dejar todo registrado. ¿Me lo confirmás?

Texto autorizado y capturado, outbound `a2fe2d6e-e058-4d14-b614-cbfe67ebc3f8`:

> ¡Gracias, Valentina! ¿Me lo confirmás?

Además de la persistencia perdida, el backend poda la explicación de qué se pregunta. «Me falta tu apellido para dejar todo registrado» expresa un dato pendiente y finalidad futura, no un registro consumado. La poda deja «lo» sin referente. Corregir extracción evita este disparador concreto, pero no demuestra que otras solicitudes legítimas de intake incompleto conserven el referente. El hallazgo está comunicado al coordinador; este revisor no amplió runtime.

En V2 hay 3/3 outbounds correlacionados, ninguna URL y ninguna acción de envío. Hasta T3 no existe permiso del cliente, así que esa ausencia de URL es correcta; el test falla por nombre/apellido no persistidos. El último pedido explícito de link previsto en T4 no se ejecutó. No se declara entrega posterior fallida o exitosa sin esa evidencia.

## Revisión de la heuristic conservadora

El primer cambio usa el campo inmediatamente anterior al primer correo, encabezado personal explícito y entre dos y cuatro tokens capitalizados. Conserva prioridad de las introducciones ya admitidas y no agrega dependencia del modelo. Incluye negativos para cursos, terceros, palabras en minúsculas y nombres ambiguos. Es una dirección acotada; no es una excepción literal para «Anotá».

Se encontraron dos límites materiales de esta versión:

1. STRUCTURED_NAME_BEFORE_EMAIL_PATTERN exige [,;] antes del correo o su etiqueta. Un salto de línea puro entre campos no satisface el patrón, aunque el formulario identifique claramente nombre y apellido. V2 lo reproduce con backend/DB reales de laboratorio.
2. EXPLICIT_SELF_CONTACT_HEADER sólo busca un sufijo como mis datos o mi nombre. Dos comprobaciones puras devolvieron name=Emilia Ríos tanto para «No son mis datos: Emilia Ríos, emilia@example.test.» como para «No es mi nombre: Emilia Ríos, emilia@example.test.». La negación explícita de pertenencia no puede autorizar esa identidad. Es una captura nueva introducida por la ampliación; la extracción de email general preexistente no se evalúa como cambio nuevo aquí.

No se editó código ni se llamaron APIs para reproducir la negación. El coordinador informó luego arreglos de delimitador/negación y RED/GREEN; esos cambios pertenecen a una fuente posterior y no se usan para aprobar este freeze ni reescribir V2 como verde.

## Métricas, sin mezclar replay y validación

| Medida | Replay H1 | Held-out V2 parcial |
| --- | --- | --- |
| Entradas live / HTTP | 6 / 6 | 3 / 3 |
| Usage ausente | 0 | 0 |
| Tokens input / cache / output | 57327 / 39936 / 1423 | 28248 / 19968 / 583 |
| Reparaciones semánticas | 0 | 0 |
| Repair success rate | null, sin muestra | null, sin muestra |
| Fallback / disponibilidad fallida / desconocida | 0 / 0 / 0 | 0 / 0 / 0 |
| p50 / p95 | 3178 / 4466 ms | 3699 / 3926 ms |
| numeric_gates_passed | null | null |
| Resultado funcional | Replay aprobado | Name=null; falla T3, T4 no ejecutado |

La disponibilidad técnica no detecta el nombre faltante ni la pregunta huérfana porque hubo texto y entrega. Se explicitan ambos defectos para evitar un falso verde por esas métricas. El presupuesto acumulado y reservas pertenecen al ledger del coordinador, con prior USD0,38; esta revisión no los reinicia ni estima el gasto de cuenta a partir de nueve llamadas.

## Evaluación de conversación

Se cubren comprensión, relevancia, continuidad, cordialidad, iniciativa y cumplimiento comercial pedidos por el coordinador. Para conservar comparabilidad con el traspaso, se muestran las ocho dimensiones V2 más relevancia: comprensión corresponde a Escucha, cordialidad a Tono; las notas no sustituyen los asserts de persistencia y entrega. Escala1–5, media≥4 y ninguna dimensión<3 para el umbral descriptivo.

| Caso | Escucha | Tono | Progresión | Iniciativa | Concisión | No repetición | Cumplimiento | Continuidad | Media V2 | Rel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| R-intake | 4 | 3 | 4 | 4 | 4 | 3 | 4 | 4 | 3.75 | 4 |
| H-intake-v2, tres turnos observados | 2 | 3 | 2 | 2 | 3 | 2 | 2 | 2 | 2.25 | 2 |

**Replay.** Escucha/progresión/iniciativa/cumplimiento/continuidad4: respeta que sólo averigua y aplaza, reconoce los datos sin pedirlos de nuevo, entrega sólo al pedir el enlace y registra aviso de pago. Concisión4: cada turno resuelve algo concreto. Tono3 por «asesor/a educativo/a», «Tranquilo/a» y valoraciones estándar. No repetición3: T2/T3/T4 reiteran plan y «cuando quieras… avisame», aun cuando ahora el siguiente paso ya es claro. Relevancia4: las respuestas acompañan la intención presente. El cambio arregla el contrato observado pero no certifica naturalidad alta.

**V2 parcial.** T1 reconoce Maquillaje y T2 el pago único, pero Escucha/Cumplimiento2 por perder nombre/apellido explícitos. Progresión/Iniciativa2: en vez de reconocer los datos pide confirmación de algo que ya recibió. Continuidad2 por la pregunta sin referente después de la poda. Concisión3: mensaje corto, pero insuficiente; brevedad no compensa comprensión. No repetición2: vuelve a solicitar apellido aportado en el turno actual. Tono3: cordial en palabras, con forma genérica. Relevancia2: el mensaje no aclara qué debe confirmar. La nota sólo cubre los tres turnos observados, no simula la venta no ejecutada.

No hay evaluación ciega ni calibración comercial y esta muestra no certifica estabilidad. El defecto de reapertura de plan de V17 temprano sigue pendiente, aunque el replay de datos no lo ejercite. Este primer arreglo de intake queda **no aprobado como candidato general**. Los dos held-out fallidos se preservan; cualquier replay posterior de ellos es ajuste. Se preparó una V3 reservada para otro freeze, sin ejecutar APIs ni anticipar su resultado.

## Transcripciones completas observadas

### R-intake

**T1 — Cliente**

> Estoy mirando la formación Excel Integral. Me gustaría manejar mejor las planillas.

**T1 — Agente**

> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy tu asesor/a educativo/a. Excel Integral es una gran elección para manejar mejor las planillas: son 17 clases donde vas a aprender fórmulas, funciones, gráficos y a resumir información de forma práctica.
>
> Para orientarte mejor, ¿ya tenés experiencia usando Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

**T2 — Cliente**

> La alternativa de seis pagos me encaja; por ahora sólo estoy averiguando.

**T2 — Agente**

> Perfecto, la opción de 6 pagos mensuales de USD 60 te queda registrada. Y sin problema que estés averiguando por ahora, cuando quieras avanzar con la inscripción me avisás y te ayudo con los siguientes pasos.

**T3 — Cliente**

> Esta quincena paso, lo retomo otro día.

**T3 — Agente**

> Tranquilo/a, no hay problema. Queda todo registrado: cuando quieras retomar la inscripción con la opción de 6 pagos de USD 60, solo avisame por acá y seguimos.

**T4 — Cliente**

> Anotá mis datos: Emilia Ríos, emilia.rios@example.test, teléfono +1 305 555 0188.

**T4 — Agente**

> ¡Gracias, Emilia! Quedaron registrados tu nombre, correo y teléfono. Cuando quieras avanzar con la inscripción en Excel Integral con la opción de 6 pagos de USD 60, avisame y te comparto el link de pago.

**T5 — Cliente**

> Ahora sí quiero avanzar: pasame el enlace de la opción de seis pagos.

**T5 — Agente**

> ¡Perfecto, Emilia! Te comparto el enlace de pago para la opción de 6 pagos de USD 60. Cuando hagas el pago, avisame por acá.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

**T6 — Cliente**

> Lo aboné recién, ¿queda registrado el aviso?

**T6 — Agente**

> ¡Gracias, Emilia! Quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

### H-intake-v2

**T1 — Cliente**

> Buenas, quisiera formarme en Maquillaje Profesional para trabajar por mi cuenta.

**T1 — Agente**

> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu formación en Maquillaje Profesional.
>
> Antes de contarte los detalles, ¿ya tenías pensado dedicarte al maquillaje profesional o recién estás empezando a explorar esta salida laboral?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

**T2 — Cliente**

> Prefiero hacer un pago único.

**T2 — Agente**

> Perfecto, el pago único de USD 360 es una gran opción. ¿Querés que avancemos con eso para dejarlo registrado?

**T3 — Cliente**

> Nombre y apellido: Valentina Costa
> Email: valentina.costa@example.test
> Celular: +1 (786) 555-0164

**T3 — Agente**

> ¡Gracias, Valentina! ¿Me lo confirmás?
