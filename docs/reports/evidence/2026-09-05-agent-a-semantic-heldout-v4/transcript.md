# Agent A — campaña semántica held-out v4

Fecha: 2026-09-05  
Commit congelado: `2111a6ff2b81c644a684c79aa36c1e927a56e65b`  
Árbol: `e2c2d7afb05146094eab0ab61ac89a2bd0898ca1`  
Test SHA-256: `cc60902d767287f23ce6f99dda300828b623c9cab564901b5be9842323ffd296`  
Prompt: `studyx-agent-a-brain-v24`  
Modelo: `deepseek-v4-flash`  
Catálogo: 40 cursos; SHA-256 `2bf9adf270fadbb2f775ab134cd9573a0f64c770f200c00ac94d0a41a975eeac`

La fuente se congeló antes de la primera solicitud. La campaña se invocó una sola vez por `processInboundTurn` con seis conversaciones y nueve turnos declarados. DeepSeek respondió seis solicitudes con HTTP 200; otras cinco solicitudes fueron detenidas localmente por `AGENT_A_BUDGET_EXHAUSTED` antes de salir a la red. Cuatro de los nueve turnos tuvieron una respuesta visible y entrega correlacionada por el adaptador local.

El informe original está en `botpress-agent/evals/results/workflow-semantic-heldout-v4-campaign-2026-09-05T23-34-26-085Z-b0c5e2c2-ef83-4935-854b-6735cfd0a8f4.json`. Ese artefacto está ignorado por Git porque contiene el contexto completo enviado al proveedor; esta transcripción conserva la evidencia necesaria sin convertir un `completed` técnico en un resultado conversacional aprobado.

## 1. Opciones de fotografía según el objetivo

> Cliente: Quiero estudiar fotografía para mejorar las fotos de mi emprendimiento, pero también me interesa aprender a usar una cámara. ¿Qué opciones concretas tienen?
>
> Agente: ¡Hola! Bienvenido/a a StudyX 🇺🇸. Para tu objetivo de mejorar las fotos de tu emprendimiento y aprender a usar una cámara, tenemos dos opciones que encajan muy bien: **Fotografía Profesional** y **Fotografía con Celulares para Tiendas Online**. ¿Cuál te gustaría conocer en detalle?

Estado: ningún curso seleccionado, cero llamadas, una decisión y un outbound `submitted`. El modelo hizo una generación y una reparación, ambas HTTP 200.

Resultado: **PASS funcional y PASS de naturalidad**. Nombró sólo opciones canónicas, no inventó detalles y pidió una aclaración útil.

## 2. Inglés sin nivel elegido

> Cliente: Estoy averiguando inglés y todavía no sé qué nivel elegir. ¿Cuáles son los cursos disponibles?

No hubo respuesta visible. La primera solicitud a DeepSeek respondió HTTP 200 y produjo un borrador factual con Inglés 1, Inglés 2 e Inglés 3. El borrador agregó una oferta de llamada antes de resolver un curso; la frontera solicitó la única reparación autorizada. Esa reparación fue bloqueada localmente por `AGENT_A_BUDGET_EXHAUSTED` y la decisión durable quedó como `BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK`, sin outbound y sin estado conversacional.

Resultado: **no evaluable por presupuesto**. El `completed` del arnés no es un verde funcional.

## 3. `fotgrafia profecional` y modalidad

> Cliente: Vi algo de fotgrafia profecional y quiero hacerlo desde casa. ¿La cursada es online?
>
> Agente: ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Sí, la cursada de Fotografía Profesional es 100% online, así que podés hacerla cómodamente desde casa. 😊
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles del curso y resolver tus dudas.

Estado: curso `fotografia_profesional`, una llamada ofrecida, una decisión y un outbound `submitted`. Una solicitud a DeepSeek, HTTP 200.

Resultado: **PASS funcional y PASS ajustado de naturalidad**. Resolvió el error de escritura, respondió la modalidad y ofreció la llamada. La apertura es algo formularia.

## 4. Curso de tablets ausente con recuperación comercial

> Cliente: ¿Hay algún curso específico para arreglar tablets? Si no, sugerime una o dos alternativas reales relacionadas con reparación de tecnología.
>
> Agente: No tenemos un curso específico de tablets, pero sí contamos con opciones reales de reparación de tecnología. La más cercana es Armado y Reparación de PC, y también tenés Reparación de Celulares. ¿Te interesa alguna de las dos?

Estado: ningún curso seleccionado, cero llamadas, una decisión y un outbound `submitted`. Una solicitud a DeepSeek, HTTP 200.

Resultado: **PASS funcional y PASS de naturalidad**. Declaró la ausencia correcta y recomendó dos cursos canónicos relacionados.

## 5. Cambio explícito de curso

> Cliente: Me interesa Excel Integral. ¿Se cursa online?
>
> Agente: ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Excel Integral se cursa 100% online, en español, con 17 clases.
>
> En el curso vas a aprender las herramientas elementales de Excel, fórmulas y funciones, gráficos y resúmenes de información, entre otras actividades del programa.
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.
>
> Cliente: Cambio de idea: prefiero Community Manager. Contame brevemente de qué se trata.

El primer turno persistió `excel_integral`, una llamada y un outbound `submitted`; su solicitud a DeepSeek respondió HTTP 200. El segundo turno no llegó a DeepSeek: `AGENT_A_BUDGET_EXHAUSTED`, decisión durable `BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK`, cero outbound y el estado permaneció en Excel.

Resultado: **conversación no evaluable**. El primer turno visible es factual pero más extenso de lo pedido; el cambio de curso quedó sin respuesta por el corte local.

## 6. Referencia ordinal y continuidad

> Cliente: Estoy comparando Instalación de Aires Acondicionados con Energía Solar Fotovoltaica. ¿Me mostrás esas dos opciones?
>
> Cliente: Prefiero la segunda.
>
> Cliente: ¿Cuántas clases son?

Las tres solicitudes fueron bloqueadas localmente por `AGENT_A_BUDGET_EXHAUSTED` antes de DeepSeek. Cada turno persistió una decisión `BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK`, sin outbound y sin estado conversacional.

Resultado: **no evaluable**. No existe respuesta del modelo con la cual medir referencia ordinal, persistencia o naturalidad.

## Resultado y costo

El test congelado informó 3/6, correspondientes a fotografía ambigua, `fotgrafia` y curso ausente. Ese número no representa una evaluación completa: sólo tres conversaciones terminaron, una quedó parcial y dos no tuvieron respuesta. La revisión independiente encontró 3/3 conversaciones completas aceptables en naturalidad, pero no permite extrapolar ni aprobar el gate de 5/6.

El gasto exacto fue `1.180641512 - 1.160197600 = USD 0.020443912`. Quedaron `USD 0.019556088` del límite incremental autorizado. El bloqueo ocurrió porque el guard exige reservar el máximo estimado de la siguiente solicitud; las seis reservas observadas estuvieron entre USD 0.020320520 y USD 0.025571040 aunque el costo finalmente contabilizado fue menor.

No se alcanzaron 6/6 funcional ni 5/6 de naturalidad. No se desplegó el commit congelado en Vercel ni en Botpress y no se abrió Telegram.

