# Revisión independiente final — Tasks 2.6 (`fb9f5de`) y 2.7 (`c85ee00`)

## Veredicto

- **Task 2.6 — spec compliance: PASS.** La resolución runtime por contacto conserva su precedencia y `configuration.agentAAgentLoopV3KillSwitch` domina cualquier modo de DB antes de que las ramas presentes o futuras observen el claim.
- **Task 2.6 — code quality: PASS.** El cambio tiene pruebas discriminantes de `true` y `false`; `updated_at` avanza incluso en dos operaciones de la misma transacción y bajo `orchestrator_role`.
- **Task 2.7 — spec compliance: PASS.** Las tres herramientas tienen `ToolResultV1`; `search_catalog` cruza ahora una ruta versionada real sin alterar `/tools/catalog` ni su consumidor legacy.
- **Task 2.7 — code quality: PASS.** La integración atraviesa función, ruta y proxy, y prueba los envelopes completos de éxito y catálogo ausente.
- **Veredicto global tras el fix: PASS.** No quedan P0, P1 ni P2 abiertos en este alcance.

La spec `docs/superpowers/specs/2026-09-04-agent-a-agent-loop-design.md` se tomó como autoridad, según `progress.md`. El handoff vigente y las secciones 2.6/2.7 del plan se usaron para los límites de seguridad, compatibilidad y ejecución. Los gates corrieron en worktrees detached limpias de cada commit; no se editó source compartido, no se usó `.env.local`, APIs ni DB remota.

## Fix posterior a la revisión

El fix se desarrolló con RED/GREEN sobre los tres findings:

- el workflow normaliza el claim a `agent_loop_v3_mode: 'off'` cuando el kill switch es `true`, antes de construir contexto, rutear o ejecutar modelos; con `false` conserva `authoritative`. Un evento sin contenido de cliente registra modo reclamado, modo efectivo y estado del freno;
- `GET /api/agent/tools/v1/search-catalog` carga exclusivamente el workspace configurado y devuelve el resultado de `searchCatalogToolV1`. El endpoint `/api/agent/tools/catalog` y `lookupCatalog` permanecen compatibles;
- la migración crea de forma idempotente una función y trigger dedicados. Usa `clock_timestamp()` para que `updated_at` cambie también si el `INSERT` y el `UPDATE` ocurren dentro de la misma transacción.

No se agregó una acción Botpress sin consumidor: la frontera ejecutable requerida en este alcance es la ruta backend autenticada; el futuro adapter de `ToolExecutor` podrá invocarla. La acción legacy continúa usando el endpoint legacy y no cambia su contrato.

## Hallazgos originales, cerrados por el fix

### P0

Ninguno.

### P1 resuelto — Task 2.6 omitía el kill switch independiente exigido por la spec

La spec §5.0, después de definir la tabla runtime, exige además:

```text
configuration.agentAAgentLoopV3KillSwitch: boolean
```

Lo define como “freno de mano independiente de la base” y dice que se publica una vez en Fase 2. El plan/brief de Task 2.6 sólo cableó `features.agent_loop_v3_mode` y no asignó ese requisito a otra tarea. En `fb9f5de` no existe el campo en `agent.config.ts`, schemas, workflow ni tests; tampoco aparece en el árbol posterior inspeccionado.

La tabla sí proporciona el rollback operativo recomendado, pero no sustituye el freno independiente que la spec pide expresamente. Un error de lectura/configuración de DB cae a `off`, mientras una activación incorrecta ya resuelta como `authoritative` sólo puede frenarse escribiendo la misma base de control. El kill switch debía dominar cualquier modo de tabla antes de ejecutar el loop.

La corrección agregó el booleano con default `false`, lo aplicó antes de cualquier rama del workflow y cubrió que `true` fuerce `off` mientras `false` preserve `authoritative`.

### P1 resuelto — Task 2.7 no ofrecía `search_catalog` con el sobre común en la frontera ejecutable

La spec §3.3 enumera tres herramientas de lectura y declara “Sobre común, sin excepciones” para `ToolResultV1`. `c85ee00` implementa correctamente `searchCatalogToolV1`, pero no crea ni adapta una ruta que la acción/ToolExecutor pueda invocar con ese resultado.

La superficie existente sigue siendo:

- `GET /api/agent/tools/catalog` → `CatalogResponseSchema` con `{ items, count, dropped, ..., prices_assertable }`;
- `botpress-agent/src/actions/lookupCatalog.ts` → valida ese mismo `CatalogResponseSchema`.

No devuelve `tool`, `success`, `canonical_data`, `error_code`, `recoverable`, `idempotency_result` ni `preparation_id`. En cambio, `get_course_information` y `get_payment_options` sí tienen rutas nuevas con `ToolResultV1`.

Los tests reflejan el hueco: la integración de Task 2.7 llama `searchCatalogToolV1` directamente contra `PostgresBusinessContextStore`, pero la matriz de rutas y autenticación sólo incluye `/tools/course/...` y `/tools/payment-options`. Por eso 21/21 puede quedar verde aunque un `ToolExecutor` remoto no tenga una respuesta común para `search_catalog`.

La corrección expuso una ruta versionada separada y agregó pruebas de éxito, `CATALOG_UNAVAILABLE` y autenticación de proxy, sin migrar el consumidor legacy.

### P2 resuelto — `agent_loop_rollout_v3.updated_at` no registraba cambios de modo

La tabla define `updated_at timestamptz NOT NULL DEFAULT now()`, pero no tiene trigger y el `UPDATE` operativo de rollback/promoción sólo cambia `mode`. Probe local dentro de una transacción revertida:

```text
INSERT mode='off' -> updated_at=T
UPDATE mode='shadow' después de 20 ms -> updated_at=T
updated_at_changed=false
```

El trigger dedicado actualiza con reloj de pared, y la integración lo prueba bajo el rol de runtime y en la misma transacción. También comprueba su presencia después de reaplicar dos veces la migración.

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

### Fix final

```bash
npm exec -- vitest run --config vitest.config.mts \
  tests/unit/botpress/agent-loop-v3-kill-switch-config.test.ts \
  tests/unit/botpress/process-inbound-turn-hot-path.test.ts \
  tests/unit/orchestration/agent-loop-rollout.test.ts \
  tests/unit/orchestration/claim-batch.test.ts \
  tests/unit/orchestration/claim-route-agent-loop-rollout.test.ts \
  tests/unit/conversation/agent-tools-read.test.ts \
  tests/contract/botpress-response-parity.test.ts
# PASS: 7 archivos, 179 tests

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npm exec -- vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-migrations.test.ts \
  tests/integration/agent-loop-rollout-claim.test.ts \
  tests/integration/agent-tools-read-routes.test.ts \
  tests/integration/business-context-store.test.ts \
  tests/integration/catalog-detail.test.ts
# PASS: 5 archivos, 32 tests

# La migración 00003 se aplicó dos veces con ON_ERROR_STOP=1: PASS / PASS.
npm run typecheck
npm run build --prefix botpress-agent
npm run typecheck --prefix botpress-agent
npm exec -- eslint <archivos del fix> --max-warnings=0
git diff --check
# PASS en todos los gates
```

## Ruling final

Los findings originales y los tres findings de esta revisión quedaron cerrados con evidencia RED/GREEN. Corresponde cerrar Tasks 2.6 y 2.7 dentro del alcance de la spec revisada.
