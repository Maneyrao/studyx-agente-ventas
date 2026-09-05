# Agent A — autoridad semántica del catálogo

Fecha: 2026-09-05
Rama: `codex/agent-a-semantic-catalog`
Base verificada: `21c47d3bf9916f465ff87784316eb90adc46368c`
Prompt actual: `studyx-agent-a-brain-v23` (las campañas pagas congeladas usaron v22)
Modelo de producción previsto: `deepseek-v4-flash`

## Alcance ejecutado

El cerebro recibe las 40 identidades activas del catálogo cuando todavía no hay un curso seleccionado. Cada elemento contiene únicamente `code`, `fact_id`, `display_name` y `area_code`. El plannerless conserva el `move.course_reference` propuesto por el modelo y el backend sigue validando códigos, hechos y acciones antes del commit.

Se corrigieron dos incompatibilidades encontradas por el workflow real:

1. El validador local no autorizaba los `fact_id` de `available_offerings`, aunque ya se los mostraba al modelo. La prueba RED devolvió `FACT_NOT_AUTHORIZED`; luego quedó verde sin reparación.
2. En una referencia como “el de celulares”, el contexto decía que la llamada no estaba disponible porque el curso aún no existía en el estado previo, mientras el backend exigía la oferta después de aceptar la selección semántica. `may_offer_call` ahora representa el presupuesto de llamada; la selección canónica y el límite siguen verificándose en el backend.

No se agregaron migraciones, modelos, proveedores, tablas ni frameworks. No se modificaron Stripe, Sheets ni Retell. El planner y las obligaciones rígidas permanecen fuera de la ruta plannerless.

## Evidencia TDD y workflow

- Contrato RED inicial: faltaban `available_offerings` y la autoridad seguía en candidatos.
- Validación RED focal: 1 fallo esperado, `FACT_NOT_AUTHORIZED` para `offering:fotografia-profesional:name:v1` visible.
- Capacidad RED focal: `may_offer_call=false` en selección semántica; el workflow reproducía `CALL_BUDGET_EXHAUSTED` en ADK y `CALL_OFFER_REQUIRED` en backend.
- Resultado GREEN final: catálogo 5/5, frontera Telegram fixture 3/3, llamada/pago 4/4.

Las pruebas de workflow invocaron `processInboundTurn`, el backend Next aislado en `127.0.0.1:3217` y PostgreSQL en `127.0.0.1:55435`. Sólo la respuesta de DeepSeek fue fixture, con costo USD 0. Cada turno comprobó ingestión, lote, claim, propuesta, autorización, commit, estado durable y captura de entrega correlacionada.

### Catálogo

| Entrada | Salida autorizada | Estado |
|---|---|---|
| `Quiero un curso de foto.` | `Tenemos Fotografía Profesional y Fotografía con Celulares para Tiendas Online. ¿Cuál de estas opciones se acerca más a lo que buscás?` | Sin selección; 1 outbound |
| `¿Tienen cursos de inglés?` | `Tenemos Inglés 1 y Inglés 2 y Inglés 3. ¿Cuál de estas opciones se acerca más a lo que buscás?` | Sin selección; 1 outbound |
| `Quiero estudiar fotografía.` | `Tenemos Fotografía Profesional y Fotografía con Celulares para Tiendas Online. ¿Cuál de estas opciones se acerca más a lo que buscás?` | Sin selección; 1 outbound |
| `¿Tienen fotgrafia?` | `Tenemos Fotografía Profesional y Fotografía con Celulares para Tiendas Online. ¿Cuál de estas opciones se acerca más a lo que buscás?` | Sin selección; 1 outbound |
| `¿Tienen Medicina? Si no, recomendame algo con salida laboral.` | `Medicina no figura entre los cursos disponibles. Por tu objetivo laboral, te recomiendo Especialista en Ventas, Excel Integral, Marketing Digital. ¿Cuál querés conocer mejor?` | Sin selección; sólo códigos reales; 1 outbound |

Cada caso recibió exactamente 40 identidades, realizó una sola generación, no invocó el planner y terminó con una pregunta útil.

### Secuencias Telegram anonimizadas

**L E**

> Cliente: Hola, quiero un curso de foto para mi emprendimiento.
> Agente: Tenemos Fotografía Profesional y Fotografía con Celulares para Tiendas Online. ¿Cuál se acerca más a lo que buscás?
> Cliente: El de celulares.
> Agente: Perfecto, Fotografía con Celulares para Tiendas Online puede servirte para crear contenido de tu negocio. Si querés, coordinamos una llamada breve y te cuento cómo seguir.

Estado final: `fotografia_celulares_tiendas_online`, llamada ofrecida una vez, 2 decisiones y 2 outbounds correlacionados.

**gfalejandro**

> Cliente: ¿Y cursos de inglés tienen?
> Agente: Sí: tenemos Inglés 1, Inglés 2 e Inglés 3. ¿Qué nivel te interesa?
> Cliente: El nivel 2.
> Agente: Buenísimo, entonces vemos Inglés 2. Si querés, coordinamos una llamada breve para orientarte; si no, seguimos por acá.

Estado final: `ingles_2`, llamada ofrecida una vez, 2 decisiones y 2 outbounds correlacionados.

**Lucas**

> Cliente: Me interesa Fotografía Profesional.
> Agente: Perfecto, vemos Fotografía Profesional. Si querés, coordinamos una llamada breve para orientarte; si no, seguimos por acá.
> Cliente: En realidad prefiero Excel Integral.
> Agente: Claro, cambiamos a Excel Integral. ¿Qué uso te gustaría darle?
> Cliente: ¿Y ese se cursa online?
> Agente: Sí, Excel Integral se cursa 100% online. ¿Querés que te cuente cómo son las clases?

Estado final: `excel_integral`; la referencia conserva el curso nuevo y no resucita Fotografía Profesional. Hubo 3 decisiones y 3 outbounds correlacionados.

### Llamada y pago

Las cuatro regresiones determinísticas comprobaron: oferta de llamada y ledger, captura secuencial de nombre/apellido/correo/teléfono, persistencia del cambio de curso, selección de plan, postergación, consentimiento explícito, materialización backend del enlace, entrega única correlacionada, aviso de pago, opt-out e idempotencia. El enlace de prueba sólo apareció después de completar intake y quedó tanto registrado como entregado.

## Gates gratuitos

| Gate | Resultado |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm --prefix botpress-agent run typecheck` | PASS |
| `npm run test:unit` | PASS — 191 archivos, 2 omitidos; 3.002 tests, 7 omitidos, 7 TODO |
| `npm --prefix botpress-agent run check` | PASS — 0 errores, 0 warnings |
| `npm --prefix botpress-agent run build` | PASS |
| `git diff --check` | PASS |
| Workflow fixture de catálogo, Telegram y acciones | PASS — 3 archivos; 12 tests, 1 test pago omitido |

Los skips están informados y no se cuentan como aprobados. La regresión Telegram de 11 turnos que usa DeepSeek quedó fuera de esta corrida mediante filtro porque el plan permite una sola campaña paga de seis conversaciones.

## Revisión manual

Las transcripciones finales no declaran ausentes Inglés ni Fotografía, no inventan cursos, no listan las 40 identidades, no restauran el curso anterior y no terminan sin un próximo paso. La redacción fixture prueba el contrato y la persistencia; la naturalidad queda reservada para la campaña held-out única.

Costo API nuevo hasta este checkpoint: **USD 0.00**.

## Campaña held-out paga inicial

La fuente quedó congelada antes de la primera solicitud en el commit `aa5a669df271394fce2bb88d8c40c7698a3e2847`, árbol `1beb00caa9e935a2d4bca2cce765cc788d3f30ca`, prompt `studyx-agent-a-brain-v22`, modelo `deepseek-v4-flash`, 40 cursos y digest de catálogo `5387b1a0b474123829605922e1cbe97c68eda6da5a9cabc8d6612432d1cbb2a4`.

Se iniciaron exactamente seis conversaciones nuevas. El runner hizo seis llamadas al modelo, una por conversación. Los dos escenarios de dos turnos no llegaron a su segundo mensaje porque la aserción estricta del primer turno detuvo cada caso. No se repitió la campaña.

| Caso | Respuesta propuesta por Agent A | Resultado real |
|---|---|---|
| Fotos de productos con teléfono | `Para tu tienda, el curso ideal es Fotografía con Celulares para Tiendas Online...` + propuesta de llamada | Modelo entendió y citó el curso real; backend rechazó `CALL_OFFER_NOT_AUTHORIZED`; sin outbound |
| Inglés sin nivel definido | `Tenemos tres niveles de inglés: Inglés 1, Inglés 2 e Inglés 3...` + propuesta de llamada | Nombres reales y sin falsa ausencia; propuso `select_course` sin curso único; backend rechazó `CALL_OFFER_NOT_AUTHORIZED`; sin outbound |
| `fotgrafia profesional` | `Veo que te interesa Fotografía Profesional...` + propuesta de llamada | Modelo corrigió el error y citó el curso real; backend rechazó `CALL_OFFER_NOT_AUTHORIZED`; sin outbound |
| Derecho ausente | `No tenemos una carrera de Derecho... Especialista en Ventas, Community Manager y Marketing Digital.` | Commit y entrega correctos, tres cursos reales; falló el criterio conversacional porque terminó sin pregunta, llamada ni siguiente paso |
| Fotografía Profesional, antes del cambio | Descripción canónica de 41 clases, online + propuesta de llamada | Modelo entendió y citó hechos canónicos; backend rechazó `FACT_NOT_AUTHORIZED,CALL_OFFER_NOT_AUTHORIZED`; sin outbound; el segundo turno no se ejecutó |
| Marketing Digital, antes de la referencia | Descripción canónica de 16 clases, online + propuesta de llamada | Modelo entendió y citó hechos canónicos; backend rechazó `FACT_NOT_AUTHORIZED,CALL_OFFER_NOT_AUTHORIZED`; sin outbound; el segundo turno no se ejecutó |

### Transcripciones observadas

En los cinco casos rechazados, “Agent A” identifica el borrador capturado antes del commit; ese texto no fue visible para el cliente.

**Fotos de productos con teléfono — no entregada**

> Cliente: Necesito aprender a sacar buenas fotos con el teléfono para publicar los productos de mi tienda.
> Agent A: ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a. Para tu tienda, el curso ideal es Fotografía con Celulares para Tiendas Online: vas a aprender a sacar fotos profesionales de tus productos con el teléfono y a publicarlas para vender más.
> Agent A, llamada: ¿Te parece si coordinamos una llamada breve para contarte cómo funciona y resolver tus dudas?

**Inglés sin nivel — no entregada**

> Cliente: Estoy buscando inglés, pero no sé qué nivel me corresponde. ¿Qué opciones hay?
> Agent A: ¡Hola! Bienvenido/a a StudyX 🇺🇸 Te cuento que tenemos tres niveles de inglés: Inglés 1, Inglés 2 e Inglés 3, cada uno pensado para una etapa distinta del aprendizaje.
> Agent A, llamada: ¿Te gustaría que te llame para ayudarte a identificar cuál es tu nivel y contarte cómo funciona cada uno?

**Error `fotgrafia` — no entregada**

> Cliente: Me interesa fotgrafia profesional y quiero saber cómo puedo seguir.
> Agent A: ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Veo que te interesa Fotografía Profesional, excelente elección. Me encantaría contarte cómo podés empezar y resolver todas tus dudas.
> Agent A, llamada: ¿Te parece si coordinamos una llamada breve para contarte los detalles y cómo podés inscribirte?

**Derecho ausente — entregada**

> Cliente: ¿Dan la carrera de Derecho? Si no la tienen, recomendame hasta tres cursos para mejorar mi salida laboral.
> Agent A: No tenemos una carrera de Derecho en nuestra oferta actual. Para mejorar tu salida laboral, te recomiendo tres cursos que sí tenemos: Especialista en Ventas, Community Manager y Marketing Digital. Cada uno te da herramientas prácticas para trabajar en áreas con alta demanda.

**Fotografía Profesional — no entregada**

> Cliente: Quiero conocer Fotografía Profesional.
> Agent A: ¡Hola! Bienvenido/a a la Academia de Emprendedores 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar con Fotografía Profesional. Es un curso 100% online, en español, de 41 clases, pensado para quienes quieren conocer desde cero el proceso fotográfico digital actual.
> Agent A, llamada: Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas. ¿Te parece?

**Marketing Digital — no entregada**

> Cliente: Quiero conocer Marketing Digital.
> Agent A: ¡Hola! Bienvenido/a a la Academia de Marketing 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar con el diplomado de Marketing Digital, un programa de 16 clases 100% online para que desarrolles estrategias exitosas y potencies tu negocio.
> Agent A, llamada: ¿Te gustaría que te cuente los detalles por una llamada breve?

### Puntuación separada

| Caso | Comprensión | Factualidad | Escucha | Iniciativa comercial | Concisión | Acción segura |
|---|---|---|---|---|---|---|
| Fotos con teléfono | PASS | PASS | PASS | PASS | PASS | FAIL |
| Inglés sin nivel | PASS | PASS | PASS | PASS | PASS | FAIL |
| `fotgrafia` | PASS | PASS | PASS | PASS | PASS | FAIL |
| Derecho ausente | PASS | PASS | PASS | FAIL | PASS | PASS |
| Fotografía Profesional | PASS | PASS | PASS | PASS | PASS | FAIL |
| Marketing Digital | PASS | PASS | PASS | PASS | PASS | FAIL |

Resultado del gate estricto: **0/6 funcional**, **1/6 con commit y entrega**, **5/6 borradores conversacionalmente aceptables**, cero cursos inventados y cero falsas ausencias. Cinco conversaciones quedaron en silencio visible por rechazo de la frontera; el caso entregado no tuvo un próximo paso. Por lo tanto, el candidato congelado no habilita despliegue.

### Causa agrupada e iteración TDD posterior

Las respuestas originales de DeepSeek contenían `course_reference` canónico en cuatro de los cinco rechazos. DeepSeek devolvió esos movimientos en una variante plana del objeto estructurado. El adaptador conservó `move`, texto y citas, pero descartó `course_reference`, `secondary_moves`, `vetoes`, `payment_plan` y `confidence` al convertirlo al contrato anidado. El backend recibió entonces una selección sin referencia: no eligió un curso por inferencia, no autorizó sus hechos detallados y no autorizó la llamada.

La prueba nueva reprodujo primero el fallo: `select_course` llegaba con `confidence=1` y sin `course_reference`. El commit `2034605` conserva los campos emitidos, normaliza el nombre visible al código canónico y mantiene el backend como autoridad final. Esa corrección pasó 111 pruebas focales.

El commit `84e0112` cerró los otros dos fallos observados sin agregar selección semántica al backend:

- un `select_course` sin `course_reference` canónico abre la única reparación permitida con `COURSE_NOT_RESOLVED`;
- una exploración o selección de área aún no resuelta debe dejar una pregunta útil, o abre la misma reparación con sujeto `next_step`;
- la política del backend rechaza también un `select_course` cuyo referente no resuelve contra el catálogo canónico.

Las pruebas TDD nuevas fallaron primero tanto en ADK como en backend, luego quedaron verdes. La suite focal posterior aprobó 160/160 pruebas. La verificación gratuita completa aprobó 2.998 unitarias y el workflow real aprobó 12/12 casos gratuitos, con un único test pago omitido. En ese workflow, el backend materializó, registró y entregó una sola vez el enlace sintético autorizado sólo después de persistir curso, plan, consentimiento y los cuatro datos de contacto.

Esas correcciones llevaron a una segunda campaña autorizada y congelada, documentada a continuación.

## Segunda campaña held-out paga

La segunda fuente quedó congelada en el commit `5c7fbf71132091bd4566cfa8c3ba8eae8fffc15d`, árbol `efa92464a928922abde60c37d83cb80c08bcb714`, test SHA-256 `14f755074dd5e58d4350655734f3133e38ccd1a05f33268595aec3939a70e2c4`, prompt v22, modelo `deepseek-v4-flash`, 40 cursos y catálogo SHA-256 `2bf9adf270fadbb2f775ab134cd9573a0f64c770f200c00ac94d0a41a975eeac`.

Un primer intento del wrapper terminó con `AGENT_A_BUDGET_INVALID` antes de llamar a la API y costó USD 0. La única ejecución respaldada por API abrió seis conversaciones, procesó ocho turnos e hizo diez llamadas a DeepSeek; todas devolvieron HTTP 200. No se volvió a ejecutar.

El resultado automático congelado fue **1/6**. Tres fallos fueron falsos negativos del test: exigía `available_offerings.length === 40` incluso después de seleccionar un curso, cuando el contexto correcto ya contenía `selected_offering`. Inglés, Maquillaje y el cambio de Paisajismo a Energía Solar sí persistieron y se entregaron. El resultado histórico permanece fallido y no se modificó después de ver las respuestas.

Los tres fallos reales fueron:

1. Ante la consulta ambigua por fotos con celular o cámara, el modelo nombró los dos cursos correctos pero emitió dos veces `select_course` sin `course_reference`; ambas propuestas fueron rechazadas y hubo silencio.
2. Ante Drones, el modelo declaró correctamente la ausencia y recomendó tres cursos reales. El guard rechazó la frase colectiva `todas dentro de la Academia de Oficios`; luego Botpress rechazó el fallback persistido porque su contrato no aceptaba `EGRESS_PARTIAL_VETO_TRANSITION_REFUSED`. Hubo silencio visible.
3. Ante `¿Y cuánto dura ese?`, la referencia a Excel se conservó, pero el modelo inventó acceso `24/7 por varios meses` y una fecha final abierta. Esos datos no estaban en los hechos autorizados.

La revisión manual independiente dio **3/6 funcional estricto** y **3/6 naturalidad**. Hubo cero cursos inventados y cero falsas ausencias, pero dos silencios y una invención de logística violan el gate. Las seis conversaciones están preservadas en [`transcript.md`](evidence/2026-09-05-agent-a-semantic-heldout-v2/transcript.md).

### Corrección v23 posterior a la campaña

El commit `705dac9` agrega únicamente las correcciones observadas:

- exige `browse_catalog` cuando hay varias opciones y reserva `select_course` para una referencia canónica única;
- acepta la razón de veto parcial en el contrato Botpress para que el fallback persistido pueda entregarse;
- valida descriptores colectivos de área contra el catálogo completo;
- rechaza logística no autorizada como acceso 24/7, cantidad de meses o una fecha abierta;
- actualiza el prompt a `studyx-agent-a-brain-v23` sin restaurar planner ni obligaciones.

La corrección pasó 214/214 pruebas focales, 7/7 integraciones de veto/silencio y 5/5 casos de catálogo por el workflow real con PostgreSQL y entrega correlacionada. También pasaron lint, ambos typechecks, las 3.002 unitarias, `adk check`, el build de Botpress y `git diff --check`.

v23 **no tiene una evaluación paga nueva**. Las pruebas gratuitas verifican el contrato y la persistencia, pero no permiten afirmar que DeepSeek ya alcance el gate conversacional. La segunda campaña tampoco incluyó pago; el envío de enlace sólo está demostrado con el workflow gratuito y un enlace sintético autorizado. No se desplegó este candidato a Vercel ni a Botpress y no se abrió el canario de Telegram.

## Presupuesto acumulado

- Último gasto informado al inicio del trabajo: **USD 0.38**.
- Gasto registrado después de ese punto: **USD 0.744803640**.
- Segunda campaña: **USD 0.021663480**, incluido en el importe anterior.
- Acumulado reconciliado: **USD 1.124803640**.
- Techo acumulado autorizado: **USD 1.185364112**.
- Margen no consumido: **USD 0.060560472**.

Para intentar el gate otra vez hace falta una nueva autorización paga. El alcance mínimo es congelar v23, ejecutar seis conversaciones no vistas sin superar el margen restante y exigir 6/6 funcional, cero invenciones/falsas ausencias/acciones no autorizadas/silencios y al menos 5/6 en naturalidad. Sólo si eso pasa corresponde desplegar exactamente el mismo commit en Vercel y Botpress y preparar el canario de Telegram.

Estado de cierre:

`READY_FOR_AGENT_A_TRAINING: NO`

`READY_FOR_TELEGRAM_CANARY: NO`
