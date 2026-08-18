# Sesión StudyX

## Fase actual

**Contenido y contexto del Agente A. Estado: código completo, recuperación
bloqueada por credencial** (2026-08-18).
Rama: `feat/studyx-datos-y-sim-local`. Commits: `2fb28ce`, `8819314`,
`a1d771d`, `7dbca7a`.

Lo que cambió: el mapeo de `offerings` al prompt descartaba
`delivery.classes/modules/includes/temario_publicado` y la columna `audience`
entera, así que el bot no podía responder "¿cuántas clases tiene?" ni "¿qué
incluye?" aunque el seed sí tenía el dato. Además el schema Zod de
`botpress-agent` descartaba en silencio cualquier campo nuevo. Ambos
arreglados. Se sembraron los 14 temarios publicados en `knowledge_sources`
(`source_type='offering'`), aplicados a producción.

**Descubrimiento que redefine la prioridad:** la base de conocimiento nunca
se proyectó en producción — `knowledge_documents` y `knowledge_chunks` en
cero, 23 jobs `pending`. `context.knowledge_base` viene vacío en cada turno
desde siempre. Ver Bloqueos.

Fase anterior (datos reales + simulación local A→B→A, 2026-08-17): completa.
Plan: `docs/superpowers/plans/2026-08-17-studyx-datos-y-simulacion-local.md`
(leer primero la tabla "planificado vs. implementado" de arriba de todo).
Ledger: `.superpowers/sdd/2026-08-17-studyx-datos-y-simulacion-local/progress.md`.

## Fases completas

- Catálogo real de StudyX cargado: workspace `studyx` (`environment='production'`),
  14 diplomados verificados, **cero precios numéricos**. Evidencia:
  `tests/integration/studyx-seed.test.ts` y `studyx-catalog.test.ts`.
- Loop B→A (spec 007) con cobertura de integración del cron post-llamada:
  FR-1 idempotencia, FR-3 `no_contactar`, FR-4 `cancelled`, FR-5 contacto
  bloqueado. Evidencia: `tests/integration/post-call-followup.test.ts` y
  `docs/evidence/simulacion-local-a-b-a.md`.
- Simulación local documentada y ejecutable: `docs/runbooks/simulacion-local-a-b-a.md`
  + `scripts/seed-sandbox-tester.mjs`.
- Fases 0–8 del ledger de orquestación (2026-08-11), plan
  `specs/004-sales-orchestration/`, rama `feat/phases-0-8-canal-agnostic`.
  Estado real del código: `docs/ORCHESTRATOR_MAP.md`.

## Decisiones de arquitectura tomadas

- StudyX vive en `supabase/seed/studyx.sql`, separado de `dev.sql` → un seed de
  producción no puede arrastrar fixtures sintéticas → Ruling 11 del ledger.
- **Superada el 2026-08-18.** El precio quedó resuelto por decisión del dueño:
  los 14 cursos llevan `price_type='fixed'`, `price_amount=1200.00 USD` — lo
  que realmente cobra el checkout — y el monto de la Beca ($699) vive sólo en
  `offerings.metadata.beca_price_usd`, marcado `beca_hypothesis_unconfirmed`.
  Ese monto está guardrailed para no aparecer NUNCA en texto recuperable
  (`BECA_LEAK_PATTERN = /\b699\b/` en dos suites), y la columna `metadata` ni
  se selecciona en `postgres-business-context.ts` — exclusión deliberada, no
  un olvido. La regla anterior era: ningún precio como número mientras el
  sitio publicara $699 y cobrara $1.200.
- La cadena de migraciones no se reescribe; la reconciliación local vive en
  `scripts/pg-native-up.sh` → tocar una migración aplicada es una decisión sobre
  el historial de deploys de producción, no de esta rama → Ruling 21.

## Invariantes establecidas en esta fase

- Ningún texto recuperable puede contener una cifra con forma de precio →
  test de escaneo en `tests/integration/studyx-seed.test.ts`.
- El detalle del catálogo nunca niega un curso por el tope de la lista →
  test de regresión con rellenos en `tests/integration/studyx-catalog.test.ts`.
- Un truncamiento de ofertas nunca es silencioso → `offerings_truncated` +
  logs en `catalog/route.ts` y `claim-batch.ts`.
- Los tests de integración no pueden escribir en producción → `tests/setup/integration.ts`
  pisa `DATABASE_URL` siempre, nunca con `??=`.
- Los topes se fijan con holgura sobre el dato real, no pegados a él →
  `maxOfferings: 40`, `maxForbiddenPromises: 24`, ambos con test que fija el piso.

## Tests agregados

- `tests/integration/studyx-seed.test.ts`: el seed carga 14 ofertas sin precio y
  ningún knowledge_source filtra un monto.
- `tests/integration/studyx-catalog.test.ts`: el catálogo no expone precio por
  ningún campo, y el detalle encuentra cursos pasados el tope de la lista.
- `tests/integration/post-call-followup.test.ts`: los cuatro requisitos del cron
  B→A, cada uno verificado rompiendo su guard.
- `tests/unit/orchestration/business-context.test.ts`: holgura de los topes y
  propagación de los contadores de truncamiento e inyección.

## Bloqueos

- **🔴 `GEMINI_API_KEY` inválida → la base de conocimiento no se puede
  proyectar.** Es el bloqueo nº 1: sin esto, sembrar contenido no sirve de
  nada porque el agente no lo recupera. La clave de `.env.local` tiene
  formato `AQ.A…` (53 chars) y `generativelanguage.googleapis.com/v1beta`
  responde `GEMINI_EMBED_HTTP_401` — espera una clave `AIza…` de AI Studio.
  El cron `/api/cron/project-knowledge` SÍ está agendado en `vercel.json`
  cada 15 min, o sea que viene fallando en silencio, no es que nunca disparó
  (revisar también qué clave tiene cargada Vercel). Para drenar la cola una
  vez corregida:
  `npx tsx scripts/run-knowledge-projection.ts --database-url "…" --allow-remote --yes`.
  Requiere que el dueño reemplace la credencial.
- **Sin observabilidad del cron**: que un cron agendado falle en todas sus
  corridas durante días sin que nadie se entere es la brecha operativa real
  detrás del bloqueo anterior. Nada alerta sobre `knowledge_projection_jobs`
  estancados ni sobre `knowledge_chunks` en cero.
- **La cadena de migraciones no corre de cero**: `20260805000001:379` hace
  REVOKE sobre `anon`/`authenticated` sin guardas, y `20260805000001:194` crea
  un `knowledge_chunks(source_id)` que choca con el canónico
  `knowledge_chunks(document_id)` de `20260809020001:15`. Producción lo resolvió
  a mano — tiene `legacy_knowledge_chunks_20260805`, que ninguna migración del
  repo crea. Requiere una decisión del dueño sobre el historial de migraciones.
- ~~**Producción atrasada en migraciones (CP1)**~~ — resuelto: verificado el
  2026-08-18, `knowledge_projection_jobs` existe y `knowledge_documents`
  tiene `workspace_id`.
- **EXT-05**: la integración `telegram` no está instalada en Botpress Cloud, lo
  que bloquea el piloto de `docs/PILOT_RUNBOOK.md`.
- **Retell**: no existe `retell.provider.ts`; el Agente B real de voz sigue sin
  implementarse. El sandbox usa el simulador de Telegram.

## Regla de bloqueo

Intentar cada bloqueo técnico hasta tres veces con alternativas seguras. Si el
mismo bloqueo persiste, documentarlo con evidencia y solicitar intervención.
