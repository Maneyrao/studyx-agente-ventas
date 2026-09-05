# Re-review independiente — paridad de modelo de Task 2.11

Candidato revisado: `76123c106b6f4a4bce5c8f33cb811a2771364cc0`, en una worktree detached limpia. Alcance: el P2 de autoridad doble del modelo en `task-2.11-2.12-final-review.md`, compatibilidad del workflow V21 y configuración Botpress al publicar el bundle sin cambiar valores remotos. No se llamó ninguna API ni se usó base remota.

## Veredictos

- **Spec compliance: PASS.** El modelo efectivo de Agent A tiene una autoridad versionada única, los overrides divergentes fallan antes del fetch y del commit, y el manifiesto se deriva de la misma fuente.
- **Code quality: FAIL.** La implementación es acotada y el bundle Botpress construye, pero el test nuevo agrega una variable sin uso y deja rojo el gate raíz obligatorio `npm run lint -- --max-warnings=0`.
- **P0/P1:** ninguno.
- **P2:** uno, limitado a lint del test.

## Finding

### P2 — El test nuevo deja rojo el gate de lint

`tests/unit/scripts/release-manifest-agent-loop.test.ts:68` declara `providerFetch` con el parámetro `_url`, pero la regla `@typescript-eslint/no-unused-vars` no exceptúa ese nombre. Los 62 focales y ambos typechecks pasan; `npm run lint` falla por una advertencia y el script usa `--max-warnings=0`.

La corrección es eliminar el parámetro del mock o usarlo en una aserción discriminante. No afecta la semántica de paridad, pero impide considerar limpio el commit.

## P2 original cerrado

### Fuente única y configuración literal: PASS

`botpress-agent/src/config/agent-a-model.ts` contiene la única autoridad productiva del Brain: `AGENT_A_DEEPSEEK_MODEL = 'deepseek-v4-flash'`. `agent.config.ts` la consume como `z.literal(...).default(...)`; `agent-a-brain.ts` la usa tanto como default exportado como dentro de `resolveAgentADeepSeekModelV1`; el generador del manifiesto lee esa misma declaración y rechaza cualquier `DEEPSEEK_MODEL` divergente.

Quedan literales en helpers de smoke, presupuesto y bridge local. Ninguno puede cambiar el modelo efectivo del Brain: el bridge termina atravesando el resolver, el budget hook sólo valida el body y el smoke es el probe de proveedor. No constituyen una segunda autoridad runtime.

El build ADK materializó el contrato esperado:

```ts
agentABrainDeepSeekModel: z.default(
  z.literal("deepseek-v4-flash"),
  "deepseek-v4-flash",
)
```

Así, una configuración existente con el valor canónico sigue siendo válida y la ausencia del campo recibe el mismo default. Un valor distinto falla cerrado.

### Compatibilidad con la configuración remota previa: PASS con evidencia local

Los snapshots sanitizados versionados anteriores al cambio registran `agentABrainDeepSeekModel: "deepseek-v4-flash"`. Ese valor satisface exactamente el nuevo literal. Publicar el bundle sobre esa configuración no necesita mutar el valor remoto; si el campo faltara en una instalación anterior, el default generado lo completa.

Este ruling se basa en el snapshot local y en el artefacto ADK construido. Por restricción de la revisión no se consultó Botpress Cloud ni se simuló un deploy remoto. Una configuración remota alterada después del snapshot fallaría intencionalmente en vez de ejecutar un modelo no validado.

### Fallo antes de fetch y commit: PASS

`generateDeepSeekAgentATurnProposalV1` resuelve el modelo antes de crear timers, entrar al loop o invocar `fetch`. Un valor distinto lanza `AGENT_A_DEEPSEEK_MODEL_MISMATCH`; el test prueba cero fetch y cero commit. En el límite de configuración real, el esquema literal impide que un override divergente llegue al workflow.

`generateReleaseManifest` también compara `DEEPSEEK_MODEL` contra la constante fuente antes de construir el manifiesto. El adversarial `deepseek-reasoner` lanza `RELEASE_MANIFEST_MODEL_MISMATCH` y conserva cero fetch/commit en el flujo de prueba.

### Modelo efectivo del request: PASS

El valor retornado por `resolveAgentADeepSeekModelV1` alimenta directamente `body.model` y `result.model`. El test existente captura el request del mock de DeepSeek y exige simultáneamente:

```text
request body.model = deepseek-v4-flash
result.model       = deepseek-v4-flash
manifest.model     = deepseek-v4-flash
```

La misma función maneja el primer intento y el retry de schema/JSON, por lo que un reintento no puede seleccionar otro modelo.

### Manifiesto reproducible: PASS

Con `RELEASE_BUILT_AT`, prompt SHA y árbol Git fijos, dos llamadas independientes a `generateReleaseManifest` produjeron JSON idéntico. El probe confirmó:

```text
identical=true
git_sha=76123c106b6f4a4bce5c8f33cb811a2771364cc0
model=deepseek-v4-flash
artifact_sha_equal=true
template_sha_equal=true
```

El manifiesto ya no toma `model` del entorno: el entorno sólo puede confirmar el valor canónico o provocar un error explícito.

### Workflow V21: PASS

El cambio no altera selección de rutas, políticas, composición ni persistencia. Las tres llamadas DeepSeek del workflow V21 continúan pasando `configuration.agentABrainDeepSeekModel`; el schema garantiza el literal y el resolver lo revalida justo antes del request. Los logs conservan el modelo configurado, que ahora sólo puede ser el canónico. La suite completa de `agent-a-brain.test.ts` quedó verde, incluidas generación inicial, retries y reparación.

## Evidencia ejecutada

```bash
npm exec -- vitest run --config vitest.config.mts \
  tests/unit/scripts/release-manifest-agent-loop.test.ts \
  tests/unit/botpress/agent-a-brain.test.ts \
  tests/unit/agent-core/release-manifest.test.ts
# PASS: 3 archivos, 62 tests

npm run typecheck
# PASS

(cd botpress-agent && npm run typecheck)
# PASS

(cd botpress-agent && npm run build)
# PASS: ADK genera bot.definition.ts y bundle de producción

node /tmp/studyx-model-parity-probe.mjs
# PASS: dos manifiestos idénticos; modelo y hashes estables

git diff --check 76123c1^..76123c1
# PASS

npm run lint
# FAIL: 1 warning, tests/unit/scripts/release-manifest-agent-loop.test.ts:68
# @typescript-eslint/no-unused-vars; --max-warnings=0
```

## Ruling

`76123c1` cierra el P2 funcional de paridad de modelo y es compatible con la configuración Botpress registrada para V21. El commit requiere un ajuste mínimo en su test para recuperar el gate de lint; después de ese cambio puede aprobarse también en calidad sin modificar runtime.
