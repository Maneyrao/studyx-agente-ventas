# Fix de lock safety — migraciones Agent Loop 00002, 00004, 00005, 00007 y 00009

Fecha: 2026-09-05

## Cambio

Las migraciones 00002, 00007 y 00009 conservan sus expresiones `CHECK`, pero separan la creación del constraint y el scan de validación:

```sql
ADD CONSTRAINT ... CHECK (...) NOT VALID;
VALIDATE CONSTRAINT ...;
```

Así, el `ACCESS EXCLUSIVE` breve del cambio de catálogo no permanece durante el scan completo. `VALIDATE CONSTRAINT` comprueba todas las filas con un lock más débil. La semántica final no cambia: los tres constraints quedan `convalidated=true` y rechazan el mismo dominio de valores.

Las migraciones 00004 y 00005 ahora permanecen fuera de una transacción explícita y usan `CREATE [UNIQUE] INDEX CONCURRENTLY IF NOT EXISTS`. La sustitución de 00005 construye y valida primero `conversation_sales_context_events_v1_source_idx`; sólo entonces elimina `conversation_sales_context_events_v1_source_unique` con `DROP INDEX CONCURRENTLY`. Ambas fijan `lock_timeout='5s'`, lo restauran al final y eliminan un índice homónimo inválido antes del retry sin reconstruir uno sano. Los cuatro `CHECK` y la FK agregados por 00004 también usan `NOT VALID` seguido de `VALIDATE CONSTRAINT`, para que una reaplicación sobre una tabla poblada no reintroduzca el mismo scan bloqueante.

Archivos:

- `supabase/migrations/20260905000002_outbound_deferred_state_patch.sql`
- `supabase/migrations/20260905000004_agent_turn_preparations.sql`
- `supabase/migrations/20260905000005_agent_loop_commit_trace.sql`
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

Un segundo ciclo TDD agregó `00002` al mismo gate: dio RED con **1 FAIL / 3 PASS** contra su `ADD CHECK` inmediato y quedó GREEN al aplicar el mismo patrón.

El tercer ciclo agregó 00004 y 00005 antes de tocarlas: dio RED con **2 FAIL / 5 PASS** por ausencia de `CONCURRENTLY`, `lock_timeout` y transacción explícita en 00005. Un probe adicional dio RED con **1 FAIL / 7 PASS** por la FK y los cuatro checks inmediatos de 00004.

GREEN final:

```text
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_agent_loop_lock_review \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-migrations.test.ts \
  tests/integration/agent-loop-migration-lock-safety.test.ts

2 archivos PASS; 15/15 tests PASS
```

El test nuevo elimina comentarios antes de inspeccionar el DDL, exige `NOT VALID` en cada `ADD` con scan y un `VALIDATE CONSTRAINT` posterior. Para índices exige todos los `CREATE ... INDEX` concurrentes, ausencia de `BEGIN/COMMIT`, timeout/restauración y orden create-before-drop. Luego consulta `pg_constraint`/`pg_index` para demostrar constraints validados, índices válidos, unicidad correcta y ausencia del índice retirado. Cada migración se ejecuta dos veces.

## PostgreSQL local limpio

Se creó `studyx_agent_loop_lock_review` desde `template0` en `127.0.0.1:55433`, se instaló `vector` en el schema `extensions` y se aplicó la cadena completa de migraciones. Se omitió únicamente `20260623000008_roles.sql` porque `orchestrator_role` es un objeto global del cluster y ya existía; no es estado del schema de la base nueva.

Después se reaplicaron, en orden, las nueve migraciones `20260905000001` a `20260905000009`: **PASS**. 00004/00005 completaron sus operaciones concurrentes en ambas pasadas; 00002/00007/00009 repitieron `DROP`, `ADD ... NOT VALID` y `VALIDATE` sin error.

## Gates

```text
npx tsc --noEmit
PASS

npx eslint tests/integration/agent-loop-migration-lock-safety.test.ts --max-warnings=0
PASS

git diff --check -- <las cinco migraciones, test e informe>
PASS
```

No se usó DB remota, API paga ni despliegue.
