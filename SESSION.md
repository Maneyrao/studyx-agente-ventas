# Sesión de endurecimiento

## Plan activo

`specs/004-sales-orchestration/` — arquitectura canal-agnóstica, 20 fases.
Rama: `feat/phases-0-8-canal-agnostic`.

## Fase actual

**Fases 0–8 del ledger de orquestación: terminadas** (2026-08-11).
Fuente de reanudación: `.superpowers/ledgers/2026-08-11-studyx-mvp-orchestrator.md`.
Estado real del código: `docs/ORCHESTRATOR_MAP.md`.

Siguiente paso: ejecutar el piloto de Telegram siguiendo
`docs/PILOT_RUNBOOK.md` y llenar `docs/PILOT_MATRIX.md`. Bloqueado por EXT-05
(la integración `telegram` no está instalada en Botpress Cloud).

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
