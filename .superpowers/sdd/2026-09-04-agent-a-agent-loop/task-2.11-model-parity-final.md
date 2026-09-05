# Revisión final independiente — paridad de modelo de Task 2.11

Candidato revisado: `76123c106b6f4a4bce5c8f33cb811a2771364cc0` con los fixes `5fae17b260e6b6c3f023b71cdbb74dcdc1427b08` y `8158bf3509fd07c557b6e76b73f90395db6dd767`. La ejecución se hizo en una worktree detached en `8158bf3`; los únicos archivos adicionales fueron enlaces locales a dependencias. No se llamaron APIs, no se usó una base de datos y no se modificó source.

## Veredictos

- **Spec compliance: PASS.** La autoridad del modelo efectivo sigue siendo única y fail-closed. El manifiesto, el esquema Botpress y los requests del Brain convergen en `deepseek-v4-flash`.
- **Code quality: PASS.** El P2 de gates queda cerrado: lint completo, typecheck raíz, typecheck Botpress y typecheck `agent-core` pasan en el commit exacto. Los fixes sólo modifican el probe que había roto esos gates.
- **P0/P1/P2 residuales:** ninguno.

## Cierre del P2

`5fae17b` eliminó la advertencia `@typescript-eslint/no-unused-vars` al quitar el parámetro del mock `providerFetch`, pero dejó al typecheck con una llamada de un argumento a una función inferida sin argumentos. `8158bf3` restaura la firma `(url: string)` y consume el parámetro con `void url`. El resultado satisface simultáneamente ESLint y TypeScript, sin cambiar runtime ni el comportamiento probado.

El probe mantiene la discriminación buscada: con `DEEPSEEK_MODEL=deepseek-reasoner`, `generateReleaseManifest` rechaza con `RELEASE_MANIFEST_MODEL_MISMATCH` antes de alcanzar tanto el fetch simulado como el commit simulado. El test del Brain cubre la misma frontera productiva y exige cero llamadas a `fetch` y cero commit cuando el override del modelo diverge.

## Paridad y compatibilidad de configuración

- `botpress-agent/src/config/agent-a-model.ts` conserva la única constante productiva `AGENT_A_DEEPSEEK_MODEL = 'deepseek-v4-flash'` y su resolver rechaza cualquier valor no vacío distinto.
- `botpress-agent/agent.config.ts` deriva el campo de configuración como `z.literal(AGENT_A_DEEPSEEK_MODEL).default(AGENT_A_DEEPSEEK_MODEL)`. Una instalación sin el campo obtiene el default canónico; una instalación divergente falla cerrado.
- El build ADK generado en esta revisión materializó `z.literal("deepseek-v4-flash")` con el mismo default y el tipo `agentABrainDeepSeekModel: "deepseek-v4-flash"`.
- El snapshot sanitizado previo `docs/reports/evidence/2026-09-04-agent-a/botpress-production-before.json` registra exactamente `agentABrainDeepSeekModel: "deepseek-v4-flash"`, por lo que satisface el nuevo esquema sin migrar ese valor.
- Las rutas inicial, reparación plannerless y reparación legacy del workflow pasan `configuration.agentABrainDeepSeekModel` a `generateDeepSeekAgentATurnProposalV1`; el resolver vuelve a validar el literal antes del request.
- El generador del manifiesto lee la misma fuente versionada y rechaza un `DEEPSEEK_MODEL` divergente antes de construir el artefacto.

La compatibilidad remota se limita a la evidencia local versionada y al artefacto ADK generado. No se leyó Botpress Cloud ni se hizo deploy en esta revisión.

## Evidencia ejecutada en `8158bf3`

```bash
npm run lint
# PASS: eslint . --max-warnings=0

npm run typecheck
# PASS

(cd botpress-agent && npm run typecheck)
# PASS

(cd agent-core && npx tsc --noEmit)
# PASS

npm exec -- vitest run --config vitest.config.mts \
  tests/unit/scripts/release-manifest-agent-loop.test.ts \
  tests/unit/botpress/agent-a-brain.test.ts \
  tests/unit/agent-core/release-manifest.test.ts
# PASS: 3 archivos, 62 tests

(cd botpress-agent && npm run build)
# PASS: ADK build completed successfully

git diff --check 76123c1^..8158bf3
# PASS
```

## Ruling

`76123c1` + `5fae17b` + `8158bf3` cierran el finding de paridad y el P2 de calidad del informe anterior. El candidato queda **PASS/PASS**, sin findings residuales para este alcance.
