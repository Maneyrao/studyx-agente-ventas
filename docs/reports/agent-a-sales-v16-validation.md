# Agent A Sales Playbook v16 — validación local

Fecha: 2026-08-26  
Base: `f7f2fcf` · rama `codex/integration-agent-a-outbound-prod`

## Cambios verificados

- Playbook ejecutable único v16 y suites sincronizadas.
- Conversación comercial normal en `model_required`; saludo, opt-out, llamada explícita y elección explícita de pago conservan fast paths.
- Egress permite copy vendedor respaldado alrededor de cursos canónicos y mantiene bloqueo exacto de importes, URLs y promesas.
- Runner registra SHA, transporte, proveedor, modelo, versión, ruta, razones, hashes SHA-256 y fallback sin transcript ni PII.

## Gates

| Gate | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm --prefix botpress-agent run typecheck` | PASS |
| `npm --prefix botpress-agent run check` | PASS |
| `npm --prefix botpress-agent run build` | PASS |
| `vitest.integration.config.mts` | 3 PASS; 301 SKIP (PostgreSQL desechable no reconstruido en este entorno) |
| unitarias completas | BLOQUEADO: 35 expectativas históricas v15 requieren fast paths comerciales eliminados por v16 |

Pruebas dirigidas nuevas: runner/persistence 81 PASS; egress 84 PASS; prompt+runner 118 PASS; router v16 9 PASS.

## Alcance no ejecutado

No se ejecutaron PostgreSQL real, Gemini/Stripe/Sheets, deploy Vercel/Botpress ni canary Telegram/WhatsApp. Las restricciones de ejecución prohíben tráfico externo, escrituras reales y producción; Task 7 queda en preflight únicamente.
