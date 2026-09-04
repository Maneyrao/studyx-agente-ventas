# Agente A: triage reproducible de los 11 fallos de integración

Fecha: 2026-09-04. Evaluador/implementador: subagente `integration_scout`, coordinado por Codex. Sin llamadas de modelo ni API pagas: costo adicional USD 0.

Checkpoint de entrada: `codex/agent-a-plannerless-v2`, `ad15baafb63e8c55cb877f943a74e57c2899deda`, árbol inicialmente limpio. Los blobs de `decision.service.ts` y `commercial-truth-guard.ts` eran idénticos entre la base `1ad468d7a1f3b3a71cdfe3b0b2cd48ffecc0fead` y ese HEAD. Que los fallos fueran previos no los excluyó de revisión.

## Aislamiento y alcance

PostgreSQL 17 local creado por `scripts/pg-native-up.sh 55435 --seed`: DB `studyx_test`, host `127.0.0.1`, puerto `55435`, esquema `public`, 50 tablas; `contacts.declared_phone` presente. No se tocó PostgreSQL compartido 5432 ni base remota. Backend no necesario para estas suites: usan servicios y transacciones reales directamente. Todas las identidades fueron fixtures nuevas. El seed conserva `workspaces.environment=production` para el workspace lógico `studyx`; no implica conexión física remota.

`tests/setup/integration.ts` fuerza `DATABASE_URL` desde `TEST_DATABASE_URL`, validada por el allowlist local de `tests/helpers/db.ts`. No se cargó `.env.local`. Las tres suites no ejecutan DeepSeek, Telegram, Retell ni Sheets reales. Las pruebas de conversación por `processInboundTurn` y canal son responsabilidad de la campaña coordinada, separadas de este reporte.

## Clasificación de los 11 fallos iniciales

Las ubicaciones corresponden al archivo actual salvo la fila que identifica la expectativa reemplazada.

| # | Suite y caso | Ruta/contrato | Causa y resolución |
|---|---|---|---|
| 1 | `conversation-pipeline-v1.test.ts:478`, pregunta sobre link enviado | Rollback V1, dedupe backend compartido | Se borraba el párrafo que contenía URL junto con la respuesta del modelo. Ahora se retiran oraciones con URL y se conserva la referencia al link anterior. |
| 2 | `conversation-pipeline-v1.test.ts:518`, misma pregunta y replay | Rollback V1, dedupe compartido | Misma causa. Se conservan asserts de una URL, una acción y una proyección bajo replay. |
| 3 | `orchestration-lifecycle.test.ts:223`, beca garantizada más párrafo útil | Frontera comercial compartida V1/V2, sin flag que la omita | El nuevo guard no incluía becas/descuentos. Se veta la cláusula afirmativa no autorizada y se conserva texto seguro; la negación de otra cláusula no habilita un beneficio. |
| 4 | `orchestration-lifecycle.test.ts:1235`, curso inventado | Frontera comercial compartida V1/V2 | No se verificaba el nombre del curso ofrecido. Ahora se contrasta con nombres/áreas del catálogo, sin exigir plantilla de redacción. |
| 5 | `orchestration-lifecycle.test.ts:1274`, `missing_course` | Backend compartido, defensa de selección | Una selección inexistente volvía al catálogo completo y el error aparecía tarde al persistir estado. Ahora su alcance de valores queda vacío y no autoriza precio de otra oferta. |
| 6 | Expectativa anterior `no authorized course code` dentro de `it.each` | Contrato legacy superado por la frontera de valores | Sin selección, el contrato explícito y unitarias previas permiten valores del catálogo activo. Se reemplazó con `:1295`, que exige USD 360 canónico y ausencia de acción de pago. No autoriza link por citar precio. |
| 7 | `zero-silence.test.ts:309`, primer rechazo | Prueba de rollback V1; mecanismo de degradación técnico backend | Mockeaba un guard que ya no decide verdad comercial. Se inyecta `enforceCommercialTruthV1`, frontera activa; assertions de outbound técnico y motivo conservadas. |
| 8 | `zero-silence.test.ts:331`, ausencia de efectos comerciales | Mismo camino de fallo, persistencia real | Misma inyección obsoleta. Se conserva curso/plan nulos y contador persistido. |
| 9 | `zero-silence.test.ts:342`, segundo rechazo | Mismo camino, derivación humana durable | Se conserva contador 2 y marca de revisión antes de afirmarla. |
| 10 | `zero-silence.test.ts:362`, tercer rechazo | Mismo camino, idempotencia | Se conserva fecha de la derivación sin duplicarla. |
| 11 | `zero-silence.test.ts:379`, recuperación | Mismo camino, historial | Se conserva reinicio de contador y marca histórica de revisión. |

El workflow elige V2 con `configuration.agentAPlannerlessV2Enabled=true`; al apagarlo recupera V1. Las pruebas V1 aquí conservadas dan evidencia de rollback de estos contratos, no certifican una experiencia conversacional completa.

## Hallazgos de revisión incorporados

La primera versión del detector de curso era demasiado amplia y confundía pagos, canales y recomendaciones con nombres de cursos. El revisor independiente `rubric_review` lo detectó. Se reprodujeron cinco categorías con RED y se restringió el análisis a objetos explícitos de curso, nombres propios y nombres canónicos. Se probaron también dos negaciones que antes habilitaban una oferta afirmativa de beca/descuento en otra cláusula.

La poda del link repetido conserva prosa útil, pero ahora elimina anuncios inmediatos de envío que no van acompañados de una acción nueva. Se corrigió una expectativa anterior que exigía precisamente esa promesa falsa. Si sólo sobrevive texto vacío, V2 usa el rechazo `EGRESS_COMMERCIAL_TRUTH_VIOLATION` existente, sin inventar copy. Legacy entra en la frontera técnica existente y registra degradación; la nueva prueba `orchestration-lifecycle.test.ts:1591` verifica motivo y ausencia de acción. Se retiró el fallback comercial que afirmaba «sigue activo» sin verificarlo.

Límite explícito: este detector de nombres es léxico. Un nombre desconocido en minúsculas sin un identificador como «curso» puede no ser identificado sólo por el texto. Los códigos de curso y acciones se validan en la política autoritativa; esta cobertura no equivale a una garantía semántica universal ni a naturalidad certificada.

## Comandos reproducibles

Desde el worktree, sin cargar archivos de entorno:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55435/studyx_test npm run test:integration -- tests/integration/orchestration-lifecycle.test.ts tests/integration/conversation-pipeline-v1.test.ts tests/integration/zero-silence.test.ts --reporter=json --outputFile=botpress-agent/evals/results/integration-triage-<nuevo-id>.json
npm run test:unit -- tests/unit/orchestration/commercial-truth-guard.test.ts
```

Lint focal de los cinco archivos editados pasó. Typecheck, coverage, integración total, ADK y build quedan en la validación final centralizada del coordinador. Este informe no declara disponibilidad del modelo, entrega remota ni despliegue.

## Artefactos preservados

Los JSON están en `botpress-agent/evals/results/` (directorio ignorado por Git); el candidato final debe conservarlos como evidencia de campaña. Ninguno sobrescribió el anterior.

| Artefacto | Pass / fail / skip | SHA-256 |
|---|---|---|
| `integration-triage-20260904-001.json` | 55 / 11 / 0 | `1690341c4a605de136cddf6baec38f53bebf63d23255b5906306e4bf9a594fb6` |
| `commercial-truth-red-20260904-001.json` | 25 / 7 / 0 | `0cf3fd979993057d8f1bb52405fbe2bba1b7e1032862d99e7b97a942389fd8e1` |
| `integration-triage-20260904-002.json` | 64 / 2 / 0 | `dd60099511afe026fa41c8e498f7a60b620054f42016b0d92a55e203ecc775ee` |
| `integration-triage-20260904-003.json` | 66 / 0 / 0 | `5248d0a08bc0844f84c241a99ff0bbc81882806d020b796709e52e8ffc5b280e` |
| `commercial-truth-review-red-20260904-001.json` | 32 / 7 / 0 | `b5243f96b514c3f7b2a68b16cf4496c01cb0fd033081d7b7001ec606ffe1cfd7` |
| `commercial-truth-review-green-20260904-001.json` | 39 / 0 / 0 | `ab0c54f8d7b1717ae5ecd6f2c7b97f55d34a6e008c986f80d39e257561b6a465` |
| `dedupe-promise-red-20260904-001.json` | 0 / 1 / 55 | `f95c0573b6b59a3230bb2d8a98f274bf626e37cb7396aee6c73b9a9ba78e6913` |
| `dedupe-empty-red-20260904-001.json` | 0 / 1 / 56 | `7baf9388901102d547693a80f95834b9783601337d6078736d37a993083c8cc8` |
| `integration-triage-20260904-004.json` | 67 / 0 / 0 | `9c602e9d7c3034943063c08fab5ff207a108967351ac1227e9bf33a87df91c42` |
| `integration-fixes-unit-20260904-001.json` | 195 / 0 / 0 | `74cc6095467fc827af7cbca76f4f509f5b474d0e5f2092f580a04f11decdaaa2` |


## Cierre de revisión y triage de gates globales

El revisor independiente `rubric_review` aceptó las correcciones acotadas del guard y dedupe; ejecutó 53 pruebas de frontera comercial/promesas futuras, todas verdes. La última focal completa del grupo inicial fue 67/67 sin skips (`integration-triage-20260904-004.json`).

El coordinador ejecutó los gates globales después: coverage encontró 6 fallos de metadata v13/v14 en 4 archivos; integración encontró 2 expectativas antiguas de nuevo envío en `delivery-attempt-fencing.test.ts`. La inspección de sus diffs de assertions mostró que no eran nuevos fallos del runtime:

- Los tres asserts de hot path y uno de runner ahora comparan la metadata enviada con `AGENT_A_BRAIN_PROMPT_VERSION`. El test que congela la versión del prompt se actualizó explícitamente a `studyx-agent-a-brain-v14`.
- Sólo la metadata `prompt_version` de las suites futuras `studyx-agent-a-brain-v1-heldout.json` y `studyx-agent-a-conversational-baseline.json` se actualizó a v14. No se retocó ningún reporte de conversación histórico ni el texto de esos casos.
- Los dos tests de delivery/concurrencia ahora incluyen prosa útil del modelo junto al anuncio de envío. Exigen conservar esa prosa y retirar el anuncio tras dedupe. Todas sus aserciones de entrega durable, replay, proyección y concurrencia permanecen.

Verificación focal posterior: 157/157 unitarias de metadata y 23/23 de delivery fencing, sin skips. Sin nuevos cambios runtime ni gasto API en este paso.

| Artefacto final focal | Pass / fail / skip | SHA-256 |
|---|---|---|
| `prompt-v14-metadata-focal-20260904-001.json` | 157 / 0 / 0 | `2f0f87d112278d7d9eeee135c032cebdd55ebd114d59811d55de55e27186be01` |
| `delivery-fencing-focal-20260904-001.json` | 23 / 0 / 0 | `be0792c39a191edb53d4de35f1c69fa47ed63d7c973d7bc539dc16a53defdb54` |


## Investigación de rollback por artefacto anterior

Investigación local sólo de lectura; no se generaron bundles ni se desplegó nada durante esta revisión. Objetivos informados por el coordinador: Botpress `STUDYX` (`2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b`), desplegado `2026-09-03T10:50:31.859Z`; Vercel `dpl_AqoLiooRKL3qeCX4kMYQ7h2DT1Ji`, URL `studyx-agente-ventas-8f5utc6mm-maneyraos-projects.vercel.app`.

**No se recuperó un bundle Botpress anterior vinculado de forma verificable a ese despliegue.** Se inspeccionaron manifiestos, reportes de release/rollback y directorios generados pertinentes en el checkout padre y sus worktrees. No se leyó historial de conversaciones, bases de logs ni valores de secretos. No se encontró reporte de rollout del 3 de septiembre que asocie ese timestamp con un SHA y digest de bundle.

Los bundles compilados sí existen en `botpress-agent/.adk/bot/.botpress/dist/index.cjs`, pero sus fechas no prueban un despliegue y ninguno conserva procedencia remota del objetivo:

| Ubicación relativa al repositorio padre | mtime UTC observado | Interpretación |
|---|---|---|
| `.worktrees/agent-a-plannerless-v2/.../index.cjs` | 2026-09-04 13:43:24 | Build del candidato de esta campaña; no es backup del 3 de septiembre. |
| `.worktrees/agent-a-chanl-evals/.../index.cjs` | 2026-09-02 02:59:48 | Build anterior sin vínculo al deploy objetivo. |
| `.worktrees/agent-a-outbound-prod-deploy/.../index.cjs` | 2026-08-31 14:17:32 | Build previo de otra rama; tampoco prueba identidad con el remoto actual. |
| `botpress-agent/.../index.cjs` del checkout padre | 2026-08-26 00:24:28 | Build viejo del checkout padre. |

`project.cache.json` sólo aporta `botId`, no SHA/digest de deployment. `scripts/generate-release-manifest.mjs` puede generar manifiestos del árbol actual, pero no se encontró uno histórico para el objetivo; su campo `botpress_artifact_sha` se obtiene de fuentes trackeadas y no es por sí mismo el hash del bundle remoto. El snapshot JSON de evidencia de agosto pertenece a otro bot (`28eefcf3...`) y no sirve como rollback de STUDYX. Según la comprobación remota del coordinador, `listBotVersions` retornó vacío y `getBotJson` sólo metadata Studio: ninguno es backup ADK.

Para Vercel, `.eval/codex-20260904/vercel-production-inspect.json` conserva el deployment ID y URL exactos, `readyState=READY`, `target=production`, creación `2026-09-03T03:40:54.744Z`. Ese archivo no contiene `gitSource`, `meta` ni SHA de commit. La existencia del deployment ID da un destino remoto preciso para una reversión gestionada por Vercel, si continúa disponible y el operador la valida; no demuestra que el checkpoint local sea su código. No se ejecutó rollback ni se certificó compatibilidad con un bundle Botpress anterior.

### Reconstrucción alternativa del checkpoint: recuperación no certificada

El siguiente procedimiento está **preparado, no ejecutado**. Reconstruye fuentes del checkpoint local conocido, no el artefacto desplegado el 3 de septiembre. No incluye deploy ni migración. Usa caché npm local: si falta una dependencia, `--offline` falla y hay que resolver ese faltante de forma explícita. La copia de `.adk/dependencies` es el snapshot local actual y no se presenta como snapshot histórico; esa diferencia obliga a revalidar el artefacto reconstruido.

```bash
set -euo pipefail
STUDYX_RECOVERY_REPO='/Users/tmaneyro22/Documents/AGENTE IA/studyx-agente-ventas'
STUDYX_RECOVERY_DIR='/private/tmp/studyx-recovery-ad15ba-20260904'
STUDYX_RECOVERY_CURRENT="$STUDYX_RECOVERY_REPO/.worktrees/agent-a-plannerless-v2"
test ! -e "$STUDYX_RECOVERY_DIR"
git -C "$STUDYX_RECOVERY_REPO" worktree add --detach "$STUDYX_RECOVERY_DIR" ad15baafb63e8c55cb877f943a74e57c2899deda
npm --prefix "$STUDYX_RECOVERY_DIR" ci --offline --ignore-scripts
npm --prefix "$STUDYX_RECOVERY_DIR/botpress-agent" ci --offline --ignore-scripts
mkdir -p "$STUDYX_RECOVERY_DIR/botpress-agent/.adk"
cp -R "$STUDYX_RECOVERY_CURRENT/botpress-agent/.adk/dependencies" "$STUDYX_RECOVERY_DIR/botpress-agent/.adk/dependencies"
npm --prefix "$STUDYX_RECOVERY_DIR/botpress-agent" run build
npm --prefix "$STUDYX_RECOVERY_DIR/botpress-agent" run typecheck
npm --prefix "$STUDYX_RECOVERY_DIR/botpress-agent" run check
shasum -a 256 "$STUDYX_RECOVERY_DIR/botpress-agent/.adk/bot/.botpress/dist/index.cjs"
```

El canario no debe llamar a esa alternativa «rollback exacto». El checkpoint incluye cambios que no están acreditados como desplegados. Apagar plannerless sólo recupera otra ruta del bundle actual y tampoco sustituye una reversión por artefacto. La columna aditiva nullable `declared_phone` puede mantenerse durante un rollback de código, preservando datos nuevos.
