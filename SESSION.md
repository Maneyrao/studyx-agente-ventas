# Sesión StudyX

## Fase actual
PHASE 8 — veracidad comercial y continuidad, Brain v104, personalidad canónica v69 intacta. Publicado y verificado el 14-10 a las 15:42 Argentina: fuente 40236e1, backend dpl_2akosk2QVGonzc1K3MtvvCzjStp8 en el dominio principal y Botpress final publicado a las 15:40:34. Se conserva la persistencia de v103 y la migración 20261014163031. Se corrige el bypass factual de 7dabdb3, se devuelven contradicciones a A y se separa el contrato interno de datos de las decisiones conversacionales. 4088 unitarias, 93 integraciones y workflow firmado de rechazo/reformulación/persistencia/pago aprobados. Muestra real de cinco respuestas sin emojis; canario reanudado, límite acumulado impidió un sexto turno del modelo. Reporte: docs/reports/2026-10-14-agent-a-truth-and-voice-recovery.md.

## Fases completas
- PHASE 0: fallos y silencios observables.
- PHASE 1: contexto acotado e intake autoritativo del Brain.
- PHASE 2: propuesta, rechazo estructurado y backend autoritativo.
- PHASE 4: persistencia de respuestas fragmentadas publicada en 232611a; 3793 unitarias, 599 integraciones y tres workflows aprobados.
- PHASE 5: A conserva voz y estado al recibir resultados/faltantes; plan y enlace en el mismo turno, seguimiento de llamada redactado por A; 3892 unitarias, 601 integraciones, seis workflows; lint, tipos, builds y revisión aprobados, producción verificada.
- PHASE 6: petición explícita de pago sin segunda etiqueta, guardas por cláusula y solicitud pendiente conservada durante faltantes; 3994 unitarias, 601 integraciones y ocho workflows; fuente 32e109a publicada y verificada.
- PHASE 7: persistencia independiente por campo, correcciones y retractaciones, preguntas entregadas estructuradas y escritores canónicos de chat/voz; fuente 4abe256 y Brain v103 publicados, pruebas y comprobaciones finales aprobadas.
- PHASE 8: validación factual y combinaciones de cuotas, reformulación propia de A, reparación de repeticiones sin silenciar respuestas seguras y contrato interno separado de la personalidad; fuente 40236e1 y Brain v104 publicados y verificados.

## Decisiones de arquitectura tomadas
- A propone perfil con UUID físico y evidencia literal; backend valida formato, procedencia, orden y versión por campo sin interpretar nombres → contrato contact-profile-v1 y Brain v103, canónico v69 intacto.
- Captura independiente antes de validar texto/efectos, incluidas confirmaciones de teléfono probadas → datos válidos sobreviven reparación, veto y supersession; cualquier reparación con nuevos datos pasa nuevamente por persistencia.
- Una columna JSONB aditiva con campos independientes, retractaciones explícitas y recibos acotados es la fuente única → columnas antiguas son proyecciones; ingestión y escritores de voz no pueden competir con ella.
- Preguntas estructuradas siguen las burbujas realmente entregadas y cierran por campo respondido → no se infiere intake desde la última burbuja; entrega debe preceder al inbound.
- Una solicitud de llamada pendiente puede continuar cuando llegan sus datos → A interpreta la disponibilidad; backend mantiene autorización de efecto, consentimiento y ledger.
- A interpreta y redacta; backend conserva hechos, transiciones y efectos → restaurar especificación del 1-10, cuyos commits siguen en la rama → informe de restauración del 14-10.
- Plan y enlace en un mismo turno con recursos canónicos y datos completos → quitar permiso basado en fase previa y reinterpretación regex → contexto, resolver y agent-turn-policy-v2.ts.
- Una continuación conserva movimiento y teléfono confirmado de A → memoria semántica no desaparece al reparar texto → agent-a-action-feedback.ts y conversation_only.
- La herramienta explícita expresa la solicitud sin otra etiqueta → validar recursos canónicos y autorización real → fase 6, Brain v102.
- requested_action conserva la operación original sólo bajo conversation_only → guardar intención pendiente sin ejecutar efectos ni inventar movimientos → schemas, workflow, runner, decisión y preparer.
- Selección de curso no resuelta conserva su procedencia → nunca reutilizar checkout del curso anterior → normalización, resolver y backend.
- Efectos bloqueados, estado permitido durante continuación → prevenir checkout implícito sin perder intención → decision.service.ts, prepare-agent-turn-v2.ts, effects_allowed=false.
- A redacta resultado de llamada con prompt y academia canónicos → eliminar plantilla antigua activada en e34130a → agent-a-post-call-narrative.ts, prompt canónico v69.
- Despacho/webhook devuelven hechos antes de generar texto con after → evitar timeout del caller → rutas dispatch y retell/eventos.
- Recuperación conserva cincuenta candidatos y presupuesto de 120 segundos → mantener capacidad diaria y filas pendientes → post-call-followup.ts y cron.
- Alta sandbox autorizada hasta final del 15-10 Argentina → vencimiento 2026-10-16T03:00:00Z; Lucas conserva matrícula activa → informe de recuperación Lucas.
- Reinicio del número de prueba terminado en 4497 completado; contexto posterior conservado → pagos/matrícula previos separados del nuevo contexto → informe de reinicio de memoria.

## Invariantes establecidas en esta fase
- Continuación sin efectos explícitos ni implícitos; conserva consentimiento, plan y solicitud pendiente → schemas espejados y pruebas de autoridad/preparación.
- Fallo opcional no descarta respuesta segura de A → pruebas de política, schema, timeout y presupuesto agotado.
- Máximo dos solicitudes reales al modelo, incluidos JSON, transporte y replay durable → callback previo al HTTP y pruebas de Brain, workflow y runner.
- Seguimiento con redacción congelada, egress canónico, DNC y entrega única → caché bajo lock corto y clave post-call:<call_id>, pruebas de concurrencia/crash.
- Datos fragmentados conservan recibos de pregunta entregada → ingesta de 232611a y workflow Agus.
- Prompt canónico v69 intacto; Brain v103 cambia ejecución → módulos idénticos byte por byte y pruebas de prompt/bundle.

## Tests agregados
- Feedback/hot path: voz propia, faltantes, conservación de semántica/teléfono y respuesta segura.
- Autoridad/preparación/contrato: conversation_only conserva estado y nunca crea efectos, incluso checkout implícito.
- Contexto/resolver/runner: plan actual, curso/compra canónicos, continuidad tras handoff y presupuesto físico de generaciones.
- Narrativa/seguimiento: guardas por cláusula, identidad canónica, disponibilidad autorizada, caché y recuperación de cincuenta candidatos con presupuesto.
- Rutas dispatch/Retell: respuesta operacional independiente de composer demorado y recuperación posterior.
- Seis workflows, 3892 unitarias, 601 integraciones aprobadas; 27 integraciones de llamadas tras último ajuste; cobertura configurada 98,91% líneas/93,07% ramas; lint, tipos y ADK aprobados.

## Bloqueos
- Motivo del primer HTTP 400 de Xendra no conservado → requiere evidencia remota; reintento posterior del usuario aceptado y terminado en buzón. No se atribuye al merge.
- Evento access_ready procesado sin claim de Botpress → alta y aviso de Lucas recuperados; causa del handler pendiente de auditoría separada.
- Dos expectativas previas de múltiples cursos también fallan en a69970a → deuda documentada; no se declara aprobada toda la matriz de workflows. La tercera, CALL_OFFER_REQUIRED ante un pago autorizado, queda corregida y su escenario original pasa.
- Canal de Botpress Cloud y scheduler pendientes de prueba funcional del usuario tras publicar v103 → canario de seis turnos con modelo real aprobado contra backend y PostgreSQL aislados, sin llamadas ni cobros reales; evidencia conservada.
