# Agent A — estado de recuperación

Fecha: 2026-08-26. Rama: `codex/integration-agent-a-outbound-prod`.

## Evidencia local aprobada

- Base PostgreSQL descartable recreada y sembrada desde migraciones + catálogo canónico.
- Unit: 1.616 aprobados; 7 omitidos no pertenecen al flujo comercial.
- Integración: 313 aprobados; 1 omitido.
- Lint, typecheck de Next y Botpress, `adk check`, build de Botpress y build Next con configuración local segura: aprobados.
- Catálogo completo separado del detalle; curso/plan/etapa se guardan como estado comercial estructurado.
- Memoria vectorial queda limitada a preferencias y objetivos, con worker durable, epoch, lease, reintento y dead-letter observable.
- Gemini directo recibe una única oportunidad y un timeout máximo de 6 s. El runner registra ingest, claim, modelo, commit, delivery y total por turno.
- Matriz comercial local con Gemini: 20/20 en dos rondas consecutivas (92 turnos por ronda). Ronda 1: p50 1.467 s, p95 2.143 s, máximo 7.486 s. Ronda 2: p50 1.440 s, p95 1.693 s, máximo 6.968 s.
- Memoria vectorial: 4/4 casos reales de disponibilidad, presupuesto, canal preferido y objeción. Cada caso persistió una memoria activa, generó el embedding y la recuperó en una retoma posterior.
- Proyección de Sheets con proveedor falso: 57/57 filas pendientes procesadas; ninguna escritura externa.
- Regresión cerrada: «qué te había contado» ya no se interpreta como elección de pago al contado.

## Gates que no se pueden declarar todavía

- 50 completos × 3 con proveedor real.
- Smoke real de Google Sheets y de Telegram/WhatsApp con sandbox autorizado.
- Despliegue backend/Botpress de la misma release y canary interno.

Estos gates requieren aprobación explícita para interactuar con canales externos. La corrida de memoria también observó respuestas 429 y timeouts de Gemini; los fallbacks mantuvieron 4/4, pero la cuota del proveedor sigue siendo un riesgo operativo que debe monitorearse.
