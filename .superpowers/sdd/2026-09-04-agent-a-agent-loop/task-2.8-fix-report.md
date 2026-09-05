# Task 2.8 — fix de revisión sobre `c13c73d`

## Resultado

Se cerraron los findings P1/P2 de `task-2.8-review.md` sin modificar archivos de Task 2.9, 2.10 ni 2.11.

- `preparePaymentLinkToolV1` rechaza valores runtime que no sean strings antes de usar `length` o coerción regex.
- La autoridad del curso se deriva del turno y del estado conversacional persistido. La preparación exige exactamente un workspace activo, membresía activa del contacto y un offering activo dentro de ese workspace.
- La consulta de inserción vuelve a comprobar turno, conversación, contacto, workspace y offering en la misma sentencia que reserva. Si el contexto cambia entre la lectura y la mutación, no inserta y falla cerrado.
- Un curso inexistente, inactivo, perteneciente sólo a otro workspace o una conversación asociada de forma ambigua a dos workspaces no produce reserva.
- La URL devuelta por el resolver, incluido uno inyectado, se valida con `isStripePaymentLinkUrl` antes de persistirse.
- El `UPSERT` mantiene la clave `(conversation_id, tool, canonical_key)` y fue ejercitado con dos pools PostgreSQL independientes bajo `orchestrator_role`: una llamada devuelve `applied`, la otra `duplicate`, ambas sobre una sola fila.
- La preparación sigue siendo inerte: `committed_at` queda nulo y no aparecen decisión, mensaje outbound, delivery ni evento de outbox.
- El fixture focal crea su propio workspace/catálogo/contacto y elimina el grafo completo después de cada caso. La verificación final encontró cero workspaces `task-2-8-*` residuales.

## Vencimiento y permisos

No se concedió `DELETE` directo a `orchestrator_role`. La migración crea `public.expire_agent_turn_preparations_v1(workspace_id, older_than_ms)` como `SECURITY DEFINER`, fija el `search_path`, valida argumentos y limita el borrado a reservas:

- del workspace solicitado;
- con una única asociación autoritativa de conversación/workspace;
- no commiteadas;
- anteriores al umbral.

La función no tiene `EXECUTE` para `PUBLIC`, `anon` ni `authenticated`; sólo el orquestador puede llamarla. Los grants de tabla quedaron en `SELECT`, `INSERT` y `UPDATE` por columna para `canonical_key`/`committed_at`. `canonical_data` no es actualizable por el rol y la tabla no concede `DELETE`.

**Desviación coordinable con Task 2.14:** la spec ilustraba `expireStalePreparationsV1` con un `DELETE` directo y sin workspace. Su implementación deberá resolver el workspace confiable y llamar a esta función, en vez de obtener permiso global de borrado. Esto conserva la firma pública que Task 2.14 defina, pero cambia su SQL interno para mantener aislamiento.

## TDD

Primer RED, después de corregir el fixture para que no hubiera errores propios:

```bash
TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/studyx_test' \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-tools-prepare.test.ts
# 4 PASS / 7 FAIL esperados:
# offering cross-workspace, contexto ambiguo, offering inactivo/ausente,
# input no-string, URL no canónica, cruce de conversación y función de expiry ausente.
```

Segundo RED para privilegios mínimos:

```text
10 PASS / 1 FAIL
Esperado: UPDATE de tabla/canonical_data todavía era true.
```

GREEN final focal:

```text
1 archivo PASS; 11/11 tests PASS.
```

## Verificación

Se usó exclusivamente `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test`; no se leyó `.env.local`, no se llamó ninguna API ni servicio remoto.

```bash
psql 'postgresql://postgres@127.0.0.1:55433/studyx_test' \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/20260905000004_agent_turn_preparations.sql
# PASS, incluida reaplicación idempotente

TEST_DATABASE_URL='postgresql://postgres@127.0.0.1:55433/studyx_test' \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-tools-prepare.test.ts \
  tests/integration/agent-loop-exactly-once.test.ts
# 2 archivos PASS; 15/15 tests PASS

npx eslint src/features/conversation/application/agent-tools-prepare.ts \
  tests/integration/agent-tools-prepare.test.ts --max-warnings=0
# PASS

(cd agent-core && npx tsc --noEmit)
(cd botpress-agent && npm run typecheck)
npx tsc --noEmit
git diff --check -- \
  src/features/conversation/application/agent-tools-prepare.ts \
  supabase/migrations/20260905000004_agent_turn_preparations.sql \
  tests/integration/agent-tools-prepare.test.ts
# PASS, incluidos los tres typechecks
```

ACL verificada en la base local:

```text
DELETE(table)=false
UPDATE(table)=false
UPDATE(canonical_key)=true
UPDATE(committed_at)=true
UPDATE(canonical_data)=false
EXECUTE(expire function, orchestrator_role)=true
EXECUTE(expire function, PUBLIC/anon/authenticated)=false
fixtures residuales task-2-8-*=0
```

## Archivos del fix

- `src/features/conversation/application/agent-tools-prepare.ts`
- `supabase/migrations/20260905000004_agent_turn_preparations.sql`
- `tests/integration/agent-tools-prepare.test.ts`
- `.superpowers/sdd/2026-09-04-agent-a-agent-loop/task-2.8-fix-report.md`
