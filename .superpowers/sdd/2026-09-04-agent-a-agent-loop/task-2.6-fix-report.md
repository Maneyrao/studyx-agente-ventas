# Task 2.6 — fix de revisión sobre `5846d25`

## Resultado

Se cerraron los tres findings de `task-2.6-review.md` sin cambiar el contrato de rollout ni otros módulos del agent loop.

- Una fila aplicable conserva `mode` como valor no confiable hasta el resolver. El adapter ya no elimina silenciosamente valores inválidos.
- Un override inválido del contacto cae a `off` aunque exista un default `authoritative`, en cualquier orden de filas.
- Una fila inválida de otro contacto no interviene en la resolución.
- Los outcomes no propietarios prueban explícitamente que `agentLoopRollout.load` no se llama.
- La ruta HTTP tiene un test de cableado que verifica que instancia el reader con el workspace configurado y lo inyecta en `claimBatch`.
- La integración con PostgreSQL usa un override `off` explícito para no depender del default compartido, limpia la fixture completa y prueba el reader dentro de una transacción revertida para workspace, contacto y membresía.

## Archivos

- `src/features/orchestration/domain/agent-loop-rollout.ts`
- `src/features/orchestration/adapters/postgres-agent-loop-rollout.ts`
- `tests/unit/orchestration/agent-loop-rollout.test.ts`
- `tests/unit/orchestration/claim-batch.test.ts`
- `tests/unit/orchestration/claim-route-agent-loop-rollout.test.ts`
- `tests/integration/agent-loop-rollout-claim.test.ts`
- `.superpowers/sdd/2026-09-04-agent-a-agent-loop/task-2.6-fix-report.md`

## TDD

RED del defecto funcional:

```text
npx vitest run --config vitest.config.mts \
  tests/unit/orchestration/agent-loop-rollout.test.ts

FAIL — 2/7
- override inválido + default authoritative: esperaba off, recibió authoritative
- el adapter eliminó la fila inválida: esperaba 2 filas, recibió sólo el default
```

GREEN mínimo:

```text
npx vitest run --config vitest.config.mts \
  tests/unit/orchestration/agent-loop-rollout.test.ts
PASS — 7/7
```

Los tests P2 caracterizan propiedades que el código ya cumplía por estructura. Son discriminantes: sacar la dependencia de la ruta rompe el test HTTP; adelantar la lectura antes del claim rompe los cinco casos no propietarios; mezclar workspace/contact o aceptar un no miembro rompe el probe SQL transaccional.

La primera ejecución de la integración ampliada detectó una limpieza incompleta: `audit_log` retenía el `channel_event` de la fixture. Se agregó esa dependencia al cleanup y dos ejecuciones consecutivas terminaron verdes, confirmando que la suite no depende de residuos propios.

## Gates finales

```text
npx vitest run --config vitest.config.mts \
  tests/unit/orchestration/agent-loop-rollout.test.ts \
  tests/unit/orchestration/claim-batch.test.ts \
  tests/unit/orchestration/claim-route-agent-loop-rollout.test.ts \
  tests/unit/botpress/agent-a-context.test.ts \
  tests/unit/botpress/process-inbound-turn-hot-path.test.ts \
  tests/unit/scripts/agent-a-conversation-runner.test.ts
PASS — 6 archivos, 269 tests

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-rollout-claim.test.ts
PASS — 1 archivo, 2 tests (repetido dos veces)

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-migrations.test.ts
PASS — 1 archivo, 6 tests

npm run typecheck
PASS

(cd botpress-agent && npm run typecheck)
PASS

npx eslint <archivos del fix> --max-warnings=0
PASS

git diff --check -- <archivos del fix>
PASS
```

No se usaron APIs, servicios pagos, URLs remotas ni despliegues. La única base fue `postgresql://postgres@127.0.0.1:55433/studyx_test`.
