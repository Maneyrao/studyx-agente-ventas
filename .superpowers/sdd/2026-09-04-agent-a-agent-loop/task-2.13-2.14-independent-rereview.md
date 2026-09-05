# Re-review independiente — Tasks 2.13 y 2.14

Fecha: 2026-09-05

Commit bajo revisión: `148b304a879bfd4ff422703c2eeb7bdef7f8c0ce`

Base de hallazgos: `task-2.13-2.14-final-review.md`

La ejecución se hizo desde un archivo limpio del commit exacto. Los cambios posteriores del worktree no formaron parte de los probes ni de los gates.

## Veredicto

| Alcance | Spec compliance | Calidad | Resultado |
|---|---|---|---|
| Task 2.13 | **FAIL** | **FAIL** | Contacto y llamada cierran el contrato anterior; memoria y lead todavía tienen tres bypasses P1 de autoridad, dependencia y orden de entrega. |
| Task 2.14 | **PASS** | **PASS** | El test de crash ahora ejecuta y commitea la misma preparación en el turno siguiente; concurrencia y recuperación siguen verdes. |
| Migración `00006` | **PASS** en seguridad y re-aplicación; **FAIL** como frontera tenant de supersession | **PASS** para privilegios/idempotencia de DDL | Es `SECURITY INVOKER`, fija `search_path`, revoca roles públicos y se aplicó dos veces; su contrato sólo recibe `contact_id`, por lo que no puede impedir la supersession entre workspaces reproducida por la aplicación. |
| Cierre conjunto | **FAIL / no habilitable** | **FAIL** | No encontré P0. Hay tres P1 reproducibles antes de considerar la fase cerrada. |

## Findings priorizados

### [P1] Una memoria de otro workspace puede ser supersedida cuando el contacto global es el mismo

`prepareMemoryToolV1` autoriza una memoria seleccionada uniendo `workspace_contacts` únicamente por `memory.contact_id` y por la membresía del workspace actual (`agent-tools-prepare.ts:360-369`). Esa consulta no vincula la conversación de origen de la memoria con ese workspace. El worker tampoco carga `workspace_id` (`project-agent-a-memories.ts:159-174`) y `record_prepared_agent_memory_v1` sólo recibe y valida `contact_id` (`20260905000006_agent_loop_prepared_memory.sql:8-23`, `:86-96`).

Probe local discriminante:

1. Se creó una memoria activa desde una conversación del workspace A.
2. Se agregó el mismo contacto global como miembro activo del workspace B.
3. Una conversación del workspace B preparó y commiteó una corrección con `supersedes` apuntando a la memoria de A.
4. La preparación fue aceptada y el worker terminó `completed`; la memoria de A quedó `status='superseded'` y `superseded_by_memory_id=<UUID reservado en B>`.

Esto viola el aislamiento por workspace de la spec y no es sólo un defecto del test. El cambio mínimo debe llevar el workspace autoritativo hasta la reserva/job/función y comprobar que cada memoria objetivo proviene de una conversación o vínculo durable del mismo workspace y contacto. La validación por contacto sigue siendo necesaria, pero no alcanza.

### [P1] El commit acepta un sucesor cuyo `supersedes` sólo existe en una preparación que nunca fue seleccionada

La segunda rama de `authorized_ids` considera autorizado cualquier UUID dentro de otra fila `prepare_memory` de la misma conversación (`agent-tools-prepare.ts:370-381`), sin exigir `committed_at` ni que esa preparación forme parte del commit actual. Esto permite el caso previsto por el brief de preparar una corrección sobre un UUID reservado, pero el commit no valida ni materializa la dependencia: sólo encola los candidatos listados (`commit-agent-turn-v3.ts:1017-1047`).

Probe local discriminante:

1. El turno 1 reservó una memoria y no la incluyó en ningún commit.
2. El turno 2 reservó un sucesor que apuntaba al UUID del turno 1 y commiteó únicamente el sucesor.
3. La reserva y el commit devolvieron éxito.
4. El worker dejó el job en `failed` con `MEMORY_PROJECTION_STORE_FAILED`, porque la función exige que el objetivo exista activo en `selected_memories` (`20260905000006_agent_loop_prepared_memory.sql:86-96`).

La preparación puede seguir admitiendo IDs reservados para conservar el contrato del brief, pero el commit debe fallar cerrado si cada objetivo no es ya una memoria durable autorizada o una preparación incluida en una dependencia cerrada y materializable en orden. El test existente sólo rechaza un UUID de otro contacto (`agent-tools-prepare-rest.test.ts:277-317`); no discrimina una reserva no commiteada del mismo contacto.

Además, aun en el camino válido, la memoria anterior permanece activa después del commit y sólo se supersede cuando corre el worker; el test lo afirma expresamente (`agent-tools-commit-effects.test.ts:343-352`). La función hace atómica la inserción del sucesor y la actualización de sus predecesores (`20260905000006_agent_loop_prepared_memory.sql:108-138`), pero esa atomicidad ocurre en el worker, no en la transacción de decisión. Esto conserva una ventana en la que el turno siguiente puede recuperar la memoria vieja, contrario a §3.10 (`agent-a-agent-loop-design.md:557-559`). Resolver la dependencia anterior también debe fijar este orden o documentar y aprobar explícitamente la desviación.

### [P1] El lead queda reclamable por Sheets antes de que el canal confirme la entrega

El commit llama `enqueueLeadProjection` (`commit-agent-turn-v3.ts:1050-1071`) antes de registrar el outbound y su delivery (`:1081-1164`). La atomicidad de la transacción evita una fila huérfana, pero al finalizar deja `sheet_projection_rows` en `pending`; `flushSheetProjections` reclama cualquier fila pendiente y ejecuta `provider.updateRow` sin comprobar el estado del delivery (`projection.service.ts:328-359`).

Probe local con provider falso, sin red:

1. Se commiteó `prepare_lead_projection`.
2. Sin emitir un delivery report, el outbound permanecía en estado `leased`.
3. `flushSheetProjections` reclamó una fila y llamó una vez a `updateRow`; devolvió `claimed=1`, `completed=1`.

La ausencia de red dentro de `commitAgentTurnV3` sí está cumplida. La semántica de entrega no: el contrato operativo exige encolar/actualizar Sheets sólo después de entrega confirmada (`agent-a-operational-mvp.md:61`, `:85`, `:111`) y el propio servicio declara esa frontera (`projection.service.ts:28-31`). La corrección mínima es crear una fila interna ligada al outbound en estado no reclamable y promoverla tras `submitted_to_botpress`, o hacer que el claim de Sheets exija esa entrega aceptada. El test actual sólo verifica la fila `pending` y que no hubo red inline (`agent-tools-commit-effects.test.ts:376-409`), por lo que hoy codifica el orden incorrecto.

## Contratos verificados

- **Contacto:** el snapshot se arma sólo con preparaciones seleccionadas (`commit-agent-turn-v3.ts:282-327`) y `contacts` sólo se actualiza si una de ellas es `prepare_contact_details` (`:969-981`). Un probe con una reserva de contacto no listada conservó nombre y correo anteriores y dejó `committed_at` nulo.
- **Llamada:** `call_id` reservado se pasa como `reserved_call_id` (`commit-agent-turn-v3.ts:983-1014`) y se usa como `call_sessions.id` y como `call_events.call_id` (`request-call.ts:151-235`). El camino feliz y su replay dejaron una sesión, un evento `requested`, cero eventos de provider y el mismo UUID. Un probe sin consentimiento rechazó con `CALL_CONFIRMATION_REQUIRED` y revirtió decisión, sesión, evento y `committed_at`.
- **Fencing de llamada:** las preparaciones abiertas se cargan por el `turn_id` y la conversación exactos, bajo lock (`commit-agent-turn-v3.ts:412-424`); el servicio revalida contacto, conversación, lote y modo de consentimiento. La suite histórica de handoff pasó 15/15.
- **Reservas no listadas:** contacto, lead, llamada y memoria ausentes de `commit_preparations` no produjeron efecto ni quedaron commiteadas en el caso combinado (`agent-tools-commit-effects.test.ts:129-188`).
- **Memory payload:** el job conserva el UUID reservado y la lista `supersedes`; el worker los entrega al store mediante `memory_id` y `supersedes_memory_ids` (`project-agent-a-memories.ts:203-230`). La migración enlaza `superseded_by_memory_id` y activa el sucesor en una única llamada SQL. Los findings anteriores se refieren a autoridad y momento, no a pérdida de esos campos.
- **Crash y turno siguiente:** el test ahora expira la reserva abandonada, vuelve a reservar la misma clave en el turno siguiente, la commitea y observa exactamente un job y una decisión (`agent-loop-prepare-crash.test.ts:94-132`). El P2 anterior queda cerrado.

## Migración `00006`

Se aplicó el archivo completo dos veces seguidas sobre PostgreSQL local; ambas ejecuciones terminaron en `COMMIT`. La función resultante tiene:

```text
security_definer=false
search_path=pg_catalog, public
orchestrator_role EXECUTE=true
PUBLIC EXECUTE=false
anon EXECUTE=false
authenticated EXECUTE=false
```

La migración usa `CREATE OR REPLACE FUNCTION`, `REVOKE` y `GRANT`, por lo que su re-aplicación es idempotente. Es `SECURITY INVOKER` (`20260905000006_agent_loop_prepared_memory.sql:30-32`) y no eleva privilegios. La función bloquea el contacto, valida objetivos activos del mismo contacto y materializa inserción/supersession en una operación. El defecto de tenant señalado arriba existe porque no recibe ni valida workspace; los privilegios no lo corrigen.

## Evidencia ejecutada

Sólo se usó `postgresql://postgres@127.0.0.1:55433/studyx_test`. Los probes fueron efímeros y se eliminaron después de ejecutarlos. No hubo API, DB remota ni despliegue.

```text
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-tools-commit-effects.test.ts \
  tests/integration/agent-tools-prepare-rest.test.ts \
  tests/integration/agent-loop-prepare-crash.test.ts \
  tests/integration/agent-loop-concurrency.test.ts \
  tests/integration/agent-loop-fallback-recovery.test.ts \
  tests/integration/agent-loop-exactly-once.test.ts \
  tests/integration/agent-loop-delivery-failure.test.ts
# PASS: 7 archivos, 21/21 tests

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-a-call-handoff.test.ts
# PASS: 1 archivo, 15/15 tests

probe efímero autoridad/selección/delivery
# 2 positivos PASS: llamada sin consentimiento revierte; contacto no listado es inerte
# 3 expectativas seguras FAIL: memoria cross-workspace, predecessor no commiteado,
# lead reclamable antes de delivery

probe efímero de efectos de memoria
# predecessor no commiteado -> job failed / MEMORY_PROJECTION_STORE_FAILED
# predecessor cross-workspace -> job completed y memoria ajena superseded

npx tsc --noEmit
# PASS

(cd agent-core && npx tsc --noEmit)
# PASS

npx eslint <3 sources + 3 tests focales>
# PASS

git diff --check 148b304^..148b304
# PASS
```

Los verdes del repositorio confirman la materialización feliz, el replay, la inercia de reservas descartadas y la recuperación tras crash. No cubren las tres secuencias adversariales anteriores; por eso no alcanzan para aprobar Task 2.13.
