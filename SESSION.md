# Sesión StudyX

## Fase actual

**Contenido y contexto del Agente A. Estado: código completo, recuperación
bloqueada por credencial** (2026-08-18).
Rama: `feat/studyx-datos-y-sim-local`. Commits: `2fb28ce`, `8819314`,
`a1d771d`, `7dbca7a`.

Lo que cambió: el mapeo de `offerings` al prompt descartaba
`delivery.classes/modules/includes/temario_publicado` y la columna `audience`
entera, así que el bot no podía responder "¿cuántas clases tiene?" ni "¿qué
incluye?" aunque el seed sí tenía el dato. Además el schema Zod de
`botpress-agent` descartaba en silencio cualquier campo nuevo. Ambos
arreglados. Se sembraron los 14 temarios publicados en `knowledge_sources`
(`source_type='offering'`), aplicados a producción.

**Descubrimiento que redefine la prioridad:** la base de conocimiento nunca
se proyectó en producción — `knowledge_documents` y `knowledge_chunks` en
cero, 23 jobs `pending`. `context.knowledge_base` viene vacío en cada turno
desde siempre. Ver Bloqueos.

Fase anterior (datos reales + simulación local A→B→A, 2026-08-17): completa.
Plan: `docs/superpowers/plans/2026-08-17-studyx-datos-y-simulacion-local.md`
(leer primero la tabla "planificado vs. implementado" de arriba de todo).
Ledger: `.superpowers/sdd/2026-08-17-studyx-datos-y-simulacion-local/progress.md`.

## Fases completas

- Catálogo real de StudyX cargado: workspace `studyx` (`environment='production'`),
  14 diplomados verificados, **cero precios numéricos**. Evidencia:
  `tests/integration/studyx-seed.test.ts` y `studyx-catalog.test.ts`.
- Loop B→A (spec 007) con cobertura de integración del cron post-llamada:
  FR-1 idempotencia, FR-3 `no_contactar`, FR-4 `cancelled`, FR-5 contacto
  bloqueado. Evidencia: `tests/integration/post-call-followup.test.ts` y
  `docs/evidence/simulacion-local-a-b-a.md`.
- Simulación local documentada y ejecutable: `docs/runbooks/simulacion-local-a-b-a.md`
  + `scripts/seed-sandbox-tester.mjs`.
- Fases 0–8 del ledger de orquestación (2026-08-11), plan
  `specs/004-sales-orchestration/`, rama `feat/phases-0-8-canal-agnostic`.
  Estado real del código: `docs/ORCHESTRATOR_MAP.md`.

## Decisiones de arquitectura tomadas

- StudyX vive en `supabase/seed/studyx.sql`, separado de `dev.sql` → un seed de
  producción no puede arrastrar fixtures sintéticas → Ruling 11 del ledger.
- **Superada el 2026-08-18.** El precio quedó resuelto por decisión del dueño:
  los 14 cursos llevan `price_type='fixed'`, `price_amount=1200.00 USD` — lo
  que realmente cobra el checkout — y el monto de la Beca ($699) vive sólo en
  `offerings.metadata.beca_price_usd`, marcado `beca_hypothesis_unconfirmed`.
  Ese monto está guardrailed para no aparecer NUNCA en texto recuperable
  (`BECA_LEAK_PATTERN = /\b699\b/` en dos suites), y la columna `metadata` ni
  se selecciona en `postgres-business-context.ts` — exclusión deliberada, no
  un olvido. La regla anterior era: ningún precio como número mientras el
  sitio publicara $699 y cobrara $1.200.
- La cadena de migraciones no se reescribe; la reconciliación local vive en
  `scripts/pg-native-up.sh` → tocar una migración aplicada es una decisión sobre
  el historial de deploys de producción, no de esta rama → Ruling 21.

## Invariantes establecidas en esta fase

- Ningún texto recuperable puede contener una cifra con forma de precio →
  test de escaneo en `tests/integration/studyx-seed.test.ts`.
- El detalle del catálogo nunca niega un curso por el tope de la lista →
  test de regresión con rellenos en `tests/integration/studyx-catalog.test.ts`.
- Un truncamiento de ofertas nunca es silencioso → `offerings_truncated` +
  logs en `catalog/route.ts` y `claim-batch.ts`.
- Los tests de integración no pueden escribir en producción → `tests/setup/integration.ts`
  pisa `DATABASE_URL` siempre, nunca con `??=`.
- Los topes se fijan con holgura sobre el dato real, no pegados a él →
  `maxOfferings: 40`, `maxForbiddenPromises: 24`, ambos con test que fija el piso.

## Tests agregados

- `tests/integration/studyx-seed.test.ts`: el seed carga 14 ofertas sin precio y
  ningún knowledge_source filtra un monto.
- `tests/integration/studyx-catalog.test.ts`: el catálogo no expone precio por
  ningún campo, y el detalle encuentra cursos pasados el tope de la lista.
- `tests/integration/post-call-followup.test.ts`: los cuatro requisitos del cron
  B→A, cada uno verificado rompiendo su guard.
- `tests/unit/orchestration/business-context.test.ts`: holgura de los topes y
  propagación de los contadores de truncamiento e inyección.

## Entregables pedidos: Sheets · Agente B · Stripe

Auditados contra el código el 2026-08-18 (no contra specs ni memoria). Los
tres comparten el mismo diagnóstico: **el núcleo está bien construido y
testeado; lo que falta es el cableado del último tramo y las credenciales.**
`docs/ROADMAP.md` está desactualizado — no menciona ni al Agente B ni a
Sheets.

Ojo con la tabla de fronteras de `specs/004-sales-orchestration/spec.md:43-46`:
describe `src/lib/providers/{voice,payments,sheets}/`, y **ese directorio no
existe**. Lo real vive en `src/features/{calls,payments}/{ports,adapters}/`.
La spec es aspiracional, no un mapa del código.

### Sheets — ~15%. Sólo existe la capa de base de datos.

Hecho: la migración `20260817040001_sheet_projection_rows.sql`, y es buena —
outbox idempotente por `projection_key`, `row_number` reservado con unique
por spreadsheet+tab (para hacer siempre `values.update`, nunca `append`),
`claim_sheet_projection_rows` con `FOR UPDATE SKIP LOCKED`, lease,
dead-letter.

Falta todo lo demás: **cero código TypeScript**, cero dependencia de Google
instalada, cero tests, cero cron. Nadie inserta en la tabla y nadie la
consume — es una tabla huérfana. Falta el provider HTTP con auth de service
account, el worker, el route handler de cron, el candado de sandbox
(`assertRealSideEffectAllowed(..., 'GOOGLE_SHEETS_ROW')`) y las credenciales
de Google (bloqueante externo desde el 2026-08-06).

Hueco de diseño a resolver antes de escribir provider: la migración exige
`row_number >= 2` y único por tab, pero **ninguna función lo asigna**.

### Agente B — núcleo completo y verificado. Falta el adaptador de Retell.

Hecho, y agnóstico de proveedor: puerto `VoiceProvider` (3 métodos), ledger
durable (`call_sessions`, `call_events` con `UNIQUE(provider,event_id)`),
reductor de estado puro, dispatch con lease y taxonomía
confirmado/ambiguo, loop B→A cerrado y verificado end-to-end contra la ruta
HTTP real, cron post-llamada agendado, y el contrato v2 ya con fixtures de
`provider: "retell"`. La base y el config **ya aceptan** `'retell'`.

Falta: 3 archivos (`retell-voice.provider.ts`, `retell-webhook.ts`, su
`route.ts`), 2 ediciones de una línea (`src/proxy.ts:70` para el path
público, y el 409 `VOICE_PROVIDER_NOT_IMPLEMENTED` de
`dispatch/route.ts:21-22`), 7 variables `RETELL_*`, y sus tests. Estimado:
2-3 días con la credencial en mano. Es implementar un puerto, no
refactorizar.

Consecuencia hoy: el simulador **nunca emite `analyzed`**, así que `result`
es siempre `null` y el cron degrada a `ANALYSIS_UNAVAILABLE`. Las 9 ramas de
negocio del ruteo post-llamada están escritas y testeadas pero **nunca
fueron ejercitadas por un camino vivo**. Retell real es lo que las enciende.

No existe `reconcile-calls`: hoy nada reconcilia una llamada colgada en
`dispatch_ambiguous`.

**Primer paso, y no es escribir código:** `.env.local` tiene
`TELEGRAM_BOT_B_TOKEN`, pero `config.ts:101-105` exige
`TELEGRAM_AGENT_B_BOT_TOKEN` + `_WEBHOOK_SECRET` + `_SMOKE_CHAT_ID` +
`_SMOKE_USER_ID`, y ninguno está. Con este `.env.local`
`loadTelegramAgentBConfig()` tira `MISSING_AGENT_B_CONFIG` y el webhook
responde 500. Falta también `CRON_SECRET` (sin él el cron da 401). **El
simulador que ya está construido hoy no arranca.** Nombres correctos en
`docs/runbooks/simulacion-local-a-b-a.md:56-77`.

### Stripe — motor sin transmisión. Hoy no cobra ni en modo fake.

Hecho y bien hecho: ledger canónico (`20260817030001_canonical_payments.sql`:
`payments`, `payment_events` append-only, `fulfillment_jobs`,
`offering_payment_configs`, trigger de invariantes en SQL), máquina de
estados espejada en dominio y base, adapter de Checkout Sessions,
`FakePaymentProvider`, y un webhook que verifica firma contra raw body y
**exige que `amount_total`/`currency` coincidan con el monto canónico** antes
de marcar `paid`. Tests fuertes: replay ×10, mismatch de monto, mismatch de
sesión, creación ambigua, concurrencia.

Roto en cinco tramos, todos de cableado:
1. **Nadie llama a `reservePayment` ni a `createCheckout`** fuera de tests.
   No existe la ruta. Es el hueco nº 1.
2. **No hay factory** que instancie el adapter según
   `loadPaymentProviderConfig()`. `StripeCheckoutProvider` sólo se construye
   en un test.
3. **El agente no puede disparar un link de pago**: `DECISION_KINDS` es
   `['reply','clarify','suppress']` y la única acción con efecto es
   `request_call_now`. No existe `send_payment_link` — es imposible por
   schema. El texto `PAYMENT_LINK_SENT` del post-llamada asume que el link
   lo manda el Agente B *en la llamada*, que es justo lo que no existe.
4. **Nadie consume `fulfillment_jobs`**: `claim_fulfillment_jobs` está lista
   y sin usar, sin cron. Un pago acreditado encola el job y ahí muere.
5. **`offering_payment_configs` está vacía**: el provisioning nunca se corrió
   de verdad (el commit `007b91e` sólo hizo `--dry-run`). Como el JOIN de
   `reserve-payment.ts:86` es INNER, **los 14 cursos fallan con
   `OFFERING_NOT_PAYABLE`** — ni el fake funciona.

Además faltan las 5 env vars (`PAYMENT_PROVIDER`, `STRIPE_SECRET_KEY`,
`STRIPE_WEBHOOK_SECRET`, `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`), así que
`PAYMENT_PROVIDER` cae al default `fake` y el webhook devuelve 503. Y
`stripe_live` está apagado a propósito (`config.ts:62`,
`STRIPE_LIVE_DISABLED`) — candado deliberado, no bug.

**Riesgo de negocio, sin decisión escrita:** el sitio real cobra con
`authorize_net_cim_credit_card`, no con Stripe
(`docs/analysis/ANALISIS-STUDYX-CONTEXTO-VS-SITIO.md:15,211,323`). La spec
004 nunca dijo "Stripe", dice `<psp>.provider.ts` genérico. Se construyó
Stripe *después* de tener documentado que el negocio usa Authorize.Net.
Buena noticia arquitectónica: si cambia el PSP, **el puerto y todo el ledger
se reutilizan tal cual**; sólo se tira el adapter.

A revisar: en `stripe-checkout-provider.ts:63-69` el
`assertRealSideEffectAllowed` está *dentro* del `if (environment === 'live')`
que siempre tira después — en `stripe_test` un contacto sandbox no queda
bloqueado. Hoy es inocuo (sin dinero), pero el assert queda muerto en el
momento en que se saque el `throw`.

### El eslabón compartido

`fulfillment_jobs` es la bisagra entre los dos: el pago acreditado lo encola
y la fila en la planilla es su salida. Hoy **ningún worker lo consume**, así
que Stripe y Sheets están cortados por la misma pieza faltante. Es el punto
de mayor apalancamiento de los tres entregables.

## Bloqueos

- **🔴 `GEMINI_API_KEY` inválida → la base de conocimiento no se puede
  proyectar.** Es el bloqueo nº 1: sin esto, sembrar contenido no sirve de
  nada porque el agente no lo recupera. La clave de `.env.local` tiene
  formato `AQ.A…` (53 chars) y `generativelanguage.googleapis.com/v1beta`
  responde `GEMINI_EMBED_HTTP_401` — espera una clave `AIza…` de AI Studio.
  El cron `/api/cron/project-knowledge` SÍ está agendado en `vercel.json`
  cada 15 min, o sea que viene fallando en silencio, no es que nunca disparó
  (revisar también qué clave tiene cargada Vercel). Para drenar la cola una
  vez corregida:
  `npx tsx scripts/run-knowledge-projection.ts --database-url "…" --allow-remote --yes`.
  Requiere que el dueño reemplace la credencial.
- **Sin observabilidad del cron**: que un cron agendado falle en todas sus
  corridas durante días sin que nadie se entere es la brecha operativa real
  detrás del bloqueo anterior. Nada alerta sobre `knowledge_projection_jobs`
  estancados ni sobre `knowledge_chunks` en cero.
- **La cadena de migraciones no corre de cero**: `20260805000001:379` hace
  REVOKE sobre `anon`/`authenticated` sin guardas, y `20260805000001:194` crea
  un `knowledge_chunks(source_id)` que choca con el canónico
  `knowledge_chunks(document_id)` de `20260809020001:15`. Producción lo resolvió
  a mano — tiene `legacy_knowledge_chunks_20260805`, que ninguna migración del
  repo crea. Requiere una decisión del dueño sobre el historial de migraciones.
- ~~**Producción atrasada en migraciones (CP1)**~~ — resuelto: verificado el
  2026-08-18, `knowledge_projection_jobs` existe y `knowledge_documents`
  tiene `workspace_id`.
- **EXT-05**: la integración `telegram` no está instalada en Botpress Cloud, lo
  que bloquea el piloto de `docs/PILOT_RUNBOOK.md`.
- **Retell**: no existe `retell.provider.ts`; el Agente B real de voz sigue sin
  implementarse. El sandbox usa el simulador de Telegram.

## Regla de bloqueo

Intentar cada bloqueo técnico hasta tres veces con alternativas seguras. Si el
mismo bloqueo persiste, documentarlo con evidencia y solicitar intervención.
