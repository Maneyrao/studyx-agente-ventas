# Agent A StudyX — Codex stop handoff

**Fecha:** 2026-09-05 (America/Argentina/Buenos_Aires)  
**Motivo:** el usuario pidió detener la ejecución y dejar un reporte para que Claude Code continúe.  
**Worktree:** `/Users/tmaneyro22/Documents/AGENTE IA/studyx-agente-ventas/.worktrees/agent-a-plannerless-v2`  
**Branch:** `codex/agent-a-plannerless-v2`

## Instrucción vigente del usuario

Continuar la ejecución del plan, sin rediseñarlo. La prioridad sigue siendo: eliminar falsos verdes, corregir conversación, probar persistencia y entrega por el workflow real, evaluar naturalidad, desplegar el candidato cuando los gates sean reales y preparar el canario de Telegram. El usuario ya autorizó el despliegue supervisado cuando el candidato cumpla las condiciones. No autorizó ampliar el presupuesto pago.

No se debe declarar éxito sólo por unitarias verdes. La entrega debe incluir transcripciones, resultados verificables, commit y estado real del despliegue.

## Fuente completa anterior

Leer completo antes de continuar:

`/Users/tmaneyro22/Documents/AGENTE IA/docs/superpowers/plans/2026-09-04-agent-a-codex-handoff.md`

Plan y especificación:

- `docs/superpowers/plans/2026-09-04-agent-a-agent-loop.md`
- `docs/superpowers/specs/2026-09-04-agent-a-agent-loop-design.md`
- `.superpowers/sdd/2026-09-04-agent-a-agent-loop/`

## Presupuesto pago: no reiniciar

- Gasto acumulado autoritativo heredado: **USD 1.085364112**.
- Tope autorizado: **USD 1.08**.
- El tope ya fue excedido por **USD 0.005364112**.
- No ejecutar DeepSeek, una conversación paga en Botpress Cloud ni otra llamada paga sin una nueva autorización explícita.
- Un archivo viejo `.eval/codex-20260904/telegram-review/budget-update.json` muestra USD 0.900002128 sobre un límite viejo de USD 1.00; no usarlo para bajar ni reiniciar el total acumulado vigente.
- Siguen permitidas pruebas locales/deterministas, consultas remotas de sólo lectura y despliegue previamente autorizado.

## Estado Git al detenerse

Al comenzar esta continuación, HEAD era `19f6b5e61d99073599bd88808e50ee2d7f919c33`.

Codex agregó y commiteó:

- `6eaac0dc5b4dc9ff7dd166a2c9b8fb89b2bb3e30` — `fix(agent-a): attest exact Botpress bundle`

Ese commit corrige una discrepancia de evidencia: `botpress_artifact_sha` se calculaba sobre archivos fuente versionados, aunque la spec lo define como el SHA del bundle publicado. Ahora `generateReleaseManifest` exige `BOTPRESS_ARTIFACT_SHA256`, lo valida como SHA-256 y lo guarda sin sustituirlo por un hash de fuente. También se documentó la variable en `.env.example`.

TDD observado para ese cambio:

- RED: `tests/unit/scripts/release-manifest-agent-loop.test.ts` falló 2 casos: ignoraba el SHA explícito y aceptaba su ausencia.
- GREEN: 15/15 tests en `release-manifest-agent-loop.test.ts` + `release-manifest.test.ts`.
- ESLint focal: exit 0.
- Falta revalidarlo dentro de los gates completos.

Al detenerse existen **tres cambios sin commit** que hizo el subagente encargado de los fallos integrales:

- `src/features/orchestration/domain/commercial-truth-guard.ts`
- `tests/unit/orchestration/commercial-truth-guard.test.ts`
- `tests/integration/reconcile-orchestration.test.ts`

Preservarlos. No hacer reset ni checkout. El diff parcial:

1. Restringe `payment_options` al producto seleccionado cuyo precio total y moneda coinciden. La causa que intenta corregir es que los planes globales del workspace autorizaban como verdad comercial el precio de otro curso o de una oferta inexistente.
2. Agrega dos regresiones unitarias para oferta distinta/inexistente.
3. Hace inequívocamente antigua la lease de un fixture de reconciliación para que quede en el primer lote de una DB local reutilizada.

Estos cambios quedaron interrumpidos antes de commit y antes de recibir un resultado final del subagente. Deben revisarse y probarse; no asumir que están terminados.

## Trabajo cerrado antes de la detención

### Tasks 2.6/2.7

- Commit de implementación: `7d8ae09`.
- Revisión independiente final: `fe04bd7` — PASS spec/calidad, sin P0/P1/P2.
- Incluye kill switch independiente con precedencia absoluta, ruta V1 de catálogo y trigger de `updated_at`.

### Paridad del modelo

- Implementación: `76123c1` y correcciones `5fae17b`, `8158bf3`.
- Revisión independiente: `501c8b8` — PASS.
- Autoridad única: `deepseek-v4-flash`; el override divergente falla antes de fetch/commit.

### Evidencia de prompt

- Implementación final: `a4eaaec`.
- `lastPromptSha256` se actualiza sólo inmediatamente antes de un `model.generate` real.
- La traza guarda `model_request_prompt_sha256s` en orden.
- Deadline antes de todo request: `prompt_sha256:null` y cero requests.
- Deadline de reparación y excepción de proveedor conservan el SHA observado.
- El commit sólo acepta `null` para budget fallback con cero requests.
- Evidencia ejecutada por el autor: 77/77 focales, 28/28 integraciones del Agent Loop, 2975 unitarias completas, typechecks/lint.
- **Pendiente:** revisión independiente de `a4eaaec`. El subagente asignado fue interrumpido antes de entregar informe.

### Preparaciones comerciales (estado parcial)

- Implementación: `148b304`.
- Revisión independiente: `19f6b5e`.
- Task 2.14: PASS.
- Task 2.13: FAIL por tres P1 reproducibles. Informe completo:
  `.superpowers/sdd/2026-09-04-agent-a-agent-loop/task-2.13-2.14-independent-rereview.md`

Los tres P1 que aún requieren implementación TDD son:

1. **Aislamiento de memoria por workspace.** La preparación/supersession puede cruzar workspaces cuando el contacto global pertenece a más de uno. El workspace de origen debe viajar y ser verificado por preparación, job, worker y función SQL.
2. **Predecesor no durable.** `previous_memory_id` puede apuntar a una reserva previa no commiteada/no seleccionada. El commit debe fallar cerrado salvo que el predecesor sea durable y autorizado o forme parte de una dependencia seleccionada que pueda materializarse atómicamente. Cumplir además §3.10 sobre inactivar la memoria anterior dentro de la transacción de decisión, o demostrar una garantía equivalente estricta.
3. **Lead antes de delivery.** El lead queda reclamable como `pending` y puede enviarse a Sheets mientras el outbound sigue leased. Debe ser no reclamable hasta que la entrega esté aceptada/`submitted_to_botpress`, usando el mecanismo diferido existente.

El subagente recibió instrucciones para corregirlos, pero fue interrumpido antes de modificar archivos o entregar un commit.

### Naturalidad y Telegram anterior

- Evaluación: `e651c40` y `docs/reports/2026-09-05-agent-a-v21-naturalness-review.md`.
- Transcript de laboratorio aislado: 4.125/5.
- El Telegram real anterior falló: no propuso llamada por un rechazo durable del contacto reutilizado, no vinculó “un pago de 360”, no capturó un nombre invertido, falló catálogo ante “ninguno... fotografía” y terminó en silencio.
- Evidencia sanitizada: commit `d20d471`, archivo `docs/reports/evidence/2026-09-05-agent-a-v21-telegram-followup/transcript.md`.
- Esos fallos reales no quedaron revalidados en Botpress Cloud porque no hay presupuesto pago disponible.

## Gate integral pendiente

La suite de integración completa tuvo:

- 437 pass
- 1 skip
- 6 fallos, concentrados en `orchestration-lifecycle.test.ts` y `reconcile-orchestration.test.ts`

Los mismos fallos se reprodujeron sobre el base detached `501c8b8`, así que no provienen de `a4eaaec`, pero bloquean un gate integral honesto. El trabajo parcial sin commit descrito arriba intenta resolver al menos las causas observadas. Debe continuar el debugging sistemático y correr nuevamente toda la suite.

## Producción real al detenerse

No se desplegó ningún cambio en esta continuación.

- Vercel producción seguía en deployment `dpl_EgnjgaYTSMnjGGWzEnhCvikw7n3G`.
- `/api/health` exponía commit `767cad87d2105a6cb1e2fa3554439e5f565fb3c9`.
- Botpress STUDYX, bot `2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b`, seguía con deploy de `2026-09-04T23:19:31.766Z`, V21 y modelo `deepseek-v4-flash`.
- La producción sólo tiene las migraciones anteriores; las migraciones Agent Loop `20260905000001..00006` (y cualquier nueva necesaria para los P1) no se aplicaron.
- `runAgentTurnWithIntegrityV3` y `commitAgentTurnV3` aún no están conectados al workflow de producción. V3 permanece desactivado/no cableado. El deploy de esta rama debe presentarse como hotfix del workflow V21 activo más núcleo V3 inactivo, no como activación de V3.

Esto explica por qué el usuario probó y vio el comportamiento viejo: el candidato local nunca sustituyó el deployment de producción.

## Orden recomendado para continuar

1. Preservar y terminar los tres archivos dirty del debugging integral; ejecutar focales y commitear sólo si la causa raíz queda demostrada.
2. Implementar con TDD los tres P1 de Task 2.13; usar una migración nueva si cambia SQL, sin reescribir migraciones ya identificadas.
3. Conseguir revisión independiente para `a4eaaec`, para los P1 corregidos y para `6eaac0d`.
4. Correr gates frescos con claves de modelos eliminadas del entorno:
   - `npm run lint`
   - typecheck raíz, `agent-core` y `botpress-agent`
   - suite unitaria completa
   - suite de integración completa, secuencial, con `TEST_DATABASE_URL` y `DATABASE_URL` en `postgresql://postgres@127.0.0.1:55433/studyx_test`
   - aplicar todas las migraciones dos veces sobre la DB local
   - build de Next local con DB de test y valores dummy no secretos
   - `npx adk check --format json` y `npx adk build`
5. Ejecutar únicamente la prueba workflow determinista gratuita `tests/workflow/agent-a-deterministic-outcomes.test.ts`, contra el handler real, backend local y PostgreSQL. No ejecutar toda la suite workflow porque contiene casos pagos/live.
6. Calcular SHA-256 del bundle exacto `botpress-agent/.adk/bot/.botpress/dist/index.cjs`. Usarlo como `BOTPRESS_ARTIFACT_SHA256` al desplegar Vercel y comprobar que coincide con el bundle publicado.
7. Con gates verdes, aplicar primero dry-run y luego migraciones de producción con el pooler de Supabase del proyecto `eqspozrpzgzvtpowwprg`; no imprimir secretos y borrar el env temporal.
8. Crear un export limpio con `git archive HEAD`, agregar sólo `.vercel/project.json`, desplegar Vercel producción con metadata `studyxSourceSHA=<sha>`, `studyxBrain=v21`, `studyxCanonical=v9`, `actor=codex`, y variables `STUDYX_RELEASE_SHA`, `AGENT_A_PROMPT_TEMPLATE_SHA256` y `BOTPRESS_ARTIFACT_SHA256`.
9. Verificar `/api/health` y `/api/ready`. Evitar `/api/diagnostics` si puede disparar Gemini.
10. Construir, hacer preflight y publicar el bundle Botpress con `.eval/codex-20260904/deploy-supervised/botpress-code-only.mjs`; comprobar que preserva configuración, integraciones, plugins y secretos.
11. Registrar deployment IDs, hashes, migraciones, configuración preservada y transcript determinista en un informe final versionado.
12. Recién entonces pedir una única autorización de ampliación del tope, por ejemplo de USD 1.08 a USD 1.12, para una conversación normal real en Botpress Cloud/Telegram. Sin esa autorización, no ejecutar el canario pago.

## Estado de subagentes

Los tres subagentes quedaron interrumpidos al pedir el usuario que se detuviera:

- `measurement`: revisión independiente de `a4eaaec`, sin entrega final.
- `naturalness_final`: debugging de los seis fallos integrales; dejó los tres archivos dirty enumerados.
- `rubric_review`: implementación de los tres P1 de Task 2.13, sin entrega ni cambios visibles.

No hay una declaración de éxito ni un despliegue nuevo en este punto.
