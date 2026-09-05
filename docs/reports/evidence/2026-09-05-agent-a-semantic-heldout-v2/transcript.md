# Agent A semantic held-out V2 — transcripción preservada

Fecha de ejecución: 2026-09-05 22:50–22:51 UTC

Commit congelado: `5c7fbf71132091bd4566cfa8c3ba8eae8fffc15d`

Prompt: `studyx-agent-a-brain-v22`

Modelo: `deepseek-v4-flash`

Conversaciones: 6

Turnos: 8

Llamadas al modelo: 10, todas HTTP 200
Costo exacto: USD 0.021663480

Esta evidencia distingue el texto entregado al adaptador de los borradores rechazados antes de la entrega.

## 1. Fotografía ambigua

> Cliente: Che, ¿hay algo para aprender a sacar fotos con el celu o con una cámara posta? Estoy medio perdido.
>
> Agente visible: sin respuesta.

Los dos intentos del modelo nombraron correctamente `Fotografía Profesional` y `Fotografía con Celulares para Tiendas Online`, pero emitieron `select_course` sin una referencia de curso única. La política rechazó ambos intentos y no hubo outbound.

## 2. Inglés

> Cliente: Estoy con ganas de estudiar inglés, pero eso de 1, 2 y 3 me marea: ¿por dónde arranco?
>
> Agente: ¡Hola! Bienvenido/a a StudyX 🇺🇸 Te cuento que tenemos el programa de inglés dividido en tres niveles: Inglés 1, Inglés 2 e Inglés 3. Para orientarte mejor: ¿arrancás desde cero o ya tenés alguna base del idioma?

La respuesta fue persistida y entregada. El caso falló sólo en el oráculo congelado, que exigía las 40 ofertas en un turno cuya autoridad ya estaba acotada a la selección pertinente.

## 3. Maquillaje con error ortográfico

> Cliente: Buenas, ¿me pasás info del curso de maquiaje profecional?
>
> Agente: ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesora educativa del área de Moda y Belleza. El curso de Maquillaje Profesional tiene 38 clases 100% online y está pensado para que aprendas a trabajar como maquillador/a profesional: reconocer materiales, tipos de piel, formas de rostro y asesorar a cada cliente.
>
> Agente: ¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?
>
> Agente: Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

La selección, la oferta de llamada, la persistencia y la entrega fueron correctas. El caso falló sólo por el mismo defecto del oráculo congelado.

## 4. Curso inexistente y recomendación técnica

> Cliente: ¿Dan algo para arreglar drones? Si no, ¿qué opciones técnicas tienen para aprender a reparar equipos?
>
> Agente visible: sin respuesta.

El borrador del modelo fue:

> Hola, bienvenido/a a StudyX 🇺🇸 No tenemos un curso específico de reparación de drones, pero sí opciones técnicas para reparación de equipos. Te cuento: contamos con Armado y Reparación de PC, Reparación de Celulares y Redes Informáticas, todas dentro de la Academia de Oficios.
>
> ¿Cuál de estas áreas te interesa más para trabajar o aprender?

El guard de verdad rechazó erróneamente la frase colectiva `todas dentro de la Academia de Oficios`. El backend persistió un fallback técnico, pero el contrato de respuesta de Botpress no aceptó `EGRESS_PARTIAL_VETO_TRANSITION_REFUSED`; el adaptador terminó con `INVALID_STUDYX_RESPONSE` y no entregó nada.

## 5. Cambio de curso

> Cliente: Quiero conocer Paisajismo y Jardinería.
>
> Agente: ¡Hola! Bienvenido/a a la Academia de Emprendedores 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con todo lo que necesites sobre Paisajismo y Jardinería. Es un curso 100% online, en español, de 23 clases, donde vas a aprender a intervenir en espacios exteriores como jardines, terrazas, balcones, parques y plazas.
>
> Agente: Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas. ¿Te parece?
>
> Cliente: Cambié de idea: prefiero Energía Solar Fotovoltaica; contame de esa.
>
> Agente: ¡Claro! Energía Solar Fotovoltaica es un curso de la Academia de Oficios, 100% online y en español, de 8 clases. Vas a conocer el componente más importante de las instalaciones fotovoltaicas: los módulos solares, que convierten la luz del sol en energía eléctrica continua, y te vas a introducir en cómo se transforma la luz solar en energía.
>
> Agente: Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

El cambio quedó persistido y ambas respuestas se entregaron. El caso falló sólo por el defecto del oráculo congelado.

## 6. Referencia por pronombre y logística inventada

> Cliente: Me interesa Excel Integral; ¿sirve para alguien que recién empieza?
>
> Agente: ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Excel Integral es ideal para quienes recién empiezan: vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información, todo en 17 clases 100% online.
>
> Agente: ¿Te gustaría que te cuente más sobre cómo se cursa y qué incluye?
>
> Agente: Si preferís, podemos conversarlo en una llamada breve para contarte todos los detalles.
>
> Cliente: ¿Y cuánto dura ese?
>
> Agente: Excel Integral son 17 clases 100% online, y avanzás a tu ritmo: la plataforma queda disponible 24/7 por varios meses, así que no hay presión de terminar en una fecha fija.
>
> Agente: Si querés, te cuento todos los detalles en una llamada breve, ¿te parece?

La referencia a Excel se conservó, pero `24/7`, `por varios meses` y la ausencia de una fecha límite no estaban autorizados por los hechos canónicos del curso.

## Resultado reconciliado

| Caso | Funcional estricto | Naturalidad |
|---|---:|---:|
| Fotografía ambigua | FAIL | FAIL |
| Inglés | PASS | PASS |
| Maquillaje | PASS | PASS |
| Drones / alternativas | FAIL | FAIL |
| Cambio de curso | PASS | PASS |
| Referencia a Excel | FAIL | FAIL |

Resultado manual: **3/6 funcional** y **3/6 naturalidad**. Hubo dos silencios visibles y una invención de logística. El resultado automático congelado fue 1/6 porque tres casos correctos también chocaron con un supuesto inválido del test; ese resultado histórico se conserva y no se reescribe.

La campaña no incluyó un caso de pago. Por eso esta ejecución no verifica el envío de un enlace de pago real. Las pruebas gratuitas existentes sí verifican materialización backend, registro y entrega correlacionada de un enlace sintético después de curso, plan, consentimiento e intake completos.
