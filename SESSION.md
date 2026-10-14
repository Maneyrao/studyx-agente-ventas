# Sesión StudyX

## Fase actual
PHASE 5 — restauración de autoría y continuidad de Agent A. Estado: en curso; código y revisión final aprobados, 3892 unitarias/601 integraciones/6 workflows aprobados; publicación coordinada pendiente de completar.

## Fases completas
- PHASE 0: fallos y silencios observables.
- PHASE 1: contexto acotado e intake autoritativo del Brain.
- PHASE 2: propuesta, rechazo estructurado y backend autoritativo.
- PHASE 4: persistencia de respuestas fragmentadas publicada en 232611a; 3793 unitarias, 599 integraciones y tres workflows aprobados.

## Decisiones de arquitectura tomadas
- A interpreta y redacta; backend conserva hechos, transiciones y efectos → restaurar especificación del 1-10, cuyos commits siguen en la rama → informe de restauración del 14-10.
- Plan y enlace en un mismo turno con recursos canónicos y datos completos → quitar permiso basado en fase previa y reinterpretación regex → contexto, resolver y agent-turn-policy-v2.ts.
- Una continuación conserva movimiento y teléfono confirmado de A → memoria semántica no desaparece al reparar texto → agent-a-action-feedback.ts y conversation_only.
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
- Prompt canónico v69 intacto; Brain v101 cambia ejecución → módulos idénticos byte por byte y pruebas de prompt/bundle.

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
- Tres expectativas previas de workflow de catálogo/pago también fallan en a69970a → deuda documentada; no se declara aprobada toda la matriz de workflows.
- Canario real de esta restauración pendiente tras publicar → prueba del usuario; laboratorio sin llamadas ni cobros reales.
