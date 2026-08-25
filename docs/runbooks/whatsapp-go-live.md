# Controlled Botpress WhatsApp Sandbox demo — not production

## Status and authority

This is an operator checklist for a **controlled Botpress WhatsApp Sandbox demo**, not a production launch. Today the Agent A regression result is **20/50**, not the required local 50/50. Therefore every external action is blocked: do not deploy, install or authorize an integration, write cloud secrets, attach a phone, or send a message.

**Task 5 is blocked until explicit authorization** separately covers staging deployment, Botpress development deployment, the WhatsApp Sandbox authorization, configuration/secrets, and messages from one named tester. That authorization does not authorize production or customer traffic. The gates below document the future path; they are not permission to execute it.

The pinned dependency and its non-secret metadata are in [the WhatsApp integration contract](whatsapp-integration-contract.md). Botpress development and production are independent environments: never copy a token, secret value, or account setting between them.

## 1. External prerequisites — record presence, never values

Before an authorized Sandbox demo, an operator must have all of the following:

- a Facebook account and Facebook business page;
- a WhatsApp Business Account (WABA) with Meta business verification complete;
- one approved/test phone, owned by the tester and represented as strict E.164;
- the official Botpress WhatsApp integration pinned to `whatsapp@4.18.5`;
- either the guided Botpress authorization, or the manual fields **Verify Token**, **Access Token**, **Client Secret**, **Default Bot Phone Number ID**, and **WABA ID**.

Enter values only in the Botpress/Meta control panels. Do not put values in this repository, a terminal transcript, evidence, screenshots, issue comments, or a local `.env` example. Confirm the Meta/Botpress integration status is the pinned WhatsApp integration, configured only for the intended environment, and either disabled or Sandbox-restricted until the relevant gate permits it.

### Backend and Botpress presence checklist

In the Vercel/Supabase environment, confirm these names are present without printing their values:

```text
DATABASE_URL
ORCHESTRATOR_API_KEY
ORCHESTRATOR_KEY_ID
STUDYX_SIGNING_SECRET
CRON_SECRET
GEMINI_API_KEY
GOOGLE_SHEETS_CLIENT_EMAIL
GOOGLE_SHEETS_PRIVATE_KEY
GOOGLE_SHEETS_SPREADSHEET_ID
GOOGLE_SHEETS_TAB_NAME
PAYMENT_PROVIDER=stripe_test
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_SUCCESS_URL
STRIPE_CANCEL_URL
PAYMENT_LINK_12M
PAYMENT_LINK_6M
PAYMENT_LINK_CONTADO
BUSINESS_WORKSPACE_SLUG=studyx
```

In Botpress, confirm the presence of `STUDYX_ORCHESTRATOR_KEY`, `STUDYX_SIGNING_SECRET`, `CRON_SECRET`, and exactly one `WHATSAPP_CANARY_PHONE_E164S` tester entry. Confirm non-secret configuration names and safe values by environment: `apiBaseUrl` is public HTTPS and points to the intended backend, `orchestratorKeyId` matches `ORCHESTRATOR_KEY_ID`, `automationEnabled` is off unless the authorized development tester is actively running, and `whatsappCanaryEnabled` is on only for that narrow canary.

Stripe remains test-only: verify a signed event reaches `/api/webhooks/payments/stripe`, its `STRIPE_WEBHOOK_SECRET` verifies it, and the canonical payment state changes only for the expected test payment. The canonical offer mapping resolves `PAYMENT_LINK_12M`, `PAYMENT_LINK_6M`, and `PAYMENT_LINK_CONTADO`; verify presence and the expected test-mode mapping without logging URLs. Verify the Google Sheets projection separately: its outbox item is idempotently projected once to `GOOGLE_SHEETS_SPREADSHEET_ID` / `GOOGLE_SHEETS_TAB_NAME` using `GOOGLE_SHEETS_CLIENT_EMAIL` and `GOOGLE_SHEETS_PRIVATE_KEY`; the sheet is an operator projection, never the source of truth.

## 2. Health, ready, and readiness commands

Run these only after the underlying deployment has explicit authorization. They are read-only checks and must return a healthy liveness response, a ready readiness response, and release-verifier `ready:true` without exposing values.

```bash
curl --fail --silent --show-error "$STUDYX_STAGING_API_URL/api/health"
curl --fail --silent --show-error "$STUDYX_STAGING_API_URL/api/ready"
(cd botpress-agent && adk run ./scripts/attest-whatsapp-canary.ts)
node scripts/verify-whatsapp-release-readiness.mjs --target development --format json
```

Among the ADK informational lines, the runtime attestation must contain exactly
one `STUDYX_WHATSAPP_CANARY_ATTESTATION={"valid":true,"count":1}` line. Zero,
duplicate, or malformed framed lines are a hard no-go. The payload never prints a phone or secret value. The official WhatsApp canary gate runs
before workflow creation, ingest, decision, call dispatch, or send; it also
precedes payment, PII persistence, and every workflow network request. A
non-allowlisted identity causes none of those side effects; the pre-send gate
remains defense-in-depth.

`GET /api/health` is liveness: it proves the process responds. `GET /api/ready` is readiness: it proves required configuration and PostgreSQL permit traffic. The release verifier is the third readiness check: it requires a public HTTPS DNS hostname (IP-literal API URLs are always rejected), backend configuration, Botpress development integration status, Stripe test mode, the single tester allowlist, and safe switches. A failed check is a no-go; do not work around it.

## 3. Controlled promotion sequence

The sequence is deliberately written as gates. With the current 20/50 result, it stops at the first gate. Do not skip, reorder, or treat a later command as authorized by an earlier green check.

1. **R0 — local 50/50.** Obtain a fresh 50/50 Agent A regression result; the current 20/50 blocks all following steps.
2. **Build gate.** Run `npm run build`, then `npm --prefix botpress-agent run build` (which runs `adk build`). Both must succeed before any backend staging deployment.
3. **Staging gate.** Perform the authorized backend staging deployment, then run the `/api/health` and `/api/ready` checks above against its public HTTPS URL. Do not use localhost for Botpress Cloud.
4. **Development integration/playground gate.** In the authorized Botpress development environment, confirm the official integration is pinned, configured for **sandbox** (not production), and visible in the Botpress development integration/playground. Run `adk check --format json` and the release verifier. `adk deploy` is an external mutation and remains forbidden until its separate development-deployment authorization is granted.
5. **Development canary gate.** Set up one-number development canary only: one tester, one exact allowlist entry, sandbox integration, and all preflight checks green. First prove that global automation remains off; only the authorized test window may enable it for that one tester. Return it to off immediately after the script below.
6. **Production-preview gate.** Review only the dry-run result:

   ```bash
   cd botpress-agent
   adk integrations copy --from dev --to prod --dry-run --format json
   ```

   This is not permission to copy dependencies, credentials, or configuration into production. Record only aliases, versions, enablement changes, and statuses—never values.
7. **Production configuration gate.** Complete production secret/config verification by presence only: required Vercel and Botpress names, matching key IDs, Supabase migrations, catalog checksum, public HTTPS, Stripe test mode, Meta/Botpress integration status, and `/api/ready=ready`. A production code deploy with automation disabled is still a separate authorized action.
8. **Production canary gate.** After a new production authorization, permit exactly one-number production canary, with the production integration disabled or canary-restricted until the tester is confirmed. Do not attach a customer-facing phone or enable Stripe live.
9. **General availability gate.** The general availability approval requires a successful development 8/8, automation returned off, reviewed production dry-run, zero hard/security/idempotency failures, and an explicit new approval. This runbook never grants that approval.

### Development Botpress deployment procedure

This procedure is documentation only while R0 is 20/50: **no external mutation until authorized**. Before the deploy command, obtain a **separate explicit development deployment authorization**; the Sandbox/canary authorization alone is insufficient. Create an audit record with authorization reference, approver, operator, UTC start time, intended Botpress development environment, source commit, expected integration alias/version, and the assertion that no customer traffic is authorized.

1. In the development environment, confirm the safe default readback: `automationEnabled=false`, `whatsappCanaryEnabled=false`, the WhatsApp integration is disabled, and no tester allowlist is used for sending.
2. Run `npm --prefix botpress-agent run build` and `adk check --format json`. Against the already authorized public staging backend, run `/api/health` and `/api/ready`; record only status, trace ID, timestamp, and deployment/commit identifier.
3. Reconfirm the selected environment is development in the Botpress control panel, then execute `adk deploy`. Record the command target/status and resulting deployment ID in the audit record; do not record configuration or secret values.
4. Re-read the safe defaults and repeat `/api/health` and `/api/ready`. Do not enable integration, automation, canary, tester allowlist, or messages in this procedure. Those are a later, separately authorized development-canary action.

**Rollback:** if the deployment is wrong or either readiness check fails, stop, keep `automationEnabled=false` and `whatsappCanaryEnabled=false`, leave the WhatsApp integration disabled, record the failure, and follow [Rollback](#6-rollback). Do not roll forward or send a probe message.

### Production Botpress deployment procedure

This procedure is also documentation only: **no external mutation until authorized**. Before the production deploy command, obtain a **separate explicit production deployment authorization**. It must be distinct from development, Sandbox, canary, general-availability, Meta, phone, and payment approvals. Create an audit record with authorization reference, approver, operator, UTC start time, intended Botpress production environment, source commit, reviewed dry-run identifier, and the assertion that no customer traffic is authorized.

1. Confirm the reviewed command remains a preview only: `adk integrations copy --from dev --to prod --dry-run --format json`. In the production environment, confirm `automationEnabled=false`, `whatsappCanaryEnabled=false`, the WhatsApp integration is disabled, no production tester allowlist is active for sending, and Stripe remains test mode.
2. Verify the production configuration by presence only and run `/api/health` and `/api/ready` against the selected public production backend. Record statuses, trace IDs, timestamps, source commit, and target; never record values, URLs, phone numbers, or credentials.
3. Reconfirm the selected environment is production in the Botpress control panel, then execute `adk deploy`. Record the command target/status and resulting deployment ID in the audit record. This does not authorize integration enablement, automation, canary activation, a phone attachment, or a customer message.
4. Re-read `automationEnabled=false` and `whatsappCanaryEnabled=false`, confirm the integration remains disabled, and repeat `/api/health` and `/api/ready`. A one-number production canary still requires its own subsequent authorization.

**Rollback:** if the deployment is wrong or either readiness check fails, stop, keep `automationEnabled=false` and `whatsappCanaryEnabled=false`, leave the WhatsApp integration disabled, preserve the audit record, and follow [Rollback](#6-rollback). Do not roll forward or send a probe message.

## 4. Development canary — eight-scenario demo script

This section is executable only after R0 through the development canary gate are green and explicit external authorization has been recorded. It is a one-tester controlled Sandbox demo, not a customer test.

For the one allowlisted tester, run these exact eight scenarios:

1. `greeting`
2. `known course facts`
3. `area navigation`
4. `direct call request`
5. `call decline and continued chat`
6. `explicit payment with Stripe test link`
7. `deferred payment with no link`
8. `opt-out acknowledgement followed by silence`

For every scenario, verify one inbound event, one claimed batch, one decision, at most one outbound, one submitted delivery, expected consent state, the authorized egress hash, expected Stripe count, expected Google Sheets projection count, no `paused_error`, and a response time contributing to p95 under 15 seconds. For the payment scenario, verify the Stripe webhook before calling payment complete. For the projection scenario, verify the canonical outbox row and then its one Google Sheets projection.

Evidence fields are: scenario label, `trace_id`, opaque internal IDs or hashes, UTC timestamps, status/reason codes, duration, inbound/batch/decision/outbound counts, consent result, Stripe count, Sheets projection count, and pass/fail. Use **no PII**: do not record a phone number, name, message body, raw transcript, webhook payload, token, account ID, or screenshot containing any of them.

## 5. Production canary and general availability

These remain unexecuted today. A production canary is allowed only after the separate production authorization and all R4 gates are documented green:

- production Botpress values are entered directly in its production control panel, never copied from development;
- exactly one production tester is allowlisted and the integration remains disabled or canary-restricted;
- Stripe stays `stripe_test`; switching to Stripe live needs separate approval;
- the rollback operator has access and confirms the readiness checks;
- the same eight scenarios produce the required evidence without PII.

General availability requires explicit approval after the production canary; it is never inferred from a development Sandbox demo or a dry-run.

## 6. Rollback

Rollback requires no code deployment. At the first hard, security, idempotency, or unexpected-delivery failure, stop the canary and execute this order:

1. Set `automationEnabled=false` in the affected Botpress environment and confirm the configuration readback.
2. If inbound delivery continues unexpectedly, **disable the WhatsApp integration** in that same environment.
3. **preserve database/audit evidence** and the no-PII evidence record.
4. **do not delete conversations, contacts, outbox rows, or migrations**.
5. Before any retry, inspect and reconcile every `submitted_to_botpress` delivery; a Botpress message ID means the send may already be real, so never resend blindly.
6. Leave production automation and production WhatsApp disabled. Classify the defect, add a failing regression test first, fix it, and restart at R0 only after review and a new authorization.

## 7. Historical Telegram pilot

[The Telegram pilot runbook](../PILOT_RUNBOOK.md) remains historical evidence of the earlier synthetic-identity pilot. It is not the current WhatsApp launch authority and does not authorize an external Telegram or WhatsApp activation.
