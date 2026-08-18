# Sesión StudyX

## Fase actual

**Datos reales de StudyX + simulación local A→B→A. Estado: completa** (2026-08-17).
Rama: `feat/studyx-datos-y-sim-local`, desde `baefe9f`.
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
- Ningún precio de StudyX entra como número mientras el sitio publique $699 y
  cobre $1.200 → el agente no puede citar un monto que el checkout desmienta →
  `price_type='quote'` + `never_invent_price` en `supabase/seed/studyx.sql`.
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

- **Precio real de StudyX**: el sitio publica $699 y cobra $1.200 (+71,7%,
  verificado en 3 cursos). Hasta que StudyX lo resuelva, ningún curso puede
  tener `price_amount`. Requiere respuesta del cliente.
- **La cadena de migraciones no corre de cero**: `20260805000001:379` hace
  REVOKE sobre `anon`/`authenticated` sin guardas, y `20260805000001:194` crea
  un `knowledge_chunks(source_id)` que choca con el canónico
  `knowledge_chunks(document_id)` de `20260809020001:15`. Producción lo resolvió
  a mano — tiene `legacy_knowledge_chunks_20260805`, que ninguna migración del
  repo crea. Requiere una decisión del dueño sobre el historial de migraciones.
- **Producción atrasada en migraciones**: le faltan las de CP1
  (`20260817020001`, `20260817020002`); `knowledge_documents` no tiene
  `workspace_id` y `knowledge_projection_jobs` no existe.
- **EXT-05**: la integración `telegram` no está instalada en Botpress Cloud, lo
  que bloquea el piloto de `docs/PILOT_RUNBOOK.md`.
- **Retell**: no existe `retell.provider.ts`; el Agente B real de voz sigue sin
  implementarse. El sandbox usa el simulador de Telegram.

## Regla de bloqueo

Intentar cada bloqueo técnico hasta tres veces con alternativas seguras. Si el
mismo bloqueo persiste, documentarlo con evidencia y solicitar intervención.
