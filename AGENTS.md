# StudyX Agente A — Reglas obligatorias

## Autoridad única
- Comportamiento y objetivo final: docs/authority/prompt-agente-a-studyx-v2.md (Gabi/Lisandro).
- Bonificación: docs/authority/spec-backend-bonificacion.md.
- Si el código, otro prompt, el brain, un validador o un test contradice esos documentos, gana el documento.
- El prompt anterior de Lisandro y el bloque LISANDRO_VOICE_GATE del brain quedan por debajo de los documentos: sólo valen donde los documentos no dicen nada.
- No edites los documentos de autoridad. Si algo es técnicamente imposible, detenete y reportalo con archivo:línea.

## Decisiones cerradas
- Identidad: "Soy Emma, asesora de Studyx". Emma es fijo (AGENT_A_ADVISOR_NAME=Emma). Nunca "administrativa".
- Llamadas: según la sección "Llamadas" del prompt (las pide el cliente, duda compleja o escalón 4). El backend no obliga a ofrecerla. Se mantienen: máximo 2, consentimiento, datos completos, may_offer_call.
- Precio: se permite presentar la cuota de USD 30 y el plan de 12 como el más accesible. El total USD 360 nunca cambia; sin descuentos.
- Tono: copiar tú/vos del cliente.
- Certificado: usar el texto del prompt como dato autorizado.

## Adaptaciones técnicas permitidas (no cambian comportamiento)
- Traducir la spec al contrato real AgentATurnProposalV1 (no existe move "negotiate"; proposed_action es un objeto).
- accept_promotion lleva la identidad completa del contexto (promotion_code, interest_offering_code, promotion_cycle_id, offer_version).
- Ante el rechazo de una bonificación se quita sólo el curso nuevo; se conservan los ya entregados.
- La price_objection que habilita la bonificación debe estar registrada en un turno anterior.
- Temarios y texto del certificado llegan al modelo como datos autorizados (fact_id).

## Responsabilidades
- El Agente A interpreta, elige la estrategia y redacta.
- El backend valida SÓLO hechos y efectos: cursos y planes existentes, precio, links, datos de contacto, consentimiento de llamada, pago verificado, las 9 reglas de la spec, idempotencia y alta.
- Prohibido agregar regex o validadores que decidan si una respuesta "vende", "avanza", "cierra bien" o "aplaza".

## No romper
Llamadas y traspaso al Agente B, recolección de datos, link de pago y prueba de USD 0,50, verificación de pago,
alta en Central (pago + bonificados), postventa, memoria (vectorial y base de datos), registro de leads, opt-out,
seguimientos, audios, no ejecutar dos veces la misma acción.

## Terminado
- Pasan evals/golden contra DeepSeek real en staging.
- Pasan los tests de todas las funciones de "No romper".
- Se informa: SHA, versión del prompt, versión del brain y tabla aprobado/fallido con evidencia.
- Un test con respuestas del modelo escritas a mano no prueba comportamiento.
- Nunca digas "listo" sin esa tabla.
