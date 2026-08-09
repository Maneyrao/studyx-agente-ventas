# Plan de implementación y pruebas del orquestador híbrido

**Fecha:** 2026-08-06

**Objetivo:** Validar y completar un flujo de venta iniciado por WhatsApp en el que Botpress actúe como adaptador conversacional, Next.js sea el orquestador canónico y Supabase conserve el estado, la memoria y la auditoría. El recorrido final debe poder calificar al lead, obtener consentimiento, coordinar al Agente B de voz, retomar la conversación, generar el pago y disparar el alta o su notificación sin duplicar efectos.

**Arquitectura:** Botpress recibe/renderiza mensajes y ejecuta decisiones acotadas. Next.js valida cada transición y coordina memoria, negocio, voz, pago y fulfillment. Supabase/PostgreSQL es la única fuente de verdad; pgvector es un índice derivado dentro de la misma base. Las integraciones externas entran por adaptadores y webhooks idempotentes.

**Stack actual:** Next.js 16.3, TypeScript, Zod, Botpress ADK 2.0.5, Supabase/PostgreSQL 17, pgvector, Vitest y despliegue previsto en Vercel/Botpress Cloud.

## Restricciones globales

- No crear `/api/chat/sync` ni `/api/chat/memory`: extender el ciclo existente `ingest -> decision -> delivery`.
- No reconstruir el agente en Botpress Studio: aprovechar `botpress-agent/` y su workflow ADK.
- No guardar estado canónico, secretos, RAG ni reglas irreversibles en Botpress.
- No mantener una transacción o lock mientras responde un LLM o un proveedor externo.
- Toda migración nueva debe ser aditiva; no modificar migraciones ya aplicadas.
- Toda llamada, cobro y alta requiere consentimiento o evidencia verificable y una clave de idempotencia.
- Google Sheets será una proyección operativa, nunca la fuente de verdad.
- No habilitar autonomía en producción hasta superar los gates de replay, concurrencia, seguridad y recuperación.
- No mezclar los cambios actualmente sueltos de `main` con el worktree `codex/feature-2-aburridont` sin una integración revisada.

## Estado de partida comprobado

- `npm test`: 7 archivos y 66 tests en verde.
- `npm run typecheck`: aprobado.
- `npm run lint`: aprobado.
- `botpress-agent/npm run typecheck`: aprobado.
- `botpress-agent/npm run check`: configuración ADK válida.
- Ya existen ingesta idempotente, decisión canónica, reporte de delivery, HMAC, outbox, auditoría y kill switch.
- El primer smoke E2E todavía está bloqueado por identidad faltante en Emulator, autonomía apagada, falta de runtime local para Supabase y ausencia de WhatsApp/voz reales.

## Modelo de estados que se debe congelar

Mantener tres máquinas de estado independientes evita que WhatsApp, voz y ventas se pisen.

### Estado comercial configurable

Vive en `pipeline_stages`, no en un enum de código:

`new -> qualifying -> qualified -> proposal -> won | lost | disqualified`

`call_in_progress` no es una etapa comercial. `follow_up` debe ser una acción/tarea pendiente, no una etapa obligatoria.

### Estado de conversación/turno

`received -> processing -> decision_committed -> waiting_user | paused_error | completed`

### Estado técnico de llamada

`requested -> dispatching -> ringing -> in_progress -> completed | failed | cancelled | timed_out`

### Estado de pago y fulfillment

Pago: `not_created -> pending -> paid | failed | expired | refunded`

Fulfillment: `not_requested -> requested -> completed | failed`

## Sobre común de eventos

Todo evento de Botpress, voz o pago debe incluir como mínimo:

- `schema_version`
- `event_id`
- `event_type`
- `occurred_at`
- `source`
- `trace_id`
- `correlation_id`
- `idempotency_key`
- `aggregate_id` (`turn_id`, `call_id` o `payment_id`)
- `sequence` o versión monotónica cuando el proveedor pueda entregar eventos fuera de orden
- `payload`

## Task 0 — Estabilizar el punto de partida

**Objetivo:** evitar que el trabajo paralelo sobre Feature 1 y Feature 2 se sobrescriba.

**Archivos a revisar:**

- `studyx-agente-ventas/` completo y su estado de Git.
- `studyx-feature2-aburridont/supabase/migrations/20260805000001_universal_business_memory.sql`
- `studyx-feature2-aburridont/supabase/migrations/20260805000002_secure_existing_tables.sql`
- `studyx-feature2-aburridont/supabase/seed/dev.sql`

**Pasos:**

1. Inventariar los cambios de `main` por Feature 1, robustez y Botpress.
2. Cerrar esos cambios en commits lógicos únicamente después de revisarlos; no usar reset ni checkout destructivo.
3. Cerrar por separado las migraciones/seed de Feature 2 en `codex/feature-2-aburridont`.
4. Crear el punto de integración desde commits conocidos, no copiando carpetas sobre un árbol sucio.
5. Volver a ejecutar la línea base.

**Verificación:**

```bash
npm run typecheck
npm run lint
npm test
(cd botpress-agent && npm run typecheck && npm run check)
```

**Terminado cuando:** ambos trabajos tienen un origen recuperable y todos los controles actuales permanecen verdes.

## Task 1 — Congelar contratos y decisiones de negocio

**Objetivo:** hacer que Botpress ejecute una decisión permitida por Next.js, en lugar de decidir por sí solo el estado comercial.

**Archivos:**

- Crear: `specs/004-sales-orchestration/spec.md`
- Crear: `specs/004-sales-orchestration/contracts/orchestrator-v1.md`
- Crear: `specs/004-sales-orchestration/contracts/voice-events-v1.md`
- Crear: `specs/004-sales-orchestration/contracts/payment-events-v1.md`
- Crear: `specs/004-sales-orchestration/state-machines.md`
- Crear: `src/lib/contracts/agent.ts`
- Modificar: `src/app/api/agent/ingest/route.ts`
- Modificar: `botpress-agent/src/schemas/contracts.ts`
- Crear: `tests/contract/agent-business-context.test.ts`
- Crear: `tests/contract/event-envelope.test.ts`

**Pasos:**

1. Escribir primero tests que rechacen contratos sin versión, idempotencia, correlación o estado válido.
2. Centralizar el contrato Next.js de ingesta fuera del Route Handler.
3. Extender `IngestResponse` con `business_context`:
   - `workspace_id`
   - `offering_id`
   - `opportunity_id`
   - `pipeline_stage`
   - `state_version`
   - `qualification_summary`
   - `missing_fields`
   - `allowed_actions`
   - `next_action`
   - `active_call`
   - `payment_status`
4. Mantener el contexto conversacional existente (`recent_turns`, resumen y memoria) separado del contexto comercial.
5. Definir políticas exactas:
   - Durante una llamada activa: `suppress`; no usar IA.
   - Sin consentimiento de llamada: `request_call` debe ser rechazado.
   - Precio, horario, consentimiento, pago y acceso solo pueden salir de datos estructurados confirmados.
6. Verificar paridad entre los esquemas Zod de Botpress y Next.js con fixtures compartidos, sin acoplar los runtimes.

**Prueba mínima:** payload válido aceptado; payload viejo o incompleto rechazado; `next_action` siempre pertenece a `allowed_actions`.

**Terminado cuando:** existe un contrato versionado que Lucas, Botpress y backend pueden implementar sin inferencias.

## Task 2 — Converger el esquema universal y proteger sus invariantes

**Objetivo:** llevar el modelo de negocio/Feature 2 al repositorio principal sin romper la base robusta existente.

**Archivos:**

- Integrar tras revisión: las dos migraciones `2026080500000x` del worktree de Feature 2.
- Crear: `supabase/migrations/<timestamp>_sales_orchestration_integrity.sql`
- Crear: `supabase/tests/007_universal_business_isolation.sql`
- Crear: `supabase/tests/008_sales_state_integrity.sql`
- Regenerar: `src/lib/supabase/database.types.ts`

**Pasos:**

1. Comparar el historial remoto con ambos grupos de migraciones antes de aplicar nada.
2. Confirmar que convivan contactos, permisos por canal, oportunidades, calificación, conocimiento, memoria, outbox y decisiones del agente.
3. Agregar constraints que impidan mezclar entre workspaces:
   - pipeline y stage
   - opportunity y offering
   - opportunity y contacto
   - qualification field y workspace
   - chunks/memoria y workspace/contacto
4. Agregar control optimista `state_version` al agregado comercial.
5. Mantener embeddings como datos derivados/reconstruibles.
6. Regenerar tipos desde el esquema efectivo.
7. Ejecutar reset limpio y dos resets adicionales para probar repetibilidad.

**Prueba mínima:** insertar relaciones cruzadas entre dos workspaces debe fallar por constraint, no solamente por validación de aplicación.

**Comandos de verificación:**

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:integration
npm run test:db:invariants
npm run test:db:reset-loop
```

**Dependencia:** Docker, OrbStack u otro runtime compatible con Supabase CLI. No ejecutar estas pruebas destructivas contra el proyecto remoto compartido.

**Terminado cuando:** una migración limpia reproduce toda la base, los tipos coinciden y no es posible filtrar datos entre negocios o contactos.

## Task 3 — Primer smoke de backend sin Botpress

**Objetivo:** validar el cerebro y el estado antes de sumar dos plataformas externas.

**Archivos:**

- Crear: `src/lib/services/sales-context.service.ts`
- Modificar: `src/lib/services/ingestion.service.ts`
- Crear: `tests/integration/sales-context.test.ts`
- Crear: `tests/integration/sales-turn-lifecycle.test.ts`
- Crear: `scripts/smoke-agent-turn.mjs`

**Pasos:**

1. Escribir test de contacto nuevo y comprobar creación única de contacto, workspace_contact, conversación y oportunidad.
2. Escribir test de contacto conocido y comprobar recuperación de etapa y respuestas previas.
3. Escribir test de diez reentregas con el mismo `external_message_id`.
4. Escribir test de dos mensajes simultáneos y comprobar que no se pierda ni retroceda `state_version`.
5. Implementar la lectura de `business_context` dentro de la misma operación de ingesta, sin invocar LLM.
6. Crear un smoke HTTP firmado que recorra `ingest -> decision -> delivery` usando datos sintéticos.
7. Confirmar trazabilidad completa desde `external_message_id` hasta auditoría.

**Terminado cuando:** los cuatro escenarios funcionan contra una base descartable sin Botpress y sin llamadas a modelos reales.

## Task 4 — Habilitar una vertical mínima en Botpress Emulator

**Objetivo:** probar el adaptador existente de punta a punta sin WhatsApp real.

**Archivos:**

- Modificar: `botpress-agent/agent.config.ts`
- Modificar: `botpress-agent/src/conversations/emulator.ts`
- Modificar: `botpress-agent/src/workflows/processInboundTurn.ts`
- Crear: `botpress-agent/src/evals/happyPath.ts`
- Crear: `botpress-agent/src/evals/duplicateInbound.ts`

**Pasos:**

1. Agregar `emulatorPhoneE164` como configuración exclusiva de desarrollo con el número sintético del seed.
2. No relajar `phone_e164` en el backend: corregir el adaptador Emulator.
3. Mantener `automationEnabled=false` por defecto y habilitarlo solo en un entorno de prueba explícito.
4. Ejecutar una única vertical:
   - Emulator recibe texto.
   - `ingestTurn` persiste y obtiene contexto.
   - Next.js devuelve `next_action` y `allowed_actions`.
   - El nodo autónomo solo redacta dentro de esas restricciones.
   - `commitDecision` valida el efecto.
   - Botpress intenta un único envío físico.
   - `reportDelivery` registra el resultado.
5. Crear eval feliz y eval de evento duplicado.
6. Mantener fail-closed ante timeout, contrato inválido o ambigüedad de envío.

**Smoke:** escribir “Hola” en Emulator y verificar una única conversación, inbound, decisión, outbound y delivery correlacionados por `trace_id`.

**Terminado cuando:** el flujo completo es observable en Supabase y repetir el mismo evento no crea otra respuesta lógica.

## Task 5 — Calificación estructurada antes de RAG

**Objetivo:** avanzar el proceso de venta usando hechos verificables y preguntas faltantes.

**Archivos:**

- Crear: `src/lib/services/qualification.service.ts`
- Modificar: `src/lib/services/decision.service.ts`
- Modificar: `botpress-agent/src/schemas/contracts.ts`
- Modificar: `botpress-agent/src/workflows/processInboundTurn.ts`
- Crear: `tests/integration/qualification-lifecycle.test.ts`

**Pasos:**

1. Agregar una acción propuesta `record_qualification_answer`; el modelo no escribe SQL ni cambia etapas directamente.
2. Validar en Next.js que el field pertenece al workspace y que el valor cumple el tipo esperado.
3. Registrar evidencia: mensaje de origen, extractor/modelo, confianza y timestamp.
4. Calcular preguntas faltantes de forma determinista.
5. Cambiar etapa únicamente cuando se cumplen las reglas configuradas del negocio y coincide `state_version`.
6. Obtener precio y horarios desde tablas relacionales, no desde vector search.
7. Probar el dataset sandbox de Aburridont:
   - perfil IT
   - objetivo laboral
   - nivel
   - bloqueo al hablar
   - disponibilidad
   - urgencia
   - presupuesto

**Pruebas negativas:** presupuesto inventado, oferta inexistente, respuesta para otro contacto y dos decisiones sobre la misma versión deben ser rechazadas.

**Terminado cuando:** el lead puede pasar de `new` a `qualified` sin que el LLM sea dueño del estado.

## Task 6 — Memoria y RAG con degradación segura

**Objetivo:** recuperar contexto útil sin volver crítica la base vectorial.

**Archivos:**

- Crear: `src/lib/services/knowledge.service.ts`
- Modificar: `src/lib/services/memory.service.ts`
- Modificar: `src/lib/embeddings/openai.ts` o sustituirlo por una interfaz de proveedor.
- Modificar: `src/app/api/cron/retry-embeddings/route.ts`
- Crear: `tests/integration/knowledge-retrieval.test.ts`
- Crear: `tests/unit/memory/relevance-policy.test.ts`

**Pasos:**

1. Definir una interfaz de embeddings y usar un fake determinista en tests; la elección de proveedor real queda detrás del adaptador.
2. Crear jobs para `knowledge_chunks` y `memory_embeddings`, reutilizando la cola/lease existente.
3. Definir elegibilidad, umbral mínimo, deduplicación, máximo de chunks y procedencia/versionado.
4. Separar:
   - memoria reciente: últimos turnos
   - memoria estructurada: respuestas de calificación
   - resumen: derivado y versionado
   - knowledge RAG: información documental
5. Hacer que una consulta irrelevante devuelva cero chunks.
6. Probar aislamiento estricto por workspace y contacto.
7. Probar caída de embeddings/pgvector: el turno continúa con datos relacionales y memoria reciente.

**Terminado cuando:** “¿cuáles son los horarios y el precio?” responde con hechos correctos, y una falla vectorial no rompe ni duplica el turno.

## Task 7 — Diseñar e integrar Agente B primero con un mock

**Objetivo:** probar la coordinación antes, durante y después de la llamada sin depender todavía de Lucas.

**Archivos:**

- Crear: `supabase/migrations/<timestamp>_call_sessions_and_events.sql`
- Crear: `src/lib/contracts/voice.ts`
- Crear: `src/lib/providers/voice/voice-provider.ts`
- Crear: `src/lib/providers/voice/fake-voice-provider.ts`
- Crear: `src/lib/services/call.service.ts`
- Crear: `src/app/api/calls/requests/route.ts`
- Crear: `src/app/api/webhooks/voice/events/route.ts`
- Crear: `tests/integration/call-lifecycle.test.ts`
- Crear: `tests/contract/voice-webhook.test.ts`

**Pasos:**

1. Crear `call_sessions` y ledger append-only `call_events`.
2. Exigir consentimiento explícito, número normalizado y `idempotency_key` antes de solicitar llamada.
3. Guardar un snapshot de contexto y su hash antes de entregar el trabajo al Agente B.
4. Crear una solicitud idempotente y enviarla mediante el fake provider después del commit.
5. Procesar eventos firmados con secuencia y tabla de transiciones válidas.
6. Durante `ringing` o `in_progress`, Next.js devuelve `next_action=suppress`; Botpress no usa IA ni compite con la voz.
7. Al finalizar, guardar resultado comercial, resumen y referencia de transcripción como eventos; nunca guardar un URI no verificado como hecho.
8. Emitir exactamente una acción de seguimiento tras `completed`.
9. Probar timeout y recuperación de una llamada que nunca empieza.

**Casos obligatorios:** solicitud duplicada, llamada sin consentimiento, `call_ended` duplicado, evento atrasado, mensaje WhatsApp durante llamada y fallo del proveedor.

**Terminado cuando:** el fake reproduce todo el ciclo sin regresiones de estado ni dos seguimientos.

## Task 8 — Sustituir el mock por el contrato real de Lucas

**Objetivo:** integrar el Agente B sin cambiar el dominio interno.

**Información necesaria de Lucas:**

- endpoint de inicio y autenticación
- formato y versión de request/response
- quién administra telefonía/SIP/Twilio
- ID estable de llamada
- catálogo completo de eventos y su orden/sequence
- firma de webhooks y política de replay
- timeouts, reintentos y cancelación
- formato de resumen, resultado, transcript y objeciones durante la llamada
- mecanismo para enviar contexto actualizado durante la llamada, si realmente lo necesita

**Archivos:**

- Crear: `src/lib/providers/voice/lucas-voice-provider.ts`
- Modificar: `src/lib/config.ts`
- Ampliar: `tests/contract/voice-webhook.test.ts`
- Crear: `tests/integration/lucas-voice-adapter.test.ts`

**Pasos:**

1. Mapear el contrato externo al contrato interno; no propagar sus estados directamente al resto del sistema.
2. Verificar firma, timestamp y replay antes de procesar eventos.
3. Medir tiempo solicitud -> ringing -> in_progress.
4. Probar eventos reales grabados/sanitizados como fixtures.
5. Mantener el fake para regresiones y desarrollo local.

**Terminado cuando:** cambiar entre fake y Lucas requiere solo configuración y no altera Botpress, ventas ni Supabase.

## Task 9 — WhatsApp real después del Emulator

**Objetivo:** sustituir el canal sintético manteniendo invariantes.

**Archivos:**

- Generados/modificados por la integración oficial bajo `botpress-agent/`.
- Crear: `botpress-agent/src/conversations/whatsapp.ts`
- Crear: `tests/fixtures/whatsapp/`
- Crear: `docs/WHATSAPP_MAPPING.md`

**Pasos:**

1. Instalar y autenticar la integración oficial en un ambiente de prueba.
2. Inspeccionar los tipos/eventos reales generados por Botpress.
3. Mapear número, integration ID, conversation ID, message ID, provider ID y respuesta citada.
4. Probar texto antes de audio e imagen.
5. Repetir nuevo contacto, conocido, evento duplicado y dos mensajes rápidos.
6. Verificar la política durante llamada.
7. Mantener kill switch apagado en producción hasta completar la matriz.

**Terminado cuando:** WhatsApp real conserva la misma trazabilidad y resultados que Emulator.

## Task 10 — Pago, Sheets y acceso

**Objetivo:** cumplir el alcance original; el mock es una etapa de prueba, no el entregable final.

**Archivos:**

- Crear: `supabase/migrations/<timestamp>_payments_and_fulfillment.sql`
- Crear: `src/lib/contracts/payments.ts`
- Crear: `src/lib/providers/payments/payment-provider.ts`
- Crear: `src/lib/providers/payments/fake-payment-provider.ts`
- Crear después de elegir pasarela: adaptador real correspondiente.
- Crear: `src/lib/services/payment.service.ts`
- Crear: `src/lib/services/fulfillment.service.ts`
- Crear: `src/app/api/payments/checkout/route.ts`
- Crear: `src/app/api/webhooks/payments/events/route.ts`
- Crear: `src/lib/providers/sheets/sheets-provider.ts`
- Crear: `tests/integration/payment-fulfillment.test.ts`

**Pasos:**

1. Modelar pago y fulfillment separados de la oportunidad.
2. Generar un checkout idempotente solo para una oferta/precio confirmado.
3. Enviar el link mediante una nueva decisión/outbound canónico; Botpress no fabrica URLs.
4. Confirmar pago exclusivamente por webhook firmado del proveedor.
5. Ante `paid`, crear un job/outbox de fulfillment.
6. Actualizar Google Sheets como proyección idempotente por `payment_id`/`contact_id`.
7. Ejecutar el mecanismo de alta real disponible:
   - si existe API de la plataforma, usar un adaptador;
   - si no existe, enviar la notificación completa al equipo para alta manual, que es el alcance documentado original.
8. Registrar éxito o fallo y reintentar sin volver a cobrar ni duplicar filas/altas.

**Casos obligatorios:** checkout duplicado, webhook duplicado, webhook inválido, pago rechazado, Sheet caída, alta caída y reintento posterior.

**Terminado cuando:** un pago acreditado produce una sola fila/proyección y una sola solicitud de alta trazable.

## Task 11 — Resiliencia, observabilidad y gate de demo

**Objetivo:** demostrar que el flujo funciona también bajo fallos y concurrencia.

**Archivos:**

- Modificar: `docs/FAILURE_MATRIX.md`
- Crear: `docs/SMOKE_TEST_RUNBOOK.md`
- Crear: `src/app/api/health/route.ts`
- Crear: `src/app/api/ready/route.ts`
- Crear: `.github/workflows/ci.yml`
- Crear: `tests/e2e/full-sales-flow.test.ts`

**Pasos:**

1. Agregar CI: tipos, lint, unit/contract, migración limpia e integración.
2. Exponer health sin dependencias y readiness sin secretos.
3. Medir por tramo: Botpress, Next.js, Supabase, modelo, voz, pago y envío.
4. Medir p50/p95; no usar como verdad las estimaciones de Gemini.
5. Ejecutar 25 conversaciones concurrentes antes de intentar 150.
6. Probar kill switch, timeout, replay, recuperación de outbox y reconciliación.
7. Ejecutar demo supervisada con datos sandbox.

**Terminado cuando:** ninguna prueba rompe una invariante, cada fallo queda trazado y el operador puede detener la autonomía sin desplegar código.

## Orden de ejecución en 21 días

| Días | Resultado comprobable |
|---|---|
| 1–2 | Repositorio estabilizado, contratos y máquinas de estado congelados |
| 3–5 | Esquema universal integrado, migración limpia y smoke de backend |
| 6–8 | Botpress Emulator de punta a punta y calificación estructurada |
| 9–10 | Memoria/RAG con fallback y aislamiento verificado |
| 11–13 | Agente B fake, estados de llamada y pruebas de concurrencia |
| 14–16 | Adaptador real de Lucas y WhatsApp de prueba |
| 17–18 | Pago, webhook, Sheets y fulfillment primero con fake y luego real si hay credenciales |
| 19–20 | Smoke E2E, fallos, replay, latencia y correcciones |
| 21 | Demo supervisada, documentación y decisión de habilitación |

## Smoke tests en orden

1. **S0 — Línea base:** tipos, lint, 66 tests y ADK check.
2. **S1 — Backend:** nuevo, conocido, duplicado y concurrencia sin Botpress.
3. **S2 — Emulator:** un turno `ingest -> decision -> delivery`.
4. **S3 — Negocio:** precio/horarios + una respuesta de calificación persistida.
5. **S4 — Memoria:** referencia pasada y fallback sin vector.
6. **S5 — Voz fake:** consentimiento -> llamada -> resumen -> seguimiento.
7. **S6 — Canal real:** repetir S2–S5 por WhatsApp.
8. **S7 — Pago fake/real:** checkout -> webhook -> Sheet -> alta/notificación.
9. **S8 — Resiliencia:** replay, fuera de orden, dependencias caídas y kill switch.

## Dependencias que pueden bloquear el calendario

- Runtime local compatible con Supabase CLI.
- Credenciales y ambiente de prueba de Botpress/WhatsApp.
- Contrato final y endpoint de Lucas.
- Elección y credenciales de pasarela de pago.
- Cuenta/credenciales de Google Sheets y definición de columnas.
- API o procedimiento real de alta al contenido.
- Corpus de negocio real y reglas reales de calificación.
- Proveedor/modelo/dimensión de embeddings; el schema actual asume 1536 dimensiones y debe confirmarse antes de poblarlo.

## Gate final

La demo se aprueba únicamente si:

- cero mezcla de datos entre contactos/workspaces;
- cero duplicados lógicos ante reentregas;
- cero llamadas sin consentimiento;
- cero confirmaciones de pago sin webhook verificado;
- cero URLs/precios inventados por IA;
- estado comercial, llamada y pago nunca retroceden por eventos atrasados;
- trazabilidad completa desde WhatsApp hasta voz, pago y fulfillment;
- kill switch y recuperación operativa comprobados.

## Evaluación de diseño

- Núcleo local actual: **8,5/10** por idempotencia, transacciones, outbox y auditoría ya presentes.
- Sistema E2E actual: **6/10** porque todavía no están conectados negocio universal, Emulator funcional, WhatsApp, voz, pago ni fulfillment.
- Objetivo al terminar este plan: **8,5–9/10 E2E**, condicionado a contratos reales, pruebas con proveedores y operación supervisada.

Las tres mejoras de mayor impacto son: separar las máquinas de estado; hacer que Next.js entregue `next_action/allowed_actions`; y estandarizar todos los eventos con versión, idempotencia, correlación y secuencia.
