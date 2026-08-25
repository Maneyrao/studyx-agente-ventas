# StudyX WhatsApp Deployment Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the verified Agent A deployable to the official Botpress WhatsApp integration through a supervised canary with explicit secrets, channel normalization, readiness checks, observability, and immediate rollback.

**Architecture:** Botpress Cloud owns the official WhatsApp integration and channel delivery; one new hexagonal channel adapter converts official WhatsApp events into the existing canonical `InboundEnvelopeSchema`. Next.js/Vercel and Supabase remain the transactional authority, while `automationEnabled=false`, a canary phone allowlist, readiness gates, and a disable-first rollback keep external activation reversible.

**Tech Stack:** Botpress ADK 2.x, official Botpress WhatsApp integration pinned to `4.18.5`, Meta WhatsApp Business/Cloud API, TypeScript, Next.js/Vercel, Supabase PostgreSQL, Stripe test mode for canary, Google Sheets projection.

**Spec:** `docs/superpowers/plans/2026-08-25-bot-a-regression-recovery.md`; official setup: `https://botpress.com/docs/integrations/integration-guides/whatsapp/introduction/`; official event mapping: `https://botpress.com/docs/integrations/integration-guides/whatsapp/mapping/whatsapp-to-botpress/`

## Global Constraints

- Start only after the Agent A report is 50/50 with `regression_gate_complete=true`.
- Preparing code and runbooks does not authorize a Vercel/Botpress deploy, Meta connection, production migration, secret write, or customer message.
- Keep `automationEnabled=false` in production until `/api/ready` is `ready` and a single allowlisted tester is configured.
- Pin the WhatsApp integration to `4.18.5`; do not deploy `@latest` to production.
- Botpress development and production integrations/configuration/secrets are separate; never copy a development token into production.
- Never commit `.adk/dependencies/*.json`, `.adk/secrets.json`, `.env.local`, access tokens, Meta app secrets, verify tokens, private keys, customer phone numbers, or webhook payloads.
- The canonical channel remains `whatsapp`; the official integration uses `sandbox_provider=null` and a real strict E.164 identity.
- One wildcard Botpress conversation router remains the only inbound handler; WhatsApp is an adapter entry, not a second conversation.
- Canary payment uses `PAYMENT_PROVIDER=stripe_test`; `stripe_live` remains disabled until separately approved.
- Opt-out, contact blocking, one physical outbound, HMAC validation, exact catalog authority, and idempotency gates are unchanged.
- Rollback must require no code deployment: first set `automationEnabled=false`, then disable the WhatsApp integration if needed.

---

### Task 1: Capture and Pin the Official Botpress Dependency Contract

**Files:**
- Create: `docs/runbooks/whatsapp-integration-contract.md`
- Modify: `.gitignore`
- Test: `tests/unit/botpress/whatsapp-dependency-contract.test.ts`

**Interfaces:**
- Consumes: Botpress Cloud development dependency metadata and official integration version `4.18.5`.
- Produces: a secret-free contract fixture documenting the resolved alias, integration version, runtime channel name, supported inbound message types, and required conversation/message tags.

- [ ] **Step 1: Assert the local dependency cache is ignored**

Write a test that fails unless `.gitignore` covers `.adk/dependencies/`, `.adk/secrets.json`, and `agent.local.json`.

- [ ] **Step 2: Run the test and confirm RED if any secret-bearing path is uncovered**

```bash
npm test -- tests/unit/botpress/whatsapp-dependency-contract.test.ts
```

- [ ] **Step 3: Inspect the development bot without changing it**

```bash
cd botpress-agent
adk integrations status --format json
adk integrations search whatsapp --format json
adk integrations info whatsapp@4.18.5 --channels --format json
```

Record only schema names and version metadata. Do not record access tokens, account IDs, phone numbers, webhook URLs, or configuration values.

- [ ] **Step 4: With explicit authorization, install the pinned integration on development only**

```bash
cd botpress-agent
adk integrations add whatsapp@4.18.5
adk integrations status --format json
```

Expected before authorization/configuration: WhatsApp exists on the development bot and reports `disabled` or `unconfigured`, never silently `available` under unknown credentials.

- [ ] **Step 5: Write the captured secret-free contract and finish the ignore rules**

`whatsapp-integration-contract.md` must contain the exact ADK-reported channel identifier plus the documented tags `whatsapp:userPhone`, `whatsapp:botPhoneNumberId`, and `whatsapp:replyTo`. It must state that integration configuration is held by Botpress Cloud separately for development and production.

- [ ] **Step 6: Run contract and secret scans, then commit**

```bash
npm test -- tests/unit/botpress/whatsapp-dependency-contract.test.ts
git grep -nE 'EA[A-Za-z0-9]{20,}|sk_live_|sk_test_|whsec_|BEGIN PRIVATE KEY' -- . ':!package-lock.json'
git add .gitignore docs/runbooks/whatsapp-integration-contract.md tests/unit/botpress/whatsapp-dependency-contract.test.ts
git commit -m "docs: pin official whatsapp integration contract"
```

Expected: tests pass and the secret scan prints no credential value.

---

### Task 2: Add the Official WhatsApp Hexagonal Adapter

**Files:**
- Create: `botpress-agent/src/channels/shared/whatsapp-envelope.ts`
- Create: `botpress-agent/src/channels/whatsapp.channel.ts`
- Modify: `botpress-agent/src/channels/index.ts`
- Modify: `botpress-agent/src/channels/shared/normalize.ts`
- Test: `tests/unit/botpress/whatsapp-envelope.test.ts`
- Test: `tests/unit/botpress/whatsapp-channel.test.ts`
- Test: `tests/unit/botpress/channel-router.test.ts`

**Interfaces:**
- Consumes: official incoming Botpress message fields plus tags `whatsapp:userPhone`, `whatsapp:botPhoneNumberId`, and `whatsapp:replyTo`.
- Produces:

```ts
export type WhatsAppEnvelopeInput = {
  integrationId: string;
  externalMessageId: string;
  externalConversationId: string;
  externalUserId: string;
  phoneE164: string;
  traceId: string;
  messageType: 'text' | 'audio' | 'image' | 'unsupported';
  text: string;
  occurredAt: string;
  replyToExternalMessageId: string | null;
  metadata: Record<string, string | number | boolean>;
  botpressConversationId: string;
  botpressUserId: string;
};

export function normalizeWhatsAppPhone(raw: string): string;
export function buildWhatsAppEnvelope(input: WhatsAppEnvelopeInput): InboundEnvelope;
export const whatsappChannel: ChannelAdapter;
```

- [ ] **Step 1: Write RED identity and envelope tests**

Cover a documented raw phone such as `5491112345678` becoming `+5491112345678`, preservation of external message/conversation/user IDs, `channel:'whatsapp'`, `sandbox_provider:null`, reply linkage, and strict rejection of missing, malformed, synthetic `+999`, or overlong numbers.

- [ ] **Step 2: Write RED adapter routing tests**

Using the exact channel identifier captured in Task 1, assert one text event routes to `whatsappChannel`, Telegram still routes only to `telegramChannel`, webchat still routes to the emulator, and an unsupported integration produces `CHANNEL_UNSUPPORTED`. Assert there is still one wildcard conversation handler.

- [ ] **Step 3: Run and confirm RED**

```bash
npm test -- tests/unit/botpress/whatsapp-envelope.test.ts tests/unit/botpress/whatsapp-channel.test.ts tests/unit/botpress/channel-router.test.ts
```

- [ ] **Step 4: Implement the pure envelope builder and adapter**

Use `message.payload.text` for text. For the first canary, map image/audio/video/file to `unsupported` with a short canonical marker and do not invoke the Telegram transcription action. Copy only non-sensitive type/phone-number-ID metadata; do not place the real phone, access token, media URL, raw webhook, or message body in logs.

- [ ] **Step 5: Register WhatsApp before the generic emulator adapter**

Set `CHANNEL_ADAPTERS` to deterministic specificity order: official WhatsApp, Telegram sandbox, then emulator. The adapter must return `PHONE_E164_UNRESOLVED` rather than minting identity when the documented phone tag is absent.

- [ ] **Step 6: Run channel gates, Botpress checks, and commit**

```bash
npm test -- tests/unit/botpress/whatsapp-envelope.test.ts tests/unit/botpress/whatsapp-channel.test.ts tests/unit/botpress/channel-router.test.ts
npm --prefix botpress-agent run typecheck
npm --prefix botpress-agent run check
git add botpress-agent/src/channels tests/unit/botpress
git commit -m "feat: normalize official whatsapp messages"
```

---

### Task 3: Add a Canary Kill Switch and Release Readiness Gate

**Files:**
- Modify: `botpress-agent/agent.config.ts`
- Modify: `botpress-agent/src/channels/whatsapp.channel.ts`
- Modify: `.env.example`
- Create: `scripts/verify-whatsapp-release-readiness.mjs`
- Test: `tests/unit/botpress/whatsapp-channel.test.ts`
- Test: `tests/unit/scripts/whatsapp-release-readiness.test.ts`

**Interfaces:**
- Consumes: `configuration.automationEnabled`, `configuration.whatsappCanaryEnabled`, secret `WHATSAPP_CANARY_PHONE_E164S`, backend `/api/health`, `/api/ready`, and non-secret production configuration.
- Produces: fail-closed preflight JSON:

```ts
type WhatsAppReleaseReadiness = {
  ready: boolean;
  checks: Array<{ name: string; ok: boolean; reason: string | null }>;
};
```

- [ ] **Step 1: Write RED canary tests**

Assert that `automationEnabled=false` suppresses every official WhatsApp send, `whatsappCanaryEnabled=true` accepts only exact E.164 entries from the secret allowlist, and malformed/empty allowlists fail closed. Assert phone values never appear in logs.

- [ ] **Step 2: Write RED release-preflight tests**

The script must reject `localhost`, non-HTTPS `apiBaseUrl`, `BUSINESS_WORKSPACE_SLUG` other than `studyx`, missing HMAC/orchestrator/cron/Google Sheets/Stripe-test variables, `PAYMENT_PROVIDER=fake`, `/api/ready != ready`, disabled canary, enabled global automation, or an unavailable WhatsApp development integration.

- [ ] **Step 3: Run and confirm RED**

```bash
npm test -- tests/unit/botpress/whatsapp-channel.test.ts tests/unit/scripts/whatsapp-release-readiness.test.ts
```

- [ ] **Step 4: Implement config and readiness checks**

Add Botpress configuration booleans `whatsappCanaryEnabled=false` and retain `automationEnabled=false`. Add required secret declaration `WHATSAPP_CANARY_PHONE_E164S`. Change `.env.example` to `BUSINESS_WORKSPACE_SLUG=studyx` and document the required backend variables without values: `DATABASE_URL`, `ORCHESTRATOR_API_KEY`, `ORCHESTRATOR_KEY_ID`, `STUDYX_SIGNING_SECRET`, `CRON_SECRET`, `GEMINI_API_KEY`, `GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY`, `PAYMENT_PROVIDER=stripe_test`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SUCCESS_URL`, and `STRIPE_CANCEL_URL`.

- [ ] **Step 5: Run focal tests and local dry preflight**

```bash
npm test -- tests/unit/botpress/whatsapp-channel.test.ts tests/unit/scripts/whatsapp-release-readiness.test.ts
node scripts/verify-whatsapp-release-readiness.mjs --target development --format json
```

Expected locally: a safe nonzero exit naming public HTTPS/backend/cloud configuration blockers; no secret value is printed.

- [ ] **Step 6: Commit the kill switch and preflight**

```bash
git add botpress-agent/agent.config.ts botpress-agent/src/channels/whatsapp.channel.ts .env.example scripts/verify-whatsapp-release-readiness.mjs tests
git commit -m "feat: gate whatsapp activation behind canary readiness"
```

---

### Task 4: Build the Staging and Production Runbook

**Files:**
- Create: `docs/runbooks/whatsapp-go-live.md`
- Modify: `README.md`
- Modify: `docs/ORCHESTRATOR_MAP.md`
- Modify: `docs/PILOT_RUNBOOK.md`
- Test: `tests/unit/docs/whatsapp-go-live-runbook.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 plus the existing Vercel/Supabase/Botpress architecture.
- Produces: an operator checklist with separate `development canary`, `production canary`, `general availability`, and `rollback` gates.

- [ ] **Step 1: Write a RED runbook completeness test**

Assert that the runbook names every required secret/configuration key, exact health endpoints, `adk integrations copy --from dev --to prod --dry-run`, `adk build`, `adk deploy`, `automationEnabled`, `whatsappCanaryEnabled`, Stripe webhook verification, Google Sheets projection verification, Meta/Botpress integration status, and rollback order.

- [ ] **Step 2: Run and confirm RED**

```bash
npm test -- tests/unit/docs/whatsapp-go-live-runbook.test.ts
```

- [ ] **Step 3: Document the external prerequisites**

The runbook must require: a Facebook account, Facebook business page, WhatsApp Business Account, Meta business verification, an approved/test phone, the Botpress official integration, and either guided Botpress authorization or the documented manual fields `Verify Token`, `Access Token`, `Client Secret`, `Default Bot Phone Number ID`, and `WABA ID`. Values are entered only in Botpress/Meta control panels.

- [ ] **Step 4: Document the promotion sequence**

Require this order: local 50/50 → `npm run build` → `npm --prefix botpress-agent run build` → backend staging deployment → `/api/health` and `/api/ready` → Botpress development integration/playground → one-number canary → production dependency copy dry-run → production secret/config verification → production code deploy with automation disabled → one-number production canary → general availability approval.

- [ ] **Step 5: Document the rollback sequence**

First set `automationEnabled=false`; if inbound delivery continues unexpectedly, disable the WhatsApp integration; preserve database/audit evidence; do not delete conversations, contacts, outbox rows, or migrations; reconcile any `submitted_to_botpress` delivery before retrying.

- [ ] **Step 6: Run docs test and commit**

```bash
npm test -- tests/unit/docs/whatsapp-go-live-runbook.test.ts
git add docs README.md tests/unit/docs
git commit -m "docs: define supervised whatsapp go live"
```

---

### Task 5: Execute a Supervised WhatsApp Canary

**Files:**
- Evidence: `docs/evidence/whatsapp-canary-20260825.md`
- No source-code changes during the canary.

**Interfaces:**
- Consumes: a 50/50 Agent A report, readiness `ready:true`, public staging backend, configured Botpress development integration, and one allowlisted tester.
- Produces: trace-correlated evidence for eight real WhatsApp scenarios and an explicit go/no-go verdict.

- [ ] **Step 1: Obtain explicit authorization for external mutations**

Authorization must separately cover backend staging deployment, Botpress development deployment, WhatsApp integration authorization, setting development secrets/configuration, and sending messages from the tester account. It does not authorize production or customer traffic.

- [ ] **Step 2: Prepare cloud dependencies with automation disabled**

```bash
cd botpress-agent
adk integrations status --format json
adk check --format json
adk build
```

Configure the development integration in Botpress, set `apiBaseUrl` to the public HTTPS staging backend, keep `automationEnabled=false`, set `whatsappCanaryEnabled=true`, and store exactly one tester E.164 in `WHATSAPP_CANARY_PHONE_E164S`.

- [ ] **Step 3: Verify backend readiness before allowing responses**

```bash
curl --fail --silent --show-error "$STUDYX_STAGING_API_URL/api/health"
curl --fail --silent --show-error "$STUDYX_STAGING_API_URL/api/ready"
node scripts/verify-whatsapp-release-readiness.mjs --target development --format json
```

Expected: liveness succeeds, readiness is `ready`, and the release verifier returns `ready:true` without printing credentials.

- [ ] **Step 4: Enable automation only for the canary tester**

Set `automationEnabled=true` while `whatsappCanaryEnabled=true`. Confirm a non-allowlisted probe is suppressed before ingestion and the tester reaches the single router/adapter path.

- [ ] **Step 5: Run eight real WhatsApp scenarios**

Execute: greeting; known course facts; area navigation; direct call request; call decline and continued chat; explicit payment with Stripe test link; deferred payment with no link; opt-out acknowledgement followed by silence. Record only IDs, timestamps, statuses, durations, and hashes—no raw PII or full transcript—in the evidence file.

- [ ] **Step 6: Verify every scenario end to end**

For each trace, require one inbound event, one claimed batch, one decision, at most one outbound, one submitted delivery, correct consent state, exact authorized egress hash, expected Stripe count, and expected Sheets projection count. Require p95 response latency below 15 seconds and zero `paused_error`.

- [ ] **Step 7: Return to safe mode and record the verdict**

Set `automationEnabled=false` immediately after the canary. Mark GO only for 8/8 with zero hard/security/idempotency failures; otherwise mark NO-GO with failing trace IDs and keep both production automation and production WhatsApp disabled.

---

### Task 6: Prepare—But Do Not Perform—the Production Cutover

**Files:**
- Modify: `docs/runbooks/whatsapp-go-live.md`
- Evidence: `docs/evidence/whatsapp-production-preflight-20260825.md`

**Interfaces:**
- Consumes: successful development canary evidence.
- Produces: a reviewed dry-run and explicit list of remaining human approvals; no production mutation.

- [ ] **Step 1: Preview dependency promotion**

```bash
cd botpress-agent
adk integrations copy --from dev --to prod --dry-run --format json
```

Store only aliases, versions, enablement changes, and statuses. Do not store integration configuration values.

- [ ] **Step 2: Verify production configuration by presence, not value**

Confirm Botpress production secrets/configuration and Vercel production environment report every required key as present; confirm Supabase migrations and StudyX catalog checksum; confirm Stripe remains test mode until live payments receive separate authorization.

- [ ] **Step 3: Verify production-safe defaults**

Require `automationEnabled=false`, `whatsappCanaryEnabled=true`, exactly one production tester, WhatsApp integration disabled or canary-restricted, `/api/ready=ready`, and a documented rollback operator with access.

- [ ] **Step 4: Stop for explicit production approval**

The final evidence must state that these remain unexecuted: production dependency copy without `--dry-run`, `adk deploy`, enabling the production WhatsApp integration, enabling automation, attaching a customer-facing phone number, sending any customer message, and switching Stripe live.

---

## Release Gates

- **R0:** Agent A local regression is 50/50.
- **R1:** Official WhatsApp adapter unit/parity gates are green and no PII enters logs.
- **R2:** Next.js and Botpress production builds succeed; readiness verifier is green against staging.
- **R3:** Development WhatsApp canary is 8/8 and automation is returned to false.
- **R4:** Production dependency/configuration dry-run is reviewed with safe defaults.
- **R5:** Production cutover requires a new, explicit user authorization; this plan alone never grants it.

## Expected Outcome

The codebase is ready to receive official Botpress WhatsApp text events through the same canonical workflow already tested locally, while keeping deployment, integration authorization, real phone attachment, automation activation, and customer traffic behind separate reversible gates.
