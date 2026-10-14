# Sesión StudyX

## Fase actual
PHASE 3 — recuperación de llamadas y validación del incidente de Lucas. Estado: en curso; corrección e34130a publicada en Vercel y Botpress, alta de Lucas recuperada; pendiente canario de llamada real y diagnóstico del aviso automático.

## Fases completas
- PHASE 0: fallos y silencios observables.
- PHASE 1: contexto acotado e intake autoritativo del Brain.
- PHASE 2: propuesta, rechazo estructurado y reparación con backend autoritativo.

## Decisiones de arquitectura tomadas
- Mantener advisory general y exigir coherencia de promesas de llamada → protege efectos sin restaurar todos los vetos semánticos → resolve-agent-a-plannerless.ts y prepare-agent-turn-v2.ts.
- call_sessions respalda el registro de una solicitud existente, nunca una llamada nueva → active_call opcional del contexto del agente.
- Construir proveedor tras claimDispatch y cerrar fallos confirmados anteriores al HTTP → evita solicitudes activas indefinidas por mala configuración → ruta calls/[call_id]/dispatch.
- Ejecutar seguimiento al fallar el despacho → un rechazo puede no generar webhook → runPostCallFollowup y claves existentes por call_id.
- Partir de a69970a → su fuente coincide con el backend publicado auditado → rama codex/lucas-call-recovery; prompt v100/canónico v69.
- Permiso sandbox→alta real extendido por el usuario hasta el final del 15-10 Argentina → vencimiento publicado 2026-10-16T03:00:00Z; pagos siguen test → configuración y docs/runbooks/stripe-sandbox-chat.md.
- Lucas conserva su registro de prueba Juan/Oratoria → pago original recuperado, solicitud completed en intento 2, matrícula enr_2 activa y aviso sent → docs/reports/2026-10-13-lucas-enrollment-recovery.md.

## Invariantes establecidas en esta fase
- Sin acción autorizada no se publica una promesa de nueva llamada → guards de Botpress y backend, reparación limitada y aviso técnico al agotarse.
- Nombre y apellido juntos, incluidos nombres compuestos, se preservan → extractor y 123 pruebas de identidad.
- Correo opcional para llamada; nombre, apellido, teléfono utilizable y disponibilidad sí son necesarios → capacidades de autorización alineadas.
- Despacho fallido, replay y webhook producen un único aviso → integración con base real y HTTP controlado; ambiguos conservan su estado.

## Tests agregados
- tests/workflow/agent-a-call-recovery.test.ts: incidente Lucas, diagnóstico de reparación, identidad, consentimiento, reserva única, replay y aviso único ante reparación inválida; 2/2 aprobados.
- tests/unit/calls/dispatch-route-followup.test.ts y tests/integration/post-call-followup.test.ts: rechazo 503 y fallo de configuración/constructor, deduplicación y preservación de resultados ambiguos.
- Tests de resolver, preparación, contexto e identidad: negaciones, ofertas condicionales, pregunta de cierre, sesión durable y nombres compuestos.
- Verificación completa: 3785 unitarias y 591 integraciones aprobadas; cobertura configurada 98,85% líneas; lint, tipos y builds de backend/Botpress aprobados. Detalle en docs/reports/2026-10-13-lucas-call-recovery.md.

## Bloqueos
- Backend dpl_5nAmth2X62aJ3ggaYmxnGncezRSh y Botpress desplegado 2026-10-14T00:18:29.312Z verificados; falta llamada real supervisada → requiere una persona disponible con consentimiento; no se hicieron llamadas reales.
- Aviso access_ready de Lucas: Botpress informó processed sin iniciar claim; se completó la misma notificación por rutas firmadas, conservando entrega única → falta determinar la causa del evento sin ejecución; el primer fallo precede al despliegue de Botpress.
- Tres expectativas de workflow de catálogo/pago fallan igual en la base a69970a → deuda previa documentada en el informe; no se relajaron pruebas ni se cambió la política general para ocultarlas.
- El mensaje sin reclamar de la auditoría original tiene causa no demostrada → investigación separada; esta corrección no la atribuye ni declara resuelta.
