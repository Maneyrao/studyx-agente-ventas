# 004 — Sales orchestration (canal-agnóstico)

Freeze de contratos y fronteras para el plan de 20 fases que separa lo canal-específico de lo canal-agnóstico. Alcance: contrato canónico de mensajes inbound, esquema de eventos de llamada, y las fronteras de reemplazo canal → producción.

## Documentos

- [spec.md](spec.md) — intención y fronteras channel-specific vs channel-agnostic.
- [contracts.md](contracts.md) — schemas Zod congelados y política de versión.

## Estado

- Fase activa: **Phase 0 — Inspection & contracts**.
- Terminado cuando: existen fixtures compartidos en `tests/fixtures/canonical-envelopes/` y `tests/fixtures/call-events/`, y los tests de contrato en `tests/contract/` validan idempotencia, versión, correlación y paridad entre los Zod de Botpress y los de Next.js.
