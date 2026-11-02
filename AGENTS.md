# StudyX Agente A — Reglas obligatorias

## Autoridad única
- Comportamiento y objetivo final: docs/authority/prompt-agente-a-studyx-v2.md (Gabi/Lisandro).
- Bonificación: docs/authority/spec-backend-bonificacion.md.
- Si el código, otro prompt, el brain, un validador o un test contradice esos documentos, gana el documento.
- El prompt anterior de Lisandro y el bloque LISANDRO_VOICE_GATE del brain quedan por debajo de los documentos: sólo valen donde los documentos no dicen nada.
- No edites los documentos de autoridad. Si algo es técnicamente imposible, detenete y reportalo con archivo:línea.

## Decisiones cerradas
- Identidad: "Soy Emma, asesora de Studyx". Emma es fijo (AGENT_A_ADVISOR_NAME=Emma). Nunca "administrativa".
- Llamadas: según la sección "Llamadas" del prompt (las pide el cliente, duda compleja o escalón 4), más la Regla B del dueño (2026-11-02, abajo), que sí obliga a ofrecerla en la 2.ª o 3.ª respuesta. Se mantienen: máximo 2, consentimiento, datos completos, may_offer_call.
- Precio: se permite presentar la cuota de USD 30 y el plan de 12 como el más accesible. El total USD 360 nunca cambia; sin descuentos.
- Tono: copiar tú/vos del cliente.
- Certificado: usar el texto del prompt como dato autorizado.

## Excepción de postventa autorizada por el dueño (2026-11-01)
- Excepción explícita a `docs/authority/prompt-agente-a-studyx-v2.md:230`: el mensaje de acceso se arma con la plantilla predeterminada del dueño, en un solo mensaje, sin generación, reparación ni fallback del modelo. El agradecimiento posterior sigue a cargo del Agente A.
- Listar sólo cursos `active`/`already_enrolled` verificados por fulfillment/Central; bonificados por identidad exacta del snapshot de pago. Ante activación parcial, listar sólo activos, avisar qué curso falta antes de los canales y conservar el caso humano de spec §6. Reservar `access_ready` para el paquete completo; el parcial terminal usa `access_delayed`.
- Aclaración posterior del dueño: «la contraseña por default siempre es la misma». Se autoriza esa contraseña inicial vigente desde configuración obligatoria exclusivamente para un alumno que Central confirmó haber creado (`student_was_created=true`); no afirmar que la API devuelve un campo de contraseña que no existe. Usuario siempre del resultado real de Central, identidad contrastada con el pago. Cuenta existente: usuario y contraseña de siempre, sin clave nueva ni sugerencia final. Recordatorio de E sólo si la clave configurada comienza con E mayúscula.
- Campus y contactos oficiales vienen de configuración validada antes de modificar notificaciones. Ninguna contraseña de ejemplo o fallback en código de negocio. No copiar la credencial a auditorías ni al claim/contexto/journal del evento inicial de acceso; conservar la entrega exacta al cliente. El historial posterior de mensajes conserva esa entrega: esta excepción no cambia las proyecciones generales de memoria/resumen.
- La autorización de egreso cubre la plantilla completa y sus datos verificados; no rechazar la bienvenida a Studyx por el detector genérico de cursos. Se mantienen integridad de contenido, URLs y controles de otros mensajes.

## Adaptaciones técnicas permitidas (no cambian comportamiento)
- Traducir la spec al contrato real AgentATurnProposalV1 (no existe move "negotiate"; proposed_action es un objeto).
- accept_promotion lleva la identidad completa del contexto (promotion_code, interest_offering_code, promotion_cycle_id, offer_version).
- Ante el rechazo de una bonificación (`ladder_step_pending` o `forbidden_promise`), la reparación no menciona ni sugiere bonificaciones, tampoco genéricas, condicionales o en preguntas. Se conservan en el estado los cursos ya entregados; no se borran ni se vuelven a ofrecer. Se realiza el escalón pendiente identificado por hechos, sin inventar pasos completos ni deducirlos sólo del contador (prompt :106-123 y :129; spec :71).
- La price_objection que habilita la bonificación es la memoria del modelo (Regla A): cuentan los turnos anteriores y la del turno actual con cita literal del cliente.
- Temarios y texto del certificado llegan al modelo como datos autorizados (fact_id).
- Formato de llamada (autorización explícita del usuario del 2026-11-01): en la reparación por escalera pendiente, la invitación va sólo en `response.call_offer`. Para la entrega se quitan de `messages` únicamente burbujas completas exactamente iguales a ese campo, conservándolo íntegro. La propuesta original y los índices de `profile_requests` permanecen intactos para validación y auditoría; el mapeo a la entrega conserva la metadata por texto exacto. Nunca recortar una frase dentro de una burbuja ni deduplicar por significado.
- El contrato técnico `course_mentions` declara cada curso nombrado con su rol real (`paid`, `bonus`, `paid_complement` o `alternative`). El backend detecta nombres canónicos exactos del catálogo y rechaza cursos distintos del pago vigente sin declaración con `COURSE_ROLE_UNDECLARED`. No infiere roles de frases ni cambia la redacción. La compatibilidad con propuestas antiguas usa una lista vacía, sin omitir la validación.
- Identidad `paid` (corrección autorizada del 2026-11-01): si falta una selección persistida vigente, la mención puede usar el foco conversacional que el servidor deriva con el mismo proyector del contexto de generación, desde catálogo y mensajes de la sesión. No tomar ese código del modelo ni de un snapshot enviado por el cliente. La selección vigente o un cambio validado prevalecen. Este foco sólo valida la mención: no persiste selección ni autoriza pagos, paquetes o bonificados; sus identidades y las 9 reglas y la Regla A conservan su fuente anterior. Con una sola referencia positiva e inequívoca del cliente (2026-11-02) contrastada con el catálogo activo completo, ese curso es el foco de la mención con el mismo alcance factual, aunque el agente no lo haya nombrado antes; no persiste selección ni autoriza pagos.
- Declarar `bonus` no autoriza un regalo: exige `offer_course_bonus` autorizado en el mismo turno por las 9 reglas y la Regla A, o pertenecer al paquete vigente ya entregado. Las reservas pendientes y los paquetes cancelados/expirados no cuentan. Se conservan recapitulaciones y complementos pagos legítimos (prompt :122-124 y :131-133; spec :36-38 y :59-73; decisión explícita del usuario del 2026-11-01).

## Responsabilidades
- El Agente A interpreta, elige la estrategia y redacta.
- El backend valida SÓLO hechos y efectos: cursos y planes existentes, precio, links, datos de contacto, consentimiento de llamada, pago verificado, las 9 reglas de la spec, las reglas A y B de abajo, idempotencia y alta.
- Prohibido agregar regex o validadores que decidan si una respuesta "vende", "avanza", "cierra bien" o "aplaza". Las reglas A y B (abajo) son la única excepción, autorizada por el dueño: comprueban hechos (efecto propuesto, nombre exacto del curso, campo `call_offer`), no la calidad de la venta.

## Reglas del backend — decisión determinista, redacción del modelo, respaldo fijo (decisión del dueño, 2026-11-02)
Excepción explícita a la autoridad de Gabi (`docs/authority/prompt-agente-a-studyx-v2.md:106-133` y sección Llamadas): el backend decide CUÁNDO y CUÁL; el modelo redacta todo el turno; un respaldo fijo reemplaza el turno sólo si el modelo no presenta el efecto decidido después de una reescritura. Código: `src/shared/conversation/deterministic-sales-rules.ts`.

Detección de objeción de precio: la memoria del modelo `type=objection`, `key=price_objection`, con `source_quote` literal del mensaje del cliente. Las expresiones de precio («caro», «costoso», «no me alcanza», «mucha plata», «es un montón», «no tengo presupuesto», etc.) se pasan al modelo como pista y se registran; NUNCA disparan por sí solas una bonificación. Las preguntas («es caro?») y las negaciones («no es caro») no cuentan.

### REGLA A — bonificación (reemplaza la regla 10)
- Disparador: 2.ª objeción de precio registrada (turnos anteriores + la del turno actual), o el cliente confirma que el precio es lo único que lo frena (`constraint/price_only_barrier=confirmed`). No exige llamada ofrecida.
- Curso: TABLA FIJA `BONUS_AFFINITY_TABLE_V1`, derivada del mapa de afinidades de Gabi (por curso pago: 1.º, 2.º y 3.º bonificado; sólo cursos activos; si no hay afinidad, puentes universales del mapa). El backend rechaza un código distinto del siguiente de la tabla.
- Ejecución: el backend ejecuta `offer_course_bonus` con las 9 reglas de la spec.
- Redacción: si el borrador del modelo no presenta esa oferta, UNA reescritura informándole el curso exacto, que el precio no cambia y que cierre en el mismo mensaje. El modelo redacta TODO el turno.
- Respaldo: si la reescritura falla, se reemplaza el turno COMPLETO (nunca se agregan burbujas a un texto del modelo) por dos burbujas fijas con 20 s de pausa entre ambas: «Dejame revisar qué te puedo ofrecer, dame un segundo.» / «Te puedo sumar {curso_bonificado} sin costo; el precio de {curso_pago} sigue igual. Avanzamos?»
- Escalada: una nueva objeción de precio en una respuesta del cliente posterior a la oferta → siguiente bonificado de la tabla, máximo 3. Respaldo de recapitulación: «Te sumo también {curso_nuevo}. Te quedan {curso_pago} + {bonificados} sin costo extra, al mismo precio. Avanzamos?»
- Aceptación automática: con una oferta vigente, si el cliente avanza a la compra, el link incluye el paquete ofrecido sin depender de que el modelo proponga `accept_promotion`.
- Nunca durante checkout, ni después de pagar, ni con la bonificación deshabilitada.
- Si el modelo menciona un regalo distinto del ejecutado por el backend → rechazo (`course_mentions`).

### REGLA B — llamada
- Disparador: 2.ª o 3.ª respuesta del agente (las respuestas idénticas reenviadas cuentan una vez), con el cliente que ya expresó qué busca (área, curso u objetivo), `may_offer_call=true` y la llamada sin ofrecer.
- Redacción: si el borrador no la incluye en `response.call_offer`, UNA reescritura pidiéndola con un motivo concreto.
- Respaldo: si falla, `response.call_offer` fijo: «Si querés, coordinamos una llamada corta para verlo juntos. Te sirve?»
- Nunca durante checkout, ni tras un pedido de seguir por chat, opt-out o rechazo de llamada. Máximo 2 invitaciones; nunca duplicada en el mismo turno. Nunca prometer una llamada inmediata sin la acción ejecutada.

Cada turno registra, por regla, si se cumplió con texto del modelo (`model`), con reescritura (`rewrite`) o con respaldo fijo (`fixed`), o `not_applicable` con su motivo.

## Bonificación global — configuración (decisión del dueño, 2026-11-02)
- La bonificación está habilitada para TODOS los contactos: `CENTRAL_CARGA_BONUS_ENABLED=true`, `COURSE_BONUS_FLOW_MODE=direct`, `COURSE_BONUS_MAX_COURSES=3`. El modo global no depende de listas: `isCentralCargaBonusEnabledForContact` devuelve `true` antes de consultar cualquier lista.
- `CENTRAL_CARGA_BONUS_CANARY_PHONE_E164S` y `CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS` quedan sólo como mecanismo de canary con el interruptor global apagado.
- Configuración de producción para el handoff: las tres variables de arriba con esos valores, `CENTRAL_CARGA_BONUS_FULFILLMENT_PAUSED=false` y las dos listas de canary vacías.

## No romper
Llamadas y traspaso al Agente B, recolección de datos, link de pago y prueba de USD 0,50, verificación de pago,
alta en Central (pago + bonificados), postventa, memoria (vectorial y base de datos), registro de leads, opt-out,
seguimientos, audios, no ejecutar dos veces la misma acción.

## Despliegue de pruebas — excepción operativa del dueño (2026-11-01)
- El dueño acepta 35/48 como riesgo conocido (escalera de negociación incompleta) para desplegar la base `d558f93` exclusivamente en su entorno de pruebas autorizado. El criterio formal documentado de aceptación no se cambia ni se considera cumplido por esta excepción.
- Aclaración posterior del dueño: «por ahora en mi vercel, usamos botpress vertice porque seguimos desarrollando». Quedan autorizados el proyecto personal Vercel `prj_Ns9LbXPT6UF6yvKR0rUcrwJAsFYM` (`maneyraos-projects`, alias `studyx-agente-ventas.vercel.app`) y el bot STUDYX `0d7c9ecb-4781-4c65-913d-f7e947fa14d4` del workspace `wkspace_01M4XEBZNC10HX2KDHKY36T6R0` llamado Vertice, mediante la cuenta `tmaneyro@gmail.com` y perfil explícito `studyx-detmaneyro`. No se autoriza otro proyecto de Lucas ni la cuenta/bot De Fazio. Esta aclaración resuelve la exclusión nominal previa de Vertice para estos dos recursos de desarrollo; verificar sus IDs y conexiones antes de cada publicación.
- La instrumentación de versión debe distinguir SHA base de aplicación, versión/hash del procedimiento de instrumentación y hash del artefacto final. No presentar un artefacto instrumentado como fuente sin modificaciones de `d558f93`.
- El reinicio autorizado corresponde sólo al número de prueba `1169004497`, en el entorno autorizado. Preservar pagos, matrículas, Central y trazabilidad; verificar que no regresen historiales, memorias ni tareas pendientes previas.

## Terminado
- Pasan evals/golden contra DeepSeek real en staging.
- Pasan los tests de todas las funciones de "No romper".
- Se informa: SHA, versión del prompt, versión del brain y tabla aprobado/fallido con evidencia.
- Un test con respuestas del modelo escritas a mano no prueba comportamiento.
- Nunca digas "listo" sin esa tabla.

## Identidad de contactos de prueba — decisión del dueño (2026-11-02)
- La habilitación de bonificaciones de prueba se configura por teléfono internacional normalizado en `CENTRAL_CARGA_BONUS_CANARY_PHONE_E164S`, contrastado exclusivamente con `contacts.phone` y pertenencia al workspace. No usar teléfono declarado, perfil, mensaje ni salida del modelo para conceder el permiso.
- El permiso debe sobrevivir a un reinicio que cambie el ID del contacto. Aplicar la misma identidad en el contexto, la validación transaccional, el seguimiento y el fulfillment; conservar límites, consentimiento e idempotencia. La compatibilidad con UUID anteriores sólo facilita la migración, no es la identidad nueva de la lista de pruebas.


## Continuación Codex para retomar en Claude (2026-11-02)
- Plan original, estado heredado, cambios de esta continuación y evidencia de publicación: `docs/reports/2026-11-02-reglas-a-b-continuacion-codex.md`.
- Resultados de verificación y limitaciones: `docs/reports/2026-11-02-reglas-a-b-verificacion-codex.md`. Leer su estado final antes de dar por cumplidos golden o despliegue; estos informes no reemplazan la autoridad ni las reglas anteriores.
