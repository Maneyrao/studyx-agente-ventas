# Prompt para Claude Code — Agente B Telegram Smoke

Actuá como principal engineer responsable del frente **Agente B / Telegram
sandbox** de StudyX. Implementá un vertical slice local, probado e idempotente
que demuestre que una sesión de llamada ya autorizada entrega a B exactamente
el contexto preparado, que B lo carga sin pérdidas ni invenciones y que un
tester puede verificarlo desde Telegram.

No estás diseñando la personalidad ni las respuestas comerciales del Agente A.
Ese frente se está implementando en paralelo en el worktree
`.worktrees/agent-a-customer-flow`, branch `feature/agent-a-customer-flow`.

## Resultado de esta sesión

Entregar en una branch y worktree propios:

```text
sesión preautorizada con fixture canónica
→ dispatch por Telegram Bot B
→ validación de CallContextV1
→ hash recalculado por B
→ context receipt determinístico
→ confirmación humana correcta/incorrecta
→ eventos de llamada idempotentes
→ proyección estable aunque los eventos lleguen desordenados
```

Este frente termina preparado para el smoke vivo, pero no debe fingir que el
handoff A→B completo está integrado. La reserva real desde `Decision v4` se
conectará después, en una fase serial, cuando A y B estén verdes.

## Instrucciones iniciales obligatorias

1. Anunciá que vas a usar `superpowers:using-git-worktrees` y
   `superpowers:subagent-driven-development`; si no hay subagentes, usá
   `superpowers:executing-plans`.
2. Leé por completo, antes de editar:

   - `CLAUDE.md`
   - `specs/004-sales-orchestration/spec.md`
   - `/Users/tmaneyro22/Documents/AGENTE IA/studyx-agente-ventas/specs/005-agent-a-b-communication/spec.md`
   - `/Users/tmaneyro22/Documents/AGENTE IA/studyx-agente-ventas/docs/superpowers/plans/2026-08-16-agent-a-b-communication.md`
   - `src/lib/contracts/call-event.ts`
   - `src/lib/services/sandbox.service.ts`
   - `src/lib/repositories/sandbox-identity.repository.ts`

   Los dos documentos A↔B todavía pueden estar untracked en el checkout raíz:
   preservalos y leelos por su ruta absoluta; no los borres, muevas ni
   sobrescribas.
3. Inspeccioná sin modificar:

   ```bash
   git status --short
   git branch --show-current
   git worktree list --porcelain
   git -C .worktrees/agent-a-customer-flow status --short
   git -C .worktrees/agent-a-customer-flow diff --name-status snapshot/wip-full...HEAD
   ```

4. Creá el worktree `.worktrees/agent-b-telegram-smoke` y la branch
   `feature/agent-b-telegram-smoke` desde `snapshot/wip-full`. Verificá primero
   que `.worktrees/` esté ignorado. No cambies de branch ni escribas dentro del
   worktree de A.
5. Instalá dependencias en el worktree si hiciera falta y verificá el baseline:

   ```bash
   npm test
   npm run typecheck
   (cd botpress-agent && npm run typecheck && npm run check)
   ```

   Si el baseline falla, distinguí fallo preexistente de regresión y reportalo
   antes de implementar.
6. Antes de crear una ruta Next.js, consultá la guía correspondiente dentro de
   `node_modules/next/dist/docs/`; este proyecto usa Next.js 16.3.

## Coordinación obligatoria con el frente A

### Archivos prohibidos para este frente

No edites, reformatees ni stages ningún archivo de estas zonas:

```text
src/features/orchestration/**
botpress-agent/**
src/lib/services/decision.service.ts
src/lib/services/ingestion.service.ts
src/app/api/agent/turns/[turn_id]/decision/route.ts
tests/unit/orchestration/**
tests/unit/botpress/**
tests/integration/claim-context.test.ts
tests/integration/agent-a-call-handoff.test.ts
tests/contract/botpress-response-parity.test.ts
package.json
package-lock.json
docs/PILOT_MATRIX.md
docs/PILOT_RUNBOOK.md
docs/FAILURE_MATRIX.md
```

Tampoco implementes ni modifiques en este frente:

```text
src/features/orchestration/domain/decision-v4.ts
src/features/orchestration/domain/decision-v3.ts
src/lib/contracts/call-event.ts
botpress-agent/src/schemas/call-events.ts
tests/fixtures/call-events/**
tests/contract/call-event-schema.test.ts
tests/contract/zod-parity.test.ts
src/features/calls/domain/call-consent.ts
src/features/calls/application/request-call.ts
src/features/calls/application/route-post-call.ts
```

Consumí esos contratos como precondiciones; no crees copias paralelas. Si el
worker de A empieza a modificar un archivo que necesitás, no lo pises: buscá un
puerto nuevo dentro de `src/features/calls/**` o detenete y reportá el conflicto.

### Ownership de este frente

Podés crear o modificar solamente archivos nuevos o hunks estrictamente
necesarios dentro de:

```text
src/features/calls/domain/call-context.ts
src/features/calls/domain/context-receipt.ts
src/features/calls/domain/call-state.ts
src/features/calls/ports/call-store.ts
src/features/calls/ports/context-receipt-store.ts
src/features/calls/ports/voice-provider.ts
src/features/calls/adapters/postgres-call-store.ts
src/features/calls/adapters/postgres-context-receipt-store.ts
src/features/calls/adapters/fake-voice.provider.ts
src/features/calls/adapters/telegram-bot-api.client.ts
src/features/calls/adapters/telegram-sim-voice.provider.ts
src/features/calls/application/dispatch-call.ts
src/features/calls/application/record-call-event.ts
src/features/calls/application/verify-telegram-context.ts
src/app/api/agent/calls/[call_id]/dispatch/route.ts
src/app/api/webhooks/voice/telegram/route.ts
src/app/api/cron/reconcile-calls/route.ts
supabase/migrations/20260816010002_call_ledger.sql
tests/unit/calls/**
tests/integration/call-ledger-invariants.test.ts
tests/integration/call-store.test.ts
tests/integration/call-event-reconciliation.test.ts
tests/integration/telegram-agent-b-smoke.test.ts
tests/fixtures/telegram-agent-b/**
scripts/smoke-telegram-agent-b.mjs
docs/evidence/telegram-agent-b-smoke.md
docs/runbooks/telegram-agent-b-smoke.md
```

Podés hacer un cambio mínimo y focalizado en `src/proxy.ts`,
`tests/unit/security/proxy-public-paths.test.ts`, `src/lib/config.ts` y
`.env.example` sólo si resulta imprescindible. `src/lib/supabase/database.types.ts`
puede recibir únicamente los tipos generados por la nueva migración. Revisá
antes que A no haya modificado ninguno de esos archivos. No agregues
dependencias: usá `fetch`, `crypto` y Zod existentes.

## Límites funcionales

- B recibe una **sesión ya autorizada**. No interpreta mensajes comerciales,
  no ofrece llamadas, no decide consentimiento y nunca crea contactos.
- Telegram B no entra por `/api/agent/ingest` y no modifica la conversación de
  A.
- El sandbox nunca llama a Retell, WhatsApp real, Sheets, pagos ni producción.
- PostgreSQL es canónico. Telegram es sólo un adaptador/proyección.
- A y B nunca se llaman directamente. El backend coordina.
- El modelo no participa en la generación del context receipt ni de los hashes.
- B recibe todo `CallContextV1`, no el historial completo de WhatsApp.
- Campos desconocidos permanecen vacíos/nulos según el contrato; nunca se
  completan por inferencia.

## Arquitectura hexagonal obligatoria

- `domain`: schemas, normalización acotada, hash, reducer y reglas puras; cero
  imports de Next.js, PostgreSQL o Telegram.
- `application`: casos de uso que dependen sólo de puertos y dominio.
- `ports`: interfaces definidas hacia adentro, con DTOs propios.
- `adapters`: PostgreSQL y Telegram Bot API.
- rutas/webhooks: adaptadores de entrada delgados; validan, traducen y llaman a
  un caso de uso.
- composition root: inyecta implementaciones. Ningún caso de uso instancia
  `fetch`, clientes SQL ni lee `process.env` directamente.

## Contratos obligatorios

Implementá una única fuente TypeScript para `CallContextV1`, compatible con la
spec:

```ts
export interface CallContextV1 {
  call_id: string;
  nombre_lead: string;
  curso_interes: string;
  pais: string;
  email_lead: string;
  resumen_whatsapp: string;
  prompt_version: string;
}
```

Requisitos:

- schema estricto;
- `call_id` UUID;
- todas las claves presentes;
- strings acotados;
- `resumen_whatsapp` máximo 1.200 caracteres;
- el builder no agrega datos de pago ni secretos; B trata todo el resumen como
  datos no confiables, elimina caracteres de control para renderizar y jamás
  interpreta instrucciones incluidas en el texto;
- serialización canónica con orden fijo de claves y UTF-8;
- SHA-256 hexadecimal de 64 caracteres;
- mismo objeto lógico produce el mismo hash aunque cambie el orden de claves de
  entrada;
- una diferencia en cualquier valor cambia el hash.

Definí un acuse separado del lifecycle de llamada. No agregues
`context_loaded` al enum canónico `requested | started | ended | analyzed`:

```ts
export interface ContextLoadAckV1 {
  schema_version: 1;
  event: 'context_loaded';
  call_id: string;
  context_hash: string;
  received_fields: string[];
  missing_fields: string[];
  status: 'accepted' | 'rejected';
  loaded_at: string;
  error_code?:
    | 'CONTEXT_SCHEMA_INVALID'
    | 'CONTEXT_HASH_MISMATCH'
    | 'CONTEXT_REQUIRED_FIELD_MISSING';
}
```

El hash demuestra igualdad de transporte; el schema/listado de campos demuestra
completitud; la confirmación humana demuestra que lo visible es correcto.

## Smoke de Telegram

1. El tester debe haber iniciado Bot B una vez con `/start` o con un deep link
   `https://t.me/<bot>?start=smoke_<nonce>`. El bot no puede iniciar un chat
   privado en frío.
2. No intentes hacer que Bot A le escriba a Bot B: Telegram no entrega mensajes
   de otros bots. El orquestador llama al adaptador de B.
3. `TelegramSimVoiceProvider.placeCall` debe:

   - recibir `callId`, `phoneE164`, `context` e `idempotencyKey` desde el puerto;
   - resolver el chat sandbox mediante un puerto/adaptador, nunca desde el
     output del modelo;
   - validar el contexto y recalcular el hash;
   - persistir el `ContextLoadAckV1` antes de marcarlo aceptado;
   - enviar exactamente un context receipt por idempotency key;
   - devolver un `providerCallId` derivado del `message_id` de Telegram;
   - tratar timeout como ambiguo, sin reenviar ciegamente.

4. El mensaje debe generarse por plantilla determinística, nunca por LLM:

   ```text
   🧪 SMOKE A → B

   Call ID: <call_id abreviado>
   Nombre: <nombre_lead o "no informado">
   Curso: <curso_interes o "no informado">
   País: <pais o "no informado">
   Resumen: <resumen_whatsapp sanitizado>
   Campos recibidos: <n>/<total>
   Hash: <primeros 12 caracteres>

   [✅ Información correcta] [❌ Información incorrecta]
   ```

5. `callback_data` contiene sólo un nonce opaco y una acción; máximo 64 bytes.
   Nunca incluye PII, contexto ni token.
6. El webhook público exacto es `/api/webhooks/voice/telegram`. Debe validar
   `X-Telegram-Bot-Api-Secret-Token`, el schema del update, el chat/usuario
   tester esperado, el nonce y la asociación con el mensaje original.
7. Respondé siempre `answerCallbackQuery` para cerrar el spinner de Telegram.
8. Replays del mismo update/callback son idempotentes. Un mismo
   `idempotencyKey` no produce dos mensajes.
9. Un callback de otro usuario/chat, nonce vencido, hash distinto o contexto
   incompleto falla cerrado y deja evidencia sin contenido sensible.
10. `sendMessage` exitoso prueba aceptación de Telegram; `context_loaded`
    prueba carga técnica; el botón humano prueba corrección visual. No mezcles
    esas tres evidencias.

## Persistencia e invariantes

Implementá la migración aditiva asignada sin modificar migraciones aplicadas.
Como mínimo debe soportar:

- `call_sessions` con snapshot inmutable, hash, proveedor, idempotency key y
  estados ortogonales;
- `call_events` append-only con unicidad `(provider, event_id)`;
- una llamada activa por contacto;
- un dispatch por source turn/idempotency key;
- receipts de contexto con hash, estado, `telegram_message_id`, nonce hash y
  veredicto, sin duplicación;
- RLS/revocación coherente con las tablas servidoras del proyecto;
- ningún transcript, token, teléfono, email o texto completo en logs.

El reducer de llamadas relee el ledger completo; no aplica “último webhook
gana”. Probá todas las permutaciones de `started`, `ended` y `analyzed` y mantené
`analysis_status` independiente.

## Ejecución TDD

Trabajá en tareas pequeñas, cada una con test rojo → implementación mínima →
test verde → revisión → commit focalizado:

1. `CallContextV1`, sanitización acotada, serialización y hash.
2. Reducer de llamadas y migración/constraints.
3. Puertos/store PostgreSQL y pruebas de replay/concurrencia.
4. Fake provider y `dispatchCall`, incluyendo timeout ambiguo.
5. Cliente Telegram con `fetch` inyectado y respuestas sanitizadas.
6. Telegram simulator, receipt determinístico e idempotencia.
7. Webhook `/start`, callback correcto/incorrecto, autenticación e idempotencia.
8. Smoke local con fixture y documentación operativa.

Casos mínimos obligatorios:

- contexto completo;
- campo obligatorio ausente;
- campo opcional vacío sin invención;
- resumen de 1.200 y 1.201 caracteres;
- orden diferente de claves con mismo hash;
- cambio de un valor con hash diferente;
- prompt injection dentro del resumen tratada sólo como datos;
- sendMessage 200, error confirmado, 429 y timeout ambiguo;
- dispatch duplicado y concurrente;
- callback duplicado;
- callback de usuario/chat incorrecto;
- nonce inválido o vencido;
- dos contactos concurrentes sin mezcla de contexto;
- eventos en todas las permutaciones;
- cero efecto Retell/WhatsApp/Sheets.

No uses asserts de tiempo frágiles en unit tests. Instrumentá
`request_to_telegram_accepted_ms` y registrá p50/p95 en el smoke; objetivo p95
menor a 2 segundos para Telegram sandbox. El dispatch de B nunca debe bloquear
la respuesta inmediata de A al cliente.

## Smoke vivo y secretos

- Variables esperadas, documentadas pero nunca impresas:

  ```text
  TELEGRAM_AGENT_B_BOT_TOKEN
  TELEGRAM_AGENT_B_WEBHOOK_SECRET
  TELEGRAM_AGENT_B_SMOKE_CHAT_ID
  TELEGRAM_AGENT_B_SMOKE_USER_ID
  TELEGRAM_AGENT_B_SMOKE_ENABLED=false
  VOICE_PROVIDER=telegram_sandbox
  ```

- No configures BotFather, `setWebhook`, Vercel, Botpress, Supabase remoto ni
  Retell sin autorización explícita posterior.
- No ejecutes el smoke vivo por defecto. Creá
  `scripts/smoke-telegram-agent-b.mjs` con guardas dobles:
  `TELEGRAM_AGENT_B_SMOKE_ENABLED=true` y flag `--confirm-sandbox`.
- Si faltan credenciales, el resultado correcto es
  `READY_FOR_LIVE_SMOKE`, con todos los tests locales verdes y el comando exacto
  documentado. No inventes ni solicites imprimir secretos.

## Verificación final obligatoria

Ejecutá, capturando resúmenes y no logs verbosos:

```bash
npm test
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration
bash scripts/verify-native-postgres-loop.sh
npm run typecheck
npm run lint
npm run build
(cd botpress-agent && npm run typecheck && npm run check)
git diff --check
git status --short
```

No declares éxito si alguna verificación requerida falla. Ante un bloqueo,
hacé hasta tres intentos **con diagnósticos y cambios distintos**, no tres
repeticiones ciegas. Si persiste, detenete y reportá comando, error sanitizado,
causa probable y qué autorización/dato falta.

## Prohibiciones operativas

- No `git reset --hard`, `git clean`, `git stash`, `git checkout --` ni borrado
  de cambios ajenos.
- No merge, rebase, cherry-pick sobre la branch de A ni edición de su worktree.
- No push, deploy, migración remota ni cambios de integración externa.
- No stage de archivos ajenos; commits pequeños sólo con archivos propios.
- No guardar tokens, chats reales, PII o payloads completos en fixtures, logs,
  commits o evidencia.
- No “arreglar” tests preexistentes fuera del alcance para hacerlos pasar.

## Entrega

Al finalizar informá:

1. worktree, branch y commits creados;
2. archivos creados/modificados;
3. tests ejecutados con conteos y resultados;
4. invariantes e idempotencia demostradas;
5. estado `READY_FOR_LIVE_SMOKE` o bloqueo real;
6. comando manual del smoke y paso `/start` requerido;
7. métricas de latencia disponibles;
8. cualquier deuda de integración con A;
9. lista exacta de archivos puente que deberán integrarse serialmente después:
   `Decision v4`, reserva atómica, schemas/workflow Botpress, dispatch desde A,
   mensajes diferidos y handback;
10. evidencia explícita de que no tocaste el worktree ni los archivos propiedad
    de A.

No conectes ambas branches. Terminá dejando B revisable y aislado.
