# Direct course bonus V2 production cutover

Preparation only, 2026-10-28. No deployment, publication, environment change or customer message has been performed by Task 10. Every external step below requires the release operator's existing authorization and access. Neither Lucas's nor Thiago's production access is asserted here.

## Current release decision: blocked

The [Task 9 verification](../reports/2026-10-28-agent-a-direct-bonus-verification.md) proves local contracts with scripted model/channel/Central boundaries. Its latest tested source is `17a91049c10618e34274ea096ec9e29abcb527b3`; initial fix `9bac47df0bb010e6f0bddc9d5d16039fa8155633`, workflow/evidence `44bfc7d2c6bd65affcc29556fac27e628f7a758a`. Task 10's tested rollback correction is `ef4e7f4e6445caa634ca72bb3e7f50298f99b09a` (96 directed PostgreSQL tests; 4808 unit tests passed, 17 skipped, 7 todo, existing 15-second allowance; both typechecks, lint and guarded build passed). Freeze the final documentation-inclusive release SHA and rerun affected gates before a deploy. Do not label the Task 9 SHA as containing that correction.

Task 10 Fix1 additionally preserves direct offered/accepted/attached identity in the Agent A context with creation disabled, and restricts rollback guidance/repair to `delivered_bonus_offerings`. Its brain v133 source commit is discoverable with `git log -1 --format=%H -- botpress-agent/src/prompts/agent-a-brain-v1.ts`; it must be included in the frozen release. Fix1 local verification: 631 expanded checks and 4814 unit tests passed (17 skipped, 7 todo, existing 15-second allowance). These checks are additional to, not replacements for, the pending production gates below.

Full integration remains **889 passed, 7 failed, 1 skipped**, not green. Outstanding: legacy backfill fixture dropping a depended-on column; four global follow-up dispatcher contamination failures; isolated bootstrap pgcrypto/search-path failure; preexisting contact-profile clock/source-order sensitivity. Passing an isolated rerun does not resolve that sensitivity: implement deterministic occurrence ordering and verify both source orders. Thiago owns local remediation and a new full-suite result; the release owner records any explicit disposition. There is no disposition or global release approval in this document.

External gates are also pending: authenticated WhatsApp confirmed delivery correlated to the exact version; deployed Central/Moodle full-package and partial recovery; Retell/Xendra additive forwarding with authenticated call scope. Local fixtures do not establish provider behavior or natural model sales quality. Preserve the historical WhatsApp sandbox restrictions in [WhatsApp go-live](whatsapp-go-live.md); its 20/50 result is historical, not a fresh evaluation of this release.

## Provenance and local verification

Pin `studyx-agent-a-canonical-v98`, `studyx-agent-a-brain-v133`, canonical source SHA-256 `65e7632de64a0f33e47629a9283ede870e312c40cff94ce5eba2fc401b59c1ef` (93 lines), and byte-identical backend/Botpress generated modules. Brain v133 recognizes durable direct packages during review rollback and restricts guidance/repair to confirmed delivered gifts; v132 is the earlier Task 9/initial Task 10 evidence, not the new release target. Keep the canonical-source digest distinct from the manifest's template digest, rendered-turn prompt digest and Botpress artifact digest. They are different objects and must not be substituted for one another.

Local source comparison passed for brain v133: template digest `190bc66a4023a2d8ee105f49970e7505f6518ad1999ab0fb904bb0a73f43ee81`; latest migration `20261028010009_voice_course_selection_supersession.sql`. Recheck against the frozen release artifact; these local digests do not supply missing runtime/artifact attestation.

Run from the frozen release checkout, using local installed dependencies:

```sh
cd botpress-agent
npx adk check --format json
# Return to repository root:
cd ..
npm run release:manifest
```

Task 10 ran ADK with an empty inherited environment, offline npm and the existing local-only socket guard: `valid:true`, zero errors/warnings, assets/types available. This validates local structure, not TypeScript or Cloud deployment. The manifest script was inspected: it reads local Git/files and configuration-presence booleans; it does not deploy or make network requests. With ambient credentials removed, the required command exited 1 with `RELEASE_MANIFEST_TURN_PROMPT_REQUIRED`. No complete release manifest exists from that command. Do not supply fake secrets, a fabricated rendered prompt hash or an invented artifact hash to make it green.

Thiago must bind actual tested artifact evidence before publication: manifest `git_sha` equals the frozen release SHA, `prompt_version` is brain v133, source/generated modules remain canonical v98 with the digest above, `prompt_template_sha256` matches those tested files, `prompt_sha256` is the actual rendered turn (or an explicitly valid null path supported by the collector), `botpress_artifact_sha` is the tested bundle, `latest_migration` matches the release migration inventory, provider/model match source, and required configuration is attested by presence only. An output constructed with synthetic presence booleans is not release evidence. Missing values or a network/login requirement fail closed; obtain evidence through the authorized release operator, never inspect or print secret values.

## Compatibility deployment order

This order is a future procedure. Stop at each failed gate; no automatic progression from local preparation to external execution.

### 1. Additive backend in review

Thiago prepares the reviewed migration inventory and backend artifact from the frozen SHA; an authorized operator applies migrations first, then deploys the additive backend with `COURSE_BONUS_FLOW_MODE=review` and `CENTRAL_CARGA_BONUS_ENABLED=false`. Keep existing canary membership unchanged until its explicit test window; create no new direct offers. Record migration identifiers/checksums, operator, target, release/deployment IDs, timestamps and flag readbacks. Never roll schema back to undo a rollout. Existing direct obligations remain versioned and durable.

### 2. Readiness and old ADK compatibility

Before publishing a new ADK, Thiago records `/api/health`, `/api/ready`, backend SHA, schema parity, migration presence and readiness results without secrets. Exercise the still-deployed old ADK's legacy review proposal and empty legacy `accept_promotion` against the additive backend; record proposal schema/version, accepted/rejected result and durable outbound/recovery identity. Prove ordinary nonbonus Central v1 remains unchanged. Old ADK compatibility is required evidence, not inferred from optional schema fields. Verify contact identity scope, intake recap/confirmation, payment verification, early calls, call decline, campus access, opt-out and no invoice. A broken readiness/schema/old-ADK gate blocks publication.

### 3. Publish dual-mode ADK

Only after step 2 is green, the authorized Botpress operator publishes the tested dual-mode ADK from the same release SHA. Record Cloud artifact/deployment ID and digest and re-read readiness, prompt/brain versions and flags. Keep `COURSE_BONUS_FLOW_MODE=review`, global bonus enablement false, and existing traffic restrictions. The bundle must understand `commercial_state.promotion`, `promotion_cycle_id` and versioned `accept_promotion`, while retaining legacy review compatibility. No older incompatible bundle may become the rollback target.

### 4. Allowlisted direct canary

After full-suite disposition, provider prerequisites and explicit canary authorization, the authorized operator selects only consenting supervised contacts already in `CENTRAL_CARGA_BONUS_CANARY_CONTACT_IDS`. Read back exact opaque contact membership privately; evidence retains membership count/hash, never phone numbers. Set `COURSE_BONUS_MAX_COURSES=3` explicitly and `COURSE_BONUS_FLOW_MODE=direct`; keep `CENTRAL_CARGA_BONUS_ENABLED=false`. This is a contact-scoped exception, not global activation. Prove a nonallowlisted contact has no offer/payment/fulfillment side effect. Retain the independent WhatsApp send allowlist and environment restrictions; the Central allowlist does not authorize channel traffic. Run every row below and halt on any wrong promise, duplicate, silence, unverifiable delivery/access or identity mismatch.

## Canary evidence matrix

Every row needs a separate pass/fail/pending record, operator/owner, UTC start/end, environment, frozen SHA, deployment/artifact IDs and digest, scenario ID, `trace_id`, hashed scope IDs, `source_turn_id`, decision/action/rejection reason and repair result. For packages record `promotion_code`, `promotion_cycle_id`, `offer_version`, ordered course-code snapshots/hash, `outbound_message_id`, provider receipt reference, authenticated receipt result, `delivered_at`, customer `occurred_at`, acceptance/seal timestamps and replay counts. For payment/fulfillment include `payment_id`, signed event verification, immutable snapshot hash, job ID, Central release/schema/status, per-course state, `retry_offering_codes`, attempts, `manual_case_id`, notification/dispatch/claim/provider-delivery IDs or `recovery_id`. Use opaque identifiers and status evidence only: no PII, message bodies, credentials, payment URLs or raw webhooks. Pending evidence never counts as pass. `submitted_to_botpress is not confirmed delivery`.

The external spec has seven minimum scenarios and nine validation rules; both sets are explicit here.

| ID | Exercise and required outcome |
| --- | --- |
| S1 | No prior price objection, including first price question/first objection: useful reply, no gift; `no_price_objection`. |
| S2 | Prior committed same-course objection, personalized value and repeated objection: first valid gift persists before outbound; offer_available version 1. Interest is not formal purchase selection. |
| S3 | Second consecutive offer without a later customer reply: `bonus_without_reply`; package unchanged, useful reply/recovery. |
| S4 | Distinct replies after confirmed delivery permit second/third gifts; fourth gets `bonus_limit_reached`; exactly three ordered gifts. |
| S5 | Paid course proposed as gift: `same_as_paid_course`, no promise committed. |
| S6 | Explicit current-package acceptance seals exact delivered version; confirmed intake and USD 360 checkout carry its identity; signed paid event enrolls paid + N (N=1,2,3). Replay adds no enrollment/email/send. |
| S7 | Paid course changes after an offer: previous open cycle cancelled, new cycle empty, switching back does not resurrect it. |
| V1 | Disabled/nonallowlisted bonus: `bonus_disabled`; no new offer. |
| V2 | Prior objection evidence must precede current turn and match workspace/contact/conversation/course; foreign, future or current-only evidence rejected. |
| V3 | Missing/inactive/noncourse code: `invalid_offering`. |
| V4 | Paid-course identity cannot also be the gift. |
| V5 | Existing gift repeated: `duplicate_bonus`, immutable history. |
| V6 | Configured cap 1/2/3 enforced, no fourth course. |
| V7 | Two new codes in one turn: `multiple_bonus_in_turn`. |
| V8 | Pending/failed/submitted outbound or customer occurrence before confirmed delivery cannot extend or accept; record both timestamps. |
| V9 | Accepted/attached/paid sale cannot receive more gifts: `sale_already_closed`. |
| C1 | Two concurrent near-limit appends using independent transactions: one append, one structured rejection; no fourth course/duplicate promise. |
| C2 | Stale version/code/cycle acceptance after another append: reject and repair against current delivered package; exact current version seals once. |
| C3 | Course change after accepted/attached checkout, A→B→A, late send completion and signed late payment: old snapshot immutable, superseded link cannot retarget; one reconciliation case, no wrong-course auto-enrollment. |
| C4 | Real Central partial Moodle failure: payment remains paid, complete package identity/idempotency retained, only pending subset retried after `supports_partial_recovery:true`; exhausted attempts create durable human case. No complete access/credentials early. |
| C5 | Rollback from offer_available/accepted/attached with both text and authenticated voice: new offers blocked, existing exact delivered acceptance and sealed checkout/fulfillment preserved; no obligation deleted. |
| C6 | Real no-silence trace: refused direct effect rolls back promise/outbound, same Agent A repairs usefully, persisted dispatch/claim reaches actual channel delivery; exhausted repair has durable recovery with responsible operator. No orphan successful inbound. |
| C7 | Early call without exact course, call decline→chat, voice current acceptance/selection, direct price/real inability to pay, duplicate inbound and opt-out: existing consent/intake/payment/no-invoice contracts remain intact. |
| C8 | Central new/existing students, identical replay, unknown offering/unsupported schema 422, changed-package 409, HTTP 202 GET-only, exact ordered full active set and exactly one welcome email; partial never masquerades as complete. |

## Owners and missing external evidence

| Owner | Action before the next gate | Evidence required / current state |
| --- | --- | --- |
| Lucas (coordinates Central/Moodle owner) | Supply deployed Central v2 commit/release, paid + 1–3 gift mappings, run S6/C4/C8 for new and existing students. | Deployment IDs, sanitized request/snapshot hashes, ordered per-course active/already_enrolled evidence, capability `supports_partial_recovery:true`, pending-only retry/replay counts and one-email evidence. Pending; this repo's contract fixture is insufficient. |
| Lucas (coordinates business) | Confirm allowed active catalog courses, cap, channels/validity, consenting canary contacts and refund/manual-reconciliation owner. | Approved nonsecret mapping/campaign record, named operator and case destination. Pending; no business approval inferred. |
| Lucas (coordinates Retell/Xendra operator) | Publish/forward promotion code, cycle, version, paid-course identity, explicit acceptance and authenticated call scope. | Tool schema/release IDs plus signed scoped acceptance and course-change/late-checkout traces; no fabricated WhatsApp inbound. Pending. |
| Thiago / our backend-ADK team | Fix/disposition full integration issues, verify rollback regression, freeze source/bundle and manifest; supply readiness/schema/old-ADK proof. | Exact commands/results/SHA, 7-failure disposition, hashes/versions and complete manifest. Local evidence only; manifest remains blocked. |
| Thiago / authorized Botpress-WhatsApp operator | Wire/prove authenticated provider confirmed-delivery receipt through the existing delivery-status endpoint; run V8/C6. | Exact outbound/version/provider correlation, monotonic delivered timestamp, later inbound occurrence and real visible response or durable recovery. Pending; local submission proves no provider delivery. |
| Thiago + Lucas + release owner | Review matrix, reconcile every pending case and record go/no-go before any global enablement. | Signed-off evidence references, explicit scope/owner/time. Pending; access and approval must be recorded by actual operators. |

## Rollback

1. Set `COURSE_BONUS_FLOW_MODE=review` to stop new direct promises; keep `CENTRAL_CARGA_BONUS_ENABLED=false` and keep the dual-mode ADK active. No new offers or extensions are allowed, including for canary contacts. Confirm readback and readiness. Do not restore an ADK unable to understand versioned direct packages without a separately tested compatibility adapter.
2. Inventory exact direct packages and delivery/payment/job/case state before changing contact membership. For `offer_available` (persisted status `offered`), accept the exact already delivered version only after a later correlated customer reply or authenticated voice acceptance. Never create or expand a package to resolve rollback. Pending/failed/undelivered versions stay nonacceptable and need delivery reconciliation; never blindly resend a possibly submitted outbound.
3. For `accepted` and `attached`, continue exact sealed checkout, signed-payment reconciliation and full paid-plus-gifts fulfillment. Preserve contact membership needed by existing fulfillment safety gates, or assign a durable manual case with an accountable operator if automatic execution is unavailable. New-creation flags are not permission to revoke an existing promise. A superseded old payment stays auditable and opens one reconciliation case; never enroll the newly selected course automatically.
4. Keep complete access messaging gated on every promised course active/already_enrolled. For a partial failure preserve paid status, retry only pending courses under verified Central capability, then escalate durably. Use the channel emergency stop in the WhatsApp runbook for unexpected traffic; pausing sends does not cancel payment/enrollment obligations. Resume only after every possibly submitted send is reconciled.
5. Never delete migrations, bonus snapshots, payments, offers, jobs, delivery receipts or cases. Never cancel accepted obligations. Never reinterpret direct packages as review jobs. Preserve append-only history and audit evidence. Record operator, reason, mode/readiness readbacks, affected opaque package IDs, unchanged snapshot hashes and each obligation's next responsible owner/action.

Rollback acceptance/checkout is tested locally for text and voice with new offers disabled. Provider delivery, real Central recovery, Retell/Xendra forwarding, complete manifest and broad-suite qualification remain separate pending gates. Global enablement requires all matrix rows reviewed and a new explicit release decision; this runbook does not grant it.
