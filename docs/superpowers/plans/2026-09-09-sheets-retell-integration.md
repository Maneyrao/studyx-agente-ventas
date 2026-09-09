# Google Sheets + Retell Agent B Integration Plan

> **Execution scope:** Run Plans 2 and 3 from the 2026-09-09 handoff. Do not change Agent A naturality, prompts, message splitting, or conversational tests in this branch.

**Goal:** Persist every complete lead in the coordinated Google Sheet using exactly four visible columns, and connect the supplied Retell voice Agent B to the existing call ledger/orchestrator without giving Retell direct authority over Sheets, payments, or WhatsApp.

**Architecture:** PostgreSQL remains the source of truth. `sheet_projection_rows` is the durable, idempotent outbox and Google Sheets remains a replaceable operator projection. Retell is an adapter behind the existing `VoiceProvider`; its dispatches, webhooks, tools, and post-call outcomes enter existing canonical services and ledgers. No new business-authority path is created in Retell.

**Source package:** `/Users/tmaneyro22/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/18DF7F59-D2CF-4BBB-BE4F-8E660DA467B3/studyx_export_vivo_2026-09-08.json`, Agent `agent_d2c1a4ac7900ae95a47727156b`, version `0`, LLM `llm_eea8f670b6569b44689e9394b150`, version `0`.

## Global Constraints

- Agent A naturality and its prompt are out of scope.
- The Sheet exposes exactly `nombre`, `apellido`, `mail`, `tipo_de_curso`, in that order. No operational or payment columns are written to the visible row.
- A Sheet row is created only when all four canonical values are non-empty; later corrections update the same stable row.
- Stable projection key: `lead:<workspace_id>:<contact_id>`. Use `spreadsheets.values.update`, never append, and keep retry/dead-letter behavior in PostgreSQL.
- Retell never writes directly to Google Sheets, Stripe, or WhatsApp. It calls authenticated orchestration endpoints; canonical services decide and persist effects.
- The Retell tool envelope is strict `{ name, call, args }`. Invalid/missing tool auth returns `401`. Authenticated validation/business errors return HTTP `200` with `{ ok: false, error: { code } }` so the voice flow can recover conversationally.
- P0 tools only: `consultar_curso`, `consultar_oferta`, `guardar_datos_contacto`, `registrar_resultado`. Payment/material/follow-up/human-transfer tools remain disabled until their ledgers and production policies are explicitly approved.
- Retell webhook verification uses the raw request body plus `x-retell-signature`; duplicate/replayed lifecycle events must be idempotent.
- Dispatch carries `internal_call_id`, `contact_id`, and `conversation_id` in metadata; dynamic variables come only from the frozen canonical context snapshot.
- Keep explicit Agent B version configuration. Never publish a Retell draft or place a real call from tests.
- No secrets, personal data, downloaded exports, or generated credentials may enter Git, logs, test snapshots, or reports.
- Every implementation task follows RED -> GREEN, creates a focused commit, and receives an independent task review before the next implementation task.

## Task 1: Four-column complete-lead Google Sheets projection

**Files:**
- Modify: `src/lib/providers/sheets/sheets-provider.ts`
- Modify: `src/lib/providers/sheets/google-sheets-provider.ts` only if the exact A:D range requires it
- Modify: `src/lib/services/projection.service.ts`
- Modify: the minimal Agent A complete-lead trigger/call sites
- Modify/add focused projection tests

**Acceptance:**
- RED proves incomplete lead => no row; four values in arbitrary capture order => one row; replay/concurrency => one row; correction => same row; exact A:D order; provider failure remains retryable/dead-letter.
- Canonical input names may stay compatible internally, but the persisted visible payload is exactly `{ nombre, apellido, mail, tipo_de_curso }`.
- Trigger is independent of payment and runs when contact name, surname, email, and selected course become complete after accepted channel state is durable.
- Existing sandbox real-side-effect guard remains intact.

## Task 2: Retell configuration, provider adapter, and dispatch

**Files:**
- Modify: `src/lib/config.ts`, `.env.example`, `.env.local.example`
- Create: `src/features/calls/adapters/retell-voice.provider.ts`
- Modify: `src/app/api/agent/calls/[call_id]/dispatch/route.ts`
- Add focused provider/config/dispatch tests

**Acceptance:**
- RED proves exact create-phone-call request, explicit Agent/LLM version policy, idempotent recovery lookup, cancel mapping, confirmed-vs-ambiguous errors, and sandbox prohibition before any phone network effect.
- Provider uses the existing `VoiceProvider` port and preserves the existing `dispatchCall` state machine.
- Retell credentials, phone number, API base URL, Agent ID/version, and webhook secret are validated by name without logging values.
- Telegram sandbox dispatch remains behaviorally unchanged.

## Task 3: Verified Retell webhook and canonical call lifecycle

**Files:**
- Create: Retell lifecycle schemas/adapter under `src/features/calls/`
- Create: `src/app/api/webhooks/voice/retell/route.ts`
- Reuse the existing call event application/store path
- Add focused webhook and integration tests

**Acceptance:**
- RED proves bad signature `401`, unknown call correlation rejection, started/ended/analyzed mapping, duplicate replay no-op, out-of-order event safety, and terminal structured outcome compatibility with post-call follow-up.
- Route verifies the raw body before JSON parsing.
- External Retell `call_id` maps to the internal UUID using metadata and/or the persisted provider call ID; arbitrary IDs from the payload never select a tenant contact.
- Event payloads are minimized and do not persist transcript/audio content unless the existing canonical contract explicitly requires it.

## Task 4: Retell P0 orchestration tools and complete-lead convergence

**Files:**
- Create: shared Retell tool authentication/envelope/result adapter
- Create four route handlers under `src/app/api/retell/tools/`
- Reuse catalog/offering, pricing, contact identity, call-result, and Sheets projection services
- Add focused contract/application tests

**Acceptance:**
- `consultar_curso` reads canonical catalog data; no invented course facts.
- `consultar_oferta` reads canonical offering/payment configuration; no model-authored prices.
- `guardar_datos_contacto` validates call correlation, updates only the correlated contact identity, and enqueues the four-column Sheet row only when all values are complete.
- `registrar_resultado` writes/reuses the canonical call-result path with an idempotency key and cannot trigger direct side effects.
- Unknown tool names or extra envelope keys fail deterministically; body size and input lengths are bounded.

## Task 5: End-to-end readiness and post-call WhatsApp proof

**Files:**
- Add/modify focused integration tests and a no-side-effect readiness script/document only where needed
- Do not add a second/third Meta send route

**Acceptance:**
- Prove by integration test: complete Agent A lead -> one A:D row; Agent B dispatch -> lifecycle -> result -> existing post-call follow-up outbox; replay creates no duplicate call event, follow-up, or Sheet row.
- Prove the post-call path reaches the existing physical outbound delivery consumer rather than a parallel Retell/Meta sender.
- Run root typecheck/unit suite, Botpress typecheck/build or check, and focused PostgreSQL integration tests.
- Report live blockers separately: missing Retell API key/phone/webhook secret/base URL or Google credentials/config may prevent a real external smoke, but must not weaken local deterministic proof.

## Final Done Definition

- Plans 2 and 3 are implemented and reviewed on this branch; Plan 1 is unchanged.
- Sheet contract is exactly four visible columns and complete-lead only.
- Agent B can be enabled through explicit Retell configuration without changing business ownership.
- Webhook and tools are authenticated, correlated, idempotent, and tested.
- Existing Agent A -> WhatsApp delivery and post-call follow-up paths remain the only outbound authority.
