# Release de Agente A (Emma): bot Botpress + backend Vercel

Runbook para que cualquier agente (Codex o Claude) publique un cambio de Agente A
sin pasos implícitos. Probado de punta a punta el 2026-11-11 con `d554958`
(brain v210, canonical v121).

## Estado al 2026-11-11 15:21Z

| Pieza | Valor |
|---|---|
| Rama | `claude/agent-a-two-pass-clean` (remoto `personal`), worktree `.worktrees/agent-a-natural-sales-midpoint` |
| Código en producción | `d5549583eb4140b66e56484efbc1aa0e209ac72a` |
| Pin de release | `BOT_RELEASE_BASE_SHA=027a89eba06c92e302c689e79288fdb00ec46456`, brain `studyx-agent-a-brain-v210`, prompt `studyx-agent-a-canonical-v121` |
| Bot origen/rollback | «StudyX Pruebas» `15050253-3088-47a4-940d-dc849c03860c`, perfil ADK `default`, bundle `87fa45a5…` publicado 16:22:20Z; sigue activo hasta el corte único |
| Bot destino | «Asesor de admisiones Studyx» `e0f6be70-db0e-48e0-a9b7-f7864b6699d1`, workspace compartido `wkspace_01M75G5S9RYXD656HZ6J4SAHYQ`, perfil ADK `studyx-admissions` |
| Backend | Vercel `studyx-agente-ventas` (scope `maneyraos-projects`), `dpl_3o3hgThvnRpGf5tpU5JTUj7v6HAU`, health → commit `d554958` |
| Contacto de prueba del dueño | +5491169004497, contacto `6726e652-e8dd-4bab-b77e-e286c41b5489`, `ready_for_first_inbound` (reset `01336faf`) |

## Reglas que no se negocian

- `DATABASE_URL` de `.env.local` es **la base de PRODUCCIÓN**. Tests locales sólo
  contra el cluster desechable (ver `AGENTS.md`). Nunca `psql "$DATABASE_URL" -f …`.
- Desplegar sólo con orden explícita del dueño en la misma conversación.
- `botpress-agent/agent.config.ts` puede tener un cambio local ajeno (nombre
  `calm-ostrich` y reformateo, lo deja `adk`). **Nunca lo commitees ni lo publiques.**
  Por eso el release se arma desde un worktree limpio (paso 2).
- La CLI de Botpress imprime el PAT en errores: no vuelques sus logs; filtrá
  `bp_pat_[A-Za-z0-9]+`.
- Orden: primero el bot, después el backend.
- El destino único de próximos releases es «Asesor de admisiones Studyx». «StudyX
  Pruebas» se conserva apagado como rollback y nunca se elimina.
- Durante la preparación del destino, WhatsApp, `automationEnabled` y
  `whatsappPublicEnabled` deben permanecer apagados. El modo
  `STUDYX_BOTPRESS_RELEASE_MODE=preparation` permite publicar sólo si la
  integración ya está registrada y el bot/teléfono coinciden exactamente.
- Después del corte, los releases normales usan
  `STUDYX_BOTPRESS_RELEASE_MODE=live`; ese modo exige que WhatsApp y el tráfico
  público estén habilitados.

## 1. Cambio de código → commit → re-pin

1. Commit del cambio. Si cambia el comportamiento del cerebro, subí
   `AGENT_A_BRAIN_PROMPT_VERSION` en `botpress-agent/src/prompts/agent-a-brain-v1.ts`
   y los tests que fijan la versión (`grep -rn "brain-v210"`).
   Si cambia `docs/prompts/studyx-agent-a-canonical.md`: **no agregues ni quites
   líneas** (los golden citan números de línea), aplicá la misma edición en
   `docs/authority/prompt-agente-a-studyx-v2.md`, subí la versión y el
   `expectedSha256` en `scripts/generate-agent-a-prompt-module.mjs` y corré
   `node scripts/generate-agent-a-prompt-module.mjs`.
2. Verificá: `npx tsc --noEmit -p .`, `npx tsc --noEmit -p botpress-agent`,
   `npx vitest run tests/unit` (hoy: 5454 pasan).
3. Re-pin en un commit aparte (`chore(release): pin …`), como `962c689`/`d554958`:
   en `scripts/lib/botpress-release-provenance.mjs` poné `BOT_RELEASE_BASE_SHA` =
   SHA completo del commit de código, las versiones brain/prompt, y recalculá
   `REVIEWED_SOURCE_HASHES` (sha256 de los bytes) sólo si cambió algún
   `BOT_RELEASE_SOURCE_PATHS`. Actualizá las versiones en `tests/unit/scripts/*`.
   Después del base sólo pueden cambiar docs/evals/tests/tooling permitido
   (`assertOnlyNonCodeChangesSinceBaseV1`).
4. `git push personal claude/agent-a-two-pass-clean`.

## 2. Worktree limpio del release

```bash
WT="/Users/tmaneyro22/Documents/AGENTE IA/studyx-agente-ventas/.worktrees/agent-a-natural-sales-midpoint"
HEADSHA=$(git -C "$WT" rev-parse HEAD)
BASE=<BOT_RELEASE_BASE_SHA>
R=/private/tmp/studyx-release-$(date +%Y%m%d)-${HEADSHA:0:7}
mkdir -p $R && git -C "$WT" worktree add --detach $R/repo $HEADSHA
ln -s "$WT/node_modules" $R/repo/node_modules
git -C $R/repo status --porcelain   # debe salir vacío
```

## 3. Publicar el bot

```bash
cd $R/repo && node scripts/prepare-instrumented-botpress-release.mjs prepare --base-sha $BASE --output $R/source
cd $R/source && npm ci > $R/npm-root.log 2>&1
cd $R/source/botpress-agent && npm ci > $R/npm-bot.log 2>&1
# preflight de sólo lectura (con bun: con node falla «__require is not a function»)
STUDYX_BOTPRESS_PROFILE=studyx-admissions STUDYX_BOTPRESS_RELEASE_MODE=preparation \
  STUDYX_RELEASE_EVIDENCE_DIR=$R/evidence-readonly \
  bun ../scripts/publish-botpress-code-preserving-connections.mjs > $R/readonly.log 2>&1; echo exit=$?
# publicar
STUDYX_BOTPRESS_PROFILE=studyx-admissions STUDYX_BOTPRESS_RELEASE_MODE=preparation \
  STUDYX_RELEASE_EVIDENCE_DIR=$R/evidence-publish \
  bun ../scripts/publish-botpress-code-preserving-connections.mjs --publish > $R/publish.log 2>&1; echo exit=$?
```

Esperado: `prepared:true`; preflight exit 0 con botId `e0f6be70…`, nombre
«Asesor de admisiones Studyx», `releaseMode: preparation`, `contractsMatch:true`,
`publicationMode: code-only`; publish exit 0 y
`deployedAt` nuevo en `$R/evidence-publish/publication.json`. La Mac tiene que
estar enchufada (un ECONNRESET por suspensión ya tiró un preflight).

Una vez completado y verificado el corte de WhatsApp, reemplazar
`preparation` por `live` en releases posteriores. No habilitar el origen y el
destino al mismo tiempo.

## 4. Desplegar el backend

Los PDF de programas y las imágenes **no están en git**. Sin este paso el build
falla con `COURSE_MATERIAL STAGING_FAILED:MISSING:…` (pasó el 2026-11-11).

```bash
cd $R/repo
STUDYX_PROGRAMS_SOURCE_DIR="/Users/tmaneyro22/Documents/AGENTE IA/programas-studyx" \
STUDYX_MATERIAL_IMAGES_DIR="/Users/tmaneyro22/Documents/AGENTE IA/studyx-material-whatsapp/imagenes" \
  node scripts/stage-course-programs.mjs $R/repo      # esperado: 28 programas, 114/114
mkdir -p .vercel && cp /private/tmp/studyx-release-20261111-d554958/repo/.vercel/project.json .vercel/
vercel deploy --prod --yes --scope maneyraos-projects \
  --env STUDYX_RELEASE_SHA=$HEADSHA --build-env STUDYX_RELEASE_SHA=$HEADSHA > $R/vercel.log 2>&1; echo DEPLOY=$?
curl -s https://studyx-agente-ventas.vercel.app/api/health   # "commit" debe ser $HEADSHA
```

`.vercel/project.json` = `{"projectId":"prj_Ns9LbXPT6UF6yvKR0rUcrwJAsFYM","projectName":"studyx-agente-ventas", "orgId": …}`
(copialo de un release anterior en `/private/tmp/studyx-release-*/repo/.vercel/`).
Si falla el deploy, producción sigue con el anterior: no se promueve un build en error.

## 5. Reiniciar la conversación del dueño (sólo si lo pide)

Script: `scripts/prepare-owner-test-lead-reset.mjs` (lee `.env.local` y
`~/.adk/credentials` solo). Primero obtené el scope vigente (sólo lectura):
contacto = `contacts.phone LIKE '%69004497%' AND deleted_at IS NULL`; conversación =
la más reciente de ese contacto; Botpress = el `conv_…` dentro de sus
`outbound_deliveries`. Requiere 60 s sin mensajes del cliente.

```bash
D=/private/tmp/studyx-reset-1169004497-<fecha>
mkdir -p $D && echo '{"phone":"+5491169004497","contactId":"…","conversationId":"…","botpressConversationId":"conv_…"}' > $D/scope.json
export STUDYX_RESET_SCOPE_FILE=$D/scope.json
cd "$WT"
node scripts/prepare-owner-test-lead-reset.mjs discover $D/run
node scripts/prepare-owner-test-lead-reset.mjs dry-run $D/run
node scripts/prepare-owner-test-lead-reset.mjs apply-db $D/run --apply
node scripts/prepare-owner-test-lead-reset.mjs finish-botpress $D/run --apply                          # exit 1 ESPERADO
node scripts/prepare-owner-test-lead-reset.mjs finish-botpress $D/run --apply --await-native-inbound   # exit 0
node scripts/prepare-owner-test-lead-reset.mjs verify $D/run
```

Final esperado: `ready_for_first_inbound`, `verified:true`. Si `discover` aborta
por `agent_a_memory_projection_jobs` pendientes, no los drenes a mano: avisá.

## Pendiente acordado con el dueño (no implementado)

Largo de los mensajes: tope orientativo ~250 caracteres por turno, no repetir
datos ya dichos (temario, certificado, ficha), «Conecta siempre» sólo al
recomendar. El dueño lo dejó para después de probar v210/v121. Tuteo siempre:
regla del dueño, no tocar.
