# Todas las conversaciones live, antes y después de validar

Textos sintéticos por processInboundTurn, backend local, PostgreSQL55435 y adaptador capturado. No son mensajes de Telegram. Se conservan todas las rondas V14–V17, incluidas validaciones fallidas y regresiones posteriores. Las trazas se muestran una sola vez; los JSON archivados conservan snapshots completos y HTTP.

## 2026-09-04T14:15:26.349Z · Me interesa Redes Informáticas

Fuente `workflow-turn-2026-09-04T14-15-30-665Z-f209f39d-befd-4c86-844a-96863a40dd62.json.gz`; trace `a298a0da-6afa-443c-b443-f1f5a218c98c`; turno `9dd4e8a2-4581-4f24-b9ed-a312adef9350`.

Cliente: Me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a de la Academia de Oficios. Me alegra que te interese Redes Informáticas: es un curso de 16 clases, 100% online y en español, donde vas a conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen.
> Para contarte cómo se cursa y qué incluye, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a de la Academia de Oficios. Me alegra que te interese Redes Informáticas: es un curso de 16 clases, 100% online y en español, donde vas a conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen.
>
> Para contarte cómo se cursa y qué incluye, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `26b74c28-2d5e-4b94-861a-a67cac5e0678`; delivery `submitted_to_botpress`; tiempo 4316 ms.

## 2026-09-04T14:16:08.389Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `305163f2-355c-4906-ab7e-da4eb75fef73`; turno `9f2ba66f-eedc-47b3-9dc1-915735ee0e10`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Me alegra que te interese Redes Informáticas, un curso de la Academia de Oficios donde vas a conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Me alegra que te interese Redes Informáticas, un curso de la Academia de Oficios donde vas a conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `d369369d-3fe5-4012-b04d-995c0d718170`; delivery `submitted_to_botpress`; tiempo 4033 ms.

Decisión persistida: `{"turnId": "9f2ba66f-eedc-47b3-9dc1-915735ee0e10", "outboundId": "d369369d-3fe5-4012-b04d-995c0d718170", "createdAt": "2026-09-04T14:16:12.389Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:12.424Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `da6473a7-aac8-4556-8837-6c39488100df`; turno `428d0a13-cddc-412a-837a-398374d1d6ac`.

Cliente: Pensándolo mejor prefiero Excel Integral

Propuesta del modelo antes de validar:
> ¡Perfecto! Excel Integral es una gran elección. Es un curso de la Academia de Negocios de 17 clases donde vas a aprender las herramientas elementales, distintos tipos de fórmulas y funciones, gráficos y resúmenes de información, entre otras actividades que podés hacer con el programa.

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! Excel Integral es una gran elección. Es un curso de la Academia de Negocios de 17 clases donde vas a aprender las herramientas elementales, distintos tipos de fórmulas y funciones, gráficos y resúmenes de información, entre otras actividades que podés hacer con el programa.
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `1b31c801-c2fa-4ae2-8eef-6dbd58926f20`; delivery `submitted_to_botpress`; tiempo 3968 ms.

Decisión persistida: `{"turnId": "428d0a13-cddc-412a-837a-398374d1d6ac", "outboundId": "1b31c801-c2fa-4ae2-8eef-6dbd58926f20", "createdAt": "2026-09-04T14:16:16.358Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:16.393Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `36584e94-bd1c-401d-bace-bbd627f3794f`; turno `0bad813a-f9bb-49b7-b272-c4d962f7b8d4`.

Cliente: ¿Y qué se aprende ahí?

Propuesta del modelo antes de validar:
> En Excel Integral vas a aprender las herramientas elementales del programa, distintos tipos de fórmulas y funciones, cómo crear gráficos y resumir información, entre otras actividades prácticas. Son 17 clases, 100% online y en español.

Movimiento `ask_course_information`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> En Excel Integral vas a aprender las herramientas elementales del programa, distintos tipos de fórmulas y funciones, cómo crear gráficos y resumir información, entre otras actividades prácticas. Son 17 clases, 100% online y en español.

Outbound `0f6a67e3-ac56-4b3c-8782-6e04241cf310`; delivery `submitted_to_botpress`; tiempo 3347 ms.

Decisión persistida: `{"turnId": "0bad813a-f9bb-49b7-b272-c4d962f7b8d4", "outboundId": "0f6a67e3-ac56-4b3c-8782-6e04241cf310", "createdAt": "2026-09-04T14:16:19.712Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:19.766Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `72fd1880-4185-44c6-a80f-9c977947784c`; turno `96412e52-5aba-400b-891f-c795a2ca31b5`.

Cliente: Me interesa Maquillaje Profesional

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con el curso de Maquillaje Profesional.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con el curso de Maquillaje Profesional.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `c5fd0119-80e4-4fc0-8d00-27ab228d01b0`; delivery `submitted_to_botpress`; tiempo 3846 ms.

Decisión persistida: `{"turnId": "96412e52-5aba-400b-891f-c795a2ca31b5", "outboundId": "c5fd0119-80e4-4fc0-8d00-27ab228d01b0", "createdAt": "2026-09-04T14:16:23.596Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:23.613Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `03172413-f8cf-4c6b-94ba-cbd0e27725bf`; turno `83bad9c8-c265-47b6-bb5f-65b0a70e82fe`.

Cliente: No quiero que me llamen, prefiero por chat

Propuesta del modelo antes de validar:
> ¡Perfecto, seguimos por acá sin problema! 😊 Para contarte bien cómo funciona el curso, ¿ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?

Movimiento `{'schema_version': 1, 'move': 'continue_by_chat', 'secondary_moves': [], 'vetoes': ['call'], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': None, 'confidence': 0.98}`; acción `{'type': 'none'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> ¡Perfecto! Seguimos por acá entonces. 😊
> El curso de Maquillaje Profesional tiene 38 clases y está pensado para que aprendas a trabajar como maquillador profesional: reconocer materiales, tipos de piel, formas de rostro y cómo asesorar a cada cliente. ¿Te gustaría que te cuente cómo se cursa y qué incluye?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, seguimos por acá sin problema! 😊 Para contarte bien cómo funciona el curso, ¿ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?

Outbound `8ad163f4-0c21-4e82-8fbc-810061fbf99e`; delivery `submitted_to_botpress`; tiempo 6408 ms.

Decisión persistida: `{"turnId": "83bad9c8-c265-47b6-bb5f-65b0a70e82fe", "outboundId": "8ad163f4-0c21-4e82-8fbc-810061fbf99e", "createdAt": "2026-09-04T14:16:29.987Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:30.023Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `0b86324c-6889-4785-9525-ae385e4cd079`; turno `a89b3adb-ee6c-4dc3-8be4-c3edc82a98cc`.

Cliente: Contame cómo se cursa

Propuesta del modelo antes de validar:
> ¡Claro! El curso de Maquillaje Profesional es 100% online y en español, con 38 clases. La meta es que aprendas a trabajar como maquillador profesional: reconocer materiales, tipos de piel, formas de rostro y cómo asesorar a cada cliente en cada trabajo.
> Estudias a tu ritmo con material de lectura, videos explicativos, ejercicios y exámenes con corrección. Además tenés chat directo con profesores y al final recibís tu certificado. ¿Te gustaría que te cuente las opciones económicas?

Movimiento `ask_course_information`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Claro! El curso de Maquillaje Profesional es 100% online y en español, con 38 clases. La meta es que aprendas a trabajar como maquillador profesional: reconocer materiales, tipos de piel, formas de rostro y cómo asesorar a cada cliente en cada trabajo.
>
> Estudias a tu ritmo con material de lectura, videos explicativos, ejercicios y exámenes con corrección. Además tenés chat directo con profesores y al final recibís tu certificado. ¿Te gustaría que te cuente las opciones económicas?

Outbound `45b5dd0b-d6c4-4ba9-802b-ff2fe7d67919`; delivery `submitted_to_botpress`; tiempo 4483 ms.

Decisión persistida: `{"turnId": "a89b3adb-ee6c-4dc3-8be4-c3edc82a98cc", "outboundId": "45b5dd0b-d6c4-4ba9-802b-ff2fe7d67919", "createdAt": "2026-09-04T14:16:34.484Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:34.507Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `ebbc1051-fdcf-4758-b872-68e930261b32`; turno `39bb4677-739c-4818-b597-d973d2814a9a`.

Cliente: ¿Y cuánto cuesta?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Outbound `dbd97e91-d3aa-456f-8dee-54cb6373420f`; delivery `submitted_to_botpress`; tiempo 3443 ms.

Decisión persistida: `{"turnId": "39bb4677-739c-4818-b597-d973d2814a9a", "outboundId": "dbd97e91-d3aa-456f-8dee-54cb6373420f", "createdAt": "2026-09-04T14:16:37.917Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:37.972Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `66cb29a2-f608-4224-a009-43ef8d4963b7`; turno `856dd1ed-d713-46e6-809c-7977064744c9`.

Cliente: Quiero Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesora educativa del área de Academia de Oficios. Vi que te interesa Redes Informáticas, ¡excelente elección! Para poder asesorarte mejor, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `{'schema_version': 1, 'move': 'select_course', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': 'academia-de-oficios', 'payment_plan': None, 'confidence': 0.98}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesora educativa del área de Academia de Oficios. Vi que te interesa Redes Informáticas, ¡excelente elección! Para poder asesorarte mejor, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

Outbound `d17f6fdf-e0f5-412f-aebe-7ffe525e9279`; delivery `submitted_to_botpress`; tiempo 3817 ms.

Decisión persistida: `{"turnId": "856dd1ed-d713-46e6-809c-7977064744c9", "outboundId": "d17f6fdf-e0f5-412f-aebe-7ffe525e9279", "createdAt": "2026-09-04T14:16:41.768Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:41.791Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `5388c5a0-750b-413f-852d-81e5e5cfb675`; turno `6d9fa3be-7669-4dc5-bd9d-b10d23642f93`.

Cliente: Me quedo con el pago único

Propuesta del modelo antes de validar:
> ¡Perfecto! El pago único de USD 360 es una gran opción. Para dejarlo registrado y enviarte el link de pago, necesito tu nombre, apellido, correo electrónico y teléfono.

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! El pago único de USD 360 es una gran opción. Para dejarlo registrado y enviarte el link de pago, necesito tu nombre, apellido, correo electrónico y teléfono.

Outbound `a5e90f7e-2ec6-4917-ad48-1e3eb55a2a0d`; delivery `submitted_to_botpress`; tiempo 3417 ms.

Decisión persistida: `{"turnId": "6d9fa3be-7669-4dc5-bd9d-b10d23642f93", "outboundId": "a5e90f7e-2ec6-4917-ad48-1e3eb55a2a0d", "createdAt": "2026-09-04T14:16:45.172Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:45.210Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `6c0236e9-bfe8-4353-8909-68991798187a`; turno `020b8997-79c6-4dd7-8d75-99df22ed4c8f`.

Cliente: Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

Propuesta del modelo antes de validar:
> ¡Gracias, Lucía! Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'one_time'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Lucía! Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.

Outbound `34a2cd46-9c2f-453d-85d0-c4e8de6e0745`; delivery `submitted_to_botpress`; tiempo 2859 ms.

Decisión persistida: `{"turnId": "020b8997-79c6-4dd7-8d75-99df22ed4c8f", "outboundId": "34a2cd46-9c2f-453d-85d0-c4e8de6e0745", "createdAt": "2026-09-04T14:16:48.050Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:48.085Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `3c4e5238-6fc6-4422-afd3-0ceffb07e593`; turno `56e54f6f-0c19-420c-94d5-9a5d71a17595`.

Cliente: Quiero anotarme en Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy tu asesora educativa. Me alegra que quieras anotarte en Redes Informáticas. Para orientarte mejor, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy tu asesora educativa. Me alegra que quieras anotarte en Redes Informáticas. Para orientarte mejor, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.

Outbound `bfb8c21a-1bdb-434e-97e9-bb8f8e78675a`; delivery `submitted_to_botpress`; tiempo 3727 ms.

Decisión persistida: `{"turnId": "56e54f6f-0c19-420c-94d5-9a5d71a17595", "outboundId": "bfb8c21a-1bdb-434e-97e9-bb8f8e78675a", "createdAt": "2026-09-04T14:16:51.789Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:51.814Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `4f920a19-8811-483e-bbc3-0781c4fd8798`; turno `7c779a6e-b5b0-4402-b0e8-c713c9101c00`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 es una gran elección. El total del programa es USD 360, igual que en las otras opciones. ¿Querés que avancemos con esa para dejarlo registrado?

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': 'monthly_6', 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 es una gran elección. El total del programa es USD 360. Para dejarlo registrado y avanzar con el pago, necesito tu nombre, apellido, correo electrónico y teléfono.

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 es una gran elección. El total del programa es USD 360, igual que en las otras opciones. ¿Querés que avancemos con esa para dejarlo registrado?

Outbound `4493e3e9-61dd-47bb-8b7e-4bfd251e648e`; delivery `submitted_to_botpress`; tiempo 6051 ms.

Decisión persistida: `{"turnId": "7c779a6e-b5b0-4402-b0e8-c713c9101c00", "outboundId": "4493e3e9-61dd-47bb-8b7e-4bfd251e648e", "createdAt": "2026-09-04T14:16:57.825Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:16:57.866Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `efe6a062-4070-4139-a3e5-61efa3dd5dec`; turno `d120433f-f1da-4e35-9368-418c158be6ac`.

Cliente: Mandame el link. Soy Ana Ríos, ana.rios@example.test, teléfono +1 305 555 0177

Propuesta del modelo antes de validar:
> ¡Perfecto, Ana! Ya tengo tus datos registrados. Te envío el link para el plan de 6 pagos mensuales de USD 60.

Movimiento `{'schema_version': 1, 'move': 'request_payment_link', 'secondary_moves': ['provide_contact_details'], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': 'monthly_6', 'confidence': 1.0}`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Ana! Ya tengo tus datos registrados. Te envío el link para el plan de 6 pagos mensuales de USD 60.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `de4bfc01-9886-463d-99f2-4475d039aa85`; delivery `submitted_to_botpress`; tiempo 3309 ms.

Decisión persistida: `{"turnId": "d120433f-f1da-4e35-9368-418c158be6ac", "outboundId": "de4bfc01-9886-463d-99f2-4475d039aa85", "createdAt": "2026-09-04T14:17:01.156Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:01.189Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `f632e0ff-045c-4f60-8a4c-85cc7b30fa9b`; turno `068c776d-bade-49c1-a984-136309154810`.

Cliente: Me interesa Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente elección! Excel Integral es de la Academia de Negocios y tiene 17 clases. Te cuento que está pensado para que aprendas las herramientas elementales, fórmulas y funciones, gráficos y resúmenes de información, entre otras actividades útiles del programa. 😊

Movimiento `{'schema_version': 1, 'move': 'select_course', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': 'academia-de-negocios', 'payment_plan': None, 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente elección! Excel Integral es de la Academia de Negocios y tiene 17 clases. Te cuento que está pensado para que aprendas las herramientas elementales, fórmulas y funciones, gráficos y resúmenes de información, entre otras actividades útiles del programa. 😊
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `c98bbb5c-1968-45e2-8bfd-7c892582ef98`; delivery `submitted_to_botpress`; tiempo 4009 ms.

Decisión persistida: `{"turnId": "068c776d-bade-49c1-a984-136309154810", "outboundId": "c98bbb5c-1968-45e2-8bfd-7c892582ef98", "createdAt": "2026-09-04T14:17:05.164Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:05.200Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `90096e10-d4be-416a-b6a3-6eb16e5d7f96`; turno `7ec06614-0c36-483f-b88e-372328d526f0`.

Cliente: Elijo las 12 cuotas

Propuesta del modelo antes de validar:
> ¡Perfecto! La opción de 12 pagos mensuales de USD 30 es una gran elección. El total del programa es USD 360. ¿Querés que avancemos con esa opción para dejarlo registrado?

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': 'monthly_12', 'confidence': 0.98}`; acción `{'type': 'none'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> Perfecto, la opción de 12 pagos mensuales de USD 30 es una gran elección. El total del programa es USD 360. 😊
>
> Para dejarlo registrado y avanzar con el pago, necesito tu nombre, apellido, correo electrónico y teléfono.

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': 'monthly_12', 'confidence': 0.97}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! La opción de 12 pagos mensuales de USD 30 es una gran elección. El total del programa es USD 360. ¿Querés que avancemos con esa opción para dejarlo registrado?

Outbound `a727e33c-0ef7-4c30-ac26-e168e6eb1248`; delivery `submitted_to_botpress`; tiempo 5771 ms.

Decisión persistida: `{"turnId": "7ec06614-0c36-483f-b88e-372328d526f0", "outboundId": "a727e33c-0ef7-4c30-ac26-e168e6eb1248", "createdAt": "2026-09-04T14:17:10.939Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:10.973Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `b2703c91-0b02-417b-b19b-be3c4059e564`; turno `c9dc79cb-b87a-4e43-bc92-db1a0f7f91dd`.

Cliente: Ahora no puedo, lo dejo para la semana que viene

Propuesta del modelo antes de validar:
> Tranquilo, no hay problema. Cuando quieras retomar, la opción de 12 pagos mensuales de USD 30 sigue disponible. Cualquier cosa me escribís por acá. 😊

Movimiento `defer_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tranquilo, no hay problema. Cuando quieras retomar, la opción de 12 pagos mensuales de USD 30 sigue disponible. Cualquier cosa me escribís por acá. 😊

Outbound `32e17b88-4cce-4c54-982d-1a081631f8b4`; delivery `submitted_to_botpress`; tiempo 3486 ms.

Decisión persistida: `{"turnId": "c9dc79cb-b87a-4e43-bc92-db1a0f7f91dd", "outboundId": "32e17b88-4cce-4c54-982d-1a081631f8b4", "createdAt": "2026-09-04T14:17:14.423Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:14.479Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `b69f00d2-7e9f-442a-bfa8-26f4aac9825e`; turno `3fa2a06a-5a8b-45be-8b34-e49a0827d039`.

Cliente: Me anoto en Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente elección! Excel Integral es parte de la Academia de Negocios y son 17 clases donde vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. Antes de contarte más, ¿ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente elección! Excel Integral es parte de la Academia de Negocios y son 17 clases donde vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. Antes de contarte más, ¿ya tenías pensado estudiar Excel o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles.

Outbound `7f78290d-2cc6-4339-bffb-f80b7fc8e870`; delivery `submitted_to_botpress`; tiempo 3697 ms.

Decisión persistida: `{"turnId": "3fa2a06a-5a8b-45be-8b34-e49a0827d039", "outboundId": "7f78290d-2cc6-4339-bffb-f80b7fc8e870", "createdAt": "2026-09-04T14:17:18.095Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:18.179Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `08141bd1-c500-48a0-9d8e-52f6ee374380`; turno `421b5a4f-0a48-4c65-b8f6-297f6635e2b1`.

Cliente: Ya hice la transferencia

Propuesta del modelo antes de validar:
> Perfecto, quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Movimiento `{'schema_version': 1, 'move': 'report_payment', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': None, 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Outbound `4142f18b-be51-4342-a7eb-213371dc55a0`; delivery `submitted_to_botpress`; tiempo 3525 ms.

Decisión persistida: `{"turnId": "421b5a4f-0a48-4c65-b8f6-297f6635e2b1", "outboundId": "4142f18b-be51-4342-a7eb-213371dc55a0", "createdAt": "2026-09-04T14:17:21.540Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:21.707Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `8c82bd68-e54d-49fe-abb5-5d1432c4e788`; turno `0a760cf9-50cc-47e3-b960-4b019dc76fbd`.

Cliente: ¿Entonces ya tengo acceso al campus?

Propuesta del modelo antes de validar:
> Tu aviso de pago quedó registrado. El acceso al campus lo gestiona el equipo humano una vez que verifiquen que el pago está acreditado; yo no tengo forma de habilitarlo.

Movimiento `ask_current_state`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tu aviso de pago quedó registrado. El acceso al campus lo gestiona el equipo humano una vez que verifiquen que el pago está acreditado; yo no tengo forma de habilitarlo.

Outbound `61b358cf-54c4-48ef-83a8-0b8ca0622e42`; delivery `submitted_to_botpress`; tiempo 3709 ms.

Decisión persistida: `{"turnId": "0a760cf9-50cc-47e3-b960-4b019dc76fbd", "outboundId": "61b358cf-54c4-48ef-83a8-0b8ca0622e42", "createdAt": "2026-09-04T14:17:25.234Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:25.474Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `9ea96076-a191-45f7-96f2-9835b6d51466`; turno `77be883e-d76d-46f0-b96d-4a6a825f1dd1`.

Cliente: Hola, quiero info de Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesora educativa. Claro, te cuento sobre Redes Informáticas: es un curso de la Academia de Oficios, 100% online y en español, con 16 clases para que conozcas cómo funcionan las redes y cada uno de los dispositivos que las componen.

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesora educativa. Claro, te cuento sobre Redes Informáticas: es un curso de la Academia de Oficios, 100% online y en español, con 16 clases para que conozcas cómo funcionan las redes y cada uno de los dispositivos que las componen.
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

Outbound `3212a3d9-01d5-4ff5-b346-0855d80963fb`; delivery `submitted_to_botpress`; tiempo 3602 ms.

Decisión persistida: `{"turnId": "77be883e-d76d-46f0-b96d-4a6a825f1dd1", "outboundId": "3212a3d9-01d5-4ff5-b346-0855d80963fb", "createdAt": "2026-09-04T14:17:29.004Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:29.078Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `aa281a90-6d1b-45ea-a1ca-b71a21c28a60`; turno `a4b5ad5f-2a1c-4ff8-9dea-c858b6efd8fd`.

Cliente: No me escribas más, quiero que me den de baja

Salida autorizada y capturada:
> Listo, no te enviaremos más mensajes.

Outbound `d8084200-960e-41fe-bbaf-ebd3eb66a34a`; delivery `submitted_to_botpress`; tiempo 1159 ms.

Decisión persistida: `{"turnId": "a4b5ad5f-2a1c-4ff8-9dea-c858b6efd8fd", "outboundId": "d8084200-960e-41fe-bbaf-ebd3eb66a34a", "createdAt": "2026-09-04T14:17:30.149Z", "reasonCode": "EXPLICIT_OPT_OUT_ACK", "responseType": "opt_out_ack", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-sales-v17", "modelName": "deterministic:opt-out-ack-v1"}`.

## 2026-09-04T14:17:30.240Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-17-31-435Z-58fdb122-2713-40fc-b954-768ccf0c284f.json.gz`; trace `fce0b98b-be7d-492f-b8a0-f0c0d5d633fa`; turno `708175d5-5be9-468e-afa8-60ad0963fdbd`.

Cliente: ¿Y cuánto sale ese curso?

Salida autorizada y capturada:
*(silencio; consultar decisión y disponibilidad del turno)*

Outbound `None`; delivery `None`; tiempo 1131 ms.

Decisión persistida: `{"turnId": "708175d5-5be9-468e-afa8-60ad0963fdbd", "outboundId": null, "createdAt": "2026-09-04T14:17:31.355Z", "reasonCode": "CONSENT_REVOKED", "responseType": null, "hasResponse": false, "businessActionType": null, "promptVersion": "studyx-agent-a-sales-v17", "modelName": "policy:opt-out"}`.

## 2026-09-04T14:17:33.175Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversation-2026-09-04T14-17-51-606Z-85e1ae78-87bb-4a19-80a0-0b13ca043b33.json.gz`; trace `83b1a6eb-0a7d-451b-b5e8-b6d3c9b54bc5`; turno `b6b04641-7553-4fef-857c-de936756eaed`.

Cliente: Hola, quería saber qué formaciones tienen en tecnología

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a y estoy para ayudarte a encontrar la formación que mejor se adapte a lo que buscás.
> En tecnología tenemos opciones como Armado y Reparación de PC y AutoCAD orientado al Diseño de Interiores. ¿Te interesa alguna de estas áreas o preferís contarme un poco más sobre qué te gustaría aprender?

Movimiento `browse_catalog`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a y estoy para ayudarte a encontrar la formación que mejor se adapte a lo que buscás.
>
> En tecnología tenemos opciones como Armado y Reparación de PC y AutoCAD orientado al Diseño de Interiores. ¿Te interesa alguna de estas áreas o preferís contarme un poco más sobre qué te gustaría aprender?

Outbound `e0f14e36-c328-407f-b372-11076ed672a1`; delivery `submitted_to_botpress`; tiempo 4454 ms.

Decisión persistida: `{"turnId": "b6b04641-7553-4fef-857c-de936756eaed", "outboundId": "e0f14e36-c328-407f-b372-11076ed672a1", "createdAt": "2026-09-04T14:17:37.541Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:37.632Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversation-2026-09-04T14-17-51-606Z-85e1ae78-87bb-4a19-80a0-0b13ca043b33.json.gz`; trace `0553720c-adff-4e37-8e25-4ef4077591d5`; turno `6ca7efe9-163e-43dc-8d0a-41d99772a1fd`.

Cliente: Me tienta la de Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Buena elección! El curso de Redes Informáticas te permite conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen, en 16 clases 100% online. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `{'schema_version': 1, 'move': 'select_course', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': None, 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Buena elección! El curso de Redes Informáticas te permite conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen, en 16 clases 100% online. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `e322f055-ebd8-4b3c-b331-529088ccb166`; delivery `submitted_to_botpress`; tiempo 4338 ms.

Decisión persistida: `{"turnId": "6ca7efe9-163e-43dc-8d0a-41d99772a1fd", "outboundId": "e322f055-ebd8-4b3c-b331-529088ccb166", "createdAt": "2026-09-04T14:17:41.919Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:41.972Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversation-2026-09-04T14-17-51-606Z-85e1ae78-87bb-4a19-80a0-0b13ca043b33.json.gz`; trace `51e43f64-17e0-4434-92b6-777c182bad85`; turno `6f6f8e9b-f03f-43dd-876e-30d0c44ea156`.

Cliente: Pensándolo mejor, prefiero Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente elección! Excel Integral es un curso de 17 clases 100% online en el que vas a aprender las herramientas elementales, fórmulas y funciones, gráficos y resúmenes de información, entre otras actividades del programa. ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente elección! Excel Integral es un curso de 17 clases 100% online en el que vas a aprender las herramientas elementales, fórmulas y funciones, gráficos y resúmenes de información, entre otras actividades del programa. ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `df9e0092-e70d-4343-80ba-50c157cd3542`; delivery `submitted_to_botpress`; tiempo 3902 ms.

Decisión persistida: `{"turnId": "6f6f8e9b-f03f-43dd-876e-30d0c44ea156", "outboundId": "df9e0092-e70d-4343-80ba-50c157cd3542", "createdAt": "2026-09-04T14:17:45.839Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:45.876Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversation-2026-09-04T14-17-51-606Z-85e1ae78-87bb-4a19-80a0-0b13ca043b33.json.gz`; trace `59c9e9b6-abd2-4b79-b4f3-7489b68c39d4`; turno `2cf9e9de-464c-4304-87bb-a14ddf13ab5d`.

Cliente: ¿?

Propuesta del modelo antes de validar:
> ¡Perfecto! Excel Integral es una gran opción. ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

Movimiento `ask_course_information`; acción `{'type': 'none'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> Excel Integral es un curso de 17 clases 100% online, donde vas a aprender herramientas elementales, fórmulas y funciones, gráficos y resúmenes de información. ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

Movimiento `ask_course_information`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! Excel Integral es una gran opción. ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

Outbound `919f92dd-5941-4fb6-9a84-f68c83e7468e`; delivery `submitted_to_botpress`; tiempo 5712 ms.

Decisión persistida: `{"turnId": "2cf9e9de-464c-4304-87bb-a14ddf13ab5d", "outboundId": "919f92dd-5941-4fb6-9a84-f68c83e7468e", "createdAt": "2026-09-04T14:17:51.568Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:51.609Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversation-2026-09-04T14-18-05-644Z-e46af47a-fe3d-49d2-9c1e-f456f5861af8.json.gz`; trace `409ae26f-3bfe-4cdb-beff-42f73692600c`; turno `cb86fea6-59bf-4cba-9654-fad26336670b`.

Cliente: Buenas, me interesa Maquillaje Profesional

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Maquillaje Profesional. Antes de contarte los detalles, ¿ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Maquillaje Profesional. Antes de contarte los detalles, ¿ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `5ff00ceb-cb65-4eb4-b12b-bafb71884b4e`; delivery `submitted_to_botpress`; tiempo 3514 ms.

Decisión persistida: `{"turnId": "cb86fea6-59bf-4cba-9654-fad26336670b", "outboundId": "5ff00ceb-cb65-4eb4-b12b-bafb71884b4e", "createdAt": "2026-09-04T14:17:55.103Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:55.124Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversation-2026-09-04T14-18-05-644Z-e46af47a-fe3d-49d2-9c1e-f456f5861af8.json.gz`; trace `f664510d-0f97-498e-bc92-db9f907245ae`; turno `951656cc-1cae-4f92-89ae-ff264eef6a59`.

Cliente: Uf, me parece bastante plata la verdad

Propuesta del modelo antes de validar:
> Entiendo que te parezca mucho, pero el valor total del programa es USD 360 y podés elegir la opción que mejor se ajuste a tu bolsillo: 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Entiendo que te parezca mucho, pero el valor total del programa es USD 360 y podés elegir la opción que mejor se ajuste a tu bolsillo: 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Outbound `78c676b4-543b-47b6-a290-a7c2b07c5d12`; delivery `submitted_to_botpress`; tiempo 3811 ms.

Decisión persistida: `{"turnId": "951656cc-1cae-4f92-89ae-ff264eef6a59", "outboundId": "78c676b4-543b-47b6-a290-a7c2b07c5d12", "createdAt": "2026-09-04T14:17:58.907Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:17:58.938Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversation-2026-09-04T14-18-05-644Z-e46af47a-fe3d-49d2-9c1e-f456f5861af8.json.gz`; trace `2ea5e40f-a7b0-40e1-990c-8c8f80a46b1d`; turno `5cad1816-1e11-4609-843a-b9388e4f9f73`.

Cliente: No me llames por favor, sigamos escribiendo

Propuesta del modelo antes de validar:
> Perfecto, seguimos por acá sin problema. 😊
> Para avanzar, ¿cuál de las tres opciones de pago te resulta más cómoda: 12 pagos de USD 30, 6 pagos de USD 60 o el pago único de USD 360?

Movimiento `{'schema_version': 1, 'move': 'continue_by_chat', 'secondary_moves': [], 'vetoes': ['call'], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': None, 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, seguimos por acá sin problema. 😊
>
> Para avanzar, ¿cuál de las tres opciones de pago te resulta más cómoda: 12 pagos de USD 30, 6 pagos de USD 60 o el pago único de USD 360?

Outbound `2ccb724c-5f72-43d9-9837-13fc1aeba5fa`; delivery `submitted_to_botpress`; tiempo 3578 ms.

Decisión persistida: `{"turnId": "5cad1816-1e11-4609-843a-b9388e4f9f73", "outboundId": "2ccb724c-5f72-43d9-9837-13fc1aeba5fa", "createdAt": "2026-09-04T14:18:02.474Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:18:02.517Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversation-2026-09-04T14-18-05-644Z-e46af47a-fe3d-49d2-9c1e-f456f5861af8.json.gz`; trace `c078e3a2-d4f3-4314-95c4-d6da120f6fcd`; turno `8e7716be-6e73-4fc9-a2b5-03947548276e`.

Cliente: ¿Y la cuota más baja de cuánto sería?

Propuesta del modelo antes de validar:
> La opción de menor cuota es la de 12 pagos mensuales de USD 30. ¿Querés que avancemos con esa?

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': 'monthly_12', 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> La opción de menor cuota es la de 12 pagos mensuales de USD 30. ¿Querés que avancemos con esa?

Outbound `e06bdfe9-bc54-45d4-9bde-a14294e7c174`; delivery `submitted_to_botpress`; tiempo 3110 ms.

Decisión persistida: `{"turnId": "8e7716be-6e73-4fc9-a2b5-03947548276e", "outboundId": "e06bdfe9-bc54-45d4-9bde-a14294e7c174", "createdAt": "2026-09-04T14:18:05.588Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v14", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:18:05.648Z · Quiero anotarme en Redes Informáticas

Fuente `workflow-turn-2026-09-04T14-18-09-275Z-82f937fd-140b-4dfd-825f-1396ca938bc7.json.gz`; trace `810635cd-00f7-4ece-af0b-ae6597d7cfc5`; turno `f78e07ef-3e72-4add-b386-5528dad7d9ac`.

Cliente: Quiero anotarme en Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy tu asesora educativa. Me alegra que quieras anotarte en Redes Informáticas. Para orientarte mejor, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy tu asesora educativa. Me alegra que quieras anotarte en Redes Informáticas. Para orientarte mejor, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles.

Outbound `d5dd28a6-9e0a-4384-b7d8-64d591c192c5`; delivery `submitted_to_botpress`; tiempo 3627 ms.

## 2026-09-04T14:31:45.439Z · workflow-persisted-llamada_rechazada

Fuente `workflow-persisted-llamada_rechazada-2026-09-04T14-32-06-624Z-ea2eaccf-9fc0-44da-a9de-892588bda965.json.gz`; trace `8c91c8be-881e-4bea-a629-f47b89b9e9a3`; turno `b28f5c88-b3c7-453e-81a2-e778e8843ecb`.

Cliente: Me interesa Maquillaje Profesional

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en esto. Me encanta que te interese Maquillaje Profesional: son 38 clases 100% online, en español, pensadas para que puedas trabajar como maquillador/a profesional aprendiendo a reconocer materiales, tipos de piel, formas de rostro y cómo asesorar a cada cliente.

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en esto. Me encanta que te interese Maquillaje Profesional: son 38 clases 100% online, en español, pensadas para que puedas trabajar como maquillador/a profesional aprendiendo a reconocer materiales, tipos de piel, formas de rostro y cómo asesorar a cada cliente.
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

Outbound `b6f30094-fc7e-449a-a96a-892fe56d26b8`; delivery `submitted_to_botpress`; tiempo 4527 ms.

Decisión persistida: `{"turnId": "b28f5c88-b3c7-453e-81a2-e778e8843ecb", "outboundId": "b6f30094-fc7e-449a-a96a-892fe56d26b8", "createdAt": "2026-09-04T14:31:49.919Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:31:49.968Z · workflow-persisted-llamada_rechazada

Fuente `workflow-persisted-llamada_rechazada-2026-09-04T14-32-06-624Z-ea2eaccf-9fc0-44da-a9de-892588bda965.json.gz`; trace `0862c932-65c2-4246-999b-f50eba404e75`; turno `6c32b865-a4cf-4a26-a104-7aa1a288574a`.

Cliente: No quiero que me llamen, prefiero por chat

Propuesta no parseable (preservada en JSON; no fue respuesta al cliente).

Propuesta del modelo antes de validar:
> ¡Perfecto! Seguimos por acá sin problema. 😊 Te cuento cómo se cursa: son 38 clases 100% online, en español, con acceso a la plataforma 24/7 para que avances a tu ritmo. Al finalizar recibís tu certificado de Maquillaje Profesional.

Movimiento `{'schema_version': 1, 'move': 'continue_by_chat', 'secondary_moves': [], 'vetoes': ['call'], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': None, 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! Seguimos por acá sin problema. 😊 Te cuento cómo se cursa: son 38 clases 100% online, en español, con acceso a la plataforma 24/7 para que avances a tu ritmo. Al finalizar recibís tu certificado de Maquillaje Profesional.

Outbound `0e0fb48c-08cd-4024-b092-bb865f168411`; delivery `submitted_to_botpress`; tiempo 7114 ms.

Decisión persistida: `{"turnId": "6c32b865-a4cf-4a26-a104-7aa1a288574a", "outboundId": "0e0fb48c-08cd-4024-b092-bb865f168411", "createdAt": "2026-09-04T14:31:57.056Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:31:57.084Z · workflow-persisted-llamada_rechazada

Fuente `workflow-persisted-llamada_rechazada-2026-09-04T14-32-06-624Z-ea2eaccf-9fc0-44da-a9de-892588bda965.json.gz`; trace `e0ba9b09-5195-4452-9836-ff2827728df5`; turno `9b4287c9-7d34-40cd-bc1e-b4557035d376`.

Cliente: Contame cómo se cursa

Propuesta del modelo antes de validar:
> Además, tenés material de lectura, videos explicativos, ejercicios y exámenes con corrección, con chat directo con profesores para resolver tus dudas. Al finalizar, recibís tu certificado de Maquillaje Profesional que acredita tu formación.
> ¿Te gustaría conocer las opciones de pago para avanzar?

Movimiento `ask_course_information`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Además, tenés material de lectura, videos explicativos, ejercicios y exámenes con corrección, con chat directo con profesores para resolver tus dudas. Al finalizar, recibís tu certificado de Maquillaje Profesional que acredita tu formación.
>
> ¿Te gustaría conocer las opciones de pago para avanzar?

Outbound `1d2530ea-bc01-43e3-9aec-9099aa45d0d6`; delivery `submitted_to_botpress`; tiempo 3433 ms.

Decisión persistida: `{"turnId": "9b4287c9-7d34-40cd-bc1e-b4557035d376", "outboundId": "1d2530ea-bc01-43e3-9aec-9099aa45d0d6", "createdAt": "2026-09-04T14:32:00.492Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:32:00.519Z · workflow-persisted-llamada_rechazada

Fuente `workflow-persisted-llamada_rechazada-2026-09-04T14-32-06-624Z-ea2eaccf-9fc0-44da-a9de-892588bda965.json.gz`; trace `9268ad8a-c0f1-482e-a787-b5335be0fe4e`; turno `ecfec937-de36-4469-b9cc-deb81b3bdaaf`.

Cliente: ¿Y cuánto cuesta?

Propuesta no parseable (preservada en JSON; no fue respuesta al cliente).

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
> ¿Cuál de las tres opciones te resulta más cómoda para avanzar?

Movimiento `{'schema_version': 1, 'move': 'ask_payment_options', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': None, 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
>
> ¿Cuál de las tres opciones te resulta más cómoda para avanzar?

Outbound `6802243f-7529-4e0f-ac14-f4a266baa1d8`; delivery `submitted_to_botpress`; tiempo 6087 ms.

Decisión persistida: `{"turnId": "ecfec937-de36-4469-b9cc-deb81b3bdaaf", "outboundId": "6802243f-7529-4e0f-ac14-f4a266baa1d8", "createdAt": "2026-09-04T14:32:06.584Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:32:06.628Z · workflow-persisted-telefono_declarado

Fuente `workflow-persisted-telefono_declarado-2026-09-04T14-32-16-471Z-26f3815f-308a-4026-9fd3-2988db4c3c13.json.gz`; trace `800ed3c0-9028-4df9-902f-afb1de01578b`; turno `9478bc13-2682-4e7d-a2c9-577b4ffa8cb3`.

Cliente: Quiero Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en esto.
> Redes Informáticas es una gran elección: son 16 clases 100% online en español, donde vas a entender cómo funcionan las redes y cada uno de los dispositivos que las componen. Antes de contarte más, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en esto.
>
> Redes Informáticas es una gran elección: son 16 clases 100% online en español, donde vas a entender cómo funcionan las redes y cada uno de los dispositivos que las componen. Antes de contarte más, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `95eabcf7-a7a8-4038-b3d3-bcd197fc711d`; delivery `submitted_to_botpress`; tiempo 3992 ms.

Decisión persistida: `{"turnId": "9478bc13-2682-4e7d-a2c9-577b4ffa8cb3", "outboundId": "95eabcf7-a7a8-4038-b3d3-bcd197fc711d", "createdAt": "2026-09-04T14:32:10.600Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:32:10.621Z · workflow-persisted-telefono_declarado

Fuente `workflow-persisted-telefono_declarado-2026-09-04T14-32-16-471Z-26f3815f-308a-4026-9fd3-2988db4c3c13.json.gz`; trace `040d5906-a999-40ea-b9d1-83dafc9bc6e3`; turno `d3dc8775-067e-40a4-975b-c4a8a0ebcca5`.

Cliente: Me quedo con el pago único

Propuesta del modelo antes de validar:
> Perfecto, el pago único de USD 360 es una gran opción. ¿Querés que avancemos con eso para dejarlo registrado?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, el pago único de USD 360 es una gran opción. ¿Querés que avancemos con eso para dejarlo registrado?

Outbound `e5041234-8111-42f3-b375-82c2ff679bc6`; delivery `submitted_to_botpress`; tiempo 2764 ms.

Decisión persistida: `{"turnId": "d3dc8775-067e-40a4-975b-c4a8a0ebcca5", "outboundId": "e5041234-8111-42f3-b375-82c2ff679bc6", "createdAt": "2026-09-04T14:32:13.352Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:32:13.387Z · workflow-persisted-telefono_declarado

Fuente `workflow-persisted-telefono_declarado-2026-09-04T14-32-16-471Z-26f3815f-308a-4026-9fd3-2988db4c3c13.json.gz`; trace `468e18af-9bb7-4b91-a314-e7889dd839a2`; turno `2eb936b4-7117-4250-b8e8-0919ede0cc3d`.

Cliente: Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

Propuesta del modelo antes de validar:
> ¡Gracias, Lucía! Quedó registrado tu nombre, correo y teléfono. Ya tenés todo listo para avanzar con el pago único de USD 360.

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'one_time'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Lucía! Quedó registrado tu nombre, correo y teléfono. Ya tenés todo listo para avanzar con el pago único de USD 360.

Outbound `cda44ffd-7dbe-4258-93b6-ebc33b1a27a2`; delivery `submitted_to_botpress`; tiempo 3073 ms.

Decisión persistida: `{"turnId": "2eb936b4-7117-4250-b8e8-0919ede0cc3d", "outboundId": "cda44ffd-7dbe-4258-93b6-ebc33b1a27a2", "createdAt": "2026-09-04T14:32:16.445Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:32:16.474Z · workflow-persisted-postergacion

Fuente `workflow-persisted-postergacion-2026-09-04T14-32-26-623Z-53158fe6-134b-4a31-a9a3-23e5e986558d.json.gz`; trace `f8f661bb-b6fe-44b3-a2a7-f8da4a51ac52`; turno `ec5c560d-e97c-4257-91b7-7dc19421e77b`.

Cliente: Me interesa Excel Integral

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy tu asesor/a educativo/a. Excel Integral es una gran elección: son 17 clases en las que vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información.
> Para recomendarte lo mejor, contame: ¿ya tenés conocimientos previos de Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy tu asesor/a educativo/a. Excel Integral es una gran elección: son 17 clases en las que vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información.
>
> Para recomendarte lo mejor, contame: ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

Outbound `52edb70f-1ad8-4a31-8886-93a22130f384`; delivery `submitted_to_botpress`; tiempo 3573 ms.

Decisión persistida: `{"turnId": "ec5c560d-e97c-4257-91b7-7dc19421e77b", "outboundId": "52edb70f-1ad8-4a31-8886-93a22130f384", "createdAt": "2026-09-04T14:32:20.014Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:32:20.049Z · workflow-persisted-postergacion

Fuente `workflow-persisted-postergacion-2026-09-04T14-32-26-623Z-53158fe6-134b-4a31-a9a3-23e5e986558d.json.gz`; trace `5217f0ce-3aee-4c2c-a482-7c00fbe1e16a`; turno `4b9edf3d-3a6c-451d-b0da-f6228b6687d0`.

Cliente: Elijo las 12 cuotas

Propuesta del modelo antes de validar:
> ¡Perfecta elección! La opción de 12 pagos mensuales de USD 30 es la más cómoda para arrancar. El total del programa es USD 360, igual que en las otras opciones. ¿Querés que avancemos con la inscripción?

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': 'monthly_12', 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecta elección! La opción de 12 pagos mensuales de USD 30 es la más cómoda para arrancar. El total del programa es USD 360, igual que en las otras opciones. ¿Querés que avancemos con la inscripción?

Outbound `aabb167a-027d-48ad-8039-add27f12ff27`; delivery `submitted_to_botpress`; tiempo 3131 ms.

Decisión persistida: `{"turnId": "4b9edf3d-3a6c-451d-b0da-f6228b6687d0", "outboundId": "aabb167a-027d-48ad-8039-add27f12ff27", "createdAt": "2026-09-04T14:32:23.154Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:32:23.181Z · workflow-persisted-postergacion

Fuente `workflow-persisted-postergacion-2026-09-04T14-32-26-623Z-53158fe6-134b-4a31-a9a3-23e5e986558d.json.gz`; trace `d97a484b-00b2-4a36-ad3e-849ededf36d7`; turno `2fb88b5b-4392-4ef7-aea1-3c966c43c2f8`.

Cliente: Ahora no puedo, lo dejo para la semana que viene

Propuesta del modelo antes de validar:
> Tranquilo/a, no hay problema. Cuando quieras retomar, la opción de 12 pagos mensuales de USD 30 sigue disponible. Quedo por acá por si necesitás algo.

Movimiento `defer_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tranquilo/a, no hay problema. Cuando quieras retomar, la opción de 12 pagos mensuales de USD 30 sigue disponible. Quedo por acá por si necesitás algo.

Outbound `b0bf9849-b1f5-4d6c-ace9-3b0b5d036c0c`; delivery `submitted_to_botpress`; tiempo 3428 ms.

Decisión persistida: `{"turnId": "2fb88b5b-4392-4ef7-aea1-3c966c43c2f8", "outboundId": "b0bf9849-b1f5-4d6c-ace9-3b0b5d036c0c", "createdAt": "2026-09-04T14:32:26.583Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:34:42.594Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `4f0720cb-44b7-4246-80ae-5f88804d7a6c`; turno `3b2c9a08-f841-4f0d-b534-049d1261b5d4`.

Cliente: Hola, quería saber qué formaciones tienen en tecnología

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. En tecnología contamos con el curso de Armado y Reparación de PC, dentro de nuestra Academia de Oficios. ¿Te interesa ese perfil o buscás algo más específico dentro del área?

Movimiento `browse_catalog`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. ¿Te interesa ese perfil o buscás algo más específico dentro del área?

Outbound `2dd87dcd-6dee-4dd5-b063-03ec7bcf572d`; delivery `submitted_to_botpress`; tiempo 3570 ms.

Decisión persistida: `{"turnId": "3b2c9a08-f841-4f0d-b534-049d1261b5d4", "outboundId": "2dd87dcd-6dee-4dd5-b063-03ec7bcf572d", "createdAt": "2026-09-04T14:34:46.110Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:34:46.167Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `13ee663f-c5c2-4985-8bf4-676c1104abd8`; turno `0b206e45-7cb7-4f9a-9afd-945326db695e`.

Cliente: Me tienta la de Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Buena elección! Redes Informáticas es parte de la Academia de Oficios: 16 clases para entender cómo funcionan las redes y cada uno de los dispositivos que las componen. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Buena elección! Redes Informáticas es parte de la Academia de Oficios: 16 clases para entender cómo funcionan las redes y cada uno de los dispositivos que las componen. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

Outbound `82ceea26-084a-49df-8bbe-5271002e23d7`; delivery `submitted_to_botpress`; tiempo 3523 ms.

Decisión persistida: `{"turnId": "0b206e45-7cb7-4f9a-9afd-945326db695e", "outboundId": "82ceea26-084a-49df-8bbe-5271002e23d7", "createdAt": "2026-09-04T14:34:49.595Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:34:49.691Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `b6782a68-d4fa-47b7-982c-7bd21633dce0`; turno `dc738a2c-0b9d-47ec-9b71-7f1f960e9f93`.

Cliente: Pensándolo mejor, prefiero Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente cambio! Excel Integral es parte de la Academia de Negocios: 17 clases para dominar las herramientas elementales, fórmulas, funciones, gráficos y resúmenes de información. ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente cambio! Excel Integral es parte de la Academia de Negocios: 17 clases para dominar las herramientas elementales, fórmulas, funciones, gráficos y resúmenes de información. ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

Outbound `234a6170-6917-4c65-8421-c9bbfcecbbed`; delivery `submitted_to_botpress`; tiempo 3560 ms.

Decisión persistida: `{"turnId": "dc738a2c-0b9d-47ec-9b71-7f1f960e9f93", "outboundId": "234a6170-6917-4c65-8421-c9bbfcecbbed", "createdAt": "2026-09-04T14:34:53.230Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:34:53.252Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `10b443d3-3e77-4ef2-aac6-c7a4faf1e75c`; turno `9f13dfc8-6a24-4c49-8acb-fb5c992c87c2`.

Cliente: ¿?

Propuesta del modelo antes de validar:
> ¡Perfecto! Excel Integral es una gran opción. Son 17 clases para dominar fórmulas, funciones, gráficos y resúmenes de información. ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

Movimiento `{'schema_version': 1, 'move': 'ask_course_information', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': None, 'confidence': 0.9}`; acción `{'type': 'none'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> ¡Perfecto! Excel Integral es una gran opción. Son 17 clases para dominar fórmulas, funciones, gráficos y resúmenes de información, todo 100% online y en español. ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

Movimiento `{'schema_version': 1, 'move': 'ask_course_information', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': None, 'confidence': 0.9}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! Excel Integral es una gran opción. Son 17 clases para dominar fórmulas, funciones, gráficos y resúmenes de información, todo 100% online y en español.

Outbound `ee30b734-7537-41b3-b48b-e07e797c0c18`; delivery `submitted_to_botpress`; tiempo 5183 ms.

Decisión persistida: `{"turnId": "9f13dfc8-6a24-4c49-8acb-fb5c992c87c2", "outboundId": "ee30b734-7537-41b3-b48b-e07e797c0c18", "createdAt": "2026-09-04T14:34:58.401Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:34:58.462Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `35fbc0d4-72c6-4d8f-a0e8-1553892b933b`; turno `456a488f-5b72-4bd1-b8e9-5218a6d50b1b`.

Cliente: Buenas, me interesa Maquillaje Profesional

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Maquillaje Profesional. ¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Maquillaje Profesional. ¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.

Outbound `d714ab1d-0872-41bf-8bbe-895c5013751f`; delivery `submitted_to_botpress`; tiempo 3575 ms.

Decisión persistida: `{"turnId": "456a488f-5b72-4bd1-b8e9-5218a6d50b1b", "outboundId": "d714ab1d-0872-41bf-8bbe-895c5013751f", "createdAt": "2026-09-04T14:35:02.013Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:02.038Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `d742fc10-6126-49c5-927b-ff9376c494df`; turno `ff2b7959-98c5-4cab-b8e4-d0372b76982c`.

Cliente: Uf, me parece bastante plata la verdad

Propuesta del modelo antes de validar:
> Te entiendo, es una decisión importante. La opción de menor cuota es la de 12 pagos mensuales de USD 30, y también tenés 6 pagos de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Te entiendo, es una decisión importante. La opción de menor cuota es la de 12 pagos mensuales de USD 30, y también tenés 6 pagos de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Outbound `09075bbd-d426-4d60-80da-e15a6955e468`; delivery `submitted_to_botpress`; tiempo 3750 ms.

Decisión persistida: `{"turnId": "ff2b7959-98c5-4cab-b8e4-d0372b76982c", "outboundId": "09075bbd-d426-4d60-80da-e15a6955e468", "createdAt": "2026-09-04T14:35:05.757Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:05.790Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `3eed9e7d-02da-45bf-82cf-14c91de55046`; turno `fa98958d-8367-4f20-b243-4dd127a5fef3`.

Cliente: No me llames por favor, sigamos escribiendo

Propuesta del modelo antes de validar:
> Perfecto, seguimos por acá entonces. 😊 Para ayudarte a decidir con tranquilidad: el curso tiene 38 clases y está pensado para que puedas trabajar como maquillador profesional, aprendiendo a reconocer materiales, tipos de piel y formas de rostro para asesorar a cada cliente. ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, seguimos por acá entonces. 😊 Para ayudarte a decidir con tranquilidad: el curso tiene 38 clases y está pensado para que puedas trabajar como maquillador profesional, aprendiendo a reconocer materiales, tipos de piel y formas de rostro para asesorar a cada cliente. ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar?

Outbound `fdd1010f-3fe7-41f8-a88d-4d0e89f13a59`; delivery `submitted_to_botpress`; tiempo 4123 ms.

Decisión persistida: `{"turnId": "fa98958d-8367-4f20-b243-4dd127a5fef3", "outboundId": "fdd1010f-3fe7-41f8-a88d-4d0e89f13a59", "createdAt": "2026-09-04T14:35:09.882Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:09.915Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `cdde5b5b-59f0-4bff-820c-4951eee13644`; turno `4bd132e8-ee83-41ee-aa74-0baa7faf30ae`.

Cliente: ¿Y la cuota más baja de cuánto sería?

Propuesta del modelo antes de validar:
> La opción de menor cuota es la de 12 pagos mensuales de USD 30. También tenés 6 pagos de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> La opción de menor cuota es la de 12 pagos mensuales de USD 30. También tenés 6 pagos de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Outbound `a3f85af0-9082-4046-85c0-6e3c8d569511`; delivery `submitted_to_botpress`; tiempo 3297 ms.

Decisión persistida: `{"turnId": "4bd132e8-ee83-41ee-aa74-0baa7faf30ae", "outboundId": "a3f85af0-9082-4046-85c0-6e3c8d569511", "createdAt": "2026-09-04T14:35:13.179Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:13.233Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `aeb3ec21-0d1f-4c76-b4f2-b44740f8df93`; turno `1d9c4fe3-a38a-412f-bf81-dd17fc6d6b4f`.

Cliente: Quiero anotarme en Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con tu inscripción en Redes Informáticas.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes informáticas o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con tu inscripción en Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes informáticas o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `0005d6d0-5486-4193-a8af-68ca87b2df13`; delivery `submitted_to_botpress`; tiempo 3139 ms.

Decisión persistida: `{"turnId": "1d9c4fe3-a38a-412f-bf81-dd17fc6d6b4f", "outboundId": "0005d6d0-5486-4193-a8af-68ca87b2df13", "createdAt": "2026-09-04T14:35:16.345Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:16.374Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `5f4e1062-df6e-4ada-825d-e23566040217`; turno `3fa0707e-b75a-40d9-9a96-f7904c93d73e`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 es una gran elección. El total del programa es USD 360 en cualquiera de las opciones.
> ¿Querés que avancemos con esa opción para dejarla registrada?

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': 'academia-de-oficios', 'payment_plan': 'monthly_6', 'confidence': 0.98}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 es una gran elección. El total del programa es USD 360 en cualquiera de las opciones.
>
> ¿Querés que avancemos con esa opción para dejarla registrada?

Outbound `9c06f77e-9b7a-452f-b928-4dee4b40be07`; delivery `submitted_to_botpress`; tiempo 3463 ms.

Decisión persistida: `{"turnId": "3fa0707e-b75a-40d9-9a96-f7904c93d73e", "outboundId": "9c06f77e-9b7a-452f-b928-4dee4b40be07", "createdAt": "2026-09-04T14:35:19.802Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:19.838Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `6de091b8-5a5c-4d86-8f90-a3939e6f2508`; turno `7c8c8671-7eb8-4778-b381-7a8125dc6f20`.

Cliente: Igual esta semana no puedo, lo dejo para el lunes

Propuesta del modelo antes de validar:
> Tranquilo, no hay problema. Quedó registrada tu elección de 6 pagos mensuales de USD 60 para Redes Informáticas. Cuando quieras avanzar con la inscripción, avisame por acá y te ayudo.

Movimiento `defer_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tranquilo, no hay problema. Quedó registrada tu elección de 6 pagos mensuales de USD 60 para Redes Informáticas. Cuando quieras avanzar con la inscripción, avisame por acá y te ayudo.

Outbound `6cb81655-1076-4e82-947b-f015b0fd30d6`; delivery `submitted_to_botpress`; tiempo 3642 ms.

Decisión persistida: `{"turnId": "7c8c8671-7eb8-4778-b381-7a8125dc6f20", "outboundId": "6cb81655-1076-4e82-947b-f015b0fd30d6", "createdAt": "2026-09-04T14:35:23.454Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:23.481Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `270af754-0de9-4dde-8124-d06ef6e0d39d`; turno `f3e128e4-3004-40d7-aa38-31556ec845d5`.

Cliente: Ya está, mandame el link. Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

Propuesta del modelo antes de validar:
> ¡Gracias, Lucía! Registré tus datos y tu elección de 6 pagos mensuales de USD 60 para Redes Informáticas. Te comparto el link de pago por acá.

Movimiento `request_payment_link`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Lucía! Registré tus datos y tu elección de 6 pagos mensuales de USD 60 para Redes Informáticas. Te comparto el link de pago por acá.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `a4d025e2-cc0e-4545-975c-af5bd80fe809`; delivery `submitted_to_botpress`; tiempo 3510 ms.

Decisión persistida: `{"turnId": "f3e128e4-3004-40d7-aa38-31556ec845d5", "outboundId": "a4d025e2-cc0e-4545-975c-af5bd80fe809", "createdAt": "2026-09-04T14:35:26.966Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:27.010Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `506e7064-a0f9-4b1b-9df7-0de021a81e5f`; turno `87eedf6e-5d1f-448a-a0bb-e85353138f1d`.

Cliente: Me anoto en Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente elección! Excel Integral es de la Academia de Negocios y son 17 clases donde vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información. 😊

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente elección! Excel Integral es de la Academia de Negocios y son 17 clases donde vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información. 😊
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `41220569-91d0-404f-b772-18fd8a7bee7f`; delivery `submitted_to_botpress`; tiempo 3619 ms.

Decisión persistida: `{"turnId": "87eedf6e-5d1f-448a-a0bb-e85353138f1d", "outboundId": "41220569-91d0-404f-b772-18fd8a7bee7f", "createdAt": "2026-09-04T14:35:30.605Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:30.630Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `7942d67d-9826-4425-95d1-4756d98f6512`; turno `8c00e6f9-e3fa-4687-8940-549283516951`.

Cliente: Ya hice la transferencia recién

Propuesta del modelo antes de validar:
> ¡Gracias por avisarme! Dejé registrado tu aviso de pago para que el equipo lo revise. Cuando esté acreditado, gestionarán tu acceso a la plataforma. 😊

Movimiento `report_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias por avisarme! Dejé registrado tu aviso de pago para que el equipo lo revise. Cuando esté acreditado, gestionarán tu acceso a la plataforma. 😊

Outbound `ca995a3f-e6e2-41ec-9727-8a9acc4c274d`; delivery `submitted_to_botpress`; tiempo 3464 ms.

Decisión persistida: `{"turnId": "8c00e6f9-e3fa-4687-8940-549283516951", "outboundId": "ca995a3f-e6e2-41ec-9727-8a9acc4c274d", "createdAt": "2026-09-04T14:35:34.069Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:34.096Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T14-35-37-257Z-fb864fe2-b66a-4575-af1a-df2ed14033f7.json.gz`; trace `2c9465a4-610d-4bd2-9a2b-5f18db9aa36b`; turno `2f4fa45d-c2f1-468e-84aa-7e64f692009b`.

Cliente: ¿Entonces ya quedé inscripta?

Propuesta del modelo antes de validar:
> Tu inscripción queda confirmada cuando el equipo verifique que el pago está acreditado. Yo dejé registrado tu aviso; en cuanto lo revisen, gestionarán tu acceso a la plataforma. 😊

Movimiento `{'schema_version': 1, 'move': 'ask_current_state', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': None, 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tu inscripción queda confirmada cuando el equipo verifique que el pago está acreditado. Yo dejé registrado tu aviso; en cuanto lo revisen, gestionarán tu acceso a la plataforma. 😊

Outbound `b70d833d-577d-4cbd-816e-f06ba4707396`; delivery `submitted_to_botpress`; tiempo 3145 ms.

Decisión persistida: `{"turnId": "2f4fa45d-c2f1-468e-84aa-7e64f692009b", "outboundId": "b70d833d-577d-4cbd-816e-f06ba4707396", "createdAt": "2026-09-04T14:35:37.211Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:37.272Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T14-35-51-188Z-d55f0798-dbec-44cb-a18b-c0a60566b615.json.gz`; trace `8436128d-e0c8-468f-9105-a9944fab3b40`; turno `da255ecc-8791-40c2-bd4b-f68e13334c20`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con Redes Informáticas.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `f333af7b-572f-4c21-8191-c0f3e8a0f1b9`; delivery `submitted_to_botpress`; tiempo 3381 ms.

Decisión persistida: `{"turnId": "da255ecc-8791-40c2-bd4b-f68e13334c20", "outboundId": "f333af7b-572f-4c21-8191-c0f3e8a0f1b9", "createdAt": "2026-09-04T14:35:40.628Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:40.654Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T14-35-51-188Z-d55f0798-dbec-44cb-a18b-c0a60566b615.json.gz`; trace `9133b5db-6ce8-4803-b71e-c59d2006eca3`; turno `1ed5f2cc-b71d-43a8-b3c2-6c78a6a02561`.

Cliente: Prefiero no hablar por teléfono, seguimos por chat

Propuesta del modelo antes de validar:
> ¡Perfecto, seguimos por chat! 😊
>
> Para contarte bien cómo funciona Redes Informáticas, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `{'schema_version': 1, 'move': 'continue_by_chat', 'secondary_moves': [], 'vetoes': ['call'], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': None, 'confidence': 0.98}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, seguimos por chat! 😊

Outbound `2c42e607-c01e-41eb-9515-1156284bed18`; delivery `submitted_to_botpress`; tiempo 3610 ms.

Decisión persistida: `{"turnId": "1ed5f2cc-b71d-43a8-b3c2-6c78a6a02561", "outboundId": "2c42e607-c01e-41eb-9515-1156284bed18", "createdAt": "2026-09-04T14:35:44.244Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:44.265Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T14-35-51-188Z-d55f0798-dbec-44cb-a18b-c0a60566b615.json.gz`; trace `6b76441a-e966-414f-b531-c39c6c92b416`; turno `82155155-8669-4be2-b5fb-99b903e7fe98`.

Cliente: Contame más del contenido

Propuesta del modelo antes de validar:
> ¡Claro! Te cuento qué vas a aprender en Redes Informáticas 😊
> El curso tiene 16 clases y te va a permitir conocer el funcionamiento de las redes informáticas, y cada uno de los elementos y dispositivos que las componen. Es 100% online y en español.

Movimiento `ask_course_information`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Claro! Te cuento qué vas a aprender en Redes Informáticas 😊
>
> El curso tiene 16 clases y te va a permitir conocer el funcionamiento de las redes informáticas, y cada uno de los elementos y dispositivos que las componen. Es 100% online y en español.

Outbound `e83d4848-bb53-4867-b7ba-e246ee3c6bdc`; delivery `submitted_to_botpress`; tiempo 3434 ms.

Decisión persistida: `{"turnId": "82155155-8669-4be2-b5fb-99b903e7fe98", "outboundId": "e83d4848-bb53-4867-b7ba-e246ee3c6bdc", "createdAt": "2026-09-04T14:35:47.666Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:47.700Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T14-35-51-188Z-d55f0798-dbec-44cb-a18b-c0a60566b615.json.gz`; trace `520d92b9-7e7b-415a-8747-147dc52f8545`; turno `f37fcc13-5ca6-4491-b601-7f91d48de155`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Outbound `427a4b5c-cb82-4b0c-a213-8834762db081`; delivery `submitted_to_botpress`; tiempo 3469 ms.

Decisión persistida: `{"turnId": "f37fcc13-5ca6-4491-b601-7f91d48de155", "outboundId": "427a4b5c-cb82-4b0c-a213-8834762db081", "createdAt": "2026-09-04T14:35:51.138Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:51.442Z · adaptive-rule-based-v1

Fuente `workflow-adaptive-sale-2026-09-04T14-36-15-201Z-06565fb9-c40f-46bd-b8fa-3c0e9cea0a52.json.gz`; trace `584e6859-dcf5-4f3d-93b7-f1708fc2f724`; turno `7c528d42-0e0c-4be9-91e6-7bf4481d32df`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar con el curso de Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar con el curso de Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `aaf587d1-d0ef-4f58-b01d-e25777debc2a`; delivery `submitted_to_botpress`; tiempo 3534 ms.

Decisión persistida: `{"turnId": "7c528d42-0e0c-4be9-91e6-7bf4481d32df", "outboundId": "aaf587d1-d0ef-4f58-b01d-e25777debc2a", "createdAt": "2026-09-04T14:35:54.954Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:54.978Z · adaptive-rule-based-v1

Fuente `workflow-adaptive-sale-2026-09-04T14-36-15-201Z-06565fb9-c40f-46bd-b8fa-3c0e9cea0a52.json.gz`; trace `559559f4-1a00-4471-8dc2-99412e0e7dd9`; turno `a947b9c2-8226-433c-812e-92048d5f1deb`.

Cliente: Prefiero no hablar por teléfono, sigamos por acá

Propuesta del modelo antes de validar:
> ¡Perfecto, seguimos por acá sin problema! 👍
> Para recomendarte mejor, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, seguimos por acá sin problema! 👍

Outbound `bc0c77bd-20bb-4688-99fe-f2146efe9886`; delivery `submitted_to_botpress`; tiempo 3450 ms.

Decisión persistida: `{"turnId": "a947b9c2-8226-433c-812e-92048d5f1deb", "outboundId": "bc0c77bd-20bb-4688-99fe-f2146efe9886", "createdAt": "2026-09-04T14:35:58.395Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:35:58.430Z · adaptive-rule-based-v1

Fuente `workflow-adaptive-sale-2026-09-04T14-36-15-201Z-06565fb9-c40f-46bd-b8fa-3c0e9cea0a52.json.gz`; trace `705cb395-230e-4182-8b82-0ed7a5a20aff`; turno `b651cca0-b587-4363-99ce-83b71d4bae17`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Movimiento `{'schema_version': 1, 'move': 'ask_payment_options', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': None, 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Outbound `9f9c680a-b633-4444-a962-a7fbe8f2d0be`; delivery `submitted_to_botpress`; tiempo 3761 ms.

Decisión persistida: `{"turnId": "b651cca0-b587-4363-99ce-83b71d4bae17", "outboundId": "9f9c680a-b633-4444-a962-a7fbe8f2d0be", "createdAt": "2026-09-04T14:36:02.139Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:36:02.193Z · adaptive-rule-based-v1

Fuente `workflow-adaptive-sale-2026-09-04T14-36-15-201Z-06565fb9-c40f-46bd-b8fa-3c0e9cea0a52.json.gz`; trace `8da49fe9-9b71-47b5-964a-bdc6a0f2f17a`; turno `448b335d-2ad3-46d0-ae07-1168a8adc5d9`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360, y podés elegir entre 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
> ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar?

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360, y podés elegir entre 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
>
> ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar?

Outbound `9ccabcb6-4703-47b3-993c-15946595dcbe`; delivery `submitted_to_botpress`; tiempo 3859 ms.

Decisión persistida: `{"turnId": "448b335d-2ad3-46d0-ae07-1168a8adc5d9", "outboundId": "9ccabcb6-4703-47b3-993c-15946595dcbe", "createdAt": "2026-09-04T14:36:06.018Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:36:06.053Z · adaptive-rule-based-v1

Fuente `workflow-adaptive-sale-2026-09-04T14-36-15-201Z-06565fb9-c40f-46bd-b8fa-3c0e9cea0a52.json.gz`; trace `512795b5-8ac0-4488-ae9b-8863fc1080a5`; turno `52ca2275-f429-445a-9913-36e4d1c0f73b`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 queda registrada. ¿Querés avanzar con esa opción para dejarlo listo?

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': 'monthly_6', 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 queda registrada. ¿Querés avanzar con esa opción para dejarlo listo?

Outbound `1bf695c5-ca45-43eb-9cb4-395d2432ad65`; delivery `submitted_to_botpress`; tiempo 3532 ms.

Decisión persistida: `{"turnId": "52ca2275-f429-445a-9913-36e4d1c0f73b", "outboundId": "1bf695c5-ca45-43eb-9cb4-395d2432ad65", "createdAt": "2026-09-04T14:36:09.551Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:36:09.587Z · adaptive-rule-based-v1

Fuente `workflow-adaptive-sale-2026-09-04T14-36-15-201Z-06565fb9-c40f-46bd-b8fa-3c0e9cea0a52.json.gz`; trace `ee5b45db-53bf-476a-9806-f636ff74cd2b`; turno `584ce015-dbd0-4ada-a6e8-f2a0364f2449`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> ¡Genial! Para dejarlo listo necesito tus datos: nombre, apellido, correo electrónico y teléfono.

Movimiento `request_payment_link`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Genial! Para dejarlo listo necesito tus datos: nombre, apellido, correo electrónico y teléfono.

Outbound `fc39c5a0-b8aa-4a8e-82bb-885ad7ebda9e`; delivery `submitted_to_botpress`; tiempo 2747 ms.

Decisión persistida: `{"turnId": "584ce015-dbd0-4ada-a6e8-f2a0364f2449", "outboundId": "fc39c5a0-b8aa-4a8e-82bb-885ad7ebda9e", "createdAt": "2026-09-04T14:36:12.306Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:36:12.335Z · adaptive-rule-based-v1

Fuente `workflow-adaptive-sale-2026-09-04T14-36-15-201Z-06565fb9-c40f-46bd-b8fa-3c0e9cea0a52.json.gz`; trace `956e48a1-0ff7-4c19-b3bf-e1c3e3633bda`; turno `e2e7c25f-1888-47ca-ab19-5a3ccd3776d8`.

Cliente: Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

Propuesta del modelo antes de validar:
> ¡Gracias, Camila! Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Camila! Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `52000e44-b61b-487d-951e-9b3ca3060279`; delivery `submitted_to_botpress`; tiempo 2849 ms.

Decisión persistida: `{"turnId": "e2e7c25f-1888-47ca-ab19-5a3ccd3776d8", "outboundId": "52000e44-b61b-487d-951e-9b3ca3060279", "createdAt": "2026-09-04T14:36:15.158Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v15", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:42:42.498Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-43-12-398Z-2b23d063-80ef-4841-9f4b-5b7411dbca6f.json.gz`; trace `c6ef0b10-eeae-4109-97ec-71025eeb5514`; turno `0b0ba93a-6e2d-4433-a3a1-beb1726446af`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Redes Informáticas.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `2bd29001-24e8-4466-aa51-7546038490c5`; delivery `submitted_to_botpress`; tiempo 4239 ms.

Decisión persistida: `{"turnId": "0b0ba93a-6e2d-4433-a3a1-beb1726446af", "outboundId": "2bd29001-24e8-4466-aa51-7546038490c5", "createdAt": "2026-09-04T14:42:46.699Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:42:46.739Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-43-12-398Z-2b23d063-80ef-4841-9f4b-5b7411dbca6f.json.gz`; trace `784d0188-8e50-4ef6-ac65-30acdc28e6ff`; turno `12d51304-1080-4a18-b524-7b22987b0848`.

Cliente: Prefiero no hablar por teléfono, sigamos por acá

Propuesta del modelo antes de validar:
> ¡Perfecto, seguimos por acá sin problema! 👍
>
> Para contarte bien cómo funciona Redes Informáticas, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, seguimos por acá sin problema! 👍

Outbound `467bc60c-facf-4ab9-b72c-d0f5b7e45445`; delivery `submitted_to_botpress`; tiempo 3500 ms.

Decisión persistida: `{"turnId": "12d51304-1080-4a18-b524-7b22987b0848", "outboundId": "467bc60c-facf-4ab9-b72c-d0f5b7e45445", "createdAt": "2026-09-04T14:42:50.200Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:42:50.240Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-43-12-398Z-2b23d063-80ef-4841-9f4b-5b7411dbca6f.json.gz`; trace `8fa704ad-b6b9-40da-a19b-9bcaa23edf36`; turno `e0838e81-8e03-4ad8-85b6-91d4cc774298`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360.
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Outbound `c6bfad46-b59c-4955-821e-5d6878d1d539`; delivery `submitted_to_botpress`; tiempo 3196 ms.

Decisión persistida: `{"turnId": "e0838e81-8e03-4ad8-85b6-91d4cc774298", "outboundId": "c6bfad46-b59c-4955-821e-5d6878d1d539", "createdAt": "2026-09-04T14:42:53.417Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:42:53.438Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-43-12-398Z-2b23d063-80ef-4841-9f4b-5b7411dbca6f.json.gz`; trace `9b8f9eec-c4a4-46b1-82a5-a9ddfedbbae1`; turno `b21507c0-4808-480c-8474-23530fba4d9a`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
> ¿Cuál de las tres opciones te resulta más cómoda para avanzar?

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
>
> ¿Cuál de las tres opciones te resulta más cómoda para avanzar?

Outbound `8ecc3ae7-9ac4-4010-969f-a970bc08e63b`; delivery `submitted_to_botpress`; tiempo 3338 ms.

Decisión persistida: `{"turnId": "b21507c0-4808-480c-8474-23530fba4d9a", "outboundId": "8ecc3ae7-9ac4-4010-969f-a970bc08e63b", "createdAt": "2026-09-04T14:42:56.745Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:42:56.777Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-43-12-398Z-2b23d063-80ef-4841-9f4b-5b7411dbca6f.json.gz`; trace `e43b272f-dfed-4267-807a-d5679c771826`; turno `c24f6f88-a3f6-4657-8a47-d2ee53ed706d`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> ¡Perfecto! Quedó elegido el plan de 6 pagos mensuales de USD 60. ¿Querés que avancemos con eso para dejarlo registrado?

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': 'monthly_6', 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! Quedó elegido el plan de 6 pagos mensuales de USD 60. ¿Querés que avancemos con eso para dejarlo registrado?

Outbound `aeb0c183-23b3-4e73-84e3-f13a27261b26`; delivery `submitted_to_botpress`; tiempo 2933 ms.

Decisión persistida: `{"turnId": "c24f6f88-a3f6-4657-8a47-d2ee53ed706d", "outboundId": "aeb0c183-23b3-4e73-84e3-f13a27261b26", "createdAt": "2026-09-04T14:42:59.674Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:42:59.711Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-43-12-398Z-2b23d063-80ef-4841-9f4b-5b7411dbca6f.json.gz`; trace `e5367a0a-e42c-4ebf-b56c-2a6c8ddaee5a`; turno `574da5c5-0395-42a1-a960-ea7a2464261f`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
> ¿Cuál de las tres opciones te resulta más cómoda para avanzar?

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.
>
> ¿Cuál de las tres opciones te resulta más cómoda para avanzar?

Outbound `d52294a7-bf1b-454e-96c2-9ad567f38598`; delivery `submitted_to_botpress`; tiempo 3174 ms.

Decisión persistida: `{"turnId": "574da5c5-0395-42a1-a960-ea7a2464261f", "outboundId": "d52294a7-bf1b-454e-96c2-9ad567f38598", "createdAt": "2026-09-04T14:43:02.851Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:43:02.886Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-43-12-398Z-2b23d063-80ef-4841-9f4b-5b7411dbca6f.json.gz`; trace `5d0d931a-f845-45f4-939e-f24362f987b7`; turno `06034682-d57f-438d-90f5-3b679cb68749`.

Cliente: Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

Propuesta del modelo antes de validar:
> ¡Perfecto, Camila! Quedó registrado tu plan de 6 pagos mensuales de USD 60. Te envío el link de pago por acá.

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> ¡Gracias, Camila! Quedó registrado tu plan de 6 pagos mensuales de USD 60. Cuando quieras avanzar con el pago, avisame y te comparto el link.

Movimiento `provide_contact_details`; acción `{'type': 'none'}`; repair_of `{'rejection_id': 'b1ccc253-a1b2-40d3-8916-886506708db2', 'attempt': 1}`.

Salida autorizada y capturada:
> ¡Gracias, Camila! Quedó registrado tu plan de 6 pagos mensuales de USD 60. Cuando quieras avanzar con el pago, avisame y te comparto el link.

Outbound `78c1613c-8801-4c6f-8f09-a7d5dbb76748`; delivery `submitted_to_botpress`; tiempo 6121 ms.

Decisión persistida: `{"turnId": "06034682-d57f-438d-90f5-3b679cb68749", "outboundId": "78c1613c-8801-4c6f-8f09-a7d5dbb76748", "createdAt": "2026-09-04T14:43:08.971Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:43:09.037Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-43-12-398Z-2b23d063-80ef-4841-9f4b-5b7411dbca6f.json.gz`; trace `31915c60-5e6a-4b38-9490-e25956d84054`; turno `70e009a2-3f33-4012-8bba-ff6701f3241f`.

Cliente: Sí, ahora mandame el link de las seis cuotas

Propuesta del modelo antes de validar:
> ¡Perfecto, Camila! Te comparto el link de pago para las 6 cuotas de USD 60. Cuando hagas el pago, avisame por acá.

Movimiento `request_payment_link`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Camila! Te comparto el link de pago para las 6 cuotas de USD 60. Cuando hagas el pago, avisame por acá.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `61f9a104-0a82-4e44-b642-a8d55454b49c`; delivery `submitted_to_botpress`; tiempo 3349 ms.

Decisión persistida: `{"turnId": "70e009a2-3f33-4012-8bba-ff6701f3241f", "outboundId": "61f9a104-0a82-4e44-b642-a8d55454b49c", "createdAt": "2026-09-04T14:43:12.346Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:50:42.383Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `5aa66ef6-a0f1-4d6d-a8a8-4843ea6ce6af`; turno `788de194-db87-4ae3-9614-5a5343fad41d`.

Cliente: Hola, quería saber qué formaciones tienen en tecnología

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesoría educativa. En tecnología tenemos la formación en Armado y Reparación de PC, dentro de nuestra Academia de Oficios. ¿Ya tenías pensado estudiar algo de esto o recién estás empezando a averiguar?

Movimiento `browse_catalog`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesoría educativa. En tecnología tenemos la formación en Armado y Reparación de PC, dentro de nuestra Academia de Oficios. ¿Ya tenías pensado estudiar algo de esto o recién estás empezando a averiguar?

Outbound `fd73faca-1e01-4c7c-8910-136e8fb6fcd0`; delivery `submitted_to_botpress`; tiempo 3520 ms.

Decisión persistida: `{"turnId": "788de194-db87-4ae3-9614-5a5343fad41d", "outboundId": "fd73faca-1e01-4c7c-8910-136e8fb6fcd0", "createdAt": "2026-09-04T14:50:45.838Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:50:45.905Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `9c57dc64-f558-4394-be2d-d79c27dca57c`; turno `67ede004-b3f0-40f5-9325-9ad7d644b0b7`.

Cliente: Me tienta la de Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Buena elección! Redes Informáticas es parte de nuestra Academia de Oficios y son 16 clases donde vas a entender cómo funcionan las redes y cada uno de los dispositivos que las componen. ¿Ya tenés conocimientos previos en el tema o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Buena elección! Redes Informáticas es parte de nuestra Academia de Oficios y son 16 clases donde vas a entender cómo funcionan las redes y cada uno de los dispositivos que las componen. ¿Ya tenés conocimientos previos en el tema o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `c4b4af61-f2b6-4130-813c-60996381c8b0`; delivery `submitted_to_botpress`; tiempo 3728 ms.

Decisión persistida: `{"turnId": "67ede004-b3f0-40f5-9325-9ad7d644b0b7", "outboundId": "c4b4af61-f2b6-4130-813c-60996381c8b0", "createdAt": "2026-09-04T14:50:49.606Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:50:49.635Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `ee7386a4-9645-4446-b2c0-bdbee4ec8cdb`; turno `1a73e1ae-2818-4e7b-915b-b625a2ebea83`.

Cliente: Pensándolo mejor, prefiero Excel Integral

Propuesta del modelo antes de validar:
> ¡Perfecto! Excel Integral es de nuestra Academia de Negocios y son 17 clases donde vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. ¿Ya tenés conocimientos previos en Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! Excel Integral es de nuestra Academia de Negocios y son 17 clases donde vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. ¿Ya tenés conocimientos previos en Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `2df04a84-c4c7-424d-9467-409704c22be3`; delivery `submitted_to_botpress`; tiempo 3375 ms.

Decisión persistida: `{"turnId": "1a73e1ae-2818-4e7b-915b-b625a2ebea83", "outboundId": "2df04a84-c4c7-424d-9467-409704c22be3", "createdAt": "2026-09-04T14:50:52.983Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:50:53.011Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `d9df02e9-0361-4d5b-a72a-e8fc1ba7598c`; turno `98916aaa-1449-41a4-bdbb-c663fb27aeab`.

Cliente: ¿?

Propuesta del modelo antes de validar:
> ¿Tenés alguna duda puntual sobre Excel Integral o querés que te cuente cómo funciona el curso?

Movimiento `unknown`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¿Tenés alguna duda puntual sobre Excel Integral o querés que te cuente cómo funciona el curso?

Outbound `21318f6a-1fb2-443e-b19f-6d418649b2ed`; delivery `submitted_to_botpress`; tiempo 3006 ms.

Decisión persistida: `{"turnId": "98916aaa-1449-41a4-bdbb-c663fb27aeab", "outboundId": "21318f6a-1fb2-443e-b19f-6d418649b2ed", "createdAt": "2026-09-04T14:50:55.983Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:50:56.044Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `682b6dae-3ffd-441b-9a0a-c9625bac00cc`; turno `b7344af9-d3ba-48b4-95b0-104e248910d0`.

Cliente: Buenas, me interesa Maquillaje Profesional

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con el curso de Maquillaje Profesional.

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con el curso de Maquillaje Profesional.
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

Outbound `f2c075c8-a92d-4f56-abaf-a42b1db2898b`; delivery `submitted_to_botpress`; tiempo 3514 ms.

Decisión persistida: `{"turnId": "b7344af9-d3ba-48b4-95b0-104e248910d0", "outboundId": "f2c075c8-a92d-4f56-abaf-a42b1db2898b", "createdAt": "2026-09-04T14:50:59.532Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:50:59.560Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `ad434cf9-892d-4ecc-a6f3-d57b400ff9ae`; turno `a1b29be0-003e-43b3-b6ba-8c5da260f704`.

Cliente: Uf, me parece bastante plata la verdad

Propuesta del modelo antes de validar:
> Te entiendo. La buena noticia es que podés elegir cómo pagarlo: 12 pagos mensuales de USD 30, 6 pagos de USD 60 o un pago único de USD 360. El total es el mismo en las tres opciones, así que podés acomodarlo a tu presupuesto.

Movimiento `{'schema_version': 1, 'move': 'ask_payment_options', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': None, 'confidence': 0.9}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Te entiendo. La buena noticia es que podés elegir cómo pagarlo: 12 pagos mensuales de USD 30, 6 pagos de USD 60 o un pago único de USD 360. El total es el mismo en las tres opciones, así que podés acomodarlo a tu presupuesto.

Outbound `3ba90e62-6e4e-4391-be00-11a4ee8386d2`; delivery `submitted_to_botpress`; tiempo 3566 ms.

Decisión persistida: `{"turnId": "a1b29be0-003e-43b3-b6ba-8c5da260f704", "outboundId": "3ba90e62-6e4e-4391-be00-11a4ee8386d2", "createdAt": "2026-09-04T14:51:03.085Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:03.128Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `f84b79cf-cfa5-4dd7-811f-38c2cf7b2f3d`; turno `0a36e081-85c5-4aae-aaeb-07e187b4713a`.

Cliente: No me llames por favor, sigamos escribiendo

Propuesta del modelo antes de validar:
> Perfecto, seguimos por acá sin problema. 😊 ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar: 12 pagos de USD 30, 6 pagos de USD 60 o el pago único de USD 360?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, seguimos por acá sin problema. 😊 ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar: 12 pagos de USD 30, 6 pagos de USD 60 o el pago único de USD 360?

Outbound `651160d0-abcf-40c2-a69c-808c7bca441c`; delivery `submitted_to_botpress`; tiempo 3392 ms.

Decisión persistida: `{"turnId": "0a36e081-85c5-4aae-aaeb-07e187b4713a", "outboundId": "651160d0-abcf-40c2-a69c-808c7bca441c", "createdAt": "2026-09-04T14:51:06.499Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:06.521Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `9c23cab9-55c3-4647-a358-10ab0209e7b4`; turno `28ea7577-1264-4eae-92bf-101711e58f5b`.

Cliente: ¿Y la cuota más baja de cuánto sería?

Propuesta del modelo antes de validar:
> La opción de menor cuota es la de 12 pagos mensuales de USD 30. También tenés 6 pagos de USD 60 o un pago único de USD 360.

Movimiento `{'schema_version': 1, 'move': 'ask_payment_options', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': None, 'confidence': 0.98}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> La opción de menor cuota es la de 12 pagos mensuales de USD 30. También tenés 6 pagos de USD 60 o un pago único de USD 360.

Outbound `69abad32-7743-40bc-aa72-8e41a3060aab`; delivery `submitted_to_botpress`; tiempo 3152 ms.

Decisión persistida: `{"turnId": "28ea7577-1264-4eae-92bf-101711e58f5b", "outboundId": "69abad32-7743-40bc-aa72-8e41a3060aab", "createdAt": "2026-09-04T14:51:09.638Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:09.696Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `4f64f7af-809d-47ca-a22b-7c70eb14e629`; turno `daf9a849-7e16-455f-9138-8c6e6a6c4420`.

Cliente: Quiero anotarme en Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con tu inscripción en Redes Informáticas.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con tu inscripción en Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `503949c2-7610-419f-ae41-8ab88d316937`; delivery `submitted_to_botpress`; tiempo 3374 ms.

Decisión persistida: `{"turnId": "daf9a849-7e16-455f-9138-8c6e6a6c4420", "outboundId": "503949c2-7610-419f-ae41-8ab88d316937", "createdAt": "2026-09-04T14:51:13.036Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:13.071Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `12f8d82b-2fa4-40f4-84e1-ce4f0adf9d35`; turno `e6a0b7e4-9182-4fed-b04f-ad9996b2dd1a`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> Perfecto, te dejo anotado el plan de 6 pagos mensuales de USD 60. El total del programa es USD 360 en cualquiera de las opciones.
> ¿Querés avanzar con la inscripción para que te envíe el link de pago?

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': 'monthly_6', 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, te dejo anotado el plan de 6 pagos mensuales de USD 60. El total del programa es USD 360 en cualquiera de las opciones.
>
> ¿Querés avanzar con la inscripción para que te envíe el link de pago?

Outbound `5704603e-9b6f-41f1-9903-1580e07673cf`; delivery `submitted_to_botpress`; tiempo 3432 ms.

Decisión persistida: `{"turnId": "e6a0b7e4-9182-4fed-b04f-ad9996b2dd1a", "outboundId": "5704603e-9b6f-41f1-9903-1580e07673cf", "createdAt": "2026-09-04T14:51:16.465Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:16.505Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `d09d7b43-eefb-4cca-b107-f8062ff5bdb6`; turno `057c65b4-a43e-4cfc-8349-618038fe26f4`.

Cliente: Igual esta semana no puedo, lo dejo para el lunes

Propuesta del modelo antes de validar:
> Tranquilo/a, no hay problema. Queda anotado tu plan de 6 pagos mensuales de USD 60, y cuando quieras avanzar el lunes, me escribís por acá y te paso el link de pago.

Movimiento `defer_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tranquilo/a, no hay problema. Queda anotado tu plan de 6 pagos mensuales de USD 60, y cuando quieras avanzar el lunes, me escribís por acá y te paso el link de pago.

Outbound `618a158f-7481-4111-904d-05798b27319f`; delivery `submitted_to_botpress`; tiempo 3557 ms.

Decisión persistida: `{"turnId": "057c65b4-a43e-4cfc-8349-618038fe26f4", "outboundId": "618a158f-7481-4111-904d-05798b27319f", "createdAt": "2026-09-04T14:51:19.874Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:20.063Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `93397eca-92a8-4e4e-b50f-d9b5f3800a07`; turno `c319c881-87cd-4135-921b-272b765963f1`.

Cliente: Ya está, mandame el link. Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

Propuesta del modelo antes de validar:
> ¡Perfecto, Lucía! Ya quedó registrado tu plan de 6 pagos mensuales de USD 60. Te envío el link de pago ahora mismo.

Movimiento `request_payment_link`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Lucía! Ya quedó registrado tu plan de 6 pagos mensuales de USD 60. Te envío el link de pago ahora mismo.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `00b70233-02e3-4cd3-bf71-c277fd85f9f8`; delivery `submitted_to_botpress`; tiempo 2945 ms.

Decisión persistida: `{"turnId": "c319c881-87cd-4135-921b-272b765963f1", "outboundId": "00b70233-02e3-4cd3-bf71-c277fd85f9f8", "createdAt": "2026-09-04T14:51:22.968Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:23.032Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `3c543ed5-e8db-40bd-8f73-18a07cbdf5b6`; turno `5b7b8f99-89cf-4c13-a010-ef6e7a9c2f56`.

Cliente: Me anoto en Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente elección! Excel Integral es parte de la Academia de Negocios y en 17 clases vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. 😊
> Para recomendarte lo mejor, contame: ¿ya tenés conocimientos previos de Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente elección! Excel Integral es parte de la Academia de Negocios y en 17 clases vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. 😊
>
> Para recomendarte lo mejor, contame: ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

Outbound `ed4a6690-1b66-4333-9eb4-e928eafec61a`; delivery `submitted_to_botpress`; tiempo 3599 ms.

Decisión persistida: `{"turnId": "5b7b8f99-89cf-4c13-a010-ef6e7a9c2f56", "outboundId": "ed4a6690-1b66-4333-9eb4-e928eafec61a", "createdAt": "2026-09-04T14:51:26.614Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:26.632Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `4df49d57-140b-4da3-b5d8-bf1a633baaac`; turno `9137b18e-0ad2-46a2-a03c-3ebb2787b1d5`.

Cliente: Ya hice la transferencia recién

Propuesta del modelo antes de validar:
> Gracias por avisarme. Dejo registrado tu aviso de pago para que el equipo lo revise y, si está acreditado, gestione tu acceso.

Movimiento `{'schema_version': 1, 'move': 'report_payment', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': None, 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Gracias por avisarme. Dejo registrado tu aviso de pago para que el equipo lo revise y, si está acreditado, gestione tu acceso.

Outbound `e09bd426-3110-4373-b3b4-b9c45669df9f`; delivery `submitted_to_botpress`; tiempo 3014 ms.

Decisión persistida: `{"turnId": "9137b18e-0ad2-46a2-a03c-3ebb2787b1d5", "outboundId": "e09bd426-3110-4373-b3b4-b9c45669df9f", "createdAt": "2026-09-04T14:51:29.623Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:29.648Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T14-51-32-550Z-3012eb67-bbed-4231-a85c-a9e89fd9d2e5.json.gz`; trace `ed6a1eb7-4194-459f-8601-d2171b3dea8f`; turno `2bafcc4e-98a8-4613-ab90-039eead254cb`.

Cliente: ¿Entonces ya quedé inscripta?

Propuesta del modelo antes de validar:
> Tu aviso de pago quedó registrado para revisión del equipo. La inscripción se confirma cuando el pago esté acreditado; en ese momento gestionarán tu acceso.

Movimiento `ask_current_state`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tu aviso de pago quedó registrado para revisión del equipo. en ese momento gestionarán tu acceso.

Outbound `fbf75d2f-6339-4c0c-91e8-5ad67fc375d4`; delivery `submitted_to_botpress`; tiempo 2882 ms.

Decisión persistida: `{"turnId": "2bafcc4e-98a8-4613-ab90-039eead254cb", "outboundId": "fbf75d2f-6339-4c0c-91e8-5ad67fc375d4", "createdAt": "2026-09-04T14:51:32.483Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:32.567Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T14-51-46-243Z-13ff04f7-81a1-4c82-adc4-cc57915a3eb1.json.gz`; trace `43bec63c-35cd-41da-bde0-7374a5955ba0`; turno `7b72155a-98a4-4014-a7db-0bd0657248a4`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu consulta sobre Redes Informáticas.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu consulta sobre Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `db484ca6-0901-4be0-98d5-582195bed2ea`; delivery `submitted_to_botpress`; tiempo 3206 ms.

Decisión persistida: `{"turnId": "7b72155a-98a4-4014-a7db-0bd0657248a4", "outboundId": "db484ca6-0901-4be0-98d5-582195bed2ea", "createdAt": "2026-09-04T14:51:35.751Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:35.774Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T14-51-46-243Z-13ff04f7-81a1-4c82-adc4-cc57915a3eb1.json.gz`; trace `e1f80bfc-c35a-4dee-8ed9-24ce482ac7c5`; turno `585ce879-a413-4abc-9ec8-e1f0dd7f66d6`.

Cliente: Prefiero no hablar por teléfono, seguimos por chat

Propuesta del modelo antes de validar:
> ¡Perfecto, seguimos por chat! 😊
> Para contarte mejor sobre Redes Informáticas, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, seguimos por chat! 😊

Outbound `2e07519f-3db4-41fc-816b-f79f083380ad`; delivery `submitted_to_botpress`; tiempo 3354 ms.

Decisión persistida: `{"turnId": "585ce879-a413-4abc-9ec8-e1f0dd7f66d6", "outboundId": "2e07519f-3db4-41fc-816b-f79f083380ad", "createdAt": "2026-09-04T14:51:39.091Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:39.129Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T14-51-46-243Z-13ff04f7-81a1-4c82-adc4-cc57915a3eb1.json.gz`; trace `978e6372-638e-4e62-a124-7862ff7b7a58`; turno `5ceb4a6e-0453-4a02-921b-bb278f6bb999`.

Cliente: Contame más del contenido

Propuesta del modelo antes de validar:
> Claro, te cuento. En Redes Informáticas vas a conocer cómo funcionan las redes y cada uno de los elementos y dispositivos que las componen, a lo largo de 16 clases prácticas.
> Es 100% online y en español. ¿Te gustaría que te cuente también cómo se cursa y qué incluye?

Movimiento `ask_course_information`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Claro, te cuento. En Redes Informáticas vas a conocer cómo funcionan las redes y cada uno de los elementos y dispositivos que las componen, a lo largo de 16 clases prácticas.
>
> Es 100% online y en español. ¿Te gustaría que te cuente también cómo se cursa y qué incluye?

Outbound `8f967f54-ab2e-4599-98cf-ca13606f0fbe`; delivery `submitted_to_botpress`; tiempo 3524 ms.

Decisión persistida: `{"turnId": "5ceb4a6e-0453-4a02-921b-bb278f6bb999", "outboundId": "8f967f54-ab2e-4599-98cf-ca13606f0fbe", "createdAt": "2026-09-04T14:51:42.632Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:42.654Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T14-51-46-243Z-13ff04f7-81a1-4c82-adc4-cc57915a3eb1.json.gz`; trace `958c34ea-cd1b-4795-a004-ab0b341879f9`; turno `d858b0da-7dbb-4b12-aa0f-91f3f9aff1a7`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360.
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Outbound `76c9a8cc-90a7-4018-8454-5bbb910b449d`; delivery `submitted_to_botpress`; tiempo 3571 ms.

Decisión persistida: `{"turnId": "d858b0da-7dbb-4b12-aa0f-91f3f9aff1a7", "outboundId": "76c9a8cc-90a7-4018-8454-5bbb910b449d", "createdAt": "2026-09-04T14:51:46.187Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:46.494Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `0ba37931-e78b-45eb-827f-d872c2c5eca8`; turno `610e71f4-97ef-43f9-b9e9-7b1863d1641f`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con el curso de Redes Informáticas. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con el curso de Redes Informáticas. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

Outbound `fca0e93a-dc3e-4b7f-b6c2-6abce429a8a2`; delivery `submitted_to_botpress`; tiempo 3646 ms.

Decisión persistida: `{"turnId": "610e71f4-97ef-43f9-b9e9-7b1863d1641f", "outboundId": "fca0e93a-dc3e-4b7f-b6c2-6abce429a8a2", "createdAt": "2026-09-04T14:51:50.111Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:50.141Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `476b565e-18d2-4203-9212-6c070c5c6611`; turno `10fc61dd-bff4-4c2f-80a9-26746f412f4b`.

Cliente: Pensándolo mejor prefiero Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente elección! Excel Integral es de la Academia de Negocios y son 17 clases 100% online. Vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. ¿Ya tenés experiencia con Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente elección! Excel Integral es de la Academia de Negocios y son 17 clases 100% online. Vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. ¿Ya tenés experiencia con Excel o partís desde cero?

Outbound `5df8d08f-685f-4f35-82fe-800ec090e7d2`; delivery `submitted_to_botpress`; tiempo 3464 ms.

Decisión persistida: `{"turnId": "10fc61dd-bff4-4c2f-80a9-26746f412f4b", "outboundId": "5df8d08f-685f-4f35-82fe-800ec090e7d2", "createdAt": "2026-09-04T14:51:53.571Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:53.606Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `406b61d9-009c-415f-b6c3-ed94fa908399`; turno `6ef31ad1-e528-457c-9d27-a610af08573b`.

Cliente: ¿Y qué se aprende ahí?

Propuesta del modelo antes de validar:
> En Excel Integral vas a dominar desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. Son 17 clases 100% online, en español, y avanzás a tu ritmo. ¿Ya tenés experiencia con Excel o partís desde cero?

Movimiento `ask_course_information`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> En Excel Integral vas a dominar desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información. Son 17 clases 100% online, en español, y avanzás a tu ritmo.
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

Outbound `15296113-7fb0-4874-90e3-883e7377b518`; delivery `submitted_to_botpress`; tiempo 3434 ms.

Decisión persistida: `{"turnId": "6ef31ad1-e528-457c-9d27-a610af08573b", "outboundId": "15296113-7fb0-4874-90e3-883e7377b518", "createdAt": "2026-09-04T14:51:57.022Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:51:57.058Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `cb44e651-af43-44e6-bd32-9a59f1a04c98`; turno `1dc41ade-0210-4e79-be02-a1d105a05f37`.

Cliente: Me interesa Maquillaje Profesional

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Maquillaje Profesional. ¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Maquillaje Profesional. ¿Ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles.

Outbound `bf810769-7158-4308-87b6-db8fb6242007`; delivery `submitted_to_botpress`; tiempo 3877 ms.

Decisión persistida: `{"turnId": "1dc41ade-0210-4e79-be02-a1d105a05f37", "outboundId": "bf810769-7158-4308-87b6-db8fb6242007", "createdAt": "2026-09-04T14:52:00.907Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:00.936Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `dc5b4afa-0336-4cf3-b0fb-1a2eace30939`; turno `9308b87f-629d-44fb-9d34-bd3eacc3d41a`.

Cliente: No quiero que me llamen, prefiero por chat

Propuesta del modelo antes de validar:
> ¡Perfecto, seguimos por chat sin problema! 😊 Para orientarte mejor: ¿ya tenías pensado estudiar maquillaje o recién estás empezando a averiguar?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, seguimos por chat sin problema!

Outbound `9035346a-81a2-40fb-8f6b-1a19e6048a8f`; delivery `submitted_to_botpress`; tiempo 3604 ms.

Decisión persistida: `{"turnId": "9308b87f-629d-44fb-9d34-bd3eacc3d41a", "outboundId": "9035346a-81a2-40fb-8f6b-1a19e6048a8f", "createdAt": "2026-09-04T14:52:04.508Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:04.541Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `064ffa02-6bfb-4d40-b796-cf34e1b8c387`; turno `52e82278-8371-4bdf-b4bf-493505d9ef07`.

Cliente: Contame cómo se cursa

Propuesta del modelo antes de validar:
> El curso de Maquillaje Profesional es 100% online y en español. Son 38 clases con material de lectura, videos explicativos y ejercicios prácticos, y podés avanzar a tu ritmo con acceso a la plataforma 24/7.
> Además contás con profesores disponibles por chat para consultas y un certificado al finalizar. ¿Te gustaría que te cuente las opciones de pago?

Movimiento `ask_course_information`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El curso de Maquillaje Profesional es 100% online y en español. Son 38 clases con material de lectura, videos explicativos y ejercicios prácticos, y podés avanzar a tu ritmo con acceso a la plataforma 24/7.
>
> Además contás con profesores disponibles por chat para consultas y un certificado al finalizar. ¿Te gustaría que te cuente las opciones de pago?

Outbound `a1692568-b657-4677-830a-a7891ddabf79`; delivery `submitted_to_botpress`; tiempo 3852 ms.

Decisión persistida: `{"turnId": "52e82278-8371-4bdf-b4bf-493505d9ef07", "outboundId": "a1692568-b657-4677-830a-a7891ddabf79", "createdAt": "2026-09-04T14:52:08.349Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:08.395Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `75bcaef9-23a7-4389-a338-68444a5a02f2`; turno `2179d60c-c2d4-4ea4-b817-62fa70502c7c`.

Cliente: ¿Y cuánto cuesta?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360.
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Movimiento `{'schema_version': 1, 'move': 'ask_payment_options', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': None, 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Outbound `be973883-aa8b-41ef-833a-5ec4acc78852`; delivery `submitted_to_botpress`; tiempo 3546 ms.

Decisión persistida: `{"turnId": "2179d60c-c2d4-4ea4-b817-62fa70502c7c", "outboundId": "be973883-aa8b-41ef-833a-5ec4acc78852", "createdAt": "2026-09-04T14:52:11.916Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:11.959Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `d26337bf-7a52-4fe0-a69c-2b58334a3114`; turno `50064a48-5f51-4c5f-810b-a42ca6e34dcd`.

Cliente: Quiero Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu consulta sobre Redes Informáticas.
> Este curso de 16 clases te permite conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen. Antes de contarte más, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu consulta sobre Redes Informáticas.
>
> Este curso de 16 clases te permite conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen. Antes de contarte más, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `8a0dcda3-e65c-4577-8c21-0ee170e642b2`; delivery `submitted_to_botpress`; tiempo 3799 ms.

Decisión persistida: `{"turnId": "50064a48-5f51-4c5f-810b-a42ca6e34dcd", "outboundId": "8a0dcda3-e65c-4577-8c21-0ee170e642b2", "createdAt": "2026-09-04T14:52:15.736Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:15.759Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `ce3bcbda-ebba-48ad-89ad-4b12d3a1474e`; turno `85f280d9-38c8-40bf-b4f1-f08c60616b7f`.

Cliente: Me quedo con el pago único

Propuesta del modelo antes de validar:
> Perfecto, el pago único de USD 360 queda elegido. ¿Querés que avancemos con el registro para enviarte el link de pago?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, el pago único de USD 360 queda elegido. ¿Querés que avancemos con el registro para enviarte el link de pago?

Outbound `8945ca3c-1ff8-494e-9f6d-467f5281f0bd`; delivery `submitted_to_botpress`; tiempo 2835 ms.

Decisión persistida: `{"turnId": "85f280d9-38c8-40bf-b4f1-f08c60616b7f", "outboundId": "8945ca3c-1ff8-494e-9f6d-467f5281f0bd", "createdAt": "2026-09-04T14:52:18.554Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:18.595Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `f04cfeb3-3af5-4ac7-b50b-93ac28a39052`; turno `2e3658b5-963e-45d9-9e22-ec91bba9c30c`.

Cliente: Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

Propuesta del modelo antes de validar:
> ¡Gracias, Lucía! Ya tengo registrados tu nombre, correo y teléfono. Te envío el link de pago para el pago único de USD 360.

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'one_time'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> ¡Gracias, Lucía! Quedó registrado tu nombre, correo y teléfono. En cuanto confirmes que querés avanzar con el pago único de USD 360, te envío el link por acá.

Movimiento `provide_contact_details`; acción `{'type': 'none'}`; repair_of `{'rejection_id': '5f6344c2-ab89-4cb5-ac3c-5ba94fa3f10f', 'attempt': 1}`.

Salida autorizada y capturada:
> ¡Gracias, Lucía! Quedó registrado tu nombre, correo y teléfono. En cuanto confirmes que querés avanzar con el pago único de USD 360, te envío el link por acá.

Outbound `4de8687a-a853-4efd-899e-5dcbebf56675`; delivery `submitted_to_botpress`; tiempo 6007 ms.

Decisión persistida: `{"turnId": "2e3658b5-963e-45d9-9e22-ec91bba9c30c", "outboundId": "4de8687a-a853-4efd-899e-5dcbebf56675", "createdAt": "2026-09-04T14:52:24.566Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:24.624Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `4150ea8a-a9aa-4ac6-812c-2b80ef0de2ec`; turno `c64c4b77-a195-4b62-bdb7-d24ab6d2354a`.

Cliente: Quiero anotarme en Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a. Veo que te interesa Redes Informáticas, ¡excelente elección! Para orientarte mejor: ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `{'schema_version': 1, 'move': 'select_course', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': None, 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a. Veo que te interesa Redes Informáticas, ¡excelente elección! Para orientarte mejor: ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.

Outbound `87cd4527-6bf1-4f50-b60f-716a52bb3679`; delivery `submitted_to_botpress`; tiempo 3733 ms.

Decisión persistida: `{"turnId": "c64c4b77-a195-4b62-bdb7-d24ab6d2354a", "outboundId": "87cd4527-6bf1-4f50-b60f-716a52bb3679", "createdAt": "2026-09-04T14:52:28.322Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:28.359Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `f0b57fc5-25a5-4fcc-91c6-b76e5110d7ff`; turno `12ff54a1-4865-474f-b685-cd3d1b3aa7b7`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> ¡Perfecto! Elegís 6 pagos mensuales de USD 60, el total del programa es USD 360. ¿Querés que avancemos con la inscripción?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! Elegís 6 pagos mensuales de USD 60, el total del programa es USD 360. ¿Querés que avancemos con la inscripción?

Outbound `716fdf78-8c02-4db7-98f0-587bfa379807`; delivery `submitted_to_botpress`; tiempo 3426 ms.

Decisión persistida: `{"turnId": "12ff54a1-4865-474f-b685-cd3d1b3aa7b7", "outboundId": "716fdf78-8c02-4db7-98f0-587bfa379807", "createdAt": "2026-09-04T14:52:31.755Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:31.786Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `5a208719-c3d9-4850-beff-1db9b9837f0f`; turno `812efa02-485d-4a6d-a158-6517a74eba92`.

Cliente: Mandame el link. Soy Ana Ríos, ana.rios@example.test, teléfono +1 305 555 0177

Propuesta del modelo antes de validar:
> ¡Gracias, Ana! Quedó registrado tu plan de 6 pagos mensuales de USD 60. Te envío el link de pago por acá.

Movimiento `request_payment_link`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Ana! Quedó registrado tu plan de 6 pagos mensuales de USD 60. Te envío el link de pago por acá.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `020e4fde-44f4-4014-98fe-2f3898a27b38`; delivery `submitted_to_botpress`; tiempo 3270 ms.

Decisión persistida: `{"turnId": "812efa02-485d-4a6d-a158-6517a74eba92", "outboundId": "020e4fde-44f4-4014-98fe-2f3898a27b38", "createdAt": "2026-09-04T14:52:35.038Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:35.070Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `a3151168-737e-4cbf-9419-d139e79db132`; turno `61edd2fc-fb49-485a-8747-3c5e59b1e5eb`.

Cliente: Me interesa Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente elección! Excel Integral es un curso de la Academia de Negocios con 17 clases, ideal para dominar fórmulas, funciones, gráficos y resúmenes de información. 😊

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente elección! Excel Integral es un curso de la Academia de Negocios con 17 clases, ideal para dominar fórmulas, funciones, gráficos y resúmenes de información. 😊
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `3e224d49-4da2-427c-99ce-72cb99abc40d`; delivery `submitted_to_botpress`; tiempo 3451 ms.

Decisión persistida: `{"turnId": "61edd2fc-fb49-485a-8747-3c5e59b1e5eb", "outboundId": "3e224d49-4da2-427c-99ce-72cb99abc40d", "createdAt": "2026-09-04T14:52:38.484Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:38.523Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `3eeac9ba-46fa-4556-bdad-f62676612701`; turno `4a19a80c-386d-443e-a525-efa5cf54a199`.

Cliente: Elijo las 12 cuotas

Propuesta del modelo antes de validar:
> Perfecto, la opción de 12 pagos mensuales de USD 30 es una gran elección. 😊 ¿Querés avanzar con esa opción para dejarlo registrado?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, la opción de 12 pagos mensuales de USD 30 es una gran elección. 😊 ¿Querés avanzar con esa opción para dejarlo registrado?

Outbound `c31961c4-2ba9-4324-b687-860e103464c3`; delivery `submitted_to_botpress`; tiempo 2855 ms.

Decisión persistida: `{"turnId": "4a19a80c-386d-443e-a525-efa5cf54a199", "outboundId": "c31961c4-2ba9-4324-b687-860e103464c3", "createdAt": "2026-09-04T14:52:41.355Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:41.379Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `e29aa6e1-b044-4a36-bc1d-83234f645d2a`; turno `f134618b-97c3-4b17-93c1-2347db823209`.

Cliente: Ahora no puedo, lo dejo para la semana que viene

Propuesta del modelo antes de validar:
> Tranquilo/a, no hay problema. Cuando quieras retomar la semana que viene, seguimos con la opción de 12 pagos mensuales de USD 30. 😊

Movimiento `defer_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tranquilo/a, no hay problema. Cuando quieras retomar la semana que viene, seguimos con la opción de 12 pagos mensuales de USD 30. 😊

Outbound `37c8dea3-46e2-4802-b1d9-d54f7b3cfed4`; delivery `submitted_to_botpress`; tiempo 3187 ms.

Decisión persistida: `{"turnId": "f134618b-97c3-4b17-93c1-2347db823209", "outboundId": "37c8dea3-46e2-4802-b1d9-d54f7b3cfed4", "createdAt": "2026-09-04T14:52:44.533Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:44.595Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `9456f916-a412-464c-89e2-0b1aae79e1af`; turno `2d1ccf1e-e068-4392-84db-df9619af9c94`.

Cliente: Me anoto en Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente decisión! Excel Integral es ideal para dominar desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información. Son 17 clases 100% online.
> Para orientarte mejor: ¿ya tenés conocimientos previos de Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente decisión! Excel Integral es ideal para dominar desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información. Son 17 clases 100% online.
>
> Para orientarte mejor: ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles y resolver tus dudas.

Outbound `f20569b9-fc71-481c-af87-2144ee2c51f1`; delivery `submitted_to_botpress`; tiempo 3355 ms.

Decisión persistida: `{"turnId": "2d1ccf1e-e068-4392-84db-df9619af9c94", "outboundId": "f20569b9-fc71-481c-af87-2144ee2c51f1", "createdAt": "2026-09-04T14:52:47.913Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:47.953Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `b1a6174c-7e86-4bf2-aa36-1177005a1a9b`; turno `95e94f3c-96d2-44a9-a499-d02fec2d1a82`.

Cliente: Ya hice la transferencia

Propuesta del modelo antes de validar:
> Perfecto, quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Movimiento `{'schema_version': 1, 'move': 'report_payment', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': None, 'confidence': 0.97}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Outbound `d505d2ba-6089-469f-924c-2b844b69ff69`; delivery `submitted_to_botpress`; tiempo 3047 ms.

Decisión persistida: `{"turnId": "95e94f3c-96d2-44a9-a499-d02fec2d1a82", "outboundId": "d505d2ba-6089-469f-924c-2b844b69ff69", "createdAt": "2026-09-04T14:52:50.965Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:51.002Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `491af76f-4ac5-45c3-9135-168bf6966566`; turno `f49dea64-30aa-4c84-bd3c-8d5a3d305ebd`.

Cliente: ¿Entonces ya tengo acceso al campus?

Propuesta del modelo antes de validar:
> Todavía no, el acceso se habilita recién cuando el equipo confirma que el pago está acreditado. Tu aviso quedó registrado y ellos gestionan el alta.

Movimiento `ask_current_state`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Todavía no, el acceso se habilita recién cuando el equipo confirma que el pago está acreditado. Tu aviso quedó registrado y ellos gestionan el alta.

Outbound `909d680e-25bc-4cd5-b304-ed7d84856ead`; delivery `submitted_to_botpress`; tiempo 3173 ms.

Decisión persistida: `{"turnId": "f49dea64-30aa-4c84-bd3c-8d5a3d305ebd", "outboundId": "909d680e-25bc-4cd5-b304-ed7d84856ead", "createdAt": "2026-09-04T14:52:54.141Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:54.196Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `5d04bc80-9a25-41ab-be79-6a6ec0e4d217`; turno `05404b99-a5aa-4290-8396-de79c5f1f7d0`.

Cliente: Hola, quiero info de Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a y te voy a ayudar con el curso de Redes Informáticas.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a y te voy a ayudar con el curso de Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `0d3273ed-6cb4-4c44-bf46-ced0ed89ae58`; delivery `submitted_to_botpress`; tiempo 3410 ms.

Decisión persistida: `{"turnId": "05404b99-a5aa-4290-8396-de79c5f1f7d0", "outboundId": "0d3273ed-6cb4-4c44-bf46-ced0ed89ae58", "createdAt": "2026-09-04T14:52:57.574Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:52:57.607Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `90335b8a-a6a3-4bd6-b87a-0de78e547620`; turno `13a478a6-c898-453e-ba32-af1a3f6c9722`.

Cliente: No me escribas más, quiero que me den de baja

Salida autorizada y capturada:
> Listo, no te enviaremos más mensajes.

Outbound `1d06a072-8622-4299-a6cb-836b30238a9d`; delivery `submitted_to_botpress`; tiempo 1039 ms.

Decisión persistida: `{"turnId": "13a478a6-c898-453e-ba32-af1a3f6c9722", "outboundId": "1d06a072-8622-4299-a6cb-836b30238a9d", "createdAt": "2026-09-04T14:52:58.626Z", "reasonCode": "EXPLICIT_OPT_OUT_ACK", "responseType": "opt_out_ack", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-sales-v17", "modelName": "deterministic:opt-out-ack-v1"}`.

## 2026-09-04T14:52:58.646Z · workflow-persisted-outcomes

Fuente `workflow-persisted-outcomes-2026-09-04T14-52-59-702Z-e67e484e-593f-44bc-8184-68b271c3165c.json.gz`; trace `f308c7b6-ea60-4a26-86f7-80c6dcae92af`; turno `9338dc68-47a5-4f46-abc9-33d9a442e3c3`.

Cliente: ¿Y cuánto sale ese curso?

Salida autorizada y capturada:
*(silencio; consultar decisión y disponibilidad del turno)*

Outbound `None`; delivery `None`; tiempo 1036 ms.

Decisión persistida: `{"turnId": "9338dc68-47a5-4f46-abc9-33d9a442e3c3", "outboundId": null, "createdAt": "2026-09-04T14:52:59.675Z", "reasonCode": "CONSENT_REVOKED", "responseType": null, "hasResponse": false, "businessActionType": null, "promptVersion": "studyx-agent-a-sales-v17", "modelName": "policy:opt-out"}`.

## 2026-09-04T14:52:59.992Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T14-53-22-417Z-06e1b94e-9341-49af-a41d-3ad0f7d149ac.json.gz`; trace `b9b627ed-7455-481e-9544-ec12d732eb13`; turno `560aba3c-8c0f-43b3-9db0-b180a950153c`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con el curso de Redes Informáticas.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con el curso de Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `c2914503-2c52-4c37-a250-4db690097c00`; delivery `submitted_to_botpress`; tiempo 3740 ms.

Decisión persistida: `{"turnId": "560aba3c-8c0f-43b3-9db0-b180a950153c", "outboundId": "c2914503-2c52-4c37-a250-4db690097c00", "createdAt": "2026-09-04T14:53:03.706Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:53:03.748Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T14-53-22-417Z-06e1b94e-9341-49af-a41d-3ad0f7d149ac.json.gz`; trace `4a893683-8bfc-4003-a58a-bb60372b1664`; turno `65e7fa85-99dc-4239-a562-bece6ff7c43d`.

Cliente: Prefiero no hablar por teléfono, sigamos por acá

Propuesta del modelo antes de validar:
> Perfecto, seguimos por acá sin problema 👍
> Contame, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar? Así te cuento lo que más te sirva.

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, seguimos por acá sin problema 👍
>
> Así te cuento lo que más te sirva.

Outbound `c635f9c1-e2ed-496f-86ea-c140ffec4f20`; delivery `submitted_to_botpress`; tiempo 3589 ms.

Decisión persistida: `{"turnId": "65e7fa85-99dc-4239-a562-bece6ff7c43d", "outboundId": "c635f9c1-e2ed-496f-86ea-c140ffec4f20", "createdAt": "2026-09-04T14:53:07.295Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:53:07.361Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T14-53-22-417Z-06e1b94e-9341-49af-a41d-3ad0f7d149ac.json.gz`; trace `6b7a9624-4567-4e4e-9f54-7ccbb21f6d15`; turno `db95559d-3bd3-4ad1-8560-012ddfaf25f1`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360.
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Outbound `7e9c4a03-c290-4963-b8a1-5bce1824bce5`; delivery `submitted_to_botpress`; tiempo 3040 ms.

Decisión persistida: `{"turnId": "db95559d-3bd3-4ad1-8560-012ddfaf25f1", "outboundId": "7e9c4a03-c290-4963-b8a1-5bce1824bce5", "createdAt": "2026-09-04T14:53:10.384Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:53:10.416Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T14-53-22-417Z-06e1b94e-9341-49af-a41d-3ad0f7d149ac.json.gz`; trace `680ca2b2-f374-4478-ae7d-5ee7fe963157`; turno `410d9c05-9e32-4540-ad88-e2f467bbc12c`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> ¡Perfecto! Quedó elegido el plan de 6 pagos mensuales de USD 60.
> ¿Querés que avancemos con eso para dejarlo registrado?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! Quedó elegido el plan de 6 pagos mensuales de USD 60.
>
> ¿Querés que avancemos con eso para dejarlo registrado?

Outbound `ed03ead4-5476-474e-a008-ad4c5f1ff4bd`; delivery `submitted_to_botpress`; tiempo 3187 ms.

Decisión persistida: `{"turnId": "410d9c05-9e32-4540-ad88-e2f467bbc12c", "outboundId": "ed03ead4-5476-474e-a008-ad4c5f1ff4bd", "createdAt": "2026-09-04T14:53:13.564Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:53:13.624Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T14-53-22-417Z-06e1b94e-9341-49af-a41d-3ad0f7d149ac.json.gz`; trace `46228d49-6da6-40cd-bf89-b97e32254cb9`; turno `c5e3981a-635a-4d53-99cd-6124ef695de6`.

Cliente: Sí, mandame el link de pago para avanzar

Propuesta del modelo antes de validar:
> ¡Genial! Para dejarlo registrado y enviarte el link, necesito tu nombre, apellido, correo electrónico y teléfono.

Movimiento `request_payment_link`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Genial! Para dejarlo registrado y enviarte el link, necesito tu nombre, apellido, correo electrónico y teléfono.

Outbound `563e4747-5d73-4350-b5c9-71342033dcd7`; delivery `submitted_to_botpress`; tiempo 2999 ms.

Decisión persistida: `{"turnId": "c5e3981a-635a-4d53-99cd-6124ef695de6", "outboundId": "563e4747-5d73-4350-b5c9-71342033dcd7", "createdAt": "2026-09-04T14:53:16.583Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:53:16.643Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T14-53-22-417Z-06e1b94e-9341-49af-a41d-3ad0f7d149ac.json.gz`; trace `9b9d1a7d-c3e6-4fa1-b5f8-905cb289128b`; turno `307010a5-19e7-46b4-807e-79c1950f3a6d`.

Cliente: Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

Propuesta del modelo antes de validar:
> ¡Perfecto, Camila! Quedó registrado tu nombre, correo y teléfono.
> Te envío el link de pago para el plan de 6 pagos mensuales de USD 60.

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Camila! Quedó registrado tu nombre, correo y teléfono.
>
> Te envío el link de pago para el plan de 6 pagos mensuales de USD 60.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `6bd6b638-8720-4f12-9b30-bcbb26337b51`; delivery `submitted_to_botpress`; tiempo 2953 ms.

Decisión persistida: `{"turnId": "307010a5-19e7-46b4-807e-79c1950f3a6d", "outboundId": "6bd6b638-8720-4f12-9b30-bcbb26337b51", "createdAt": "2026-09-04T14:53:19.559Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:53:19.617Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T14-53-22-417Z-06e1b94e-9341-49af-a41d-3ad0f7d149ac.json.gz`; trace `a8417164-3eb7-45bd-9ea0-b5b4a41626fa`; turno `c572a1a8-0768-4812-8689-44e2dfcabb25`.

Cliente: Listo, ya hice el pago

Propuesta del modelo antes de validar:
> ¡Gracias, Camila! Registré tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Movimiento `{'schema_version': 1, 'move': 'report_payment', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': 'monthly_6', 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Camila! Registré tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Outbound `97212807-7d91-4018-9d8b-c1ed7134833a`; delivery `submitted_to_botpress`; tiempo 2784 ms.

Decisión persistida: `{"turnId": "c572a1a8-0768-4812-8689-44e2dfcabb25", "outboundId": "97212807-7d91-4018-9d8b-c1ed7134833a", "createdAt": "2026-09-04T14:53:22.382Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v16", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:56:10.729Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-56-39-737Z-8ef80647-7e23-4c8d-a583-625b59a19d0e.json.gz`; trace `94fd01a2-b4d6-4184-b550-a2bb7a8387ae`; turno `3269dd58-2490-47b9-a7cf-fea2eacf3ca5`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Redes Informáticas.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `aedaaad0-fced-4be7-82ce-83407f455758`; delivery `submitted_to_botpress`; tiempo 4120 ms.

Decisión persistida: `{"turnId": "3269dd58-2490-47b9-a7cf-fea2eacf3ca5", "outboundId": "aedaaad0-fced-4be7-82ce-83407f455758", "createdAt": "2026-09-04T14:56:14.822Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:56:14.850Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-56-39-737Z-8ef80647-7e23-4c8d-a583-625b59a19d0e.json.gz`; trace `593a1d74-3a10-49fb-97b9-ff19bd82c5aa`; turno `bcbac272-b212-4807-b19b-7cd253ab5f1a`.

Cliente: Prefiero no hablar por teléfono, sigamos por acá

Propuesta del modelo antes de validar:
> Perfecto, seguimos por acá sin problema.
> Para orientarte mejor: ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, seguimos por acá sin problema.

Outbound `3faf4818-e3d7-43d1-8535-99996d1d9f49`; delivery `submitted_to_botpress`; tiempo 3666 ms.

Decisión persistida: `{"turnId": "bcbac272-b212-4807-b19b-7cd253ab5f1a", "outboundId": "3faf4818-e3d7-43d1-8535-99996d1d9f49", "createdAt": "2026-09-04T14:56:18.484Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:56:18.518Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-56-39-737Z-8ef80647-7e23-4c8d-a583-625b59a19d0e.json.gz`; trace `ca4aaa71-e58f-46de-bfcf-8ad2f800f940`; turno `a01c0fc6-db4d-476f-aab2-e0db563d3558`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360.
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Outbound `1b150ecc-4834-4435-b0cf-3dfbd0bb8234`; delivery `submitted_to_botpress`; tiempo 3464 ms.

Decisión persistida: `{"turnId": "a01c0fc6-db4d-476f-aab2-e0db563d3558", "outboundId": "1b150ecc-4834-4435-b0cf-3dfbd0bb8234", "createdAt": "2026-09-04T14:56:21.958Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:56:21.984Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-56-39-737Z-8ef80647-7e23-4c8d-a583-625b59a19d0e.json.gz`; trace `ce44479c-9baa-4dc7-aac2-40eb4c129be9`; turno `3b9fbeca-f0c3-4004-9eb8-0f39503efcdf`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360, y podés elegir entre 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360, y podés elegir entre 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Outbound `4220a10d-0ba7-4865-a515-645a46867399`; delivery `submitted_to_botpress`; tiempo 3388 ms.

Decisión persistida: `{"turnId": "3b9fbeca-f0c3-4004-9eb8-0f39503efcdf", "outboundId": "4220a10d-0ba7-4865-a515-645a46867399", "createdAt": "2026-09-04T14:56:25.350Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:56:25.374Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-56-39-737Z-8ef80647-7e23-4c8d-a583-625b59a19d0e.json.gz`; trace `8e708f39-b7cd-4ee2-b326-ce651d3d428e`; turno `fd8d2508-037d-4f98-983b-e09c29236439`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> Perfecto, 6 pagos mensuales de USD 60. ¿Querés que avancemos con eso para dejarlo registrado?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, 6 pagos mensuales de USD 60. ¿Querés que avancemos con eso para dejarlo registrado?

Outbound `337bf833-82c6-4b33-a414-807f398f509c`; delivery `submitted_to_botpress`; tiempo 2775 ms.

Decisión persistida: `{"turnId": "fd8d2508-037d-4f98-983b-e09c29236439", "outboundId": "337bf833-82c6-4b33-a414-807f398f509c", "createdAt": "2026-09-04T14:56:28.113Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:56:28.151Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-56-39-737Z-8ef80647-7e23-4c8d-a583-625b59a19d0e.json.gz`; trace `136dacba-8f52-4d90-89c5-3742409ef11e`; turno `c1405080-3875-490f-8bd0-f4d6d472583e`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Outbound `de3b61d3-c11d-42df-9d40-0c74e5d0566d`; delivery `submitted_to_botpress`; tiempo 3137 ms.

Decisión persistida: `{"turnId": "c1405080-3875-490f-8bd0-f4d6d472583e", "outboundId": "de3b61d3-c11d-42df-9d40-0c74e5d0566d", "createdAt": "2026-09-04T14:56:31.250Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:56:31.290Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-56-39-737Z-8ef80647-7e23-4c8d-a583-625b59a19d0e.json.gz`; trace `e4b22192-dfc9-465b-90dd-fca429e6c398`; turno `b6a0d6a9-ceaf-48cc-aa5a-55b3cf303a41`.

Cliente: Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

Propuesta del modelo antes de validar:
> ¡Gracias, Camila! Quedó registrado tu nombre, correo y teléfono. Te comparto el link de pago para las 6 cuotas de USD 60.

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> Gracias, Camila. Quedó registrado tu nombre, correo y teléfono. Cuando quieras avanzar con el pago de las 6 cuotas de USD 60, avisame y te comparto el link.

Movimiento `provide_contact_details`; acción `{'type': 'none'}`; repair_of `{'rejection_id': 'f04a20a2-632c-4be1-916a-bcc46fea3f85', 'attempt': 1}`.

Salida autorizada y capturada:
> Gracias, Camila. Quedó registrado tu nombre, correo y teléfono. Cuando quieras avanzar con el pago de las 6 cuotas de USD 60, avisame y te comparto el link.

Outbound `46053643-4a6c-4d5f-8330-40cb49eda7d9`; delivery `submitted_to_botpress`; tiempo 5344 ms.

Decisión persistida: `{"turnId": "b6a0d6a9-ceaf-48cc-aa5a-55b3cf303a41", "outboundId": "46053643-4a6c-4d5f-8330-40cb49eda7d9", "createdAt": "2026-09-04T14:56:36.592Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T14:56:36.660Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T14-56-39-737Z-8ef80647-7e23-4c8d-a583-625b59a19d0e.json.gz`; trace `100f8e42-cdad-493c-aaaa-dec275414cd2`; turno `36008c85-e360-4b5f-b984-6568ddd9c018`.

Cliente: Sí, ahora mandame el link de las seis cuotas

Propuesta del modelo antes de validar:
> Perfecto, Camila. Te comparto el link para las 6 cuotas de USD 60.

Movimiento `{'schema_version': 1, 'move': 'request_payment_link', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': 'monthly_6', 'confidence': 1.0}`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, Camila. Te comparto el link para las 6 cuotas de USD 60.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `99eb4071-0602-43c8-8989-5c6e6ff85b14`; delivery `submitted_to_botpress`; tiempo 3065 ms.

Decisión persistida: `{"turnId": "36008c85-e360-4b5f-b984-6568ddd9c018", "outboundId": "99eb4071-0602-43c8-8989-5c6e6ff85b14", "createdAt": "2026-09-04T14:56:39.705Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:04:28.370Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `3efa7784-0a0a-4618-b871-8677c7101230`; turno `b15a03ff-bab3-47a0-a210-300c12f8b68c`.

Cliente: Hola, quería saber qué formaciones tienen en tecnología

Propuesta del modelo antes de validar:
> Hola, bienvenido/a a StudyX 🇺🇸 Soy tu asesor/a educativo/a. En tecnología tenemos la formación de Armado y Reparación de PC, dentro de nuestra Academia de Oficios. ¿Ya tenías pensado estudiar algo de esto o recién estás empezando a averiguar?

Movimiento `browse_catalog`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Hola, bienvenido/a a StudyX 🇺🇸 Soy tu asesor/a educativo/a. En tecnología tenemos la formación de Armado y Reparación de PC, dentro de nuestra Academia de Oficios. ¿Ya tenías pensado estudiar algo de esto o recién estás empezando a averiguar?

Outbound `8387453a-07c6-40b5-88bb-70e4ed491052`; delivery `submitted_to_botpress`; tiempo 3455 ms.

Decisión persistida: `{"turnId": "b15a03ff-bab3-47a0-a210-300c12f8b68c", "outboundId": "8387453a-07c6-40b5-88bb-70e4ed491052", "createdAt": "2026-09-04T15:04:31.761Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:04:31.826Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `23f9bacf-c5b5-4f56-a820-1d95ba19f3d0`; turno `657d3aa2-ed63-4164-a56d-9febda7be095`.

Cliente: Me tienta la de Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Buena elección! Redes Informáticas es parte de nuestra Academia de Oficios y son 16 clases donde vas a conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen. ¿Ya tenías conocimientos previos en el tema o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Buena elección! Redes Informáticas es parte de nuestra Academia de Oficios y son 16 clases donde vas a conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen. ¿Ya tenías conocimientos previos en el tema o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `da382de5-6d6d-4e60-a476-98d9a8537343`; delivery `submitted_to_botpress`; tiempo 3530 ms.

Decisión persistida: `{"turnId": "657d3aa2-ed63-4164-a56d-9febda7be095", "outboundId": "da382de5-6d6d-4e60-a476-98d9a8537343", "createdAt": "2026-09-04T15:04:35.309Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:04:35.358Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `faa42171-1715-40a8-bc65-63d9de1f1900`; turno `e60e9591-52bf-432d-8f06-2e69347c7a4a`.

Cliente: Pensándolo mejor, prefiero Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente elección! Excel Integral es parte de nuestra Academia de Negocios y son 17 clases donde vas a aprender las herramientas elementales, fórmulas y funciones, gráficos y resúmenes de información, entre otras actividades del programa. ¿Ya tenés conocimientos previos de Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente elección! Excel Integral es parte de nuestra Academia de Negocios y son 17 clases donde vas a aprender las herramientas elementales, fórmulas y funciones, gráficos y resúmenes de información, entre otras actividades del programa. ¿Ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `6b5974c3-0ed2-4b62-a464-38c948aecada`; delivery `submitted_to_botpress`; tiempo 3506 ms.

Decisión persistida: `{"turnId": "e60e9591-52bf-432d-8f06-2e69347c7a4a", "outboundId": "6b5974c3-0ed2-4b62-a464-38c948aecada", "createdAt": "2026-09-04T15:04:38.834Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:04:38.865Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `0f1ca726-15c5-4453-aeb4-a8d87fd54100`; turno `d4161bb9-3928-4d9b-84cb-9ecce6ac3eb9`.

Cliente: ¿?

Propuesta del modelo antes de validar:
> ¿En qué puedo ayudarte? Te estaba contando sobre Excel Integral, pero si tenés otra duda o querés ver otras formaciones, decime y te oriento.

Movimiento `unknown`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¿En qué puedo ayudarte? Te estaba contando sobre Excel Integral, pero si tenés otra duda o querés ver otras formaciones, decime y te oriento.

Outbound `2dc7dd98-58f1-468a-9d4c-f8b85fa85cb8`; delivery `submitted_to_botpress`; tiempo 2892 ms.

Decisión persistida: `{"turnId": "d4161bb9-3928-4d9b-84cb-9ecce6ac3eb9", "outboundId": "2dc7dd98-58f1-468a-9d4c-f8b85fa85cb8", "createdAt": "2026-09-04T15:04:41.740Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:04:41.775Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `db91aafa-e75f-4c52-bdd6-f2eeda54b23c`; turno `d20bf1b4-0cc0-454d-bf9f-f85510bcf7c5`.

Cliente: Buenas, me interesa Maquillaje Profesional

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Maquillaje Profesional.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar maquillaje profesional o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Maquillaje Profesional.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar maquillaje profesional o recién estás empezando a averiguar?
>
> Si preferís, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `4ddf4204-5594-4cf1-bec6-15e77b99112a`; delivery `submitted_to_botpress`; tiempo 3229 ms.

Decisión persistida: `{"turnId": "d20bf1b4-0cc0-454d-bf9f-f85510bcf7c5", "outboundId": "4ddf4204-5594-4cf1-bec6-15e77b99112a", "createdAt": "2026-09-04T15:04:44.971Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:04:45.005Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `a04ad8ef-593c-49be-9523-bd06d22e27e4`; turno `29e8a0e8-440b-4965-a110-e77767b10136`.

Cliente: Uf, me parece bastante plata la verdad

Propuesta del modelo antes de validar:
> Entiendo, es una inversión importante. Por eso te comento que podés elegir entre 12 pagos mensuales de USD 30, 6 pagos de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Entiendo, es una inversión importante. Por eso te comento que podés elegir entre 12 pagos mensuales de USD 30, 6 pagos de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Outbound `bf144d76-3ded-4328-8864-faf0acae153c`; delivery `submitted_to_botpress`; tiempo 3532 ms.

Decisión persistida: `{"turnId": "29e8a0e8-440b-4965-a110-e77767b10136", "outboundId": "bf144d76-3ded-4328-8864-faf0acae153c", "createdAt": "2026-09-04T15:04:48.503Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:04:48.539Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `109c3554-b217-4014-a03e-dc5588a3e0a5`; turno `150e0a8e-bb9b-41c4-9b1e-9835255e5ad5`.

Cliente: No me llames por favor, sigamos escribiendo

Propuesta del modelo antes de validar:
> Perfecto, seguimos por acá sin problema. 😊
>
> Para avanzar, ¿cuál de las tres opciones de pago te resulta más cómoda: 12 pagos de USD 30, 6 pagos de USD 60 o el pago único de USD 360?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, seguimos por acá sin problema. 😊
>
> Para avanzar, ¿cuál de las tres opciones de pago te resulta más cómoda: 12 pagos de USD 30, 6 pagos de USD 60 o el pago único de USD 360?

Outbound `dc26ec4e-5922-4f61-b986-85a2fbe4e8c9`; delivery `submitted_to_botpress`; tiempo 3356 ms.

Decisión persistida: `{"turnId": "150e0a8e-bb9b-41c4-9b1e-9835255e5ad5", "outboundId": "dc26ec4e-5922-4f61-b986-85a2fbe4e8c9", "createdAt": "2026-09-04T15:04:51.860Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:04:51.897Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `cabb6d1f-d138-4da9-b717-9508c8631c48`; turno `6700b0c5-7000-4f1f-9a36-4414450a2f75`.

Cliente: ¿Y la cuota más baja de cuánto sería?

Propuesta del modelo antes de validar:
> La cuota más baja es la de 12 pagos mensuales de USD 30. El total sigue siendo USD 360 en cualquiera de las tres opciones.

Movimiento `{'schema_version': 1, 'move': 'ask_payment_options', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': None, 'confidence': 0.97}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> La cuota más baja es la de 12 pagos mensuales de USD 30. El total sigue siendo USD 360 en cualquiera de las tres opciones.

Outbound `e2334e9f-4b59-4042-8276-d0633a79fe7a`; delivery `submitted_to_botpress`; tiempo 2972 ms.

Decisión persistida: `{"turnId": "6700b0c5-7000-4f1f-9a36-4414450a2f75", "outboundId": "e2334e9f-4b59-4042-8276-d0633a79fe7a", "createdAt": "2026-09-04T15:04:54.847Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:04:54.885Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `5df9ed77-c118-4d96-891d-e15ff3b4c3ae`; turno `dbf52e98-d17c-4da3-9655-eab76bcdb64a`.

Cliente: Quiero anotarme en Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu inscripción a Redes Informáticas.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes informáticas o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu inscripción a Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes informáticas o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `0e48999c-2165-48ef-863d-a84c7689bb5f`; delivery `submitted_to_botpress`; tiempo 3651 ms.

Decisión persistida: `{"turnId": "dbf52e98-d17c-4da3-9655-eab76bcdb64a", "outboundId": "0e48999c-2165-48ef-863d-a84c7689bb5f", "createdAt": "2026-09-04T15:04:58.511Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:04:58.538Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `5d1b12fc-0404-440f-a706-3b41b10b454a`; turno `693819f8-035a-45ea-b22c-335a9d167e2e`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> Perfecto, te anoto con el plan de 6 pagos mensuales de USD 60. El total del programa es USD 360 en cualquiera de las opciones.
> ¿Querés que avancemos con tu registro para dejarlo listo?

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': 'academia-de-oficios', 'payment_plan': 'monthly_6', 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, te anoto con el plan de 6 pagos mensuales de USD 60. El total del programa es USD 360 en cualquiera de las opciones.
>
> ¿Querés que avancemos con tu registro para dejarlo listo?

Outbound `8727a172-7d01-4252-b1bd-3d81dbdebc85`; delivery `submitted_to_botpress`; tiempo 3710 ms.

Decisión persistida: `{"turnId": "693819f8-035a-45ea-b22c-335a9d167e2e", "outboundId": "8727a172-7d01-4252-b1bd-3d81dbdebc85", "createdAt": "2026-09-04T15:05:02.211Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:02.250Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `440bee41-0160-4719-a64a-aa8a34866e91`; turno `c1a9d558-794f-403a-9679-c4f1d24ef2da`.

Cliente: Igual esta semana no puedo, lo dejo para el lunes

Propuesta del modelo antes de validar:
> Tranquilo/a, no hay problema. Quedamos así: el lunes retomamos y avanzamos con tu registro para el plan de 6 pagos mensuales de USD 60.
> Cuando quieras, escribime por acá y seguimos. 👍

Movimiento `defer_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tranquilo/a, no hay problema. Quedamos así: el lunes retomamos y avanzamos con tu registro para el plan de 6 pagos mensuales de USD 60.
>
> Cuando quieras, escribime por acá y seguimos. 👍

Outbound `f241a1b6-3024-4f4d-82c3-7d46174f52b5`; delivery `submitted_to_botpress`; tiempo 3421 ms.

Decisión persistida: `{"turnId": "c1a9d558-794f-403a-9679-c4f1d24ef2da", "outboundId": "f241a1b6-3024-4f4d-82c3-7d46174f52b5", "createdAt": "2026-09-04T15:05:05.626Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:05.672Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `8f8e4c86-25b2-421c-887b-743b905a67f6`; turno `56222cb4-1a4c-42dd-92b2-b40f740782e7`.

Cliente: Ya está, mandame el link. Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

Propuesta del modelo antes de validar:
> ¡Perfecto, Lucía! Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.

Movimiento `request_payment_link`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Lucía! Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `23e3e1c3-b74f-4065-b20a-ef94cfafb291`; delivery `submitted_to_botpress`; tiempo 2980 ms.

Decisión persistida: `{"turnId": "56222cb4-1a4c-42dd-92b2-b40f740782e7", "outboundId": "23e3e1c3-b74f-4065-b20a-ef94cfafb291", "createdAt": "2026-09-04T15:05:08.617Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:08.674Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `0618de01-21a7-4dc1-9f40-f1666dfb7ab1`; turno `b8a9022c-51c2-4162-8bc6-26e50f67fa2f`.

Cliente: Me anoto en Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente decisión! Excel Integral es un curso muy completo de la Academia de Negocios: 17 clases donde vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información. 😊
> Para orientarte mejor, ¿ya tenés conocimientos previos de Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente decisión! Excel Integral es un curso muy completo de la Academia de Negocios: 17 clases donde vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información. 😊
>
> Para orientarte mejor, ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, puedo contarte más en detalle por una llamada breve.

Outbound `9b8cb40a-5674-4922-9ecc-dfdd79e50a0a`; delivery `submitted_to_botpress`; tiempo 3303 ms.

Decisión persistida: `{"turnId": "b8a9022c-51c2-4162-8bc6-26e50f67fa2f", "outboundId": "9b8cb40a-5674-4922-9ecc-dfdd79e50a0a", "createdAt": "2026-09-04T15:05:11.944Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:11.979Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `3e4cf3e4-f837-4423-b986-5406702c7cd9`; turno `75a5d1c4-6406-46d1-ad7e-d0dd3019f1cc`.

Cliente: Ya hice la transferencia recién

Propuesta del modelo antes de validar:
> Perfecto, quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso. Cualquier novedad te avisan por acá. 👍

Movimiento `report_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso. 👍

Outbound `911433c1-7760-4bdb-b8db-ee24e85c85fd`; delivery `submitted_to_botpress`; tiempo 2738 ms.

Decisión persistida: `{"turnId": "75a5d1c4-6406-46d1-ad7e-d0dd3019f1cc", "outboundId": "911433c1-7760-4bdb-b8db-ee24e85c85fd", "createdAt": "2026-09-04T15:05:14.675Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:14.718Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T15-05-17-877Z-1b927da8-68f1-4cf4-865f-479bb922de5c.json.gz`; trace `94dc7172-ce1d-45cf-901d-6f0a97605cb6`; turno `680131ae-d710-4dfd-b1c4-c892f3ac9c9f`.

Cliente: ¿Entonces ya quedé inscripta?

Propuesta del modelo antes de validar:
> Tu aviso de pago quedó registrado. La inscripción se confirma cuando el equipo verifique que el pago esté acreditado; en ese momento gestionarán tu acceso. 👍

Movimiento `ask_current_state`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tu aviso de pago quedó registrado. La inscripción se confirma cuando el equipo verifique que el pago esté acreditado; en ese momento gestionarán tu acceso. 👍

Outbound `e32895e7-4ac0-4ce8-8e4a-93a6a73d3bad`; delivery `submitted_to_botpress`; tiempo 3142 ms.

Decisión persistida: `{"turnId": "680131ae-d710-4dfd-b1c4-c892f3ac9c9f", "outboundId": "e32895e7-4ac0-4ce8-8e4a-93a6a73d3bad", "createdAt": "2026-09-04T15:05:17.844Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:17.893Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T15-05-31-198Z-919b5ac7-b22b-4ba9-99de-6eb278fcd739.json.gz`; trace `b28d964b-420c-4b51-ab45-9ea820b1b491`; turno `110ea35c-f208-40db-ad42-9c21d4e2b3e1`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos.
> Redes Informáticas es un curso de la Academia de Oficios, 100% online y en español, con 16 clases para que conozcas el funcionamiento de las redes y sus dispositivos. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos.
>
> Redes Informáticas es un curso de la Academia de Oficios, 100% online y en español, con 16 clases para que conozcas el funcionamiento de las redes y sus dispositivos. ¿Ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `c631f797-d2af-4c2b-bdc3-79b9fda108e4`; delivery `submitted_to_botpress`; tiempo 3496 ms.

Decisión persistida: `{"turnId": "110ea35c-f208-40db-ad42-9c21d4e2b3e1", "outboundId": "c631f797-d2af-4c2b-bdc3-79b9fda108e4", "createdAt": "2026-09-04T15:05:21.351Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:21.391Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T15-05-31-198Z-919b5ac7-b22b-4ba9-99de-6eb278fcd739.json.gz`; trace `3c2bc626-29e2-4d51-9cb4-0e6aa14d8221`; turno `dc94f6b9-01c4-4fc0-92ba-201b3516cf6e`.

Cliente: Prefiero no hablar por teléfono, seguimos por chat

Propuesta del modelo antes de validar:
> ¡Perfecto, seguimos por chat! 😊 Para orientarte mejor: ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, seguimos por chat!

Outbound `e4a7d560-681e-4663-959a-818bcd28665c`; delivery `submitted_to_botpress`; tiempo 3249 ms.

Decisión persistida: `{"turnId": "dc94f6b9-01c4-4fc0-92ba-201b3516cf6e", "outboundId": "e4a7d560-681e-4663-959a-818bcd28665c", "createdAt": "2026-09-04T15:05:24.607Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:24.641Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T15-05-31-198Z-919b5ac7-b22b-4ba9-99de-6eb278fcd739.json.gz`; trace `13e062d2-1cdb-40d4-a010-719bed2a78a4`; turno `66d00c84-2938-4189-9f11-3546365c7981`.

Cliente: Contame más del contenido

Propuesta del modelo antes de validar:
> Claro, te cuento. En Redes Informáticas vas a conocer cómo funcionan las redes y cada uno de los dispositivos que las componen, a lo largo de 16 clases 100% online y en español.

Movimiento `ask_course_information`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Claro, te cuento. En Redes Informáticas vas a conocer cómo funcionan las redes y cada uno de los dispositivos que las componen, a lo largo de 16 clases 100% online y en español.

Outbound `b7ba9437-6aba-4e26-bb8e-fb060f5c2893`; delivery `submitted_to_botpress`; tiempo 3316 ms.

Decisión persistida: `{"turnId": "66d00c84-2938-4189-9f11-3546365c7981", "outboundId": "b7ba9437-6aba-4e26-bb8e-fb060f5c2893", "createdAt": "2026-09-04T15:05:27.920Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:27.958Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T15-05-31-198Z-919b5ac7-b22b-4ba9-99de-6eb278fcd739.json.gz`; trace `7d0f1db2-7aa5-4732-a8f9-e2c19cb0af67`; turno `ba239ed0-e576-4a42-a034-6189670b599a`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360.
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Outbound `99a71076-47e6-4346-b777-761031df82d2`; delivery `submitted_to_botpress`; tiempo 3225 ms.

Decisión persistida: `{"turnId": "ba239ed0-e576-4a42-a034-6189670b599a", "outboundId": "99a71076-47e6-4346-b777-761031df82d2", "createdAt": "2026-09-04T15:05:31.163Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:31.429Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T15-05-54-833Z-4f776571-b0ad-4b45-801c-0614ffb6beb8.json.gz`; trace `e864af1d-3055-444f-a162-380a05fb2bf8`; turno `c97f299c-8778-41c7-9092-8322a385c5bc`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Me alegra que te interese Redes Informáticas, un curso de la Academia de Oficios donde vas a conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen.
> Para orientarte mejor: ¿ya tenías pensado estudiar redes informáticas o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Me alegra que te interese Redes Informáticas, un curso de la Academia de Oficios donde vas a conocer el funcionamiento de las redes y cada uno de los dispositivos que las componen.
>
> Para orientarte mejor: ¿ya tenías pensado estudiar redes informáticas o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.

Outbound `82c93927-2106-4d2e-b99a-893b67e1697c`; delivery `submitted_to_botpress`; tiempo 3821 ms.

Decisión persistida: `{"turnId": "c97f299c-8778-41c7-9092-8322a385c5bc", "outboundId": "82c93927-2106-4d2e-b99a-893b67e1697c", "createdAt": "2026-09-04T15:05:35.227Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:35.267Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T15-05-54-833Z-4f776571-b0ad-4b45-801c-0614ffb6beb8.json.gz`; trace `a2bebaf3-9b80-4404-a361-8c6af834cc2c`; turno `df850bd6-59af-42fd-b323-ac5d0d4976f4`.

Cliente: Prefiero no hablar por teléfono, sigamos por acá

Propuesta del modelo antes de validar:
> Perfecto, seguimos por acá sin problema. 👍
>
> Para orientarte mejor: ¿ya tenías pensado estudiar redes informáticas o recién estás empezando a averiguar?

Movimiento `{'schema_version': 1, 'move': 'continue_by_chat', 'secondary_moves': [], 'vetoes': ['call'], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': None, 'confidence': 0.98}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, seguimos por acá sin problema. 👍

Outbound `9e2e9fd4-8458-4f66-8163-55a85b4a6b43`; delivery `submitted_to_botpress`; tiempo 3276 ms.

Decisión persistida: `{"turnId": "df850bd6-59af-42fd-b323-ac5d0d4976f4", "outboundId": "9e2e9fd4-8458-4f66-8163-55a85b4a6b43", "createdAt": "2026-09-04T15:05:38.512Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:38.564Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T15-05-54-833Z-4f776571-b0ad-4b45-801c-0614ffb6beb8.json.gz`; trace `91a814ee-b866-4459-94de-c2ff839101bf`; turno `cd84b3bb-965c-402e-aa7d-4c0d70094eaa`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360.
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Movimiento `{'schema_version': 1, 'move': 'ask_payment_options', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': None, 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360.
>
> Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Outbound `0afe79df-44c5-4959-a11c-f758811903da`; delivery `submitted_to_botpress`; tiempo 3423 ms.

Decisión persistida: `{"turnId": "cd84b3bb-965c-402e-aa7d-4c0d70094eaa", "outboundId": "0afe79df-44c5-4959-a11c-f758811903da", "createdAt": "2026-09-04T15:05:41.965Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:42.005Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T15-05-54-833Z-4f776571-b0ad-4b45-801c-0614ffb6beb8.json.gz`; trace `1fb7e236-e535-4e45-a350-3610e249a9d9`; turno `34e1561e-013b-4f97-b1be-e8ea3537b73e`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> ¡Perfecto! Te anoto la opción de 6 pagos mensuales de USD 60.
> ¿Querés que avancemos con el registro para dejarlo listo?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! Te anoto la opción de 6 pagos mensuales de USD 60.
>
> ¿Querés que avancemos con el registro para dejarlo listo?

Outbound `cc8edecc-3214-429d-8951-927b37ef6674`; delivery `submitted_to_botpress`; tiempo 3314 ms.

Decisión persistida: `{"turnId": "34e1561e-013b-4f97-b1be-e8ea3537b73e", "outboundId": "cc8edecc-3214-429d-8951-927b37ef6674", "createdAt": "2026-09-04T15:05:45.298Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:45.333Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T15-05-54-833Z-4f776571-b0ad-4b45-801c-0614ffb6beb8.json.gz`; trace `f8ff7452-0522-4bb6-bf43-2afa22a66b3a`; turno `1fa73c60-e09c-4363-84ff-eb3673df55ab`.

Cliente: Sí, mandame el link de pago para avanzar

Propuesta del modelo antes de validar:
> ¡Genial! Para dejarlo registrado y enviarte el link necesito tus datos: nombre, apellido, correo electrónico y teléfono. ¿Me los compartís?

Movimiento `request_payment_link`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Genial! Para dejarlo registrado y enviarte el link necesito tus datos: nombre, apellido, correo electrónico y teléfono. ¿Me los compartís?

Outbound `8c85e4ef-6886-43be-b8f6-f8726f85f89e`; delivery `submitted_to_botpress`; tiempo 2971 ms.

Decisión persistida: `{"turnId": "1fa73c60-e09c-4363-84ff-eb3673df55ab", "outboundId": "8c85e4ef-6886-43be-b8f6-f8726f85f89e", "createdAt": "2026-09-04T15:05:48.268Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:48.329Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T15-05-54-833Z-4f776571-b0ad-4b45-801c-0614ffb6beb8.json.gz`; trace `9daba853-53f4-4f82-b583-eea5a998af41`; turno `615564df-0c51-47dc-9dcf-55ebdaa93a80`.

Cliente: Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

Propuesta del modelo antes de validar:
> ¡Perfecto, Camila! Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Camila! Registré tus datos. Cuando informes el pago, el equipo lo revisará y, si está acreditado, gestionará tu acceso.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `1547dc43-9a42-45f2-9802-ef2c436f502c`; delivery `submitted_to_botpress`; tiempo 3633 ms.

Decisión persistida: `{"turnId": "615564df-0c51-47dc-9dcf-55ebdaa93a80", "outboundId": "1547dc43-9a42-45f2-9802-ef2c436f502c", "createdAt": "2026-09-04T15:05:51.927Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:51.985Z · adaptive-rule-based-v2

Fuente `workflow-adaptive-sale-2026-09-04T15-05-54-833Z-4f776571-b0ad-4b45-801c-0614ffb6beb8.json.gz`; trace `933db303-fc75-4617-8461-d1bf9ecf05e3`; turno `0944b2d1-4f85-484b-93a4-418aa135cb7e`.

Cliente: Listo, ya hice el pago

Propuesta del modelo antes de validar:
> ¡Gracias, Camila! Registré tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Movimiento `{'schema_version': 1, 'move': 'report_payment', 'secondary_moves': [], 'vetoes': [], 'course_reference': None, 'area_reference': None, 'payment_plan': None, 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Camila! Registré tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Outbound `3dcc9c61-847a-441c-9679-dbe3e84c97fb`; delivery `submitted_to_botpress`; tiempo 2831 ms.

Decisión persistida: `{"turnId": "0944b2d1-4f85-484b-93a4-418aa135cb7e", "outboundId": "3dcc9c61-847a-441c-9679-dbe3e84c97fb", "createdAt": "2026-09-04T15:05:54.793Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:55.040Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-06-15-535Z-192c3390-6188-45cc-9b1d-3b09176da1e3.json.gz`; trace `2292249b-4fb5-4948-9905-6e581db70499`; turno `9e61c9e0-997e-4792-850c-2e765ffd13f5`.

Cliente: Estoy mirando la formación Excel Integral. Me gustaría manejar mejor las planillas.

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a del equipo. Excel Integral es ideal para lo que buscás: vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información para trabajar las planillas con mucha más soltura.
> Para orientarte mejor: ¿ya tenés conocimientos previos de Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a del equipo. Excel Integral es ideal para lo que buscás: vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información para trabajar las planillas con mucha más soltura.
>
> Para orientarte mejor: ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles del curso.

Outbound `52967274-3d61-4e9b-9739-3cc718e32e74`; delivery `submitted_to_botpress`; tiempo 3982 ms.

Decisión persistida: `{"turnId": "9e61c9e0-997e-4792-850c-2e765ffd13f5", "outboundId": "52967274-3d61-4e9b-9739-3cc718e32e74", "createdAt": "2026-09-04T15:05:58.994Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:05:59.041Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-06-15-535Z-192c3390-6188-45cc-9b1d-3b09176da1e3.json.gz`; trace `9232332b-be76-4a90-898f-3e04204efdad`; turno `bb83a99d-8f55-4679-a8b5-6715deaf236e`.

Cliente: La alternativa de seis pagos me encaja; por ahora sólo estoy averiguando.

Propuesta del modelo antes de validar:
> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 queda anotada. Como estás averiguando, no hay apuro: cuando quieras avanzar con la inscripción, avisame y te ayudo con los siguientes pasos.
> Mientras tanto, si tenés alguna duda sobre el contenido o el ritmo del curso, estoy por acá para responderte.

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! La opción de 6 pagos mensuales de USD 60 queda anotada. Como estás averiguando, no hay apuro: cuando quieras avanzar con la inscripción, avisame y te ayudo con los siguientes pasos.
>
> Mientras tanto, si tenés alguna duda sobre el contenido o el ritmo del curso, estoy por acá para responderte.

Outbound `ae328036-1a72-4278-933e-7528f041eef0`; delivery `submitted_to_botpress`; tiempo 4077 ms.

Decisión persistida: `{"turnId": "bb83a99d-8f55-4679-a8b5-6715deaf236e", "outboundId": "ae328036-1a72-4278-933e-7528f041eef0", "createdAt": "2026-09-04T15:06:03.057Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:06:03.137Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-06-15-535Z-192c3390-6188-45cc-9b1d-3b09176da1e3.json.gz`; trace `d67ca40d-8168-4e49-9246-5edee9170160`; turno `7169828d-2cba-44e3-8ca7-f5a8fb15bc0c`.

Cliente: Esta quincena paso, lo retomo otro día.

Propuesta del modelo antes de validar:
> Tranquilo/a, no hay problema. Cuando quieras retomarlo, avisame y seguimos desde donde quedamos.

Movimiento `defer_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tranquilo/a, no hay problema. Cuando quieras retomarlo, avisame y seguimos desde donde quedamos.

Outbound `694e423f-1c41-4cfa-bc01-b8b30840e081`; delivery `submitted_to_botpress`; tiempo 3287 ms.

Decisión persistida: `{"turnId": "7169828d-2cba-44e3-8ca7-f5a8fb15bc0c", "outboundId": "694e423f-1c41-4cfa-bc01-b8b30840e081", "createdAt": "2026-09-04T15:06:06.383Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:06:06.442Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-06-15-535Z-192c3390-6188-45cc-9b1d-3b09176da1e3.json.gz`; trace `03ccc3a9-0541-4bf9-8c2b-0ac37a83b04a`; turno `97c7980d-3caa-4b63-acfc-d200b7cd2901`.

Cliente: Anotá mis datos: Emilia Ríos, emilia.rios@example.test, teléfono +1 305 555 0188.

Propuesta del modelo antes de validar:
> ¡Gracias, Emilia! Ya registré tu nombre, apellido, correo y teléfono.
> Para dejarlo todo listo, solo me falta confirmar tu apellido. ¿Me lo confirmás?

Movimiento `provide_contact_details`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Emilia! Para dejarlo todo listo, solo me falta confirmar tu apellido. ¿Me lo confirmás?

Outbound `ea44b935-6ffd-41f9-b2cc-e3f5ef502b98`; delivery `submitted_to_botpress`; tiempo 2835 ms.

Decisión persistida: `{"turnId": "97c7980d-3caa-4b63-acfc-d200b7cd2901", "outboundId": "ea44b935-6ffd-41f9-b2cc-e3f5ef502b98", "createdAt": "2026-09-04T15:06:09.245Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:06:09.298Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-06-15-535Z-192c3390-6188-45cc-9b1d-3b09176da1e3.json.gz`; trace `ef8ffc70-2374-44cf-9213-e8723ec8b78f`; turno `1cd2b240-e994-4e9e-af5b-267128abed9a`.

Cliente: Ahora sí quiero avanzar: pasame el enlace de la opción de seis pagos.

Propuesta del modelo antes de validar:
> ¡Perfecto, Emilia! Para enviarte el enlace de la opción de 6 pagos mensuales de USD 60, solo me falta confirmar tu nombre y apellido. ¿Me los confirmás?

Movimiento `request_payment_link`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Emilia! Para enviarte el enlace de la opción de 6 pagos mensuales de USD 60, solo me falta confirmar tu nombre y apellido. ¿Me los confirmás?

Outbound `0966e5b9-3504-4bf0-8160-29d33342d88e`; delivery `submitted_to_botpress`; tiempo 3073 ms.

Decisión persistida: `{"turnId": "1cd2b240-e994-4e9e-af5b-267128abed9a", "outboundId": "0966e5b9-3504-4bf0-8160-29d33342d88e", "createdAt": "2026-09-04T15:06:12.336Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:06:12.397Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-06-15-535Z-192c3390-6188-45cc-9b1d-3b09176da1e3.json.gz`; trace `947cf70a-ba30-4902-91c7-b74fac9fefdf`; turno `558b433c-875f-4a68-9f63-3d69b0afaecb`.

Cliente: Lo aboné recién, ¿queda registrado el aviso?

Propuesta del modelo antes de validar:
> ¡Gracias, Emilia! Quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Movimiento `report_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Emilia! Quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Outbound `f480248a-fb3e-4362-8511-47b6587628fc`; delivery `submitted_to_botpress`; tiempo 3121 ms.

Decisión persistida: `{"turnId": "558b433c-875f-4a68-9f63-3d69b0afaecb", "outboundId": "f480248a-fb3e-4362-8511-47b6587628fc", "createdAt": "2026-09-04T15:06:15.477Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:06:15.541Z · heldout_v14_course_change_and_optout

Fuente `workflow-heldout-checkpoint-2026-09-04T15-06-28-300Z-fc17bb81-d523-42e8-ab93-04fc4c362328.json.gz`; trace `fe87dbde-a516-443f-b185-d01289f62faa`; turno `b211addf-dec3-41e9-aee2-5a00d521dc94`.

Cliente: Quisiera conocer Redes Informáticas para mejorar en mi trabajo.

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a de la Academia de Oficios. Me alegra que quieras fortalecer tus conocimientos en Redes Informáticas para tu trabajo.
> Para orientarte mejor: ¿ya tenés experiencia en el área de redes o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy asesor/a educativo/a de la Academia de Oficios. Me alegra que quieras fortalecer tus conocimientos en Redes Informáticas para tu trabajo.
>
> Para orientarte mejor: ¿ya tenés experiencia en el área de redes o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles del curso.

Outbound `8faa60b1-d539-49ba-ae04-dadb20cbce34`; delivery `submitted_to_botpress`; tiempo 3598 ms.

Decisión persistida: `{"turnId": "b211addf-dec3-41e9-aee2-5a00d521dc94", "outboundId": "8faa60b1-d539-49ba-ae04-dadb20cbce34", "createdAt": "2026-09-04T15:06:19.112Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:06:19.154Z · heldout_v14_course_change_and_optout

Fuente `workflow-heldout-checkpoint-2026-09-04T15-06-28-300Z-fc17bb81-d523-42e8-ab93-04fc4c362328.json.gz`; trace `515e8874-0fec-4fad-aa39-c584e02255b2`; turno `f3e3da81-56e0-4660-a604-e1d55f694af6`.

Cliente: Me resulta más cómodo escribir; no quiero que me llamen.

Propuesta del modelo antes de validar:
> Perfecto, seguimos por chat sin problema. 👍
> Para orientarte mejor: ¿ya tenés experiencia en el área de redes o partís desde cero?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, seguimos por chat sin problema. 👍

Outbound `3cbf17ce-d8da-47df-9db5-e30c1f5cce05`; delivery `submitted_to_botpress`; tiempo 3637 ms.

Decisión persistida: `{"turnId": "f3e3da81-56e0-4660-a604-e1d55f694af6", "outboundId": "3cbf17ce-d8da-47df-9db5-e30c1f5cce05", "createdAt": "2026-09-04T15:06:22.774Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:06:22.804Z · heldout_v14_course_change_and_optout

Fuente `workflow-heldout-checkpoint-2026-09-04T15-06-28-300Z-fc17bb81-d523-42e8-ab93-04fc4c362328.json.gz`; trace `29491a02-87f3-4bff-8733-d798d3e0469e`; turno `1de9152c-9e9a-4280-a455-8c117ce2baa1`.

Cliente: Cambié de idea sobre el curso: prefiero Excel Integral.

Propuesta del modelo antes de validar:
> ¡Claro! Excel Integral es una gran opción. Es un curso de la Academia de Negocios con 17 clases, 100% online, donde vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información.
> Para orientarte mejor: ¿ya tenés experiencia usando Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Claro! Excel Integral es una gran opción. Es un curso de la Academia de Negocios con 17 clases, 100% online, donde vas a aprender desde las herramientas básicas hasta fórmulas, funciones, gráficos y resúmenes de información.
>
> Para orientarte mejor: ¿ya tenés experiencia usando Excel o partís desde cero?

Outbound `85b82bbf-01a8-4a09-b460-ccade7348c26`; delivery `submitted_to_botpress`; tiempo 3384 ms.

Decisión persistida: `{"turnId": "1de9152c-9e9a-4280-a455-8c117ce2baa1", "outboundId": "85b82bbf-01a8-4a09-b460-ccade7348c26", "createdAt": "2026-09-04T15:06:26.158Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:06:26.210Z · heldout_v14_course_change_and_optout

Fuente `workflow-heldout-checkpoint-2026-09-04T15-06-28-300Z-fc17bb81-d523-42e8-ab93-04fc4c362328.json.gz`; trace `71158ab3-f2e5-484b-bb1d-cbe5d7d1c474`; turno `53a6a402-e493-4aaa-a625-9e4ec94bf40e`.

Cliente: Dame de baja, no me escriban más.

Salida autorizada y capturada:
> Listo, no te enviaremos más mensajes.

Outbound `1e4d9a4b-e269-4d37-bad9-6ba8fd88c8ff`; delivery `submitted_to_botpress`; tiempo 1029 ms.

Decisión persistida: `{"turnId": "53a6a402-e493-4aaa-a625-9e4ec94bf40e", "outboundId": "1e4d9a4b-e269-4d37-bad9-6ba8fd88c8ff", "createdAt": "2026-09-04T15:06:27.225Z", "reasonCode": "EXPLICIT_OPT_OUT_ACK", "responseType": "opt_out_ack", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-sales-v17", "modelName": "deterministic:opt-out-ack-v1"}`.

## 2026-09-04T15:06:27.251Z · heldout_v14_course_change_and_optout

Fuente `workflow-heldout-checkpoint-2026-09-04T15-06-28-300Z-fc17bb81-d523-42e8-ab93-04fc4c362328.json.gz`; trace `9f74c310-ced2-40fc-90be-208c5891b562`; turno `55fc4179-45fc-4161-8a32-95049f1e138a`.

Cliente: Que quede claro que sigo de baja.

Salida autorizada y capturada:
*(silencio; consultar decisión y disponibilidad del turno)*

Outbound `None`; delivery `None`; tiempo 1031 ms.

Decisión persistida: `{"turnId": "55fc4179-45fc-4161-8a32-95049f1e138a", "outboundId": null, "createdAt": "2026-09-04T15:06:28.274Z", "reasonCode": "CONSENT_REVOKED", "responseType": null, "hasResponse": false, "businessActionType": null, "promptVersion": "studyx-agent-a-sales-v17", "modelName": "policy:opt-out"}`.

## 2026-09-04T15:15:04.871Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-15-26-011Z-4aed34e4-1a29-43ed-8875-d97c1f62b5ea.json.gz`; trace `2fd453e5-3c21-41dc-83f3-a25df8d98579`; turno `2fa7d0df-08b3-47be-9a09-0a261188037b`.

Cliente: Estoy mirando la formación Excel Integral. Me gustaría manejar mejor las planillas.

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy tu asesor/a educativo/a. Excel Integral es una gran elección para manejar mejor las planillas: son 17 clases donde vas a aprender fórmulas, funciones, gráficos y a resumir información de forma práctica.
> Para orientarte mejor, ¿ya tenés experiencia usando Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy tu asesor/a educativo/a. Excel Integral es una gran elección para manejar mejor las planillas: son 17 clases donde vas a aprender fórmulas, funciones, gráficos y a resumir información de forma práctica.
>
> Para orientarte mejor, ¿ya tenés experiencia usando Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

Outbound `781aa295-c14b-4256-be02-4f0685099610`; delivery `submitted_to_botpress`; tiempo 4466 ms.

Decisión persistida: `{"turnId": "2fa7d0df-08b3-47be-9a09-0a261188037b", "outboundId": "781aa295-c14b-4256-be02-4f0685099610", "createdAt": "2026-09-04T15:15:09.275Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:15:09.354Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-15-26-011Z-4aed34e4-1a29-43ed-8875-d97c1f62b5ea.json.gz`; trace `a2dc2459-caf1-4041-9edd-56115d9099f3`; turno `420b2a9a-6dfc-4029-8020-715e9b9816f6`.

Cliente: La alternativa de seis pagos me encaja; por ahora sólo estoy averiguando.

Propuesta del modelo antes de validar:
> Perfecto, la opción de 6 pagos mensuales de USD 60 te queda registrada. Y sin problema que estés averiguando por ahora, cuando quieras avanzar con la inscripción me avisás y te ayudo con los siguientes pasos.

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, la opción de 6 pagos mensuales de USD 60 te queda registrada. Y sin problema que estés averiguando por ahora, cuando quieras avanzar con la inscripción me avisás y te ayudo con los siguientes pasos.

Outbound `11f1a228-61b9-47fa-b492-ceb7d944d243`; delivery `submitted_to_botpress`; tiempo 3782 ms.

Decisión persistida: `{"turnId": "420b2a9a-6dfc-4029-8020-715e9b9816f6", "outboundId": "11f1a228-61b9-47fa-b492-ceb7d944d243", "createdAt": "2026-09-04T15:15:13.091Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:15:13.153Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-15-26-011Z-4aed34e4-1a29-43ed-8875-d97c1f62b5ea.json.gz`; trace `2140d490-cce1-4548-af8a-3883704c20e3`; turno `a93beeee-48e1-4158-9815-3ad71d8e00b4`.

Cliente: Esta quincena paso, lo retomo otro día.

Propuesta del modelo antes de validar:
> Tranquilo/a, no hay problema. Queda todo registrado: cuando quieras retomar la inscripción con la opción de 6 pagos de USD 60, solo avisame por acá y seguimos.

Movimiento `defer_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tranquilo/a, no hay problema. Queda todo registrado: cuando quieras retomar la inscripción con la opción de 6 pagos de USD 60, solo avisame por acá y seguimos.

Outbound `979745d8-39a3-4528-ae1f-ebfcfbe0f327`; delivery `submitted_to_botpress`; tiempo 3661 ms.

Decisión persistida: `{"turnId": "a93beeee-48e1-4158-9815-3ad71d8e00b4", "outboundId": "979745d8-39a3-4528-ae1f-ebfcfbe0f327", "createdAt": "2026-09-04T15:15:16.786Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:15:16.834Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-15-26-011Z-4aed34e4-1a29-43ed-8875-d97c1f62b5ea.json.gz`; trace `63b16e52-2ea1-473e-af22-59b8c95e3440`; turno `a1b962cf-1f12-4236-a44d-ef338492590a`.

Cliente: Anotá mis datos: Emilia Ríos, emilia.rios@example.test, teléfono +1 305 555 0188.

Propuesta del modelo antes de validar:
> ¡Gracias, Emilia! Quedaron registrados tu nombre, correo y teléfono. Cuando quieras avanzar con la inscripción en Excel Integral con la opción de 6 pagos de USD 60, avisame y te comparto el link de pago.

Movimiento `provide_contact_details`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Emilia! Quedaron registrados tu nombre, correo y teléfono. Cuando quieras avanzar con la inscripción en Excel Integral con la opción de 6 pagos de USD 60, avisame y te comparto el link de pago.

Outbound `4c2a896e-8eee-4b5a-beed-5896597e1dfc`; delivery `submitted_to_botpress`; tiempo 2957 ms.

Decisión persistida: `{"turnId": "a1b962cf-1f12-4236-a44d-ef338492590a", "outboundId": "4c2a896e-8eee-4b5a-beed-5896597e1dfc", "createdAt": "2026-09-04T15:15:19.759Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:15:19.809Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-15-26-011Z-4aed34e4-1a29-43ed-8875-d97c1f62b5ea.json.gz`; trace `f64e2786-72c3-46e6-bacf-754164b0905c`; turno `bf43c6f1-e67a-4f9a-8a82-c7ef234ac0b4`.

Cliente: Ahora sí quiero avanzar: pasame el enlace de la opción de seis pagos.

Propuesta del modelo antes de validar:
> ¡Perfecto, Emilia! Te comparto el enlace de pago para la opción de 6 pagos de USD 60. Cuando hagas el pago, avisame por acá.

Movimiento `{'schema_version': 1, 'move': 'request_payment_link', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': 'monthly_6', 'confidence': 1.0}`; acción `{'type': 'send_payment_link', 'offering_code': 'excel_integral', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Emilia! Te comparto el enlace de pago para la opción de 6 pagos de USD 60. Cuando hagas el pago, avisame por acá.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `32e605ee-3df6-46fd-84aa-2b323a034f41`; delivery `submitted_to_botpress`; tiempo 3178 ms.

Decisión persistida: `{"turnId": "bf43c6f1-e67a-4f9a-8a82-c7ef234ac0b4", "outboundId": "32e605ee-3df6-46fd-84aa-2b323a034f41", "createdAt": "2026-09-04T15:15:22.957Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:15:23.007Z · heldout_v14_consent_after_deferral

Fuente `workflow-heldout-checkpoint-2026-09-04T15-15-26-011Z-4aed34e4-1a29-43ed-8875-d97c1f62b5ea.json.gz`; trace `3365f1b1-f0b4-4e0f-babd-1dd400151f9f`; turno `e59d0f87-0487-4cfb-b07f-3f9e7f5d4cc2`.

Cliente: Lo aboné recién, ¿queda registrado el aviso?

Propuesta del modelo antes de validar:
> ¡Gracias, Emilia! Quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Movimiento `report_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Emilia! Quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Outbound `94ebdfcb-3875-4a29-b2ab-aec7469b9a2d`; delivery `submitted_to_botpress`; tiempo 2993 ms.

Decisión persistida: `{"turnId": "e59d0f87-0487-4cfb-b07f-3f9e7f5d4cc2", "outboundId": "94ebdfcb-3875-4a29-b2ab-aec7469b9a2d", "createdAt": "2026-09-04T15:15:25.983Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:15:34.355Z · heldout_intake_v2_structured_identity

Fuente `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-15-44-699Z-abd0e729-7f72-42a8-a5cc-a916029a9356.json.gz`; trace `a631c2dd-fb06-4480-8cbc-1b3ca490db1c`; turno `0d5c31af-f306-4835-a1e9-9a407ec3e3d7`.

Cliente: Buenas, quisiera formarme en Maquillaje Profesional para trabajar por mi cuenta.

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu formación en Maquillaje Profesional.
> Antes de contarte los detalles, ¿ya tenías pensado dedicarte al maquillaje profesional o recién estás empezando a explorar esta salida laboral?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y te voy a acompañar en tu formación en Maquillaje Profesional.
>
> Antes de contarte los detalles, ¿ya tenías pensado dedicarte al maquillaje profesional o recién estás empezando a explorar esta salida laboral?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `0e45b0c5-bf88-44ae-bf5c-f1401879de30`; delivery `submitted_to_botpress`; tiempo 3926 ms.

Decisión persistida: `{"turnId": "0d5c31af-f306-4835-a1e9-9a407ec3e3d7", "outboundId": "0e45b0c5-bf88-44ae-bf5c-f1401879de30", "createdAt": "2026-09-04T15:15:38.215Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:15:38.300Z · heldout_intake_v2_structured_identity

Fuente `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-15-44-699Z-abd0e729-7f72-42a8-a5cc-a916029a9356.json.gz`; trace `4453af9f-6a75-4da8-aa81-5d8ed9f451e2`; turno `e796423e-9883-41c9-b2e0-66f5182d54bc`.

Cliente: Prefiero hacer un pago único.

Propuesta del modelo antes de validar:
> Perfecto, el pago único de USD 360 es una gran opción. ¿Querés que avancemos con eso para dejarlo registrado?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, el pago único de USD 360 es una gran opción. ¿Querés que avancemos con eso para dejarlo registrado?

Outbound `f94fe3ed-31f3-4584-bb03-65c2f5ffe1bc`; delivery `submitted_to_botpress`; tiempo 3699 ms.

Decisión persistida: `{"turnId": "e796423e-9883-41c9-b2e0-66f5182d54bc", "outboundId": "f94fe3ed-31f3-4584-bb03-65c2f5ffe1bc", "createdAt": "2026-09-04T15:15:41.952Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:15:42.014Z · heldout_intake_v2_structured_identity

Fuente `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-15-44-699Z-abd0e729-7f72-42a8-a5cc-a916029a9356.json.gz`; trace `cb7aec31-cfb2-4e37-b237-0a1f30e80ddc`; turno `e89eae44-89f4-405d-9c8e-d241b664d225`.

Cliente: Nombre y apellido: Valentina Costa
Email: valentina.costa@example.test
Celular: +1 (786) 555-0164

Propuesta del modelo antes de validar:
> ¡Gracias, Valentina! Me falta tu apellido para dejar todo registrado. ¿Me lo confirmás?

Movimiento `provide_contact_details`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Gracias, Valentina! ¿Me lo confirmás?

Outbound `a2fe2d6e-e058-4d14-b614-cbfe67ebc3f8`; delivery `submitted_to_botpress`; tiempo 2672 ms.

Decisión persistida: `{"turnId": "e89eae44-89f4-405d-9c8e-d241b664d225", "outboundId": "a2fe2d6e-e058-4d14-b614-cbfe67ebc3f8", "createdAt": "2026-09-04T15:15:44.650Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:20:24.865Z · heldout_intake_v3_structured_identity

Fuente `workflow-intake-heldout-v3-checkpoint-2026-09-04T15-20-41-436Z-9697f7aa-70e8-442d-8cba-379243c961f1.json.gz`; trace `f80ac090-f0f8-4ba8-bb37-30c221f4242b`; turno `a21c32fb-b4ff-4f96-929a-e4dda8bb5b50`.

Cliente: Me interesa Excel Integral para organizar mejor los números de mi emprendimiento.

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Excel Integral es ideal para poner en orden los números de tu emprendimiento: vas a aprender fórmulas, funciones, gráficos y resúmenes de información para tomar mejores decisiones.
> Antes de contarte más, ¿ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos. Excel Integral es ideal para poner en orden los números de tu emprendimiento: vas a aprender fórmulas, funciones, gráficos y resúmenes de información para tomar mejores decisiones.
>
> Antes de contarte más, ¿ya tenías pensado estudiar Excel o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `825fab84-f1b4-47f2-899a-876159e520f3`; delivery `submitted_to_botpress`; tiempo 4194 ms.

Decisión persistida: `{"turnId": "a21c32fb-b4ff-4f96-929a-e4dda8bb5b50", "outboundId": "825fab84-f1b4-47f2-899a-876159e520f3", "createdAt": "2026-09-04T15:20:28.979Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:20:29.075Z · heldout_intake_v3_structured_identity

Fuente `workflow-intake-heldout-v3-checkpoint-2026-09-04T15-20-41-436Z-9697f7aa-70e8-442d-8cba-379243c961f1.json.gz`; trace `918bf6c0-671f-4128-be95-887a154936dc`; turno `20b363e2-dbc2-491b-a671-6527165ab2f7`.

Cliente: Para pagarlo, elijo la alternativa de doce cuotas.

Propuesta del modelo antes de validar:
> ¡Perfecto! La opción de 12 pagos mensuales de USD 30 es una gran elección. El total del programa es USD 360.
> ¿Querés que avancemos con el registro para dejarlo listo?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! La opción de 12 pagos mensuales de USD 30 es una gran elección. El total del programa es USD 360.
>
> ¿Querés que avancemos con el registro para dejarlo listo?

Outbound `5c166afc-9e5e-402c-9b65-b80ea531252c`; delivery `submitted_to_botpress`; tiempo 3190 ms.

Decisión persistida: `{"turnId": "20b363e2-dbc2-491b-a671-6527165ab2f7", "outboundId": "5c166afc-9e5e-402c-9b65-b80ea531252c", "createdAt": "2026-09-04T15:20:32.215Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:20:32.280Z · heldout_intake_v3_structured_identity

Fuente `workflow-intake-heldout-v3-checkpoint-2026-09-04T15-20-41-436Z-9697f7aa-70e8-442d-8cba-379243c961f1.json.gz`; trace `54aa0a68-f57d-44e6-8004-814640fa3a04`; turno `d195d9d5-e157-462a-ad0b-930fbde8bd13`.

Cliente: Mis datos personales:
Mariana O’Connor;
correo electrónico: mariana.oconnor@example.test
teléfono: +1 407 555 0152

Propuesta del modelo antes de validar:
> ¡Gracias, Mariana! Quedó registrado tu nombre, correo y teléfono. Te comparto el link de pago para la opción de 12 pagos mensuales de USD 30.

Movimiento `{'schema_version': 1, 'move': 'provide_contact_details', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': 'monthly_12', 'confidence': 1.0}`; acción `{'type': 'send_payment_link', 'offering_code': 'excel_integral', 'payment_plan': 'monthly_12'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> ¡Gracias, Mariana! Quedó registrado tu nombre, correo y teléfono. Cuando confirmes que querés avanzar con el pago, te comparto el link de la opción de 12 pagos mensuales de USD 30.

Movimiento `provide_contact_details`; acción `{'type': 'none'}`; repair_of `{'rejection_id': '4309b455-30de-479f-9b6b-1fe84f804e09', 'attempt': 1}`.

Salida autorizada y capturada:
> ¡Gracias, Mariana! Quedó registrado tu nombre, correo y teléfono. Cuando confirmes que querés avanzar con el pago, te comparto el link de la opción de 12 pagos mensuales de USD 30.

Outbound `f9ad7cd3-1f8e-48c1-8627-55c8495af305`; delivery `submitted_to_botpress`; tiempo 5945 ms.

Decisión persistida: `{"turnId": "d195d9d5-e157-462a-ad0b-930fbde8bd13", "outboundId": "f9ad7cd3-1f8e-48c1-8627-55c8495af305", "createdAt": "2026-09-04T15:20:38.194Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:20:38.244Z · heldout_intake_v3_structured_identity

Fuente `workflow-intake-heldout-v3-checkpoint-2026-09-04T15-20-41-436Z-9697f7aa-70e8-442d-8cba-379243c961f1.json.gz`; trace `41e2ff5a-2648-4a4b-b46e-4197b9141348`; turno `0f28edca-dda6-483b-a68c-8727705c44d1`.

Cliente: Ya podés pasarme el enlace para pagar en doce cuotas.

Propuesta del modelo antes de validar:
> ¡Perfecto, Mariana! Te comparto el enlace para el pago de la opción de 12 pagos mensuales de USD 30.

Movimiento `{'schema_version': 1, 'move': 'request_payment_link', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'excel_integral', 'area_reference': None, 'payment_plan': 'monthly_12', 'confidence': 1.0}`; acción `{'type': 'send_payment_link', 'offering_code': 'excel_integral', 'payment_plan': 'monthly_12'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Mariana! Te comparto el enlace para el pago de la opción de 12 pagos mensuales de USD 30.
>
> 12 pagos mensuales de USD 30: https://example.invalid/eval/12m

Outbound `03c575ca-34e8-4b6f-a1c2-783fc687fc8a`; delivery `submitted_to_botpress`; tiempo 3179 ms.

Decisión persistida: `{"turnId": "0f28edca-dda6-483b-a68c-8727705c44d1", "outboundId": "03c575ca-34e8-4b6f-a1c2-783fc687fc8a", "createdAt": "2026-09-04T15:20:41.394Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:20:41.594Z · heldout_intake_v2_structured_identity

Fuente `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-20-56-532Z-223dc148-49cc-4bf1-84a3-5ca175702c86.json.gz`; trace `11205d25-69c4-445c-94b7-bb081fe076c9`; turno `dffa60e3-0580-438f-bfba-8933afbd2a13`.

Cliente: Buenas, quisiera formarme en Maquillaje Profesional para trabajar por mi cuenta.

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte.
> Maquillaje Profesional es ideal si querés trabajar por tu cuenta: son 38 clases donde vas a aprender a reconocer materiales, tipos de piel, formas de rostro y a asesorar a cada clienta según lo que necesita. Antes de contarte más, ¿ya tenías pensado empezar con esto o recién estás averiguando?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte.
>
> Maquillaje Profesional es ideal si querés trabajar por tu cuenta: son 38 clases donde vas a aprender a reconocer materiales, tipos de piel, formas de rostro y a asesorar a cada clienta según lo que necesita. Antes de contarte más, ¿ya tenías pensado empezar con esto o recién estás averiguando?
>
> Si querés, podemos coordinar una llamada breve para orientarte mejor.

Outbound `5d8a18c4-6a76-49b7-a359-27f4040654d9`; delivery `submitted_to_botpress`; tiempo 4883 ms.

Decisión persistida: `{"turnId": "dffa60e3-0580-438f-bfba-8933afbd2a13", "outboundId": "5d8a18c4-6a76-49b7-a359-27f4040654d9", "createdAt": "2026-09-04T15:20:46.425Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:20:46.494Z · heldout_intake_v2_structured_identity

Fuente `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-20-56-532Z-223dc148-49cc-4bf1-84a3-5ca175702c86.json.gz`; trace `1c32644e-4b0f-440f-8253-3ec6ec8b6aa3`; turno `1192d120-8d36-48b4-84c7-0fdf62c2021e`.

Cliente: Prefiero hacer un pago único.

Propuesta del modelo antes de validar:
> Perfecto, el pago único es de USD 360 y con eso queda confirmada tu inscripción con acceso completo a la plataforma. ¿Querés que avancemos con eso?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¿Querés que avancemos con eso?

Outbound `52dba3ab-1e1d-4866-a70a-77a8747cb387`; delivery `submitted_to_botpress`; tiempo 3657 ms.

Decisión persistida: `{"turnId": "1192d120-8d36-48b4-84c7-0fdf62c2021e", "outboundId": "52dba3ab-1e1d-4866-a70a-77a8747cb387", "createdAt": "2026-09-04T15:20:50.105Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:20:50.167Z · heldout_intake_v2_structured_identity

Fuente `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-20-56-532Z-223dc148-49cc-4bf1-84a3-5ca175702c86.json.gz`; trace `975df9d1-4aa1-4005-98d3-7e018a8d5d17`; turno `64df61bb-388b-470f-84a2-aaa3375a3144`.

Cliente: Nombre y apellido: Valentina Costa
Email: valentina.costa@example.test
Celular: +1 (786) 555-0164

Propuesta del modelo antes de validar:
> ¡Perfecto, Valentina! Quedó registrado tu pago único de USD 360 para Maquillaje Profesional. Cuando hagas el pago, avisame por acá. 😊

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'maquillaje_profesional', 'payment_plan': 'one_time'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Valentina! Cuando hagas el pago, avisame por acá. 😊

Outbound `6077c944-5c75-4382-973d-88aedff14c4e`; delivery `submitted_to_botpress`; tiempo 3071 ms.

Decisión persistida: `{"turnId": "64df61bb-388b-470f-84a2-aaa3375a3144", "outboundId": "6077c944-5c75-4382-973d-88aedff14c4e", "createdAt": "2026-09-04T15:20:53.215Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:20:53.252Z · heldout_intake_v2_structured_identity

Fuente `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-20-56-532Z-223dc148-49cc-4bf1-84a3-5ca175702c86.json.gz`; trace `30aa9d89-9728-4e12-96fc-90e89f8a2e6b`; turno `4fcca9a3-3edd-4169-b520-9e0f092b343c`.

Cliente: Sí, enviame ahora el enlace para abonar todo junto.

Propuesta del modelo antes de validar:
> ¡Listo, Valentina! Te dejo el enlace para el pago único de USD 360. Cuando hagas el pago, avisame por acá. 😊

Movimiento `{'schema_version': 1, 'move': 'request_payment_link', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'maquillaje_profesional', 'area_reference': 'academia-de-moda-y-belleza', 'payment_plan': 'one_time', 'confidence': 1.0}`; acción `{'type': 'send_payment_link', 'offering_code': 'maquillaje_profesional', 'payment_plan': 'one_time'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Listo, Valentina! Te dejo el enlace para el pago único de USD 360. Cuando hagas el pago, avisame por acá. 😊
>
> Pago único de USD 360: https://example.invalid/eval/contado

Outbound `4af12536-58bc-445e-b0e0-d77af94f5b29`; delivery `submitted_to_botpress`; tiempo 3265 ms.

Decisión persistida: `{"turnId": "4fcca9a3-3edd-4169-b520-9e0f092b343c", "outboundId": "4af12536-58bc-445e-b0e0-d77af94f5b29", "createdAt": "2026-09-04T15:20:56.481Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v17", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:27:36.419Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-28-05-235Z-fa6a58f7-327a-4163-a6d7-c537f8c47bb4.json.gz`; trace `5e2b8aaf-f7f8-4fcf-b1ed-43207dae76d9`; turno `d73dc080-7f34-4ebc-b8b4-020008d32266`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos y te voy a acompañar con Redes Informáticas. Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos y te voy a acompañar con Redes Informáticas. Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos conversarlo por una llamada breve para orientarte mejor.

Outbound `a3de201d-c553-4599-93b4-f4d8cb253cec`; delivery `submitted_to_botpress`; tiempo 3719 ms.

Decisión persistida: `{"turnId": "d73dc080-7f34-4ebc-b8b4-020008d32266", "outboundId": "a3de201d-c553-4599-93b4-f4d8cb253cec", "createdAt": "2026-09-04T15:27:40.081Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:27:40.140Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-28-05-235Z-fa6a58f7-327a-4163-a6d7-c537f8c47bb4.json.gz`; trace `11e1b454-21d3-41fe-b277-c291306c818f`; turno `671e6d3d-7729-4921-9d7d-c088700f4c60`.

Cliente: Prefiero no hablar por teléfono, sigamos por acá

Propuesta del modelo antes de validar:
> ¡Perfecto, seguimos por acá sin problema! 👍
> Para orientarte mejor: ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, seguimos por acá sin problema! 👍

Outbound `174d16ea-67d3-4497-8504-d0d80b2130ba`; delivery `submitted_to_botpress`; tiempo 3279 ms.

Decisión persistida: `{"turnId": "671e6d3d-7729-4921-9d7d-c088700f4c60", "outboundId": "174d16ea-67d3-4497-8504-d0d80b2130ba", "createdAt": "2026-09-04T15:27:43.385Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:27:43.421Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-28-05-235Z-fa6a58f7-327a-4163-a6d7-c537f8c47bb4.json.gz`; trace `c79b1d16-4c76-453c-ac97-65eb5f9c9459`; turno `010d531c-bdcb-4ca2-86e1-513751d340bd`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Outbound `d0c3d7c3-a942-4126-9064-ae6827498f2c`; delivery `submitted_to_botpress`; tiempo 3133 ms.

Decisión persistida: `{"turnId": "010d531c-bdcb-4ca2-86e1-513751d340bd", "outboundId": "d0c3d7c3-a942-4126-9064-ae6827498f2c", "createdAt": "2026-09-04T15:27:46.519Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:27:46.555Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-28-05-235Z-fa6a58f7-327a-4163-a6d7-c537f8c47bb4.json.gz`; trace `aca1c65a-2ee6-4c2e-96df-f9045d8b5845`; turno `861121ce-cc0d-4c95-b39b-76cbc3f31526`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.
> ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar?

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.
>
> ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar?

Outbound `6ca6c1c3-ed65-4002-a51b-728e5e43c23f`; delivery `submitted_to_botpress`; tiempo 3345 ms.

Decisión persistida: `{"turnId": "861121ce-cc0d-4c95-b39b-76cbc3f31526", "outboundId": "6ca6c1c3-ed65-4002-a51b-728e5e43c23f", "createdAt": "2026-09-04T15:27:49.867Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:27:49.902Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-28-05-235Z-fa6a58f7-327a-4163-a6d7-c537f8c47bb4.json.gz`; trace `16f43f2c-1255-4ee9-9678-b0611e568c5a`; turno `31cbe65e-b644-4598-9f31-80c63735d0ee`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> ¡Perfecto! Quedamos con 6 pagos mensuales de USD 60, total USD 360. ¿Querés que te envíe el link de pago para avanzar?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! Quedamos con 6 pagos mensuales de USD 60, total USD 360. ¿Querés que te envíe el link de pago para avanzar?

Outbound `1e13835b-8003-4473-91cc-d9a2e8df7424`; delivery `submitted_to_botpress`; tiempo 3377 ms.

Decisión persistida: `{"turnId": "31cbe65e-b644-4598-9f31-80c63735d0ee", "outboundId": "1e13835b-8003-4473-91cc-d9a2e8df7424", "createdAt": "2026-09-04T15:27:53.260Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:27:53.280Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-28-05-235Z-fa6a58f7-327a-4163-a6d7-c537f8c47bb4.json.gz`; trace `6a522f91-9939-425f-8999-eb535f63f368`; turno `c78c3bad-ff50-4ed8-9e3a-80e67c58701c`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360, y podés elegir 6 pagos mensuales de USD 60, 12 pagos de USD 30 o un pago único de USD 360.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360, y podés elegir 6 pagos mensuales de USD 60, 12 pagos de USD 30 o un pago único de USD 360.

Outbound `0c9b67e6-a788-49b8-84d1-82230b383ec4`; delivery `submitted_to_botpress`; tiempo 3266 ms.

Decisión persistida: `{"turnId": "c78c3bad-ff50-4ed8-9e3a-80e67c58701c", "outboundId": "0c9b67e6-a788-49b8-84d1-82230b383ec4", "createdAt": "2026-09-04T15:27:56.513Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:27:56.547Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-28-05-235Z-fa6a58f7-327a-4163-a6d7-c537f8c47bb4.json.gz`; trace `18e32423-afab-46f5-9385-5b9a964c7b98`; turno `7cfa156b-db17-4a2f-b3be-582f9db464c4`.

Cliente: Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

Propuesta del modelo antes de validar:
> ¡Gracias, Camila! Quedó registrado tu nombre, correo y teléfono. Te envío el link de pago para las 6 cuotas de USD 60.

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> ¡Gracias, Camila! Quedó registrado tu nombre, correo y teléfono. Ya tenés todo listo para avanzar con el pago de las 6 cuotas de USD 60. ¿Querés que te envíe el link de pago?

Movimiento `provide_contact_details`; acción `{'type': 'none'}`; repair_of `{'rejection_id': '1cd79e7e-9d47-46e9-a585-43f9a7fa7a99', 'attempt': 1}`.

Salida autorizada y capturada:
> ¡Gracias, Camila! Quedó registrado tu nombre, correo y teléfono. Ya tenés todo listo para avanzar con el pago de las 6 cuotas de USD 60. ¿Querés que te envíe el link de pago?

Outbound `02f425ad-ce48-47d2-b8a4-ef9456dc9c74`; delivery `submitted_to_botpress`; tiempo 5853 ms.

Decisión persistida: `{"turnId": "7cfa156b-db17-4a2f-b3be-582f9db464c4", "outboundId": "02f425ad-ce48-47d2-b8a4-ef9456dc9c74", "createdAt": "2026-09-04T15:28:02.295Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:28:02.443Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-28-05-235Z-fa6a58f7-327a-4163-a6d7-c537f8c47bb4.json.gz`; trace `4905526f-ffc7-4afa-b283-b5afc98bf345`; turno `1354e262-72ab-4720-a6d9-409fc59c0dff`.

Cliente: Sí, ahora mandame el link de las seis cuotas

Propuesta del modelo antes de validar:
> ¡Perfecto, Camila! Te envío el link de pago de las 6 cuotas de USD 60.

Movimiento `request_payment_link`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Camila! Te envío el link de pago de las 6 cuotas de USD 60.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `fed5e18f-4c48-4647-bfc7-873af3d543a3`; delivery `submitted_to_botpress`; tiempo 2780 ms.

Decisión persistida: `{"turnId": "1354e262-72ab-4720-a6d9-409fc59c0dff", "outboundId": "fed5e18f-4c48-4647-bfc7-873af3d543a3", "createdAt": "2026-09-04T15:28:05.201Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:28:05.415Z · heldout_intake_v3_structured_identity

Fuente `workflow-intake-heldout-v3-checkpoint-2026-09-04T15-28-21-485Z-70f3f55f-a37b-4ce6-9404-3f328e0efb15.json.gz`; trace `cd310330-2962-4110-8229-e6fa2f499652`; turno `5127c48b-a9aa-4ca8-999d-63803dca244f`.

Cliente: Me interesa Excel Integral para organizar mejor los números de mi emprendimiento.

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Negocios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte. Excel Integral es ideal para lo que buscás: aprender a organizar y analizar los números de tu emprendimiento con fórmulas, funciones y gráficos.
> Para orientarte mejor, ¿ya tenés conocimientos previos de Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Negocios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte. Excel Integral es ideal para lo que buscás: aprender a organizar y analizar los números de tu emprendimiento con fórmulas, funciones y gráficos.
>
> Para orientarte mejor, ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte cómo se adapta el curso a tu caso.

Outbound `1fb666e5-1843-44d6-89f3-208e81b31991`; delivery `submitted_to_botpress`; tiempo 4244 ms.

Decisión persistida: `{"turnId": "5127c48b-a9aa-4ca8-999d-63803dca244f", "outboundId": "1fb666e5-1843-44d6-89f3-208e81b31991", "createdAt": "2026-09-04T15:28:09.619Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:28:09.675Z · heldout_intake_v3_structured_identity

Fuente `workflow-intake-heldout-v3-checkpoint-2026-09-04T15-28-21-485Z-70f3f55f-a37b-4ce6-9404-3f328e0efb15.json.gz`; trace `61235cfb-6ce2-4659-ad9a-da377c897bc8`; turno `e6a25354-af08-4d15-8c2e-43b511867059`.

Cliente: Para pagarlo, elijo la alternativa de doce cuotas.

Propuesta del modelo antes de validar:
> Perfecto, la opción de 12 pagos mensuales de USD 30 es una gran elección. ¿Querés que avancemos con eso para dejarlo registrado?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, la opción de 12 pagos mensuales de USD 30 es una gran elección. ¿Querés que avancemos con eso para dejarlo registrado?

Outbound `4c3f17b1-bfc5-4852-a3ef-859ef694d809`; delivery `submitted_to_botpress`; tiempo 3361 ms.

Decisión persistida: `{"turnId": "e6a25354-af08-4d15-8c2e-43b511867059", "outboundId": "4c3f17b1-bfc5-4852-a3ef-859ef694d809", "createdAt": "2026-09-04T15:28:13.011Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:28:13.051Z · heldout_intake_v3_structured_identity

Fuente `workflow-intake-heldout-v3-checkpoint-2026-09-04T15-28-21-485Z-70f3f55f-a37b-4ce6-9404-3f328e0efb15.json.gz`; trace `c60d1810-5154-41ea-a966-f93565f94cfd`; turno `f9da0b22-5b19-43f7-abeb-688f90c3626c`.

Cliente: Mis datos personales:
Mariana O’Connor;
correo electrónico: mariana.oconnor@example.test
teléfono: +1 407 555 0152

Propuesta del modelo antes de validar:
> ¡Gracias, Mariana! Quedó registrado tu nombre, correo y teléfono. Te comparto el link de pago para la opción de 12 pagos mensuales de USD 30. Cuando hagas el pago, avisame por acá.

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'excel_integral', 'payment_plan': 'monthly_12'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> ¡Gracias, Mariana! Ya quedaron registrados tus datos. Cuando estés lista para avanzar con el pago de las 12 cuotas de USD 30, avisame por acá y te comparto el link.

Movimiento `provide_contact_details`; acción `{'type': 'none'}`; repair_of `{'rejection_id': '96345922-3b11-4fe2-9595-15d13ea2de21', 'attempt': 1}`.

Salida autorizada y capturada:
> ¡Gracias, Mariana! Ya quedaron registrados tus datos. Cuando estés lista para avanzar con el pago de las 12 cuotas de USD 30, avisame por acá y te comparto el link.

Outbound `87b7981b-8e94-4e83-b6eb-bf7cfab40acc`; delivery `submitted_to_botpress`; tiempo 5561 ms.

Decisión persistida: `{"turnId": "f9da0b22-5b19-43f7-abeb-688f90c3626c", "outboundId": "87b7981b-8e94-4e83-b6eb-bf7cfab40acc", "createdAt": "2026-09-04T15:28:18.583Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:28:18.631Z · heldout_intake_v3_structured_identity

Fuente `workflow-intake-heldout-v3-checkpoint-2026-09-04T15-28-21-485Z-70f3f55f-a37b-4ce6-9404-3f328e0efb15.json.gz`; trace `a54093b0-aa65-4020-923b-e9792b988dfd`; turno `ebd53392-31c9-43e7-9822-0645bf9b0064`.

Cliente: Ya podés pasarme el enlace para pagar en doce cuotas.

Propuesta del modelo antes de validar:
> ¡Perfecto, Mariana! Te comparto el enlace para el pago de las 12 cuotas de USD 30.

Movimiento `request_payment_link`; acción `{'type': 'send_payment_link', 'offering_code': 'excel_integral', 'payment_plan': 'monthly_12'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Mariana! Te comparto el enlace para el pago de las 12 cuotas de USD 30.
>
> 12 pagos mensuales de USD 30: https://example.invalid/eval/12m

Outbound `d73e639e-8d7b-445d-bd45-88e56fa293dc`; delivery `submitted_to_botpress`; tiempo 2843 ms.

Decisión persistida: `{"turnId": "ebd53392-31c9-43e7-9822-0645bf9b0064", "outboundId": "d73e639e-8d7b-445d-bd45-88e56fa293dc", "createdAt": "2026-09-04T15:28:21.453Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v18", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:30:46.712Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `7accd94d-770d-47a3-b076-43a5296ecbf0`; turno `4862d05c-54a1-4887-8705-c8400021cb49`.

Cliente: Hola, quería saber qué formaciones tienen en tecnología

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesoría educativa. En tecnología tenemos la formación en Armado y Reparación de PC, dentro de nuestra Academia de Oficios. ¿Te interesa ese área o buscás algo más específico?

Movimiento `browse_catalog`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesoría educativa. En tecnología tenemos la formación en Armado y Reparación de PC, dentro de nuestra Academia de Oficios. ¿Te interesa ese área o buscás algo más específico?

Outbound `99eeb532-f8bd-49b8-9468-034ae4c12341`; delivery `submitted_to_botpress`; tiempo 4157 ms.

Decisión persistida: `{"turnId": "4862d05c-54a1-4887-8705-c8400021cb49", "outboundId": "99eeb532-f8bd-49b8-9468-034ae4c12341", "createdAt": "2026-09-04T15:30:50.843Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:30:50.870Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `387a3b04-936e-4df5-b202-6a8b514656f8`; turno `ca086199-36a2-4a5b-abe2-e6e47166313d`.

Cliente: Me tienta la de Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Buena elección! Redes Informáticas es parte de nuestra Academia de Oficios y te permite conocer cómo funcionan las redes y cada uno de los dispositivos que las componen. Son 16 clases, 100% online y en español.

Movimiento `{'schema_version': 1, 'move': 'ask_course_information', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': 'academia-de-oficios', 'payment_plan': None, 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Buena elección! Redes Informáticas es parte de nuestra Academia de Oficios y te permite conocer cómo funcionan las redes y cada uno de los dispositivos que las componen. Son 16 clases, 100% online y en español.
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles y resolver tus dudas.

Outbound `5d72e2ca-2cbd-489f-91f6-7c0cb60a1fdf`; delivery `submitted_to_botpress`; tiempo 3996 ms.

Decisión persistida: `{"turnId": "ca086199-36a2-4a5b-abe2-e6e47166313d", "outboundId": "5d72e2ca-2cbd-489f-91f6-7c0cb60a1fdf", "createdAt": "2026-09-04T15:30:54.847Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:30:54.867Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `813cf720-7a59-4447-aaf0-6457fcbd0453`; turno `1a52b24c-8fcf-4b03-accc-47889ce9a361`.

Cliente: Pensándolo mejor, prefiero Excel Integral

Propuesta del modelo antes de validar:
> ¡Perfecto! Excel Integral es de nuestra Academia de Negocios y son 17 clases, 100% online y en español. Vas a aprender las herramientas elementales, fórmulas y funciones, gráficos, resúmenes de información y mucho más.
> ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto! Excel Integral es de nuestra Academia de Negocios y son 17 clases, 100% online y en español. Vas a aprender las herramientas elementales, fórmulas y funciones, gráficos, resúmenes de información y mucho más.
>
> ¿Ya tenías pensado estudiar Excel o recién estás empezando a averiguar?

Outbound `15d745e6-f61c-4620-8f63-a7eb85f03c40`; delivery `submitted_to_botpress`; tiempo 3468 ms.

Decisión persistida: `{"turnId": "1a52b24c-8fcf-4b03-accc-47889ce9a361", "outboundId": "15d745e6-f61c-4620-8f63-a7eb85f03c40", "createdAt": "2026-09-04T15:30:58.317Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:30:58.336Z · wf_01_consulta_y_cambio_de_curso

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `9e57f6a6-1c6f-40cf-9c55-31b1b8b9467e`; turno `f50ca4cc-de27-4b6d-9d63-07c0fc47bb8c`.

Cliente: ¿?

Propuesta del modelo antes de validar:
> ¿Querés que te cuente más sobre Excel Integral o preferís que te ayude a encontrar otra formación que se ajuste a lo que buscás?

Movimiento `unknown`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¿Querés que te cuente más sobre Excel Integral o preferís que te ayude a encontrar otra formación que se ajuste a lo que buscás?

Outbound `4a11f929-7aa0-4528-a993-b69087102491`; delivery `submitted_to_botpress`; tiempo 2763 ms.

Decisión persistida: `{"turnId": "f50ca4cc-de27-4b6d-9d63-07c0fc47bb8c", "outboundId": "4a11f929-7aa0-4528-a993-b69087102491", "createdAt": "2026-09-04T15:31:01.066Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:01.125Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `03ecc3d4-001d-42c2-9156-0a0bfc541032`; turno `d82c01f1-6a6d-4537-895b-cc73f0b026ad`.

Cliente: Buenas, me interesa Maquillaje Profesional

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy asesor/a educativo/a de StudyX. Me alegra que te interese Maquillaje Profesional.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar maquillaje profesional o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Moda y Belleza 🇺🇸 Soy asesor/a educativo/a de StudyX. Me alegra que te interese Maquillaje Profesional.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar maquillaje profesional o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `ef9ccac4-13ec-41e9-9a6d-16e15d8110dd`; delivery `submitted_to_botpress`; tiempo 3193 ms.

Decisión persistida: `{"turnId": "d82c01f1-6a6d-4537-895b-cc73f0b026ad", "outboundId": "ef9ccac4-13ec-41e9-9a6d-16e15d8110dd", "createdAt": "2026-09-04T15:31:04.294Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:04.319Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `1e2618ec-dfa1-436b-a4df-46390aba94e7`; turno `ba4857d1-8464-46c3-a947-958da3633a11`.

Cliente: Uf, me parece bastante plata la verdad

Propuesta del modelo antes de validar:
> Te entiendo. Por eso te comento que podés elegir entre 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Te entiendo. Por eso te comento que podés elegir entre 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es USD 360 en cualquiera de las tres opciones.

Outbound `5481f91f-209b-4f68-82c4-e0291ec2dbc4`; delivery `submitted_to_botpress`; tiempo 3841 ms.

Decisión persistida: `{"turnId": "ba4857d1-8464-46c3-a947-958da3633a11", "outboundId": "5481f91f-209b-4f68-82c4-e0291ec2dbc4", "createdAt": "2026-09-04T15:31:08.126Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:08.161Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `214d4fa9-4fb4-446d-ba4f-eb35376983c3`; turno `37b5c33a-2830-49a4-92ee-fa3a9a27c936`.

Cliente: No me llames por favor, sigamos escribiendo

Propuesta del modelo antes de validar:
> Perfecto, seguimos por acá sin problema. 😊
> ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, seguimos por acá sin problema. 😊
>
> ¿Cuál de las tres opciones de pago te resulta más cómoda para avanzar?

Outbound `ca4bda0a-d075-481b-8195-3beccbfa5ffb`; delivery `submitted_to_botpress`; tiempo 3674 ms.

Decisión persistida: `{"turnId": "37b5c33a-2830-49a4-92ee-fa3a9a27c936", "outboundId": "ca4bda0a-d075-481b-8195-3beccbfa5ffb", "createdAt": "2026-09-04T15:31:11.798Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:11.836Z · wf_02_objecion_precio_y_rechazo_llamada

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `1fbe6404-b211-4658-ac6a-9fcbbe76dac3`; turno `872ef70a-0f33-4529-9a96-60b1a4f2be9e`.

Cliente: ¿Y la cuota más baja de cuánto sería?

Propuesta del modelo antes de validar:
> La opción de menor cuota es la de 12 pagos mensuales de USD 30. También tenés 6 pagos de USD 60 o un pago único de USD 360.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> La opción de menor cuota es la de 12 pagos mensuales de USD 30. También tenés 6 pagos de USD 60 o un pago único de USD 360.

Outbound `dc2f0007-1cf4-4b3f-8666-8dad5fab3610`; delivery `submitted_to_botpress`; tiempo 2915 ms.

Decisión persistida: `{"turnId": "872ef70a-0f33-4529-9a96-60b1a4f2be9e", "outboundId": "dc2f0007-1cf4-4b3f-8666-8dad5fab3610", "createdAt": "2026-09-04T15:31:14.730Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:14.765Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `4a5d1615-e279-4206-8549-af004799001c`; turno `740a73d7-5020-44a9-afba-ac6cb4e26d8e`.

Cliente: Quiero anotarme en Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con tu inscripción en Redes Informáticas.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y te voy a ayudar con tu inscripción en Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `7756da87-bd4b-4358-baa1-573f0d25a237`; delivery `submitted_to_botpress`; tiempo 3486 ms.

Decisión persistida: `{"turnId": "740a73d7-5020-44a9-afba-ac6cb4e26d8e", "outboundId": "7756da87-bd4b-4358-baa1-573f0d25a237", "createdAt": "2026-09-04T15:31:18.228Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:18.252Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `e837a7ac-b57c-49f7-898b-85a1aa33a192`; turno `ce531eeb-2b3f-46e1-b4ce-38ff441076e6`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> Perfecto, te anoto en el plan de 6 pagos mensuales de USD 60. El total del programa es USD 360. ¿Querés que avancemos con el pago?

Movimiento `select_payment_plan`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, te anoto en el plan de 6 pagos mensuales de USD 60. El total del programa es USD 360. ¿Querés que avancemos con el pago?

Outbound `6716fbfc-698a-4ac5-8490-e18899a0088b`; delivery `submitted_to_botpress`; tiempo 3090 ms.

Decisión persistida: `{"turnId": "ce531eeb-2b3f-46e1-b4ce-38ff441076e6", "outboundId": "6716fbfc-698a-4ac5-8490-e18899a0088b", "createdAt": "2026-09-04T15:31:21.324Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:21.343Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `220a2dbf-5248-4803-b6f0-4d6ceaab0dc2`; turno `b241c381-f564-4042-99a1-9c8ef812e29a`.

Cliente: Igual esta semana no puedo, lo dejo para el lunes

Propuesta del modelo antes de validar:
> Tranquilo/a, no hay problema. Queda anotado tu plan de 6 pagos mensuales de USD 60. Cuando quieras retomar el lunes, avisame y seguimos con el pago.

Movimiento `defer_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tranquilo/a, no hay problema. Queda anotado tu plan de 6 pagos mensuales de USD 60. Cuando quieras retomar el lunes, avisame y seguimos con el pago.

Outbound `c6bf8962-2a7b-4a7a-94e8-f5449239ae28`; delivery `submitted_to_botpress`; tiempo 3360 ms.

Decisión persistida: `{"turnId": "b241c381-f564-4042-99a1-9c8ef812e29a", "outboundId": "c6bf8962-2a7b-4a7a-94e8-f5449239ae28", "createdAt": "2026-09-04T15:31:24.682Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:24.704Z · wf_03_plan_postergacion_link

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `ed5b66b9-fea7-4d6e-89f5-8506e228ec10`; turno `73a94da7-e03a-480a-9ff7-a2f1962dc554`.

Cliente: Ya está, mandame el link. Soy Lucía Ferrer, lucia.ferrer@example.test, mi teléfono es +1 305 555 0199

Propuesta del modelo antes de validar:
> ¡Perfecto, Lucía! Ya quedó registrado tu plan de 6 pagos mensuales de USD 60. Te envío el link para que completes el pago.

Movimiento `request_payment_link`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Lucía! Ya quedó registrado tu plan de 6 pagos mensuales de USD 60. Te envío el link para que completes el pago.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `977c6510-b710-44e8-b7e7-da217b8a0cb5`; delivery `submitted_to_botpress`; tiempo 3278 ms.

Decisión persistida: `{"turnId": "73a94da7-e03a-480a-9ff7-a2f1962dc554", "outboundId": "977c6510-b710-44e8-b7e7-da217b8a0cb5", "createdAt": "2026-09-04T15:31:27.938Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:28.004Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `132cf26a-2f7d-4631-8029-2f273c515ab9`; turno `b4713755-7972-43f4-b472-8178b5a20db6`.

Cliente: Me anoto en Excel Integral

Propuesta del modelo antes de validar:
> ¡Excelente elección! Excel Integral es un curso de la Academia de Negocios con 17 clases, 100% online y en español. Vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información.
> Para orientarte mejor: ¿ya tenés conocimientos previos de Excel o partís desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Excelente elección! Excel Integral es un curso de la Academia de Negocios con 17 clases, 100% online y en español. Vas a aprender desde las herramientas elementales hasta fórmulas, funciones, gráficos y resúmenes de información.
>
> Para orientarte mejor: ¿ya tenés conocimientos previos de Excel o partís desde cero?
>
> Si querés, puedo contarte más en detalle cómo funciona el curso.

Outbound `7b0e1c73-9167-4734-9ea3-d2fbe93575ec`; delivery `submitted_to_botpress`; tiempo 3615 ms.

Decisión persistida: `{"turnId": "b4713755-7972-43f4-b472-8178b5a20db6", "outboundId": "7b0e1c73-9167-4734-9ea3-d2fbe93575ec", "createdAt": "2026-09-04T15:31:31.588Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:31.621Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `b9c83cef-1980-4a94-804e-a6e12bd805fc`; turno `56440a85-6a24-4b96-80fa-4f4701189738`.

Cliente: Ya hice la transferencia recién

Propuesta del modelo antes de validar:
> Perfecto, quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Movimiento `report_payment`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, quedó registrado tu aviso de pago. El equipo lo revisará y, si está acreditado, gestionará tu acceso.

Outbound `d8474bf4-aa46-41a7-84cd-b9ad4379364a`; delivery `submitted_to_botpress`; tiempo 2686 ms.

Decisión persistida: `{"turnId": "56440a85-6a24-4b96-80fa-4f4701189738", "outboundId": "d8474bf4-aa46-41a7-84cd-b9ad4379364a", "createdAt": "2026-09-04T15:31:34.283Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:34.308Z · wf_04_aviso_de_pago

Fuente `workflow-conversations-2026-09-04T15-31-37-127Z-b713a0e9-a822-4c9a-bc19-b74766aa350a.json.gz`; trace `77063b98-8261-4a8d-9c77-d17ab35ff719`; turno `00be3f22-9a2b-42e3-a8b9-4cd90c61d6a2`.

Cliente: ¿Entonces ya quedé inscripta?

Propuesta del modelo antes de validar:
> Tu aviso de pago quedó registrado. La inscripción se confirma cuando el equipo verifica que el pago esté acreditado; en ese momento gestionan tu acceso.

Movimiento `ask_current_state`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Tu aviso de pago quedó registrado. La inscripción se confirma cuando el equipo verifica que el pago esté acreditado; en ese momento gestionan tu acceso.

Outbound `e0464b7e-92db-487b-9e14-85cd2d76c90a`; delivery `submitted_to_botpress`; tiempo 2800 ms.

Decisión persistida: `{"turnId": "00be3f22-9a2b-42e3-a8b9-4cd90c61d6a2", "outboundId": "e0464b7e-92db-487b-9e14-85cd2d76c90a", "createdAt": "2026-09-04T15:31:37.074Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:37.141Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T15-31-51-129Z-54486f79-3e0d-4472-ad5b-7376259e56e4.json.gz`; trace `e727ef3c-5437-45c0-a4f4-02d3c56474ac`; turno `eeed30f1-b66e-4a85-93e7-5c9569265560`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Redes Informáticas.
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a la Academia de Oficios 🇺🇸 Soy parte del equipo de StudyX y estoy para ayudarte con Redes Informáticas.
>
> Antes de contarte los detalles, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para asesorarte mejor.

Outbound `6f216aee-5d7d-4ea2-814d-6a28b5d5fafa`; delivery `submitted_to_botpress`; tiempo 3346 ms.

Decisión persistida: `{"turnId": "eeed30f1-b66e-4a85-93e7-5c9569265560", "outboundId": "6f216aee-5d7d-4ea2-814d-6a28b5d5fafa", "createdAt": "2026-09-04T15:31:40.455Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:40.489Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T15-31-51-129Z-54486f79-3e0d-4472-ad5b-7376259e56e4.json.gz`; trace `fa702d01-ecf3-4457-865f-8e4eedca0cec`; turno `02631d56-b86b-410b-b51f-7d3cbca3d88f`.

Cliente: Prefiero no hablar por teléfono, seguimos por chat

Propuesta del modelo antes de validar:
> Perfecto, seguimos por chat entonces 👍
> Para orientarte mejor, ¿ya tenías pensado estudiar redes o recién estás empezando a averiguar?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, seguimos por chat entonces 👍

Outbound `a85f5ec8-6b38-4130-8591-04b738d1f93e`; delivery `submitted_to_botpress`; tiempo 3195 ms.

Decisión persistida: `{"turnId": "02631d56-b86b-410b-b51f-7d3cbca3d88f", "outboundId": "a85f5ec8-6b38-4130-8591-04b738d1f93e", "createdAt": "2026-09-04T15:31:43.651Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:43.685Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T15-31-51-129Z-54486f79-3e0d-4472-ad5b-7376259e56e4.json.gz`; trace `534e5ca1-b878-4b63-8f0f-138d280ebb2d`; turno `512ebe50-4f11-4cea-b818-5539bbd2614d`.

Cliente: Contame más del contenido

Propuesta del modelo antes de validar:
> Claro, te cuento. El curso de Redes Informáticas tiene 16 clases y está pensado para que entiendas cómo funcionan las redes y cada uno de los dispositivos que las componen.
> Se cursa 100% online, en español, y vas a poder avanzar a tu ritmo con el material disponible en la plataforma. ¿Te gustaría que te cuente cómo se organizan las clases y qué incluye?

Movimiento `ask_course_information`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Claro, te cuento. El curso de Redes Informáticas tiene 16 clases y está pensado para que entiendas cómo funcionan las redes y cada uno de los dispositivos que las componen.
>
> Se cursa 100% online, en español, y vas a poder avanzar a tu ritmo con el material disponible en la plataforma. ¿Te gustaría que te cuente cómo se organizan las clases y qué incluye?

Outbound `12216d85-7ec2-485b-89ea-ece4fa1b1b84`; delivery `submitted_to_botpress`; tiempo 3973 ms.

Decisión persistida: `{"turnId": "512ebe50-4f11-4cea-b818-5539bbd2614d", "outboundId": "12216d85-7ec2-485b-89ea-ece4fa1b1b84", "createdAt": "2026-09-04T15:31:47.625Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:47.659Z · workflow-call-declined

Fuente `workflow-call-declined-2026-09-04T15-31-51-129Z-54486f79-3e0d-4472-ad5b-7376259e56e4.json.gz`; trace `0f41291c-8cee-44a2-9282-48512997ead4`; turno `ad56d4ab-70b8-4279-b91d-94402297ef18`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Outbound `fe0d6338-0fdb-44e6-99a8-6522e3e8d955`; delivery `submitted_to_botpress`; tiempo 3456 ms.

Decisión persistida: `{"turnId": "ad56d4ab-70b8-4279-b91d-94402297ef18", "outboundId": "fe0d6338-0fdb-44e6-99a8-6522e3e8d955", "createdAt": "2026-09-04T15:31:51.084Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:51.352Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-32-17-896Z-02cb4b12-bc9d-4d66-80bb-f9f7013f4cb2.json.gz`; trace `a85f8c52-3f14-4996-843d-2fcdf6cf8743`; turno `a7b3c018-4ed4-4943-8462-79c16c924b0a`.

Cliente: Hola, me interesa Redes Informáticas

Propuesta del modelo antes de validar:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos y estoy para ayudarte con Redes Informáticas. ¿Ya tenías pensado estudiar este curso o recién estás empezando a averiguar?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Hola! Bienvenido/a a StudyX 🇺🇸 Soy parte del equipo de asesores educativos y estoy para ayudarte con Redes Informáticas. ¿Ya tenías pensado estudiar este curso o recién estás empezando a averiguar?
>
> Si querés, podemos coordinar una llamada breve para contarte los detalles.

Outbound `163c6be2-d673-4097-9b23-214b61dd0659`; delivery `submitted_to_botpress`; tiempo 3721 ms.

Decisión persistida: `{"turnId": "a7b3c018-4ed4-4943-8462-79c16c924b0a", "outboundId": "163c6be2-d673-4097-9b23-214b61dd0659", "createdAt": "2026-09-04T15:31:55.049Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:55.074Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-32-17-896Z-02cb4b12-bc9d-4d66-80bb-f9f7013f4cb2.json.gz`; trace `ae7ff3a4-383e-432f-bacb-eb45cd46a2f8`; turno `56b03269-b0c7-4388-88dc-897a864d4df7`.

Cliente: Prefiero no hablar por teléfono, sigamos por acá

Propuesta del modelo antes de validar:
> Perfecto, seguimos por acá sin problema 👍
> Contame, ¿ya tenías pensado estudiar Redes Informáticas o recién estás empezando a averiguar?

Movimiento `continue_by_chat`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, seguimos por acá sin problema 👍
>
> Contame, ¿ya tenías pensado estudiar Redes Informáticas o recién estás empezando a averiguar?

Outbound `36e5e239-dfd0-4e42-9ddb-a9b6ee43c31c`; delivery `submitted_to_botpress`; tiempo 3304 ms.

Decisión persistida: `{"turnId": "56b03269-b0c7-4388-88dc-897a864d4df7", "outboundId": "36e5e239-dfd0-4e42-9ddb-a9b6ee43c31c", "createdAt": "2026-09-04T15:31:58.348Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:31:58.380Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-32-17-896Z-02cb4b12-bc9d-4d66-80bb-f9f7013f4cb2.json.gz`; trace `a70c9aed-7884-4a7c-87f6-e1271e0caf95`; turno `3aca43ba-2154-4d22-94f7-0b7b25ca75cf`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones.

Outbound `898e728a-5bf1-4d93-bcbc-83b764c91592`; delivery `submitted_to_botpress`; tiempo 3044 ms.

Decisión persistida: `{"turnId": "3aca43ba-2154-4d22-94f7-0b7b25ca75cf", "outboundId": "898e728a-5bf1-4d93-bcbc-83b764c91592", "createdAt": "2026-09-04T15:32:01.401Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:32:01.424Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-32-17-896Z-02cb4b12-bc9d-4d66-80bb-f9f7013f4cb2.json.gz`; trace `52fb982c-e7c1-4778-b302-0689530f57be`; turno `703e3cd5-ea3d-4dad-808e-101d3f2e03fe`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Movimiento `{'schema_version': 1, 'move': 'ask_payment_options', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': None, 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Outbound `02332e91-23f7-4284-bf9b-54f74733e225`; delivery `submitted_to_botpress`; tiempo 3569 ms.

Decisión persistida: `{"turnId": "703e3cd5-ea3d-4dad-808e-101d3f2e03fe", "outboundId": "02332e91-23f7-4284-bf9b-54f74733e225", "createdAt": "2026-09-04T15:32:04.961Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:32:04.994Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-32-17-896Z-02cb4b12-bc9d-4d66-80bb-f9f7013f4cb2.json.gz`; trace `ffcd2f72-27fe-4099-a05f-224d3d0bb4e5`; turno `65840196-20e0-43e7-bbf9-588256e351e4`.

Cliente: Me quedo con las seis cuotas

Propuesta del modelo antes de validar:
> Perfecto, 6 pagos mensuales de USD 60. El total sigue siendo USD 360. ¿Querés que avancemos con la inscripción para dejarlo registrado?

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'redes_informaticas', 'area_reference': None, 'payment_plan': 'monthly_6', 'confidence': 1.0}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, 6 pagos mensuales de USD 60. El total sigue siendo USD 360. ¿Querés que avancemos con la inscripción para dejarlo registrado?

Outbound `f65f40b8-a268-4d7f-9dee-6af163a45ad1`; delivery `submitted_to_botpress`; tiempo 3699 ms.

Decisión persistida: `{"turnId": "65840196-20e0-43e7-bbf9-588256e351e4", "outboundId": "f65f40b8-a268-4d7f-9dee-6af163a45ad1", "createdAt": "2026-09-04T15:32:08.662Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:32:08.694Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-32-17-896Z-02cb4b12-bc9d-4d66-80bb-f9f7013f4cb2.json.gz`; trace `85073036-4aab-42bf-a50e-29991a1b3ce2`; turno `f98ea694-ff96-4ad6-9047-4fde4fd33d04`.

Cliente: ¿Y cuánto sale?

Propuesta del modelo antes de validar:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Movimiento `ask_payment_options`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> El valor total del programa es USD 360. Podés elegir 12 pagos mensuales de USD 30, 6 pagos mensuales de USD 60 o un pago único de USD 360. El total es el mismo en cualquiera de las tres opciones. ¿Cuál te resulta más cómoda para avanzar?

Outbound `7b61714f-b31a-4d2a-8602-a22dab97615c`; delivery `submitted_to_botpress`; tiempo 3050 ms.

Decisión persistida: `{"turnId": "f98ea694-ff96-4ad6-9047-4fde4fd33d04", "outboundId": "7b61714f-b31a-4d2a-8602-a22dab97615c", "createdAt": "2026-09-04T15:32:11.728Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:32:11.745Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-32-17-896Z-02cb4b12-bc9d-4d66-80bb-f9f7013f4cb2.json.gz`; trace `ab2fa584-48a6-4691-961c-5e296b237afc`; turno `65dffb5b-5889-4f8a-94ae-1180eb0b5e7d`.

Cliente: Soy Camila Ortiz, camila.ortiz@example.test, mi teléfono es +1 305 555 0143

Propuesta del modelo antes de validar:
> Gracias, Camila. Quedó registrado tu nombre, correo y teléfono. Ya tenés elegido el plan de 6 pagos mensuales de USD 60. ¿Querés que te envíe el link de pago para avanzar?

Movimiento `provide_contact_details`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Gracias, Camila. Quedó registrado tu nombre, correo y teléfono. Ya tenés elegido el plan de 6 pagos mensuales de USD 60. ¿Querés que te envíe el link de pago para avanzar?

Outbound `9e5eb067-ca78-40ec-b95a-c729f7c7399a`; delivery `submitted_to_botpress`; tiempo 3247 ms.

Decisión persistida: `{"turnId": "65dffb5b-5889-4f8a-94ae-1180eb0b5e7d", "outboundId": "9e5eb067-ca78-40ec-b95a-c729f7c7399a", "createdAt": "2026-09-04T15:32:14.964Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:32:15.018Z · workflow-consent-price-after-request

Fuente `workflow-consent-price-after-request-2026-09-04T15-32-17-896Z-02cb4b12-bc9d-4d66-80bb-f9f7013f4cb2.json.gz`; trace `afad3104-0f61-4e01-a9de-779837d76861`; turno `c41560bb-5862-4114-bc2e-536ff86e8455`.

Cliente: Sí, ahora mandame el link de las seis cuotas

Propuesta del modelo antes de validar:
> Perfecto, Camila. Te envío el link de pago de las 6 cuotas de USD 60.

Movimiento `request_payment_link`; acción `{'type': 'send_payment_link', 'offering_code': 'redes_informaticas', 'payment_plan': 'monthly_6'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, Camila. Te envío el link de pago de las 6 cuotas de USD 60.
>
> 6 pagos mensuales de USD 60: https://example.invalid/eval/6m

Outbound `60b5f8af-8ba7-41f6-a250-4e0a3f5675e4`; delivery `submitted_to_botpress`; tiempo 2865 ms.

Decisión persistida: `{"turnId": "c41560bb-5862-4114-bc2e-536ff86e8455", "outboundId": "60b5f8af-8ba7-41f6-a250-4e0a3f5675e4", "createdAt": "2026-09-04T15:32:17.858Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:32:18.081Z · heldout_intake_v2_structured_identity

Fuente `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-32-34-730Z-86f817a3-5a15-4a2d-b12f-3c4d0a52d00a.json.gz`; trace `53d21ad4-b728-4ec1-ac1c-6bec3dceca8c`; turno `7103a7f9-349c-4d97-b108-182a5fb18a50`.

Cliente: Buenas, quisiera formarme en Maquillaje Profesional para trabajar por mi cuenta.

Propuesta del modelo antes de validar:
> Hola, bienvenido/a a StudyX 🇺🇸 Soy tu asesora educativa. Veo que te interesa Maquillaje Profesional para trabajar por tu cuenta, ¡excelente objetivo! Para orientarte mejor: ¿ya tenés experiencia en maquillaje o arrancás desde cero?

Movimiento `select_course`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Hola, bienvenido/a a StudyX 🇺🇸 Soy tu asesora educativa. Veo que te interesa Maquillaje Profesional para trabajar por tu cuenta, ¡excelente objetivo! Para orientarte mejor: ¿ya tenés experiencia en maquillaje o arrancás desde cero?
>
> Si querés, podemos coordinar una llamada breve para contarte más detalles.

Outbound `d69a2ded-abc0-4ba0-af84-15d554c65086`; delivery `submitted_to_botpress`; tiempo 4042 ms.

Decisión persistida: `{"turnId": "7103a7f9-349c-4d97-b108-182a5fb18a50", "outboundId": "d69a2ded-abc0-4ba0-af84-15d554c65086", "createdAt": "2026-09-04T15:32:22.101Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "call_offer", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:32:22.137Z · heldout_intake_v2_structured_identity

Fuente `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-32-34-730Z-86f817a3-5a15-4a2d-b12f-3c4d0a52d00a.json.gz`; trace `11bb157a-23ed-45d4-b549-6f44b7b67762`; turno `816816ec-1faf-4fe2-af84-abef45a84ecd`.

Cliente: Prefiero hacer un pago único.

Propuesta del modelo antes de validar:
> Perfecto, el pago único de USD 360 es una gran opción. ¿Querés que avancemos con la inscripción para dejarlo registrado?

Movimiento `{'schema_version': 1, 'move': 'select_payment_plan', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': 'one_time', 'confidence': 0.98}`; acción `{'type': 'none'}`; repair_of `None`.

Salida autorizada y capturada:
> Perfecto, el pago único de USD 360 es una gran opción. ¿Querés que avancemos con la inscripción para dejarlo registrado?

Outbound `8b2b3920-8cda-4988-ac0d-4ccd065814d3`; delivery `submitted_to_botpress`; tiempo 3321 ms.

Decisión persistida: `{"turnId": "816816ec-1faf-4fe2-af84-abef45a84ecd", "outboundId": "8b2b3920-8cda-4988-ac0d-4ccd065814d3", "createdAt": "2026-09-04T15:32:25.442Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:32:25.471Z · heldout_intake_v2_structured_identity

Fuente `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-32-34-730Z-86f817a3-5a15-4a2d-b12f-3c4d0a52d00a.json.gz`; trace `f72dc9a6-e5cd-4f98-800f-ae98d6e17b79`; turno `92d5525d-c18e-422b-8b8b-31859e85a5ad`.

Cliente: Nombre y apellido: Valentina Costa
Email: valentina.costa@example.test
Celular: +1 (786) 555-0164

Propuesta del modelo antes de validar:
> ¡Gracias, Valentina! Ya quedaron registrados tus datos. Te envío el link para el pago único de USD 360. Cuando hagas el pago, avisame por acá.

Movimiento `provide_contact_details`; acción `{'type': 'send_payment_link', 'offering_code': 'maquillaje_profesional', 'payment_plan': 'one_time'}`; repair_of `None`.

Propuesta del modelo antes de validar:
> ¡Gracias, Valentina! Ya quedaron registrados tus datos. Cuando hagas el pago, avisame por acá y el equipo lo revisará para gestionar tu acceso.

Movimiento `{'schema_version': 1, 'move': 'provide_contact_details', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': 'one_time', 'confidence': 0.95}`; acción `{'type': 'none'}`; repair_of `{'rejection_id': '6cf75e69-c7a1-4aac-b816-88203182a021', 'attempt': 1}`.

Salida autorizada y capturada:
> ¡Gracias, Valentina! Ya quedaron registrados tus datos. Cuando hagas el pago, avisame por acá y el equipo lo revisará para gestionar tu acceso.

Outbound `f538c75c-2772-4d1c-b2dd-ac3138ef1fa1`; delivery `submitted_to_botpress`; tiempo 5860 ms.

Decisión persistida: `{"turnId": "92d5525d-c18e-422b-8b8b-31859e85a5ad", "outboundId": "f538c75c-2772-4d1c-b2dd-ac3138ef1fa1", "createdAt": "2026-09-04T15:32:31.306Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": null, "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.

## 2026-09-04T15:32:31.349Z · heldout_intake_v2_structured_identity

Fuente `workflow-intake-heldout-v2-checkpoint-2026-09-04T15-32-34-730Z-86f817a3-5a15-4a2d-b12f-3c4d0a52d00a.json.gz`; trace `0ab59f30-f3b5-4ad9-838c-3cf94650325d`; turno `8a6d0a58-3276-462c-aaa0-44e4d328c362`.

Cliente: Sí, enviame ahora el enlace para abonar todo junto.

Propuesta del modelo antes de validar:
> ¡Perfecto, Valentina! Te envío el enlace para el pago único de USD 360.

Movimiento `{'schema_version': 1, 'move': 'request_payment_link', 'secondary_moves': [], 'vetoes': [], 'course_reference': 'maquillaje_profesional', 'area_reference': None, 'payment_plan': 'one_time', 'confidence': 1.0}`; acción `{'type': 'send_payment_link', 'offering_code': 'maquillaje_profesional', 'payment_plan': 'one_time'}`; repair_of `None`.

Salida autorizada y capturada:
> ¡Perfecto, Valentina! Te envío el enlace para el pago único de USD 360.
>
> Pago único de USD 360: https://example.invalid/eval/contado

Outbound `65eae8ca-807d-490c-867f-f5e70cd1b915`; delivery `submitted_to_botpress`; tiempo 3366 ms.

Decisión persistida: `{"turnId": "8a6d0a58-3276-462c-aaa0-44e4d328c362", "outboundId": "65eae8ca-807d-490c-867f-f5e70cd1b915", "createdAt": "2026-09-04T15:32:34.677Z", "reasonCode": "AGENT_A_PLANNERLESS_V2", "responseType": "commercial_reply", "hasResponse": true, "businessActionType": "send_payment_link", "promptVersion": "studyx-agent-a-brain-v19", "modelName": "deepseek-v4-flash"}`.
