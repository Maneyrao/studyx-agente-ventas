# Task 2.6 — revisión independiente de `5846d25`

## Veredictos

- **Spec compliance: CHANGES REQUIRED.** La precedencia válida, el cableado real y el contrato Botpress cumplen, pero una fila inválida del contacto puede terminar habilitando el default del workspace. Eso contradice el requisito de caer cerrado ante un modo inválido.
- **Code quality: CHANGES REQUIRED.** La separación dominio/aplicación/adapter es correcta y los gates del commit pasan. Falta cerrar el fallo de seguridad del rollout y convertir dos propiedades operativas importantes en tests discriminantes.

## Findings

### [P1] Un override inválido del contacto puede habilitar un default autoritativo

Archivos: `src/features/orchestration/domain/agent-loop-rollout.ts:24-28`, `src/features/orchestration/adapters/postgres-agent-loop-rollout.ts:34-39`, `tests/unit/orchestration/agent-loop-rollout.test.ts:34-38`.

`resolveAgentLoopModeV3` sólo cae a `off` cuando el modo inválido es la única fila aplicable. Si el mismo contacto tiene un modo inválido y el workspace tiene `authoritative`, el resolver trata el override como ausente y devuelve `authoritative`. El adapter agrava el caso porque elimina silenciosamente la fila inválida antes de resolver, por lo que la capa de aplicación ya no puede distinguir “no hay override” de “el override está corrupto”.

Probe puro ejecutado:

```text
rows = [
  { contact_id: null, mode: 'authoritative' },
  { contact_id: CONTACT, mode: 'corrupt' },
]
resultado actual = authoritative
resultado seguro esperado = off
```

Probe del adapter con una respuesta de DB equivalente:

```text
loaded = [{ contact_id: null, mode: 'authoritative' }]
resolved = authoritative
```

El `CHECK` de la migración impide este valor en operaciones SQL normales, pero no reemplaza el fail-closed de la frontera: drift de esquema, un driver defectuoso o un fixture sin validar no deben promover tráfico. El reporte afirma que los modos desconocidos se rechazan; el comportamiento real sólo los descarta.

La corrección debe preservar evidencia de una fila aplicable inválida y resolver todo el turno a `off` (o hacer que el reader lance y dejar que `claimBatch` aplique su fallback). Agregar casos con override inválido + default `authoritative` en ambos órdenes y un test del mapper del adapter; una fila inválida de otro contacto no debe afectar al contacto reclamado.

### [P2] La integración real no aísla su baseline ni prueba el cableado HTTP

Archivo: `tests/integration/agent-loop-rollout-claim.test.ts:44-76`.

La prueba usa correctamente `PostgresOrchestrationStore` y `PostgresAgentLoopRolloutReaderV3` contra PostgreSQL local. Sin embargo, su caso “defaults to off” borra sólo la fila del contacto. Una fila default preexistente para el workspace `studyx` cambia el resultado y vuelve el test dependiente del estado compartido. El `afterEach` borra únicamente filas de rollout del contacto y conserva los contactos, conversaciones, mensajes y batches sembrados.

Además, el test llama `claimBatch` directamente. Demuestra application + adapters, pero seguiría verde si la ruta dejara de inyectar `agentLoopRollout`. El cableado de `src/app/api/agent/batches/[batch_id]/claim/route.ts:135-172` sólo queda cubierto por lectura estática.

Conviene aislar el default del workspace con restauración/rollback, limpiar toda la fixture y agregar una prueba de la ruta con el reader inyectado o un seam verificable. En ese mismo test deben quedar persistidos los tres comportamientos del SQL real: default del workspace, override del contacto sobre ese default y exclusión de otro contacto/workspace.

### [P2] “Sólo leer después de ganar el claim” está implementado pero no protegido por un test discriminante

Archivos: `src/features/orchestration/application/claim-batch.ts:547-565`, `src/features/orchestration/application/claim-batch.ts:709-721`, `tests/unit/orchestration/claim-batch.test.ts:388-409`.

El código actual retorna para `waiting`, `absorbed`, `completed`, `abandoned` y `not_found` antes de cargar el contexto y antes de crear la tarea de rollout. Esto cumple el contrato. No obstante, el test parametrizado de no propietario no inyecta un spy en `agentLoopRollout`, de modo que no fallaría si una refactorización adelantara esa lectura. Inyectar `agentLoopRollout: { load: vi.fn() }` y afirmar cero llamadas para los cinco outcomes convierte la propiedad en un gate real.

## Comprobaciones aprobadas

- La desviación del brief es válida. `src/lib/services/claim.service.ts` y `claimInboundBatch` no existen; la autoridad real es `features/orchestration/application/claim-batch.ts`. Definir el puerto en dominio, resolver en aplicación e instanciar el adapter PostgreSQL en la ruta mantiene el acceso SQL fuera del dominio y respeta el diseño del árbol actual.
- La precedencia para modos válidos no depende del orden: el test invierte default y override y conserva `authoritative`.
- Un error del reader/DB deja `agentLoopMode = 'off'`, registra `orchestration.claim.agent_loop_rollout_unavailable` y no aborta el claim.
- El SQL restringe por workspace configurado y activo, sólo devuelve default + contacto exacto y exige membresía `(workspace_id, contact_id)`. Un probe transaccional real confirmó: override propio vence al default; otro contacto conserva su propia resolución; un no miembro recibe cero filas. La migración agrega el FK compuesto, unicidad efectiva también para `contact_id IS NULL`, `CHECK` de modos, RLS y grants mínimos.
- El contrato Botpress aplica `off` cuando un backend legacy omite `features.agent_loop_v3_mode`, conserva opcional el objeto `features` y rechaza un valor de enum desconocido.
- El checkout había avanzado a `979d9d1` por trabajo concurrente, pero `git diff 5846d25..HEAD -- <archivos de Task 2.6>` fue vacío. Los gates de compilación se repitieron en un worktree temporal anclado exactamente a `5846d25`.

## Evidencia ejecutada

```text
npx vitest run --config vitest.config.mts \
  tests/unit/orchestration/agent-loop-rollout.test.ts \
  tests/unit/orchestration/claim-batch.test.ts \
  tests/unit/botpress/agent-a-context.test.ts \
  tests/unit/botpress/process-inbound-turn-hot-path.test.ts \
  tests/unit/scripts/agent-a-conversation-runner.test.ts
PASS — 5 archivos, 266 tests

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-rollout-claim.test.ts
PASS — 1 archivo, 1 test

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npx vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-migrations.test.ts
PASS — 1 archivo, 6 tests

npm run typecheck                         # worktree exacto 5846d25
PASS

(cd botpress-agent && npm run typecheck) # worktree exacto 5846d25
PASS

npx eslint <archivos raíz de Task 2.6> --max-warnings=0
PASS
```

No se hicieron llamadas a APIs, despliegues ni mutaciones remotas. Las pruebas SQL usaron exclusivamente `127.0.0.1:55433/studyx_test`; el probe adicional corrió dentro de una transacción revertida.
