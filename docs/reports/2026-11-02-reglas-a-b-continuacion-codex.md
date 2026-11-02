# Continuación Codex — reglas comerciales A/B (2026-11-02)

## Estado de partida

Continuación de la sesión de Claude en `orchestrator-mvp-closure`, rama `codex/studyx-bonus-staged-release`. Base encontrada: `fc5fccb`, que ya incluye las publicaciones de observabilidad 29f906c/fc5fccb. Al iniciar, había un conjunto de cambios locales de Codex/Claude sin commit. Este documento acompaña, no reemplaza, la decisión del dueño en `AGENTS.md` y los contratos en `docs/authority/`; esos documentos tienen autoridad.

## Plan autorizado original

1. Conservar y completar el PASO 0: permiso canary de bonus por teléfono internacional normalizado; contexto de curso, alias Ecommerce y validación `course_mentions` en el turno.
2. PASO 1: habilitar bonificaciones para todos los contactos del entorno en modo `direct`, máximo 3, sin depender de listas; conservar canary como alternativa; restaurar formato técnico `response.call_offer` en brain sin editar el prompt de Gabi; e informar cobertura de temarios sin cargar contenido.
3. PASO 2: Regla A reemplaza la regla 10. Disparador por segunda objeción de precio registrada con cita del cliente o confirmación explícita de precio como único freno. El backend elige el regalo desde tabla fija y ejecuta las reglas de la spec; una reescritura y después, si falla, reemplazo completo con textos fijos y 20 segundos entre dos burbujas. Escalera de hasta tres regalos y aceptación automática del paquete al avanzar a compra. Regla B invita a llamada en segunda o tercera respuesta cuando se cumplen condiciones; una reescritura y luego fallback en `response.call_offer`. Registrar por turno `model`, `rewrite`, `fixed` o `not_applicable`.
4. Verificar arreglos, checkout/link, llamadas, alta, postventa, memoria y ausencia de silencio; añadir dos golden con autoridad citada y reproducir la conversación real del dueño. Revisión de arquitectura antes de cerrar.
5. Commit por grupos (pasos 0–1, A, B, golden), push y despliegue sólo al Vercel personal autorizado y al Botpress STUDYX autorizado, verificando versiones/configuración.

## Progreso previo a esta continuación

- Claude reportó 5.063 unit tests aprobados, 17 omitidos, 7 todo. Esa corrida fue anterior a las verificaciones finales; repetirlas.
- Implementación local de contexto Ecommerce, negación, foco para `paid_mismatch`, regla técnica `call_offer` con brain v150, permisos de bonus por teléfono/config global, tabla y motor A/B, reparación y respaldos. Faltan la revisión final del architect, las golden nuevas, el replay final y las pruebas integrales.
- `docs/reports/2026-11-02-cobertura-temarios.md` informa 16/40 cursos del fixture local con temario oficial y 24 sin él. No representa el catálogo remoto ni se cargó contenido.
- No presentar la corrida anterior como verificación final.

## Alcance y límites

- Proyecto Vercel autorizado `prj_Ns9LbXPT6UF6yvKR0rUcrwJAsFYM` (`maneyraos-projects`, alias `studyx-agente-ventas.vercel.app`); Botpress bot `0d7c9ecb-4781-4c65-913d-f7e947fa14d4`, workspace `wkspace_01M4XEBZNC10HX2KDHKY36T6R0` (Vertice), perfil `studyx-detmaneyro`. No usar otros proyectos/bots ni producción de Lucas/De Fazio.
- Variables objetivo de bonificación: `CENTRAL_CARGA_BONUS_ENABLED`, `COURSE_BONUS_FLOW_MODE`, `COURSE_BONUS_MAX_COURSES`; valores deseados constan en `AGENTS.md`. Configuración de handoff incluye además variable de pausa y listas canary. No incluir valores secretos en informes.
- No modificar `docs/authority/`; no agregar resultados históricos al commit (`git add -A` prohibido); nunca imprimir credenciales. Botpress debe publicarse con el script code-preserving, tras verificar IDs/perfil, snapshot de dependencias y preflight; revisar configuración/integraciones/plugins tras publicar. No ejecutar `adk deploy` a ciegas.
- Golden nuevas requieren proveedor DeepSeek con presupuesto acumulado y artefactos de resultado con nombres nuevos; no sobrescribir corridas históricas.

## Checklist pendiente

- [ ] Resolver hallazgos materiales del architect antes de runtime edits; pedir review final de arquitectura.
- [ ] Auditar tabla `rule_bonus`, evidencia de objeciones/price-only, conteo de llamadas, exclusiones y flujo de reescritura/fallback/aceptación.
- [ ] Unit, integración local, typecheck, lint, build y ADK check; mantener base local aislada.
- [ ] Añadir/correr golden requeridas: presupuesto/marketing → Ecommerce → escalera; y pedido explícito de promoción, ambas citando autoridad y con criterio formal existente.
- [ ] Replay de `.local-evidence/diagnostics/2026-11-02-conversacion-dueno/` con backend/DB locales; describir límites del registro original.
- [ ] Regresiones de checkout/link con/sin paquete, llamadas, alta pagado+bonificados, postventa, memoria, opt-out y sin silencio.
- [ ] Verificar alcance por nombre al preparar commits; excluir `evals/golden/results/**` históricos; commits separados y push de rama.
- [ ] Inspeccionar variables de Vercel sin descifrar; configurar sólo variables autorizadas en el proyecto exacto.
- [ ] Desplegar/verificar backend personal y Botpress STUDYX: SHA backend, SHA base Botpress, instrumentación/hash bundle, brain/prompt, deployment, health/readiness, config preservada, integraciones/plugins y logs. No reintentar una publicación ambigua sin reconciliar su estado.
- [ ] Publicar tabla aprobado/fallido con evidencia y límites.

## Snapshot privado heredado

Antes de continuar se guardó una copia privada e ignorada por Git en `.local-evidence/codex-continuation-2026-11-02/`: diff de cambios heredados y manifiesto de rutas/tamaños/SHA-256. Excluye `.env*`, resultados históricos golden y evidencia histórica. Sólo es un respaldo local; **nunca agregar ni commitear esa carpeta**.

## Revisión arquitectónica y chequeo de preparación (solo lectura)

Los hallazgos arquitectónicos compartidos con esta continuación se deben comprobar otra vez contra el código final antes de cerrar: (1) `may_offer_bonus=false` podía rechazar `offer_course_bonus` en la autorización previa a commit; la integración local ahora incluye `rule_bonus` y el camino de regla en `processInboundTurn.ts`; (2) el reparador previo tenía dos intentos y la reserva backend tres, así que se debía preservar un intento para la reescritura A/B; (3) la oferta en varias burbujas debía conservar idempotencia de replay exacto por parte; (4) `interBubbleDelayMs` era una deduplicación/hash y no una pausa real, así que la espera de 20 s necesitaba un mecanismo explícito. El trabajo local reporta plumbing de partes y pausa; esta nota no sustituye la revisión final del architect ni pruebas del runtime.

Preparación comprobada el 2026-11-02, sin build ni mutación remota:

- `.vercel/project.json` existe y sus `projectId` y `orgId` corresponden al proyecto personal autorizado y al team scope autorizado. `.vercel/repo.json` no existe. El remoto Git es GitHub, sin credencial embebida en la URL.
- Vercel API de solo lectura por CLI funcionó con scope `maneyraos-projects`, ID de proyecto explícito y `decrypt=false`; metadata de variables confirma las cuatro de bonificación ya existen en Production, junto con la lista canary de contactos. No se leyó ningún valor. La variable canary por teléfono no estaba en el inventario del proyecto previamente revisado y se debe crear vacía.
- La llamada `vercel whoami` local sin escalación no pudo autenticarse/completar. El acceso de lectura del API requirió red autorizada por el sandbox. La mutación `env add` y el deploy todavía no se probaron; antes de usarlos, comprobar que la misma identidad CLI tiene permiso sobre el proyecto exacto. No interpretar una lectura exitosa como permiso de escritura.
- Botpress ADK local es 2.0.8 y `adk profiles list` confirma `studyx-detmaneyro`. El publicador exige `STUDYX_BOTPRESS_PROFILE` explícito; el archivo de credenciales sólo se inspeccionó por presencia/nombres. `.eval/.env.local` contiene el nombre `DEEPSEEK_API_KEY`, sin imprimirlo. No hay `ORCHESTRATOR_API_KEY` ni `STUDYX_SIGNING_SECRET` en ese archivo; no se leen credenciales de los `.env.local`.
- La skill local `deploy-to-vercel` recomienda Preview por defecto; para este caso los recursos y alias Production del proyecto personal están autorizados explícitamente por el dueño y `AGENTS.md`. Aplicar Production sólo tras terminar gates, con IDs exactos. Preparar desde `git archive` del commit final y agregar únicamente `.vercel/project.json` al export temporal para excluir los resultados no seguidos y evidencia local; nunca usar `--archive`.

Comandos propuestos para la fase de publicación (no ejecutados):

```bash
SCOPE=maneyraos-projects
PROJECT=prj_Ns9LbXPT6UF6yvKR0rUcrwJAsFYM

# Solo después de la aprobación de todos los gates; overwrite limitado a Production.
vercel env add CENTRAL_CARGA_BONUS_ENABLED --environment production --project "$PROJECT" --scope "$SCOPE" --type config --value true --force --yes
vercel env add COURSE_BONUS_FLOW_MODE --environment production --project "$PROJECT" --scope "$SCOPE" --type config --value direct --force --yes
vercel env add COURSE_BONUS_MAX_COURSES --environment production --project "$PROJECT" --scope "$SCOPE" --type config --value 3 --force --yes
vercel env add CENTRAL_CARGA_BONUS_FULFILLMENT_PAUSED --environment production --project "$PROJECT" --scope "$SCOPE" --type config --value false --force --yes
vercel env add CENTRAL_CARGA_BONUS_CANARY_PHONE_E164S --environment production --project "$PROJECT" --scope "$SCOPE" --type config --value '' --force --yes
vercel env add CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS --environment production --project "$PROJECT" --scope "$SCOPE" --type config --value '' --force --yes

# En botpress-agent, al completar gates. Primero sin --publish: preflight remoto/build local.
STUDYX_BOTPRESS_PROFILE=studyx-detmaneyro \
STUDYX_RELEASE_EVIDENCE_DIR=/ABSOLUTE/PATH/.local-evidence/studyx-release \
node ../scripts/publish-botpress-code-preserving-connections.mjs
# Sólo con preflight verde y tras registrar su evidencia:
STUDYX_BOTPRESS_PROFILE=studyx-detmaneyro \
STUDYX_RELEASE_EVIDENCE_DIR=/ABSOLUTE/PATH/.local-evidence/studyx-release-published \
node ../scripts/publish-botpress-code-preserving-connections.mjs --publish

# Backend: export temporal limpio desde el commit final, luego Vercel deploy Production
# al project ID exacto; inspeccionar deployment/alias/health/readiness y SHA.
git archive "$FINAL_SHA" | tar -x -C "$PRIVATE_EXPORT"
mkdir -p "$PRIVATE_EXPORT/.vercel"
cp .vercel/project.json "$PRIVATE_EXPORT/.vercel/project.json"
vercel deploy "$PRIVATE_EXPORT" --prod --project "$PROJECT" --scope "$SCOPE" --yes --no-wait
```

Antes del build final se debe comprobar si el despliegue por CLI usa `VERCEL_GIT_COMMIT_SHA`; el backend admite `STUDYX_RELEASE_SHA` como override en health y evidencia. Registrar SHA final de fuente, hash SHA-256 del bundle ADK publicado, brain y prompt; el manifiesto de `node scripts/generate-release-manifest.mjs` requiere un digest real en `BOTPRESS_ARTIFACT_SHA256`, evidencia de prompt y presencia de configuración completa. El generador emite presencia booleana de configuración, no sus valores. Se deben validar esos insumos al preparar la publicación; este borrador no afirma que el manifiesto final esté generado.

## Estado de cierre al actualizar esta nota

La worker está incorporando/verificando los hallazgos runtime y golden; todavía no se ejecutaron aquí pruebas, builds, publicación de variables, despliegue Vercel ni publicación Botpress. El chequeo de preparación encontró que el proyecto/identidad remota debe seguir explicitado por ID y scope, y que la CLI `whoami` sin red autorizada no demuestra disponibilidad de escritura. El gate de la fase siguiente sigue siendo la revisión arquitectónica y de verificación integral del agente principal. Esta nota recoge únicamente el plan de publicación y hechos inspeccionados sin secretos.

## Preflight ADK de esta continuación (2026-11-02 13:34 UTC)

Se ejecutó el publicador existente **sin `--publish`**, con Bun, perfil explícito `studyx-detmaneyro` y evidencia privada nueva `.local-evidence/2026-11-02-codex-rules-preflight-b/`. La ejecución en sandbox devolvió un error API antes de recuperar el bot; el reintento de lectura con red autorizada terminó correctamente. Ninguna llamada `updateBot` se ejecuta en el modo usado.

Resultado: destino STUDYX `0d7c9ecb-4781-4c65-913d-f7e947fa14d4`, workspace autorizado `wkspace_01M4XEBZNC10HX2KDHKY36T6R0`, ADK 2.0.8; se refrescaron desde Cloud los snapshots locales **generados**, sin editarlos manualmente. Después, ADK build de producción **aprobó**. Preflight confirmó 15 integraciones, 2 plugins, contratos iguales, cero parches aditivos y modo `code-only`; `publish=false`. El refresco resolvió el error previo de interfaces desconocidas de los snapshots locales.

Bundle del dry-run: `992a1a9fcb5ac731ba98565ead0e85fe79b631a9261cc657e70c56aeb5eebb07`. **No es el artefacto de release final ni una publicación:** se construyó desde el worktree aún sin commit y sin la instrumentación final. La API no expone el código remoto (`remoteCodeEvidence.status=unavailable`), por lo que no se afirma comparación de hash con el bot publicado. `source-state.json` guarda los hashes de las cuatro fuentes relevantes al momento de este preflight para correlacionar cambios posteriores; los snapshots privados de Cloud no deben agregarse a Git.

Corrección de los comandos propuestos arriba: el script de publicación se ejecuta con **`bun ../scripts/publish-botpress-code-preserving-connections.mjs`**, como indica su cabecera y el SDK instalado. El preflight se debe repetir en el export del SHA final instrumentado antes de publicar.


## Delta runtime de Codex sobre lo heredado (2026-11-02 13:38 UTC)

El diff heredado de Claude/Codex se conservó. Esta continuación no modificó los documentos en `docs/authority/`, no alteró precios ni agregó reglas comerciales. Los permisos por teléfono/global, contexto Ecommerce, tabla fija y aceptación automática implementados antes de esta sesión siguen en el conjunto; los ajustes siguientes cierran los hallazgos de integración de ese conjunto.

| Hallazgo material revisado | Corrección de esta continuación | Evidencia local |
|---|---|---|
| B no podía redactar una invitación: `conversation_only` obligaba `call_offer=null` | `agent-a-action-feedback.ts` habilita sólo el campo de invitación para el rechazo `CALL_OFFER_REQUIRED`, con permiso vigente; DeepSeek recibe ese permiso explícito en su esquema. Las acciones físicas siguen limitadas a la lista autorizada, normalmente `none`. | Prueba de la solicitud HTTP/esquema real y prueba del bounded continuation; una acción `request_call_now` sigue rechazada. |
| A podía ofrecer un regalo durante checkout si el borrador ya lo proponía | Guard compartido en policy y revalidación bajo lock en `direct-course-bonus-service.ts`; no impide aceptar un paquete previamente entregado al comprar. La invitación proactiva tampoco se entrega durante checkout. Los ciclos nuevos usan el estado efectivo, conservando reapertura comercial legítima. | Seis fronteras transaccionales de checkout; pruebas unitarias de policy con capabilities permisivas y regresiones existentes de ciclo nuevo. |
| Una validación fallida del primer borrador podía saltar el respaldo; la reescritura podía borrar su evidencia | El workflow usa `resolveDeterministicRulesTurnV1`, una función compartida y probada con el resolver real. Valida el primer borrador, permite una reescritura conjunta y valida el respaldo. Conserva sólo la evidencia literal inicial pertinente de precio. Un respaldo rechazado no se registra como éxito. | Tests de primer borrador con efecto presente pero hecho inválido, timeout de reescritura, pérdida de memoria y fallo de persistencia de evidencia. |
| Pausa de 20 s no sobrevivía a la reanudación | El backend persiste `rule_a_minimum_delay_before_ms` en la segunda parte del respaldo autorizado y lo devuelve en `outbounds`. En replay deriva `not_before` desde `submitted_at` de la primera parte. Botpress usa `step.sleep` durable y vuelve a pedir autorización antes de enviar; no reenvía partes ya presentadas. | Commit real, metadata y replay conservan IDs y una sola bonificación; hot-path prueba 20 s iniciales y espera restante de 7 s tras reanudación. |
| La pista de precio se registraba después de generar, sin llegar al modelo | El brain incluye `<price_expression_hint>` antes de la generación. Sólo es diagnóstico: nunca concede una bonificación. | Prueba del prompt para afirmación, pregunta y negación; el permiso de bonus no se altera. |
| A y B se excluían sin autorización del dueño | Se quitó la frase heredada de `AGENTS.md` y el veto de `decideCallRuleV1`. A y B pueden cumplirse juntas con una sola reescritura; cada regla tiene resultado independiente. El prompt de B conserva la acción de A cuando ambas aplican. | Casos de segunda respuesta + segunda objeción y segunda respuesta + precio como único freno; prompt combinado sin contradicción `offer_course_bonus`/`none`. |

Dos bordes adicionales del review se cerraron: (a) no se conserva un `call_offer` rechazado por ser no vacío; por ejemplo «Te llamo ahora» sin acción ejecutada se sustituye por el respaldo de B después de fallar la reescritura; (b) las citas literales multioración/multilínea se comprueban contra el mensaje completo. La segmentación se usa sólo como veto para preguntas y negaciones, incluyendo citas parciales como `caro` dentro de «es caro?» o «no es caro»; ninguna regex positiva autoriza el regalo. La misma exclusión se aplica al commit de memorias actuales y a la lectura de hechos ya comprometidos. La interpretación restante continúa siendo del modelo.

Para conservar el target ES2022 de Botpress se reemplazaron dos `findLast` preexistentes en `course-focus.ts` y `catalog-resolution.ts` por copia/inversión/búsqueda equivalente, sin mutar arrays ni cambiar su selección. El typecheck del backend y del bot ya los acepta.

Archivos principales del delta de esta fase (además del conjunto heredado): `src/shared/conversation/deterministic-sales-rules.ts`, `botpress-agent/src/lib/conversation/deterministic-rules-turn.ts`, `agent-a-action-feedback.ts`, `agent-a-brain.ts`, `processInboundTurn.ts`, `botpress-agent/src/prompts/agent-a-brain-v1.ts`, `botpress-agent/src/schemas/contracts.ts`, `agent-turn-policy-v2.ts`, `prepare-agent-turn-v2.ts`, `read-negotiation-facts.ts`, `read-course-bonus-ladder.ts`, `direct-course-bonus-service.ts`, `decision.service.ts`, y los dos dominios de compatibilidad ES2022 citados arriba.

Pruebas nuevas/ampliadas por esta fase:

- `tests/unit/botpress/deterministic-rules-turn.test.ts`: orquestación usada por el workflow, resolver real y caminos de reescritura/respaldo A+B.
- `tests/unit/botpress/agent-a-action-feedback.test.ts` y `agent-a-brain.test.ts`: invitación B redactable en el esquema de proveedor y acciones físicas cercadas.
- `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`: timing durable inicial y replay con primera parte ya enviada.
- `tests/unit/botpress/agent-a-brain-prompt.test.ts`: hint diagnóstico antes de generar y reparación A+B coherente.
- `tests/unit/conversation/deterministic-sales-rules.test.ts` y `agent-turn-policy-v2.test.ts`: exclusiones negativas/preguntas, citas completas, simultaneidad y checkout.
- `tests/integration/deterministic-sales-rules-runtime.test.ts`: **16 pruebas reales de DB/commit**, incluyendo paquete `offered` ENTREGADO → `send_payment_link` sin `accept_promotion` → aceptación/attachment + snapshot exacto, para selección persistida y para interés durable sin selección. Replays mantienen IDs y un solo pago. El fixture asegura que el nuevo inbound ocurra después de `delivered_at`; no se debilita la condición de respuesta posterior de la spec.

Verificación de esta fase:

| Comando | Resultado |
|---|---|
| `npx vitest run --config vitest.config.mts tests/unit/botpress/agent-a-brain.test.ts tests/unit/botpress/deterministic-rules-turn.test.ts tests/unit/conversation/deterministic-sales-rules.test.ts tests/unit/conversation/agent-turn-policy-v2.test.ts` | **349 passed**, 4 archivos, corrida final 13:38:22 UTC. |
| Selección previa de helper, feedback, prompt, negativos, hot-path y observaciones | **276 passed**, 6 archivos; y selección posterior de prepare/policy/prompt/helper **332 passed**. Son conjuntos superpuestos, no se deben sumar. |
| `TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55434/studyx_test npx vitest run --config vitest.integration.config.mts tests/integration/deterministic-sales-rules-runtime.test.ts` | **16 passed**, corrida final 13:36:25 UTC; sólo DB local, sin enviar mensajes ni pagos externos. |
| `npm run typecheck` | **Aprobado** en esta fase; verificación general repite sobre el conjunto final. |
| `git diff --check` | **Aprobado**. |

Los logs de esta fase están sólo en `.local-evidence/codex-continuation-2026-11-02/runtime-*.log` (privados/ignorados). El primer intento de integración sin red fue bloqueado por `EPERM` de sandbox; el reintento autorizado contra loopback ejecutó realmente las pruebas. Hubo fallos intermedios de fixtures/tipos/orden temporal corregidos; no se presentan como éxito final. No se eliminaron ni sobrescribieron resultados históricos.

Este cierre corresponde **sólo a la implementación y validación local del runtime**. Continúan pendientes aquí los resultados generales del agente verificador, el dictamen final del architect, los commits por bloques, golden contra DeepSeek real/replay, push y despliegue final. El evento `deterministic_rules` describe la resolución de la propuesta previa a commit; cualquier afirmación de ejecución debe contrastarse con el receipt final y los ledgers de oferta/pago/entrega, nunca inferirse sólo de ese evento.


## Corrección de hallazgos del golden real sobre `0fa6bce` (2026-11-02 14:01 UTC)

La campaña real suplementaria 17/18, guardada con stem nuevo `owner-rules-0fa6bce-20261102T134433Z`, expuso dos brechas concretas de implementación del plan original. No se ocultó ni sobrescribió esa corrida. El architect aprobó el alcance mínimo de estas correcciones antes de editarlas; el criterio formal de aceptación y los documentos de autoridad permanecen intactos.

1. **Hechos del curso nombrado ahora, aunque no estuviera en el menú anterior.** En el turno real `ecommerce_facts_now`, el cliente dijo «Ecommerce me gusta. Cuánto es el total y cuántas clases son?», pero el agente había nombrado únicamente otros cursos. El proyector heredado sólo recuperaba términos de cursos cuyo nombre completo figurara en la respuesta previa. Además, el catálogo oficial no configura `ecommerce` como alias: está en el código `introduccion_ecommerce` y en el nombre «Introducción al Ecommerce». Por eso no se cargaron sus 8 clases en ese turno.

   `currentFactualCourseReferencesV1` ahora contrasta referencias positivas explícitas con el índice **completo de cursos activos**: nombre canónico, alias configurado, código o un término inequívoco común a código y nombre. Los términos genéricos de curso/área no resuelven esa referencia. Los alias homónimos y términos ambiguos no se convierten en una identidad única; se conservan las exclusiones negativas, varios cursos y el orden en que los nombró el cliente. Un índice ausente o truncado falla cerrado. La compatibilidad con referencias a opciones previamente nombradas continúa separada.

   La referencia nueva usa la procedencia real `current_customer_named_course`, admitida en el esquema y trasladada al contexto de Botpress. `prior_agent_named_candidate` sólo se afirma cuando el nombre del curso sí figura en la respuesta anterior. El backend y Botpress usan el mismo proyector. Tanto `no_catalog_intent` como un `not_found` técnico pueden recuperar esos hechos inequívocos; esto no modifica el resolver de selección ni persiste un curso comprado. Para `not_found` con hechos recuperados, la instrucción técnica aclara que el nombre está respaldado y no debe declararse inexistente por el resultado del resolver de selección. El foco de validación de menciones usa esa misma referencia sin conceder pagos o bonificaciones.

   Se corrigió en su misma línea de `AGENTS.md` la restricción heredada a cursos «que el agente acaba de nombrar», que no estaba en el PASO 1b solicitado. Las reglas y citas de autoridad no se reordenaron.

2. **Recapitulación completa de las identidades del paquete al escalar.** La campaña real mostró una segunda oferta que omitía el regalo anterior y una tercera que omitía dos regalos ya entregados. El predicado heredado `draftPresentsBonusV1` sólo exigía la acción y el nombre del nuevo regalo; por tanto esas respuestas se registraban como `model` sin pasar por la reescritura.

   En una escalada, ahora se comprueban únicamente identidades factuales del paquete que ya fijó el backend: nombre del curso pago, **todos** los bonificados previamente entregados y el nuevo. Menciones obviamente negadas/excluidas no satisfacen esa identidad; números de curso distintos no se confunden. No se puntúa persuasión, tono ni calidad de cierre. La primera oferta conserva su requisito anterior. Si falta una identidad, se usa la misma **única reescritura conjunta A/B**; la directiva enumera explícitamente todos los nombres anteriores, el curso pago y el nuevo, manteniendo precio y cierre según la decisión autorizada. Si vuelve a fallar, se usa el respaldo completo de recapitulación ya autorizado. No se añadió una generación ni una acción.

Archivos de runtime de este delta: `src/features/orchestration/domain/course-focus.ts`, `src/features/orchestration/application/claim-batch.ts`, `botpress-agent/src/lib/conversation/agent-a-context.ts`, `botpress-agent/src/schemas/agent-a-brain.ts`, `src/shared/conversation/deterministic-sales-rules.ts` y `botpress-agent/src/prompts/agent-a-brain-v1.ts`; además de la aclaración factual de `AGENTS.md`.

**Prueba focalizada:** `npx vitest run --config vitest.config.mts tests/unit/conversation/deterministic-sales-rules.test.ts tests/unit/botpress/deterministic-rules-turn.test.ts tests/unit/botpress/agent-a-brain-prompt.test.ts tests/unit/orchestration/course-focus.test.ts tests/unit/orchestration/claim-batch.test.ts` → **267 passed**, 5 archivos, 14:00:55 UTC. Antes de la corrección, las pruebas añadidas del caso sin menú previo reprodujeron **9 fallos reales**. La selección final incluye claim → contexto del modelo con 8 clases, `Quiero estudiar Ecommerce` con `not_found` técnico y mención validada, conservación de una selección distinta y permisos de pago, alias homónimos/negaciones/múltiples cursos, y escaladas 2/3 que pasan por el resolver real, una reescritura y el respaldo con todas las identidades. Los logs nuevos están en `.local-evidence/codex-continuation-2026-11-02/runtime-*livefix*` y `runtime-real-golden-*`.

**Estado de esta fase al escribir:** implementación local estable, verificación general y review del delta en curso. La campaña real 17/18 debe ejecutarse otra vez desde un nuevo SHA candidato y con artefactos nuevos; esta prueba local no reemplaza DeepSeek real. No se hizo push ni despliegue de este delta y no se modificaron archivos de `evals/golden/` desde esta worker.


### Cierre de dos bordes adicionales del review de ese delta (2026-11-02 14:15 UTC)

- **Negación de un nombre completo:** el architect reprodujo «no quiero estudiar Introducción al Ecommerce». El match completo estaba negado, pero su submatch `ecommerce` podía escapar a la ventana prefija. El veto del match explícito negado ahora se propaga únicamente a sus subrangos del mismo curso y cláusula, también en la compatibilidad del menú previo. No se veta globalmente el curso ni se borra una referencia positiva independiente. Se añadieron regresiones con/sin menú previo y con Community Manager positivo en la misma intervención. `course-focus.test.ts` + `claim-batch.test.ts`: **146 passed** (14:03:35 UTC).

- **Todo candidato final atraviesa las reglas, también después de reparar un rechazo del backend:** el camino de reparación backend y la reparación genérica podían introducir evidencia nueva de objeción y una oferta incompleta después de la primera evaluación A/B. Ahora el wrapper común `commitDecision.execute` llama a `finalizeDeterministicRulesCandidateV1` antes de registrar/enviar cualquier propuesta plannerless al commit, incluidos reparación backend, continuación final y recuperación de conversación. No expone una función generadora: si la reescritura ya ocurrió, sólo valida o aplica el respaldo completo autorizado. Una reparación genérica de un turno inicialmente sin reglas vuelve a evaluar su propuesta efectiva con `repair_enabled=false` cuando introduce A/B. Las operaciones cercadas y los efectos no reautorizados por el recibo actual permanecen cercados; una invitación no elude un presupuesto rechazado por el backend.

  La trazabilidad del candidato se conserva por identidad de propuesta: un respaldo `fixed` ya validado no se vuelve a etiquetar como `model`; una propuesta completa introducida por reparación se registra como `rewrite`. Cada commit plannerless emite un evento `deterministic_rules` con `phase=final_candidate`, inmediatamente antes de su `commit_proposed` y posterior recibo/rechazo. Los evaluadores deben correlacionar este último registro con el recibo y ledger finales, no tomar la primera evaluación de un borrador anterior.

  La prueba del resolver real cubre una reparación genérica que introduce el disparador con propuesta completa e incompleta: una sola llamada de reparación, sin generación adicional. El hot-path real del workflow cubre el rechazo backend seguido de una propuesta completa/incompleta, con **dos** requests al proveedor en total: el último registro es `rewrite` o `fixed`, respectivamente, y el payload de commit contiene el paquete completo. También se verifica que la revalidación de un respaldo conserve `fixed`. Ambos archivos (`deterministic-rules-turn.test.ts` y `process-inbound-turn-hot-path.test.ts`) aprobaron **161 tests** a las 14:14:19 UTC.

`npm run typecheck`, ESLint sobre los dominios y pruebas afectados, y `git diff --check` aprobaron después de estos cambios. El ESLint raíz excluye por configuración los archivos runtime de `botpress-agent`; esos archivos no se presentan como lintados por esa configuración y sí pasan TypeScript. Continúa pendiente el review final de este delta, la verificación general coordinada y la nueva campaña DeepSeek real desde el siguiente SHA; aún no se hizo push ni despliegue de estas correcciones.


### Última condición factual de interés para B (2026-11-02 14:22 UTC)

El architect reprodujo que tres opciones de navegación genérica podían contarse como interés expresado del cliente. Se corrigió **una sola línea lógica** en `ruleContextFromAgentAContextV1`: la presencia de candidatos sólo cuenta cuando alguno lleva una `reference` positiva del mensaje actual, no por el mero tamaño del menú. Se mantienen sin cambios selección persistida, resolución exacta/ambigua y memorias `study_goal`. Las tres regresiones distinguen NAV3 sin referencia (no invita), referencia literal actual (sí) y referencia actual a un curso nombrado previamente (sí). Helper + hot-path: **164/164 passed** (14:21:26 UTC); typecheck raíz/Botpress, ESLint de la prueba y diff-check aprobados. No se repitieron suites completas por esta línea: el verificador conserva el resultado completo previo y combina esta selección posterior con su evidencia. Sin APIs externas ni cambios de autoridad.
