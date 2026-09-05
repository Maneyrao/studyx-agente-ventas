# Re-review independiente — Tasks 2.6 y 2.7

Commit revisado: `7d8ae093231633f0ff9595764c8201f63399efbd` (`fix(agent-a): close rollout and read-tool review`). La revisión se ejecutó en una worktree detached del commit exacto y contrastó los tres findings originales con la spec, los briefs, el workflow V21 y las fronteras reales de Next.js/PostgreSQL.

## Veredicto

- **Task 2.6 — spec compliance: PASS.** El kill switch de bundle existe, es booleano, queda desactivado por defecto y domina el modo resuelto por DB cuando vale `true`.
- **Task 2.6 — code quality: PASS.** La normalización ocurre una sola vez después de adquirir el claim y antes de construir contexto, rutear o ejecutar modelos. La configuración ausente conserva el modo reclamado; `false` y el default son compatibles con V21.
- **Task 2.7 — spec compliance: PASS.** `search_catalog` tiene una ruta V1 ejecutable con el sobre `ToolResultV1` completo en éxito y fallo, bajo la autenticación común de `/api/agent`.
- **Task 2.7 — code quality: PASS.** La ruta limita el tenant al workspace configurado, usa el store real y mantiene intactos el endpoint y la acción legacy que consume V21.
- **Migración/operación — PASS.** El trigger actualiza `updated_at` bajo `orchestrator_role`; permisos, RLS y reaplicación quedan verificados.
- **Veredicto global: PASS.** P0: ninguno. P1: ninguno. P2: ninguno dentro de este alcance.

No se usó `.env.local`, APIs, modelos, servicios externos ni bases remotas. La única base fue `postgresql://postgres@127.0.0.1:55433/studyx_test`.

## Cierre de los tres findings originales

### Kill switch: default, precedencia y schema

`botpress-agent/agent.config.ts:35-37` declara `agentAAgentLoopV3KillSwitch` como `z.boolean().default(false)`. El default desactivado conserva el comportamiento del bundle V21 y evita apagar un rollout por agregar el campo. El workflow convierte a booleano efectivo sólo con `configuration.agentAAgentLoopV3KillSwitch === true` (`processInboundTurn.ts:523-524`): `true` fuerza `agent_loop_v3_mode: 'off'`; `false` o ausencia conserva el claim.

La precedencia se aplica antes de `buildAgentAContextV1`, `routeCommercialTurn` y cualquier llamada a modelos (`processInboundTurn.ts:525-590`). El objeto `owned` preserva el resto del claim y sólo reemplaza el modo V3. El camino sin claim termina antes de esta lectura, por lo que la configuración nueva no introduce trabajo ni modelos en turnos que el workflow no posee.

La prueba comprometida cubre `true → off` y `false → authoritative`. Un probe efímero agregó el caso de configuración ausente: produjo `effective_mode: authoritative` y registró `kill_switch: false`. `adk build` y el typecheck de Botpress pasan con el schema real.

### Ruta V1: autenticación, envelope y compatibilidad

`GET /api/agent/tools/v1/search-catalog` carga exclusivamente `BUSINESS_WORKSPACE_SLUG`, ejecuta `searchCatalogToolV1` con `businessContextStore` y convierte cualquier indisponibilidad al mismo `ToolResultV1` recuperable (`route.ts:9-23`). El éxito incluye `tool`, `success`, `canonical_data`, `error_code`, `recoverable`, `idempotency_result` y `preparation_id`; el fallo `CATALOG_UNAVAILABLE` conserva exactamente la misma forma.

La ruta cae bajo `proxy.config.matcher = ['/api/:path*']`. Por empezar con `/api/agent/`, exige clave de orquestador, key id, timestamp, HMAC, request id, trace id e idempotency key (`src/proxy.ts:76-155`). La integración prueba 401 sin credenciales y paso con una firma local válida para las tres rutas de lectura.

La compatibilidad V21 queda preservada: `7d8ae09` agrega la ruta versionada sin modificar `/api/agent/tools/catalog` ni `botpress-agent/src/actions/lookupCatalog.ts`. El workflow actual sigue consumiendo su `CatalogResponseSchema`; un futuro `ToolExecutor` V3 puede usar el nuevo endpoint sin cambiar el contrato legacy.

### Migración: trigger, permisos e idempotencia

La migración crea o reemplaza una función de trigger con `clock_timestamp()` y `search_path` fijado, y luego elimina/recrea el trigger de forma repetible (`20260905000003_agent_loop_rollout_v3.sql:28-42`). Usar reloj de pared permite distinguir dos operaciones dentro de la misma transacción, a diferencia de `now()`.

Antes de restablecer el policy, revoca todos los privilegios del rol y concede únicamente `SELECT`, `INSERT` y `UPDATE`; `DELETE` queda denegado (`:44-63`). La integración ejecuta insert/update/select con `SET LOCAL ROLE orchestrator_role`, comprueba RLS y confirma que el timestamp avanza.

La prueba de reparación deshabilita RLS, elimina policy, grants y FK, aplica todas las migraciones dos veces dentro de la transacción y verifica que reaparezcan FK con cascade, RLS, permisos y un solo trigger. Además, `agent-loop-migrations.test.ts` se ejecutó dos veces consecutivas contra el cluster local: ambas corridas terminaron 7/7 PASS.

## Calidad de las pruebas

- El test de configuración que busca la declaración en source es débil por sí solo, pero no es el único respaldo: el workflow completo se ejecuta con las dos ramas y el build ADK consume el schema real.
- La prueba de ruta invoca el handler real con PostgreSQL real y prueba el proxy por separado. El matcher estático cubre todo `/api`, por lo que la composición de runtime alcanza también la ruta nueva.
- La prueba del trigger no se limita a inspeccionar catálogos: realiza el `UPDATE` bajo el rol operativo y compara timestamps.
- La reaplicación no depende de un árbol limpio previo: el test degrada deliberadamente la tabla y verifica reparación.

No encontré un falso verde material en los tres cierres.

## Evidencia ejecutada

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

# Repetición independiente de migraciones
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npm exec -- vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-migrations.test.ts
# PASS: 7/7, repetido dos veces

npm run test:unit
# PASS: 189 archivos, 2 skipped; 2968 tests, 7 skipped, 7 todo

npm run typecheck
npm run typecheck --prefix botpress-agent
npm run build --prefix botpress-agent
npm run lint
git diff --check 7d8ae09^..7d8ae09
# PASS
```

El lint oficial del repositorio ignora `botpress-agent`; al forzar ESLint raíz sobre todo el workflow aparecen tres `no-explicit-any` preexistentes en líneas 295-297, fuera del diff. No se clasifican como finding del commit: el typecheck y el build ADK del paquete pasan, y las líneas agregadas no introducen warnings ni errores.

## Ruling

`7d8ae09` cierra los tres findings originales sin romper el flujo V21 ni su acción de catálogo. Puede integrarse como cierre de Tasks 2.6/2.7. La ruta V1 aún no tiene un consumidor Botpress V3 porque ese adapter pertenece al cableado posterior del Agent Loop; esto no debilita el contrato entregado ni modifica el consumidor legacy.
