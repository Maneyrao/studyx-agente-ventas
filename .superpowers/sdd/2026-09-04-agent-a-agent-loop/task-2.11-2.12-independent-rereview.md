# Re-review independiente — Tasks 2.11 y 2.12

Candidato revisado: `24ef32db3dd5f94459a4efb3e294d88b832f83d6`, en una worktree detached limpia. Alcance: los dos P1 de `task-2.11-2.12-final-review.md`, el SHA efectivo en cada salida y la preservación de idempotencia/replay. Se usó solamente PostgreSQL local en `127.0.0.1:55433`; no se leyó `.env.local`, no hubo APIs ni red remota.

## Veredictos

- **Spec compliance: FAIL.** Los dos defectos originales de composición están corregidos, pero el contrato más fuerte de `prompt_sha256` efectivo sigue fallando en dos bordes de deadline: un fallback de presupuesto puede informar un SHA sin haber llamado al modelo, y un fallback de integridad puede informar el SHA de una reparación que nunca se inició.
- **Code quality: FAIL.** Tipos, focales, integración e idempotencia quedan verdes. La nueva integración, sin embargo, deriva el manifiesto del mismo `result.prompt_sha256`; no contrasta ese SHA con los requests vistos por el provider y por eso no discrimina los dos falsos positivos.
- **P0:** ninguno.
- **Findings:** 1 P1. No quedan P2 adicionales dentro del alcance.

## Finding

### P1 — Los dos fallbacks pueden atribuir un prompt que nunca corrió

La spec define `prompt_sha256` como el hash del prompt efectivo que corrió. El candidato sí captura correctamente el request del primer intento dentro del wrapper de `model.generate` (`agent-core/src/loop.ts:272-276`). En la reparación, en cambio, calcula `repairPromptSha256` antes de saber si queda tiempo (`:346-357`) y lo devuelve incondicionalmente en el fallback de integridad (`:392-404`). Si el primer intento termina rechazado exactamente al vencer el presupuesto, `remainingMs === 0`, no se llama al provider por segunda vez, pero el resultado atribuye el prompt de reparación no enviado.

El mismo problema existe antes del primer intento. `lastPromptSha256` se inicializa con un request proyectado (`:261-266`). Si el deadline se alcanza antes de entrar a `model.generate`, `runAgentTurnV3` devuelve `DEADLINE` y el fallback de presupuesto persiste ese SHA aunque el provider recibió cero requests (`:316-328`).

Probe determinístico contra el commit exacto, con un provider que registra cada request:

```text
integrity: model calls=1, sent hashes=[first], returned hash=repair, returned hash observed=false
budget:    model calls=0, sent hashes=[],      returned hash=initial, returned hash observed=false
```

En el primer caso, el reloj agota los 6.500 ms entre el rechazo inicial y el chequeo previo a la reparación. En el segundo, los agota entre la creación del deadline compartido y el primer chequeo de `runAgentTurnV3`. No se simuló una respuesta inválida ni se modificó source.

La corrección debe conservar el último SHA **observado al entrar a una llamada real** y actualizarlo inmediatamente antes de cada `deps.model.generate`. Si no ocurrió ninguna llamada, el resultado no puede afirmar un SHA efectivo; el contrato debe representar esa ausencia o garantizar que el primer intento se invoque antes de producir un fallback persistible. Deben agregarse dos tests con reloj determinístico que comparen `result.prompt_sha256` contra los requests capturados por el provider: deadline antes del primer intento y deadline entre rechazo y reparación.

## Correcciones originales confirmadas

### Fallback asignable sin cast: PASS

`AgentTurnWithIntegrityResultV3` ahora separa los fallbacks en dos variantes discriminadas: integridad exige `IntegrityRejectionV1` y presupuesto exige `null` (`agent-core/src/loop.ts:163-178`). `tests/integration/agent-loop-prompt-binding.test.ts:42-64` pasa `fallback: result` directamente a `commitAgentTurnV3`; `npm run typecheck` compila el puente sin cast ni reconstrucción.

### Binding obligatorio y rechazo pre-efecto: PASS en la frontera de commit

`effective_prompt_sha256` es obligatorio en `CommitAgentTurnV3Input`. `commitAgentTurnV3` parsea el manifiesto y compara ambos hashes antes de calcular el payload, consultar replay o abrir una transacción (`src/features/conversation/application/commit-agent-turn-v3.ts:478-494`). La condición es independiente de la rama de decisión/fallback, por lo que alcanza primer intento, reparación y ambos fallbacks. El adversarial comprometido demuestra que un SHA válido pero distinto deja cero decisiones, cero outbounds y la versión de estado intacta.

Las cuatro rutas positivas también están cubiertas: decisión inicial, decisión reparada, fallback de presupuesto y fallback de integridad. Falta cobertura adversarial separada por ruta, pero no hay una bifurcación de implementación entre ellas; el defecto bloqueante es que el valor entregado por el loop puede no corresponder a ningún request real.

### Idempotencia y replay: PASS

La comparación nueva ocurre antes de consultar una decisión existente. Un replay con el mismo resultado y manifiesto conserva el mismo payload hash; un cambio de manifiesto participa del payload y mantiene el conflicto. Las suites de exactly-once, concurrencia, fallback recovery y regresiones pasaron sin cambios de semántica.

## Evidencia ejecutada

```bash
npm exec -- vitest run --config vitest.config.mts \
  tests/unit/agent-core/loop.test.ts \
  tests/unit/agent-core/repair-and-fallback.test.ts \
  tests/unit/agent-core/release-manifest.test.ts \
  tests/unit/agent-core/no-host-imports.test.ts \
  tests/unit/agent-core/sha256.test.ts
# PASS: 5 archivos, 62 tests

TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test \
  npm exec -- vitest run --config vitest.integration.config.mts \
  tests/integration/agent-loop-prompt-binding.test.ts \
  tests/integration/agent-loop-exactly-once.test.ts \
  tests/integration/agent-loop-concurrency.test.ts \
  tests/integration/agent-loop-fallback-commit.test.ts \
  tests/integration/agent-loop-fallback-recovery.test.ts \
  tests/integration/agent-loop-commit-regressions.test.ts
# PASS: 6 archivos, 20 tests

npm run typecheck
# PASS

npm exec -- eslint \
  agent-core/src/loop.ts \
  src/features/conversation/application/commit-agent-turn-v3.ts \
  tests/integration/agent-loop-prompt-binding.test.ts
# PASS

git diff --check 24ef32d^..24ef32d
# PASS
```

## Ruling

`24ef32d` cierra los dos P1 formulados en la revisión anterior en la frontera loop→commit: el fallback es asignable sin cast y un SHA ajeno se rechaza antes de efectos. Tasks 2.11/2.12 todavía no deben declararse cerradas porque el loop puede etiquetar ambos tipos de fallback con un SHA no observado por el provider. La persistencia estricta amplifica ese error de procedencia en vez de detectarlo.
