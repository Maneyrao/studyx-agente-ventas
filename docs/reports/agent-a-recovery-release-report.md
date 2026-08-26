# Agent A — estado de recuperación

Fecha: 2026-08-26. Rama: `codex/integration-agent-a-outbound-prod`.

## Evidencia local aprobada

- Base PostgreSQL descartable recreada y sembrada desde migraciones + catálogo canónico.
- Unit: 1.479 aprobados; 7 omitidos no pertenecen al flujo comercial.
- Integración: 307 aprobados; 1 omitido.
- Lint, typecheck de Next y Botpress, `adk check`, build de Botpress y build Next con configuración local segura: aprobados.
- Catálogo completo separado del detalle; curso/plan/etapa se guardan como estado comercial estructurado.
- Memoria vectorial queda limitada a preferencias y objetivos, con worker durable, epoch, lease, reintento y dead-letter observable.
- Gemini directo recibe una única oportunidad y un timeout máximo de 6 s. El runner registra ingest, claim, modelo, commit, delivery y total por turno.

## Gates que no se pueden declarar todavía

- 20 históricos, 50 completos × 3 y 20 casos nuevos con proveedor real.
- Percentiles reales de 100 turnos: p50 <= 7 s y p95 <= 10 s.
- Smoke de delivery, Stripe y Google Sheets con sandbox autorizado.
- Despliegue backend/Botpress de la misma release y canary interno.

Estos gates requieren un entorno Development con variables reales, cuota disponible del proveedor de IA y aprobación explícita para interactuar con canales externos. No se infieren de tests locales ni se sustituyen por mocks.
