# Revisión independiente final — Tasks 2.6 (`fb9f5de`) y 2.7 (`c85ee00`)

## Veredicto

- **Task 2.6 — spec compliance: FAIL.** La resolución runtime por contacto, el fail-closed, el aislamiento SQL y el cableado claim/route cumplen. Falta el freno de mano independiente `configuration.agentAAgentLoopV3KillSwitch` que la spec vinculante exige publicar en Fase 2.
- **Task 2.6 — code quality: PASS con un P2.** Los tests discriminan los findings anteriores y los gates pasan. `updated_at` no cambia cuando cambia el modo, por lo que la columna no registra el momento del rollback/promoción.
- **Task 2.7 — spec compliance: FAIL.** Las tres funciones de aplicación cumplen su contrato nominal, pero sólo dos herramientas nuevas tienen ruta con `ToolResultV1`. `search_catalog` sigue expuesto por el endpoint/action legacy con otro envelope, pese a que §3.3 exige un sobre común sin excepciones.
- **Task 2.7 — code quality: FAIL.** La implementación interna de lectura es sólida, pero la suite evita la frontera ejecutable faltante: prueba `searchCatalogToolV1` directamente y sólo atraviesa las rutas de curso y pagos.
- **Veredicto global: FAIL.** No hay P0. Hay dos P1 de cierre de spec y un P2 operativo.

La spec `docs/superpowers/specs/2026-09-04-agent-a-agent-loop-design.md` se tomó como autoridad, según `progress.md`. El handoff vigente y las secciones 2.6/2.7 del plan se usaron para los límites de seguridad, compatibilidad y ejecución. Los gates corrieron en worktrees detached limpias de cada commit; no se editó source compartido, no se usó `.env.local`, APIs ni DB remota.

## Findings

### P0

Ninguno.

### P1 — Task 2.6 omite el kill switch independiente exigido por la spec

La spec §5.0, después de definir la tabla runtime, exige además:

```text
configuration.agentAAgentLoopV3KillSwitch: boolean
```

Lo define como “freno de mano independiente de la base” y dice que se publica una vez en Fase 2. El plan/brief de Task 2.6 sólo cableó `features.agent_loop_v3_mode` y no asignó ese requisito a otra tarea. En `fb9f5de` no existe el campo en `agent.config.ts`, schemas, workflow ni tests; tampoco aparece en el árbol posterior inspeccionado.

La tabla sí proporciona el rollback operativo recomendado, pero no sustituye el freno independiente que la spec pide expresamente. Un error de lectura/configuración de DB cae a `off`, mientras una activación incorrecta ya resuelta como `authoritative` sólo puede frenarse escribiendo la misma base de control. El kill switch debía dominar cualquier modo de tabla antes de ejecutar el loop.

Corrección mínima: agregar el booleano de configuración con default seguro, proyectarlo en el workflow y exigir que `true` fuerce la ruta legacy/off aun cuando el claim traiga `authoritative`. Debe haber tests de precedencia y compatibilidad con bundles/configuración previos.

### P1 — Task 2.7 no ofrece `search_catalog` con el sobre común en la frontera ejecutable

La spec §3.3 enumera tres herramientas de lectura y declara “Sobre común, sin excepciones” para `ToolResultV1`. `c85ee00` implementa correctamente `searchCatalogToolV1`, pero no crea ni adapta una ruta que la acción/ToolExecutor pueda invocar con ese resultado.

La superficie existente sigue siendo:

- `GET /api/agent/tools/catalog` → `CatalogResponseSchema` con `{ items, count, dropped, ..., prices_assertable }`;
- `botpress-agent/src/actions/lookupCatalog.ts` → valida ese mismo `CatalogResponseSchema`.

No devuelve `tool`, `success`, `canonical_data`, `error_code`, `recoverable`, `idempotency_result` ni `preparation_id`. En cambio, `get_course_information` y `get_payment_options` sí tienen rutas nuevas con `ToolResultV1`.

Los tests reflejan el hueco: la integración de Task 2.7 llama `searchCatalogToolV1` directamente contra `PostgresBusinessContextStore`, pero la matriz de rutas y autenticación sólo incluye `/tools/course/...` y `/tools/payment-options`. Por eso 21/21 puede quedar verde aunque un `ToolExecutor` remoto no tenga una respuesta común para `search_catalog`.

Corrección mínima: exponer una ruta/action de `search_catalog` con `ToolResultV1` o adaptar explícitamente la ruta existente y migrar su consumidor. Si se conserva compatibilidad legacy, usar una ruta versionada separada. El test debe atravesar proxy + ruta real y afirmar el envelope completo tanto en éxito como en `CATALOG_UNAVAILABLE`.

### P2 — `agent_loop_rollout_v3.updated_at` no registra cambios de modo

La tabla define `updated_at timestamptz NOT NULL DEFAULT now()`, pero no tiene trigger y el `UPDATE` operativo de rollback/promoción sólo cambia `mode`. Probe local dentro de una transacción revertida:

```text
INSERT mode='off' -> updated_at=T
UPDATE mode='shadow' después de 20 ms -> updated_at=T
updated_at_changed=false
```

No afecta la resolución del turno, pero impide auditar cuándo se promovió o apagó un contacto/default usando la columna creada para ese fin. La suite de migraciones ejecuta los tres modos sin afirmar el timestamp. Un trigger común de `updated_at` o un `SET updated_at=now()` en la operación administrativa cerraría el punto.

## Task 2.6 — comportamiento confirmado

- Precedencia válida independiente del orden: override del contacto, default del workspace, `off`.
- Override aplicable inválido + default `authoritative` cae a `off` en ambos órdenes; una fila inválida de otro contacto no interviene.
- El adapter conserva el valor de DB como `unknown`, por lo que no borra la evidencia inválida antes del resolver.
- El reader restringe workspace configurado y activo, contacto exacto/default y exige membresía `(workspace_id, contact_id)`.
- El claim sólo inicia la lectura después de ganar propiedad del batch; `waiting`, `absorbed`, `completed`, `abandoned` y `not_found` afirman `load=0`.
- Fallo del reader/DB registra indisponibilidad y conserva `off` sin abortar el claim.
- La ruta HTTP instancia el reader con el workspace configurado y lo inyecta en `claimBatch`; el test rompe si se retira esa dependencia.
- El contrato Botpress aplica `off` cuando un backend previo conserva `features` pero omite el nuevo campo. Los otros flags legacy siguen opcionales.
- La migración `00003` conserva check de modos, unicidad default/contact, FK de membresía, RLS y permisos mínimos. Se reaplicó dos veces contra local sin error.
- La integración autocontenida limpia sus fixtures y probó contacto/workspace ajenos y no miembro.

## Task 2.7 — comportamiento confirmado

- Las tres funciones devuelven el `ToolResultV1` completo en sus caminos nominales y de error.
- `searchCatalogToolV1` usa el índice completo: la integración devolvió 41 identidades aunque el snapshot de detalle normal limita 40.
- `prices_assertable` sólo queda `true` con contexto completo y precios fixed; queda `false` ante quote-only, truncamiento o contexto ausente.
- Código inseguro falla cerrado; nombre/academia con señales de inyección se neutralizan. Texto comercial restante pasa por los builders sanitizantes.
- `get_course_information` distingue `INVALID_COURSE_CODE`, `COURSE_NOT_FOUND` y `CATALOG_UNAVAILABLE`; no filtra errores internos.
- `facts[]` cubre los valores publicados con IDs estables y renderizables. Precio sólo se incluye cuando es afirmable.
- `get_payment_options` deriva los tres labels/IDs de la configuración canónica validada y no devuelve links.
- Los probes PostgreSQL/ruta no expusieron `beca_price_usd`, metadata, `699` ni URLs de pago.
- Las dos rutas nuevas heredan el proxy: 401 sin credenciales y paso con key/HMAC local válidos.

## Evidencia ejecutada

Única base: `postgresql://postgres@127.0.0.1:55433/studyx_test`.

### Commit exacto `fb9f5de`

```bash
npm exec -- vitest run --config vitest.config.mts \
  tests/unit/orchestration/agent-loop-rollout.test.ts \
  tests/unit/orchestration/claim-batch.test.ts \
  tests/unit/orchestration/claim-route-agent-loop-rollout.test.ts \
  tests/unit/botpress/agent-a-context.test.ts \
  tests/unit/botpress/process-inbound-turn-hot-path.test.ts \
  tests/unit/scripts/agent-a-conversation-runner.test.ts
# PASS: 6 archivos, 269 tests

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npm exec -- vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-rollout-claim.test.ts \
  tests/integration/agent-loop-migrations.test.ts
# PASS: 2 archivos, 8 tests

npm run typecheck
npm run typecheck --prefix botpress-agent
# PASS / PASS

npm exec -- eslint <archivos raíz de Task 2.6> --max-warnings=0
git diff 5846d25..fb9f5de --check
# PASS / PASS
```

### Commit exacto `c85ee00`

```bash
npm exec -- vitest run --config vitest.config.mts \
  tests/unit/conversation/agent-tools-read.test.ts
# PASS: 1 archivo, 14 tests

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npm exec -- vitest run --config vitest.integration.config.mts \
  tests/integration/agent-tools-read-routes.test.ts \
  tests/integration/business-context-store.test.ts \
  tests/integration/catalog-detail.test.ts
# PASS: 3 archivos, 21 tests

npm run typecheck
npm run typecheck --prefix botpress-agent
# PASS / PASS

npm exec -- eslint \
  src/features/conversation/application/agent-tools-read.ts \
  'src/app/api/agent/tools/course/[code]/route.ts' \
  src/app/api/agent/tools/payment-options/route.ts \
  tests/unit/conversation/agent-tools-read.test.ts \
  tests/integration/agent-tools-read-routes.test.ts \
  --max-warnings=0
git diff 979d9d1..c85ee00 --check
# PASS / PASS
```

No se hicieron llamadas a modelos, servicios externos ni bases remotas.

## Ruling final

Los findings originales de ambas tareas están corregidos y los componentes implementados son verificables. Aun así, no corresponde cerrar 2.6/2.7 contra la spec completa: falta el kill switch independiente asignado a Fase 2 y falta una frontera `search_catalog` consumible con el envelope común. Ambos son cambios acotados y pueden agregarse sin reabrir la lógica ya aprobada.
