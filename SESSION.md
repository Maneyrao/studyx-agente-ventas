# Sesión de endurecimiento

## Plan activo

`specs/004-sales-orchestration/` — arquitectura canal-agnóstica, 20 fases.
Rama: `feat/phases-0-8-canal-agnostic`.

## Fase actual

**Fases 0–8 del ledger de orquestación: terminadas** (2026-08-11).
Fuente de reanudación: `.superpowers/ledgers/2026-08-11-studyx-mvp-orchestrator.md`.
Estado real del código: `docs/ORCHESTRATOR_MAP.md`.

Siguiente paso: ejecutar el piloto de Telegram siguiendo
`docs/PILOT_RUNBOOK.md` y llenar `docs/PILOT_MATRIX.md`.

**EXT-05 dejó de ser bloqueante** (2026-08-18, feature 007). El piloto ya no
depende de que la integración `telegram` esté instalada en Botpress Cloud: el
orquestador entrega los mensajes salientes por sí mismo contra la Bot API. Falta
la corrida manual contra un chat real, que necesita el bot token de producción.

## Feature 007 — Entrega outbound directa multicanal

Rama `feat/007-direct-outbound-delivery`. Artefactos en
`specs/007-direct-outbound-delivery/`.

Estado: implementada y verificada salvo la corrida manual del piloto.
`src/features/messaging/` expone `sendOutboundMessage()`, un caso de uso interno
y sincrónico que entrega por Telegram o WhatsApp y devuelve un resultado
concluyente. No expone ruta HTTP: su consumidor será la integración con Retell.

### Drift de esquema resuelto (2026-08-18)

`supabase db reset` estaba roto: `20260805000001_universal_business_memory.sql` y
`20260809020001_phase6_knowledge_base.sql` creaban ambas `knowledge_chunks`,
modelando cosas distintas (la primera chunkea `knowledge_sources` con pipeline
asíncrono; la segunda chunkea `knowledge_documents` para retrieval). Como la
primera ordena antes, ganaba el nombre y Phase 6 fallaba.

Producción ya había sido reparada a mano con un rename a
`legacy_knowledge_chunks_20260805`, pero ese cambio no estaba en ninguna
migración: de ahí el drift. Se formalizó agregando ese mismo `ALTER TABLE ...
RENAME TO` al final de `20260805000001`.

Resultado verificado: las 43 migraciones aplican limpio desde cero y el esquema
resultante coincide con el de producción, incluido el orden de columnas de
`knowledge_chunks`. La integración pasó de 22 fallos a 1.

### Pendiente detectado al reparar el drift

`memory_embeddings.embedding` quedó en `vector(1536)` mientras el resto del
sistema usa 768 (Gemini). Ninguna de las cinco migraciones de la serie 768 la
tocó, porque la tabla venía de la migración que estaba en conflicto. El cron
`memory-maintenance` reclama esas filas vía `claim_memory_embeddings`, así que
escribir un embedding real ahí fallaría por dimensión.

Es el único test de integración que sigue rojo (`embedding-dimensions`). Ese test
también ve `legacy_knowledge_chunks_20260805` en 1536; como está jubilada y
vacía, la decisión es bajarla o excluirla del chequeo.

Arreglarlo toca dimensiones de columnas vector en una base con datos: requiere
decidir qué pasa con las filas existentes. Queda para una tarea propia.

> La numeración de abajo pertenece al plan de 20 fases de `specs/004-...` y no
> coincide con la del ledger. Donde discrepen, manda el ledger, que es lo que
> se verificó contra el código.

## Posición dentro del plan de 20 fases

- [x] Phase 0 — Inspection & contracts.
- [x] Phase 1 — Botpress skeleton.
- [x] Phase 2 — Telegram Bot A adapter.
- [ ] Phase 3 — Agent A inbound text.
- [ ] Phase 4 — Agent A audio / transcription.
- [ ] Phase 5 — Supabase context + memory.
- [ ] Phase 6 — Knowledge Base.
- [ ] Phase 7 — Agent A Decision Router.
- [ ] Phase 8 — Sales tools.

## Endurecimiento previo (Fase 3 anterior)

Trabajo previo sobre `main` (WIP no commiteado): contrato Botpress local,
HMAC, workflow fail-closed, replay, concurrencia. Se preserva en la rama de
esta sesión y se armoniza fase por fase.

## Regla de bloqueo

Intentar cada bloqueo técnico hasta tres veces con alternativas seguras. Si el
mismo bloqueo persiste, documentarlo con evidencia y solicitar intervención.
