# Fix de lock safety — migraciones Agent Loop 00007 y 00009

Fecha: 2026-09-05

## Cambio

Las dos migraciones conservan sus expresiones `CHECK`, pero separan la creación del constraint y el scan de validación:

```sql
ADD CONSTRAINT ... CHECK (...) NOT VALID;
VALIDATE CONSTRAINT ...;
```

Así, el `ACCESS EXCLUSIVE` breve del cambio de catálogo no permanece durante el scan completo. `VALIDATE CONSTRAINT` comprueba todas las filas con el lock más débil previsto por PostgreSQL. La semántica final no cambia: ambos constraints quedan `convalidated=true` y rechazan el mismo dominio de valores.

Archivos:

- `supabase/migrations/20260905000007_agent_loop_prepared_memory_in_txn_supersede.sql`
- `supabase/migrations/20260905000009_outbound_deferred_lead_projection.sql`
- `tests/integration/agent-loop-migration-lock-safety.test.ts`

No se reescribió ninguna función ni lógica de aplicación.

## TDD

RED inicial contra las migraciones originales:

```text
agent-loop-migration-lock-safety.test.ts
1 archivo FAIL; 2 FAIL / 1 PASS

00007: no contiene ADD CONSTRAINT ... CHECK (...) NOT VALID ni VALIDATE CONSTRAINT
00009: no contiene ADD CONSTRAINT ... CHECK (...) NOT VALID ni VALIDATE CONSTRAINT
```

GREEN:

```text
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_agent_loop_lock_review \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-migrations.test.ts \
  tests/integration/agent-loop-migration-lock-safety.test.ts

2 archivos PASS; 10/10 tests PASS
```

El test nuevo elimina comentarios antes de inspeccionar el DDL, exige `NOT VALID` en el `ADD`, exige un `VALIDATE CONSTRAINT` posterior y consulta `pg_constraint` para demostrar que ambos quedan validados con el dominio esperado. También ejecuta cada migración dos veces.

## PostgreSQL local limpio

Se creó `studyx_agent_loop_lock_review` desde `template0` en `127.0.0.1:55433`, se instaló `vector` en el schema `extensions` y se aplicó la cadena completa de migraciones. Se omitió únicamente `20260623000008_roles.sql` porque `orchestrator_role` es un objeto global del cluster y ya existía; no es estado del schema de la base nueva.

Después se reaplicaron, en orden, las nueve migraciones `20260905000001` a `20260905000009`: **PASS**. En particular, 00007 y 00009 volvieron a hacer `DROP`, `ADD ... NOT VALID` y `VALIDATE` sin error.

## Gates

```text
npx eslint tests/integration/agent-loop-migration-lock-safety.test.ts --max-warnings=0
PASS

git diff --check -- <las dos migraciones y el test>
PASS
```

`npx tsc --noEmit` quedó temporalmente bloqueado por cambios concurrentes fuera de este alcance: `tests/unit/orchestration/reconcile-orchestration-memory.test.ts` ya referencia `reclaimStrandedMemorySupersessions` y `memory_supersessions`, mientras el source concurrente aún no los expone. No se modificaron esos archivos; el gate debe repetirse cuando su dueño estabilice la rama.

No se usó DB remota, API paga ni despliegue.
