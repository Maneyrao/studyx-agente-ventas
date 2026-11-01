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
- Ante el rechazo de una bonificación (`ladder_step_pending` o `forbidden_promise`), la reparación no menciona ni sugiere bonificaciones, tampoco genéricas, condicionales o en preguntas. Se conservan en el estado los cursos ya entregados; no se borran ni se vuelven a ofrecer. Se realiza el escalón pendiente identificado por hechos, sin inventar pasos completos ni deducirlos sólo del contador (prompt :106-123 y :129; spec :71).
- La price_objection que habilita la bonificación debe estar registrada en un turno anterior.
- Temarios y texto del certificado llegan al modelo como datos autorizados (fact_id).
- Formato de llamada (autorización explícita del usuario del 2026-11-01): en la reparación por escalera pendiente, la invitación va sólo en `response.call_offer`. Para la entrega se quitan de `messages` únicamente burbujas completas exactamente iguales a ese campo, conservándolo íntegro. La propuesta original y los índices de `profile_requests` permanecen intactos para validación y auditoría; el mapeo a la entrega conserva la metadata por texto exacto. Nunca recortar una frase dentro de una burbuja ni deduplicar por significado.
- El contrato técnico `course_mentions` declara cada curso nombrado con su rol real (`paid`, `bonus`, `paid_complement` o `alternative`). El backend detecta nombres canónicos exactos del catálogo y rechaza cursos distintos del pago vigente sin declaración con `COURSE_ROLE_UNDECLARED`. No infiere roles de frases ni cambia la redacción. La compatibilidad con propuestas antiguas usa una lista vacía, sin omitir la validación.
- Declarar `bonus` no autoriza un regalo: exige `offer_course_bonus` autorizado en el mismo turno por las 9 reglas y la regla 10, o pertenecer al paquete vigente ya entregado. Las reservas pendientes y los paquetes cancelados/expirados no cuentan. Se conservan recapitulaciones y complementos pagos legítimos (prompt :122-124 y :131-133; spec :36-38 y :59-73; decisión explícita del usuario del 2026-11-01).

## Responsabilidades
- El Agente A interpreta, elige la estrategia y redacta.
- El backend valida SÓLO hechos y efectos: cursos y planes existentes, precio, links, datos de contacto, consentimiento de llamada, pago verificado, las 9 reglas de la spec, la regla 10 autorizada abajo, idempotencia y alta.
- Prohibido agregar regex o validadores que decidan si una respuesta "vende", "avanza", "cierra bien" o "aplaza".

## Bonificación — regla 10 autorizada (2026-11-01)
- Autoridad: docs/authority/prompt-agente-a-studyx-v2.md:106-120 y decisión explícita del usuario del 2026-11-01: la escalera también se protege en el backend con hechos registrados.
- `offer_course_bonus` sólo se autoriza con al menos 3 objeciones de precio registradas en turnos anteriores de la conversación por el modelo (`memory_candidates` de tipo `objection`, clave `price_objection`, de decisiones finales comprometidas). Nunca inferirlas con regex, acciones comerciales ni borradores rechazados. Deduplicar el mismo turno.
- Además, la invitación a llamada debe estar ofrecida o rechazada, o no estar autorizada (`may_offer_call=false` o tope de 2 invitaciones alcanzado). Una invitación incluida en el borrador actual no cuenta como un hecho anterior.
- Si falta un requisito, rechazar con `ladder_step_pending` e informar al modelo el conteo observado/requerido y los requisitos pendientes, sin texto prescrito. Revalidar dentro de la transacción antes del efecto.
- Esta regla no agrega condiciones comerciales distintas, no invalida replays exactos ni la aceptación/alta de bonificaciones previamente entregadas, ni reemplaza las garantías de las otras 9 reglas.

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
