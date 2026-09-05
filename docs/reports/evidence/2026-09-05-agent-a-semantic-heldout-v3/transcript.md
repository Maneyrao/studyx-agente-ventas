# Agent A — campaña semántica held-out v3

Fecha: 2026-09-05
Commit congelado: `19c6c57672b39428593f1e7729b598b0ef1778f6`
Árbol: `b30dc0e0114ca05728fe1603e9300334f5542e20`
Test SHA-256: `eb5026d06353e5f81a1703d0886c86cc6d309711d33b39f6144b4afe1a65af1f`
Prompt: `studyx-agent-a-brain-v23`
Modelo: `deepseek-v4-flash`
Catálogo: 40 cursos; SHA-256 `2bf9adf270fadbb2f775ab134cd9573a0f64c770f200c00ac94d0a41a975eeac`

La campaña se ejecutó una sola vez por `processInboundTurn`: seis conversaciones, nueve turnos y doce llamadas a DeepSeek. Las doce llamadas devolvieron HTTP 200. Ocho turnos tuvieron entrega local correlacionada y uno quedó en silencio. Hubo dos intentos de reparación.

## Transcripciones y estado durable

### 1. Elección entre fotos con celular y cámara

> Cliente: Para mostrar productos de mi negocio, ¿tienen algo de foto con celular y también fotografía con cámara? No sé cuál elegir.
>
> Agente: ¡Hola! Bienvenido/a a StudyX 🇺🇸. Para mostrar productos de tu negocio, tenemos dos opciones que encajan muy bien: Fotografía con Celulares para Tiendas Online y Fotografía Profesional. La primera está pensada justamente para sacar fotos de productos con tu celular; la segunda profundiza en el uso de cámara. ¿Cuál te gustaría conocer mejor?
>
> Cliente: Me quedo con la del celular para la tienda. ¿Cómo es?
>
> Agente: ¡Buena elección! En Fotografía con Celulares para Tiendas Online vas a aprender a sacar fotos de tus productos con el celular: iluminación, fondos, encuadre y edición para que tus publicaciones se vean profesionales y vendan más. Es 100% online, en español, con clases en vivo que quedan grabadas y acceso a la plataforma cuando quieras.
>
> Si querés, te cuento los detalles por una llamada breve, sin compromiso.

Estado final: curso `fotografia_celulares_tiendas_online`, una llamada ofrecida, dos decisiones y dos outbounds entregados.

Resultado manual: **FAIL**. Interpretó y persistió el curso, pero afirmó clases en vivo grabadas y acceso irrestricto sin esos hechos en el contexto autorizado.

### 2. Inglés sin nivel elegido

> Cliente: Necesito saber qué cursos de inglés ofrecen y cuál sería el punto de partida; todavía no elegí nivel.
>
> Agente: ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. En inglés ofrecemos tres niveles: Inglés 1, Inglés 2 e Inglés 3. Para orientarte sobre cuál es tu punto de partida, contame: ¿ya tenés conocimientos previos de inglés o partís desde cero?

Estado final: ningún curso seleccionado, cero llamadas, una decisión y un outbound entregado.

Resultado manual: **PASS**.

### 3. `fotgrafia profecional`

> Cliente: Busco el curso de fotgrafia profecional. ¿Se puede cursar online?
>
> Agente: ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos.
>
> Sí, Fotografía Profesional se cursa 100% online. Son 41 clases pensadas para que conozcas desde cero el proceso fotográfico digital actual.
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

Estado final: curso `fotografia_profesional`, una llamada ofrecida, una decisión y un outbound entregado.

Resultado manual: **PASS**. El test automático congelado lo marcó como fallo porque exigía 40 `available_offerings` aun después de una selección exacta; en ese estado el contrato correcto entrega `selected_offering` detallado y deja vacía la lista compacta.

### 4. Curso inexistente con recomendación

> Cliente: ¿Tienen un curso para reparar consolas de videojuegos? Si no existe, recomendame una o dos opciones para arreglar tecnología.
>
> Agente: No tenemos un curso específico de reparación de consolas de videojuegos. Para el área de arreglar tecnología, te puedo recomendar dos opciones: Armado y Reparación de PC, y Reparación de Celulares. ¿Te interesa alguna de las dos?

Estado final: ningún curso seleccionado, cero llamadas, una decisión y un outbound entregado.

Resultado manual: **PASS**.

### 5. Cambio de Marketing Digital a Community Manager

> Cliente: Quiero arrancar con Marketing Digital. Contame de ese curso.
>
> Agente: ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Marketing Digital es un diplomado de 16 clases, 100% online y en español, donde vas a aprender a desarrollar estrategias exitosas para comunicar de forma eficaz y potenciar tu negocio.
>
> ¿Ya tenías pensado estudiar Marketing Digital o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.
>
> Cliente: Pensándolo mejor, cambialo por Community Manager. ¿De qué se trata?
>
> Agente: ¡Perfecto! Community Manager es un diplomado de 16 clases, 100% online y en español, donde vas a aprender a manejar, optimizar y administrar de forma profesional tus redes sociales: crear estrategias de Social Media, hacer campañas digitales, actuar en una crisis y medir el éxito de tu negocio online.
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.

Estado final: curso `community_manager`, dos llamadas ofrecidas, dos decisiones y dos outbounds entregados.

Resultado funcional manual: **PASS**. El cambio quedó persistido y la política permite la segunda invitación cuando la primera fue ignorada y se pide información de otro curso. El test congelado esperaba una sola invitación y produjo un falso negativo. Resultado de naturalidad: **FAIL**, porque repitió literalmente la invitación.

### 6. Referencia ordinal entre dos cursos

> Cliente: Estoy entre Instalación de Aires Acondicionados y Energía Solar Fotovoltaica. ¿Me ubicás con esas dos opciones?

No hubo respuesta visible en el primer turno. La propuesta y su reparación nombraron los cursos correctos, pero conservaron acciones incompatibles con una referencia aún no resuelta; el backend no autorizó el outbound.

> Cliente: La segunda me interesa más. ¿Cuántas clases tiene?
>
> Agente: ¡Buena elección! El curso de Energía Solar Fotovoltaica es muy completo. Te cuento que la clase en vivo es semanal y queda grabada, así que no te perdés nada si no podés conectarte.
>
> ¿Te gustaría que te cuente más en detalle cómo está organizado el programa y qué vas a aprender?
>
> Si querés, podemos coordinar una llamada breve para contarte todos los detalles del curso y resolver tus dudas.

Estado final: curso `energia_solar_fotovoltaica`, una llamada ofrecida, dos decisiones, un solo outbound entregado.

Resultado manual: **FAIL**. Hubo silencio, no respondió las ocho clases que constaban en el catálogo e inventó frecuencia semanal y grabación.

## Resultado y costo

El resultado automático congelado fue 3/6. Dos de esos fallos corresponden a supuestos incorrectos del test histórico ya ejecutado: lista compacta de 40 cursos después de una selección exacta y una sola invitación aunque la política permite dos. La reconciliación manual dio **4/6 funcional**. La revisión de naturalidad dio **3/6**: aprobaron Inglés, `fotgrafia profecional` y curso inexistente.

El gasto exacto de esta campaña fue `1.160197600 - 1.124803640 = USD 0.035393960`. El acumulado quedó en **USD 1.160197600** sobre un techo autorizado de **USD 1.185364112**, con **USD 0.025166512** disponibles.

Como no se alcanzaron 6/6 funcional ni 5/6 de naturalidad, no se desplegó el commit congelado y no se abrió el canario de Telegram.
