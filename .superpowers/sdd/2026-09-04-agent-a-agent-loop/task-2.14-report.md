# Task 2.14 — concurrencia, caída y recuperación

## Resultado

Se cerraron las tres pruebas de la sección 6:

- dos commits reales sobre conexiones PostgreSQL independientes compiten con
  la misma versión; exactamente uno se persiste, el otro recibe
  `STATE_VERSION_CONFLICT`, y su retry sobre la versión nueva se acepta;
- una reserva vieja no commiteada se elimina sin decisión, outbound, llamada
  ni proyección de pago; una reserva commiteada y una fresca sobreviven;
- el fallback conserva curso, plan, etapa, preferencia de canal, estado de
  oferta y espera. Sólo incrementa el contador técnico y la versión. El turno
  sano siguiente entrega normalmente, reinicia el contador y vuelve a avanzar
  la versión sin borrar los campos comerciales.

La concurrencia y la rama fallback ya estaban implementadas por tareas
anteriores. El único runtime faltante era `expireStalePreparationsV1`. La
función valida una edad entera positiva y llama la frontera
`public.expire_agent_turn_preparations_v1` para cada workspace. De esta manera
el rol de aplicación no recibe `DELETE` global. El cron de reconciliación la
ejecuta con una antigüedad de quince minutos antes de sus otras reparaciones.

## TDD

Primer RED:

```text
3 archivos / 3 casos
1 PASS: recuperación de fallback
2 FAIL:
- expireStalePreparationsV1 is not a function
- el test de concurrencia esperaba STATE_VERSION_MISMATCH, pero la autoridad
  vigente devolvió el código estructurado STATE_VERSION_CONFLICT
```

Se corrigió el nombre del código esperado para reflejar el contrato existente.
Con ese ajuste, el único comportamiento ausente era el vencimiento. Después de
implementarlo:

```text
tests/integration/agent-loop-concurrency.test.ts
tests/integration/agent-loop-prepare-crash.test.ts
tests/integration/agent-loop-fallback-recovery.test.ts
3 archivos PASS; 3/3 casos PASS
```

La carrera se repitió cinco veces, secuencialmente y con dos pools
independientes por corrida: 5/5 PASS. Una ejecución de verificación inicialmente
se lanzó en paralelo con otra copia de la misma suite; ambos procesos
pseudoaleatorios sembraron el mismo teléfono y uno agotó reintentos `40001` en
ingestion. Al eliminar esa contaminación entre procesos, el caso se mantuvo
verde en las cinco repeticiones. No se atribuye ese incidente al loop.

## Verificación

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/studyx_test' \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-concurrency.test.ts \
  tests/integration/agent-loop-prepare-crash.test.ts \
  tests/integration/agent-loop-fallback-recovery.test.ts \
  tests/integration/agent-tools-prepare.test.ts \
  tests/integration/agent-tools-prepare-rest.test.ts \
  tests/integration/agent-loop-fallback-commit.test.ts
# 6 archivos PASS; 23/23 casos PASS

npx tsc --noEmit                                             # PASS
(cd agent-core && npx tsc --noEmit)                          # PASS
(cd botpress-agent && npm run typecheck)                     # PASS
npx eslint <2 sources + 3 tests> --max-warnings=0           # PASS
git diff --check                                             # PASS
```

El vencimiento focal se ejecutó con `SET LOCAL ROLE orchestrator_role`, por lo
que ejercita el permiso real de la función `SECURITY DEFINER`. La evidencia se
generó sólo sobre `postgresql://postgres@127.0.0.1:55433/studyx_test`. No hubo
APIs pagas, acceso remoto ni despliegue.

## Archivos

- `src/features/conversation/application/agent-tools-prepare.ts`
- `src/app/api/cron/reconcile-orchestration/route.ts`
- `tests/integration/agent-loop-concurrency.test.ts`
- `tests/integration/agent-loop-prepare-crash.test.ts`
- `tests/integration/agent-loop-fallback-recovery.test.ts`
- `.superpowers/sdd/2026-09-04-agent-a-agent-loop/task-2.14-report.md`
