# Agent A — informe de rediseño de conversación y latencia

Fecha: 2026-08-26  |  Rama: `codex/integration-agent-a-outbound-prod`

## Cambios aplicados

- Se restauró en producción `payment_projection_jobs` y su índice; las migraciones 20260821010001, 20260822010001 y 20260825010001 quedaron reconciliadas.
- El router limpia y guarda el transcript administrado por Botpress antes de iniciar el flujo. Si falla, sólo registra un código técnico y continúa; no se usa la compactación de IA de Botpress.
- Las consultas comerciales abiertas (catálogo, orientación y recomendación) llegan a Gemini. Se mantienen deterministas únicamente pagos, llamadas, consentimiento, opt-out y hechos canónicos.
- El egreso autoriza nombres exactos de cursos/academias del snapshot; precios, URLs, certificaciones, garantías y promesas no verificadas siguen bloqueados.
- El prompt reduce catálogos grandes a un índice (`code`, nombre y academia); los detalles y las tres opciones de pago sólo se incluyen cuando son pertinentes.

## Verificación local

- Unitarias: 1.547 pasaron; 7 omitidas por configuración existente.
- Integración PostgreSQL desechable: 303 pasaron; 1 omitida por configuración.
- `typecheck`, `lint`, `adk check` y `adk build`: verdes.
- Preflight ADK de producción posterior al deploy: sin cambios pendientes, sin incompatibilidades ni cambios destructivos.

## Deploy

- Vercel: deployment `dpl_A4Cqxj2bpy5STtqpSkHAH9Tx3dD2`, estado `Ready`, alias `https://studyx-agente-ventas.vercel.app`.
- Botpress producción: deploy completado desde el mismo commit; configuración verificada `decisionProvider=gemini_direct`, `automationEnabled=true`, `apiBaseUrl=https://studyx-agente-ventas.vercel.app`.

## Smoke externo pendiente

Por la restricción de no generar tráfico externo, todavía no se midieron Telegram/WhatsApp ni se puede afirmar p50/p95. El usuario debe enviar manualmente, en una conversación nueva, estos cinco mensajes y guardar hora de envío/recepción:

1. `Hola`
2. `Me pasas todos los cursos?`
3. `No sé qué estudiar, orientame`
4. `Me interesa tecnología pero no sé qué elegir`
5. `Cuánto sale y qué formas de pago tienen?`

Luego se deben reconciliar por `trace_id`: Telegram→router, claim, retrieval, Gemini, commit, send y total; además confirmar un solo outbound por inbound, ausencia de `QuotaExceeded`, ausencia de `42P01`, sin reintentos de delivery y sin fallback general injustificado. Los gates p50 ≤ 7 s y p95 ≤ 10 s quedan pendientes de esa muestra real.
