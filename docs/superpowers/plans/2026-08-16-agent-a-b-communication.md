# StudyX Agent A–B Communication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an idempotent, observable bridge in which Agent A can request one immediate voice call, Agent B can exchange canonical events and commands during the call, and Agent A resumes exactly once after the call.

**Architecture:** Botpress proposes a typed action, while Next.js validates per-call consent and creates the call session in PostgreSQL. Voice providers implement a common port; Retell webhooks and tools append facts to a ledger, and a reducer derives current state without trusting arrival order. Botpress receives post-call commands through a custom Runtime API event, while Supabase remains canonical.

**Tech Stack:** Next.js 16.3, TypeScript 5.9, Zod 4, PostgreSQL 17/Supabase, Vitest 4, Botpress ADK 2.0.5, Retell SDK and Runtime API.

**Spec:** `specs/005-agent-a-b-communication/spec.md`, extending `specs/004-sales-orchestration/spec.md` and `specs/004-sales-orchestration/contracts.md`.

## Global Constraints

- Preserve existing user changes; never reset, clean, stash, deploy, push, or apply a remote migration without separate authorization.
- Every migration is additive. Applied migration files remain immutable.
- PostgreSQL is canonical. Retell, Botpress and Sheets are external projections/providers.
- Provider lifecycle events remain `requested | started | ended | analyzed`; derived failures are backend states.
- Per-call consent is mandatory and bound to one canonical inbound message.
- The model never supplies `contact_id`, phone, `call_id`, consent evidence or provider identifiers.
- One active call per contact and one call per source turn are database invariants.
- External effects occur after commit and reuse a stable idempotency key.
- A dispatch timeout becomes `dispatch_ambiguous`; it is reconciled by lookup and is never blindly redialled.
- Messages received during an active call are durable and deferred, except opt-out/cancel controls.
- Human transfer, autonomous payment and recurring follow-up remain disabled.
- Logs contain IDs, state, error code and latency only; never phone, transcript, prompt, email or message body.

## Implementation Order

This plan owns the shared protocol and backend. The Agent A customer-flow plan consumes its `Decision v4`, call ledger, consent/state and `request_call_now` interfaces after Tasks 1–4 are green; that second plan owns the claim-time `sales_context` projection.

## File Map

| Responsibility | Files |
|---|---|
| Contract | `src/features/orchestration/domain/decision-v4.ts`, `src/lib/contracts/call-event.ts`, `botpress-agent/src/schemas/contracts.ts`, `botpress-agent/src/schemas/call-events.ts` |
| Persistence | new additive call migration, `src/lib/supabase/database.types.ts` |
| Domain | `src/features/calls/domain/call-state.ts`, `src/features/calls/domain/call-consent.ts` |
| Application | `request-call.ts`, `dispatch-call.ts`, `record-call-event.ts`, `execute-voice-tool.ts`, `route-post-call.ts` |
| Ports | `call-store.ts`, `voice-provider.ts`, `agent-command-publisher.ts` |
| Adapters | PostgreSQL store, fake provider, Retell provider, Botpress Runtime publisher |
| HTTP | signed Agent API routes, exact Retell webhook, voice tool route, cron reconciler |
| Botpress | dispatch action, custom `agentCommand` event and trigger |
| Tests | unit, contract, integration and provider tests under existing `tests/` conventions |

---

### Task 1: Close the Existing Inbound Batch Lifecycle

**Files:**

- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `src/lib/services/decision.service.ts`
- Modify: `src/app/api/agent/turns/[turn_id]/decision/route.ts`
- Modify: `tests/integration/orchestration-lifecycle.test.ts`
- Modify: `tests/contract/botpress-response-parity.test.ts`

**Interfaces:**

- Consumes: `batch.id` and `batch.claim_token` returned by the existing claim.
- Produces: a decision commit that atomically calls `complete_inbound_batch(batch_id, claim_token, null)`.

- [ ] **Step 1: Write the failing lifecycle assertion**

Add an integration case that ingests, claims and commits one decision, then reads:

```ts
const rows = await sql<Array<{ state: string }>>`
  SELECT state FROM inbound_batches WHERE id = ${batchId}::uuid
`;
expect(rows[0].state).toBe('completed');
```

- [ ] **Step 2: Run the scoped test and confirm the current leak**

Run:

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/orchestration-lifecycle.test.ts
```

Expected: FAIL because the production decision path leaves the batch `claimed`.

- [ ] **Step 3: Carry ownership into the commit contract**

Extend the request consistently on both sides:

```ts
export interface BatchOwnership {
  batch_id: string;
  claim_token: string;
}
```

`CommitDecisionInput` must include `batch: BatchOwnership`; the route must reject a missing or malformed UUID before opening a transaction.

- [ ] **Step 4: Complete the batch inside the decision transaction**

After the immutable decision/outbound work and before returning, call:

```sql
SELECT outcome, state
FROM complete_inbound_batch(
  ${batchId}::uuid,
  ${claimToken}::uuid,
  NULL
)
```

Accept only `completed | duplicate`; map `stale_claim | not_found` to a decision conflict so a caller cannot close another workflow's batch.

- [ ] **Step 5: Run lifecycle, contract and baseline checks**

```bash
npm run test:unit
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/orchestration-lifecycle.test.ts
npm run typecheck
(cd botpress-agent && npm run typecheck && npm run check)
```

- [ ] **Step 6: Commit the lifecycle correction**

```bash
git add botpress-agent/src/schemas/contracts.ts botpress-agent/src/workflows/processInboundTurn.ts src/lib/services/decision.service.ts src/app/api/agent/turns/'[turn_id]'/decision/route.ts tests/integration/orchestration-lifecycle.test.ts tests/contract/botpress-response-parity.test.ts
git commit -m "fix: complete claimed batch with decision"
```

### Task 2: Freeze Decision v4 and CallEvent v2 Contracts

**Files:**

- Create: `src/features/orchestration/domain/decision-v4.ts`
- Modify: `src/features/orchestration/domain/decision-v3.ts`
- Modify: `src/lib/contracts/call-event.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/schemas/call-events.ts`
- Create: `supabase/migrations/20260816010001_agent_decisions_v4_call_actions.sql`
- Create: `tests/unit/orchestration/decision-v4-policy.test.ts`
- Modify: `tests/contract/call-event-schema.test.ts`
- Modify: `tests/contract/zod-parity.test.ts`
- Add fixtures: `tests/fixtures/call-events/`

**Interfaces:**

- Consumes: immutable Decision v2/v3 parsers and CallEvent v1.
- Produces: `DecisionV4`, `RequestCallNowAction`, CallEvent v2 correlation and automated schema parity.

- [ ] **Step 1: Write failing Decision v4 tests**

```ts
const action = {
  type: 'request_call_now' as const,
  reason: 'accepted_offer' as const,
  course_of_interest: 'Python',
};

expect(() => parseDecisionV4({
  schema_version: 4,
  intent: 'commercial',
  kind: 'reply',
  response: 'Perfecto. Registré la llamada; nuestra asesora virtual intenta comunicarse ahora.',
  response_type: 'call_confirmation',
  confidence: 1,
  reason_code: 'CALL_CONSENT_ACCEPTED',
  business_action: action,
  memory_candidates: [],
  missing_information: [],
  next_state: 'completed',
  retrieval_used: null,
})).not.toThrow();
```

Also reject the action with `clarification`, `suppress`, `human_request`, an unknown reason or any identity field such as `phone_e164`.

- [ ] **Step 2: Run the red policy test**

```bash
npm run test:unit -- tests/unit/orchestration/decision-v4-policy.test.ts
```

Expected: FAIL because `parseDecisionV4` does not exist.

- [ ] **Step 3: Implement the strict v4 domain parser**

Use this exact executable union:

```ts
export type DecisionV4BusinessAction =
  | { type: 'mark_hot_lead'; score: number }
  | { type: 'log_objection'; objection_key: string; quote: string }
  | {
      type: 'request_call_now';
      reason: 'direct_request' | 'accepted_offer';
      course_of_interest?: string;
    };
```

Add `call_offer | call_confirmation` to the v4 response-type set. Require `call_offer` to use `business_action=null`, `kind='reply'` and `next_state='waiting_user'`; require `request_call_now` to accompany `response_type='call_confirmation'`. Preserve v2/v3 parsers and dispatch by `schema_version`.

- [ ] **Step 4: Add CallEvent v2 correlation without trusting Retell shapes**

Create a v2 parser with required canonical correlation while preserving the v1
parser until all queued fixtures/events drain:

```ts
schema_version: z.literal(2),
trace_id: z.string().uuid(),
provider_call_id: z.string().min(1).max(512).nullable(),
```

Retell's DTO stays separate from the canonical event. V2 allows a null provider ID only on `requested`; every mapped Retell lifecycle event must carry it. Add v1 compatibility fixtures plus v2 fixtures for a known provider ID, null provider ID on `requested`, and invalid empty provider ID.

- [ ] **Step 5: Add the v4 database constraints**

The additive migration must accept schemas `2 | 3 | 4`; for schema 4 it accepts only `mark_hot_lead | log_objection | request_call_now`, and enforces `request_call_now` with `call_confirmation` and a non-suppress decision.

- [ ] **Step 6: Automate both schema implementations against every fixture**

Extend the root parity test to invoke the Botpress fixture validator for call events and compare accept/reject results, removing the current manual-only gap.

- [ ] **Step 7: Run contract verification**

```bash
npm run test:unit -- tests/unit/orchestration/decision-v4-policy.test.ts
npm run test -- tests/contract/call-event-schema.test.ts tests/contract/zod-parity.test.ts
npm run typecheck
(cd botpress-agent && npm run typecheck && npm run check)
```

- [ ] **Step 8: Commit the frozen protocol**

```bash
git add src/features/orchestration/domain/decision-v4.ts src/features/orchestration/domain/decision-v3.ts src/lib/contracts/call-event.ts botpress-agent/src/schemas/contracts.ts botpress-agent/src/schemas/call-events.ts supabase/migrations/20260816010001_agent_decisions_v4_call_actions.sql tests/unit/orchestration/decision-v4-policy.test.ts tests/contract/call-event-schema.test.ts tests/contract/zod-parity.test.ts tests/fixtures/call-events
git commit -m "feat: freeze agent call decision protocol"
```

### Task 3: Create the Durable Call Ledger

**Files:**

- Create: `supabase/migrations/20260816010002_call_ledger.sql`
- Modify: `src/lib/supabase/database.types.ts`
- Create: `tests/integration/call-ledger-invariants.test.ts`

**Interfaces:**

- Consumes: canonical contacts, conversations, messages, decisions and outbox.
- Produces: `call_sessions`, `call_events`, `call_tool_executions`, `call_deferred_messages`, `call_event_quarantine`, `agent_commands` and `post_call_actions`.

- [ ] **Step 1: Write red integration cases for every invariant**

Cover:

```ts
expect(await activeCallCount(contactId)).toBe(1);
expect(await eventCount('retell', 'call_started:provider-1')).toBe(1);
expect(await deferredCount(callId, messageId)).toBe(1);
expect(await postCallActionCount(callId, 'handback')).toBe(1);
```

The test must attempt two active calls, duplicate source turns, duplicate provider events and the same tool ID with a different payload hash.

- [ ] **Step 2: Run the migration test and observe missing relations**

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/call-ledger-invariants.test.ts
```

- [ ] **Step 3: Create `call_sessions` with explicit orthogonal states**

Required columns include `id`, `source_turn_id`, `decision_id`, `contact_id`, `conversation_id`, `provider`, `provider_call_id`, `request_idempotency_key`, `status`, `analysis_status`, `consent_source_message_id`, `offered_by_decision_id`, `context_snapshot`, `prompt_version`, error fields and lifecycle timestamps.

Required indexes:

```sql
CREATE UNIQUE INDEX call_sessions_one_active_per_contact_uq
ON call_sessions (contact_id)
WHERE status IN (
  'requested', 'dispatching', 'provider_accepted',
  'dispatch_ambiguous', 'in_progress'
);

CREATE UNIQUE INDEX call_sessions_provider_call_uq
ON call_sessions (provider, provider_call_id)
WHERE provider_call_id IS NOT NULL;
```

- [ ] **Step 4: Create append-only child ledgers**

Enforce `UNIQUE(provider,event_id)` on `call_events`, `UNIQUE(call_id,tool_call_id)` on tool executions, `UNIQUE(call_id,message_id)` on deferred messages, `UNIQUE(call_id,action_type)` on post-call actions and a unique `deduplication_key` on agent commands. `call_event_quarantine` stores only provider, provider event key, provider call ID, payload hash, reason and timestamp; it never stores transcript, recording URL or raw body.

- [ ] **Step 5: Add state-transition and immutability triggers**

Identity, consent evidence, context snapshot and provider event payloads are immutable. A terminal call never moves back to an active status. `analysis_status` changes independently.

- [ ] **Step 6: Restrict privileges**

Grant the orchestrator only `SELECT, INSERT, UPDATE`; revoke `DELETE, TRUNCATE`; keep events and tool request payloads immutable after insert.

- [ ] **Step 7: Run clean migration and invariant loops**

```bash
bash scripts/verify-native-postgres-loop.sh
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/call-ledger-invariants.test.ts
npm run typecheck
```

- [ ] **Step 8: Commit the ledger**

```bash
git add supabase/migrations/20260816010002_call_ledger.sql src/lib/supabase/database.types.ts tests/integration/call-ledger-invariants.test.ts
git commit -m "feat: add durable voice call ledger"
```

### Task 4: Implement Consent Policy, State Reducer and Call Store

**Files:**

- Create: `src/features/calls/domain/call-consent.ts`
- Create: `src/features/calls/domain/call-state.ts`
- Create: `src/features/calls/ports/call-store.ts`
- Create: `src/features/calls/adapters/postgres-call-store.ts`
- Create: `tests/unit/calls/call-consent.test.ts`
- Create: `tests/unit/calls/call-state.test.ts`
- Create: `tests/integration/call-store.test.ts`

**Interfaces:**

- Consumes: current batch messages, latest call offer, contact facts and event ledger.
- Produces: `evaluateVoiceConsent`, `projectCallState` and `CallStore`.

- [ ] **Step 1: Write the consent table as tests**

Include direct “llamame”, contextual “sí”, expired offer, explicit negation, revoked consent, missing phone and an existing active call. The negation case must assert:

```ts
expect(evaluateVoiceConsent(input('Sí, pero no me llames'))).toEqual({
  allowed: false,
  code: 'CALL_EXPLICITLY_DECLINED',
});
```

- [ ] **Step 2: Implement the bounded deterministic policy**

Normalize case/accents. Recognize direct requests and short acceptances only; anything outside the bounded patterns returns `CALL_CONFIRMATION_REQUIRED`. A short acceptance requires a same-conversation `call_offer` no older than 15 minutes.

- [ ] **Step 3: Write all event-order permutations**

For `started`, `ended` and `analyzed`, generate all six permutations and assert one identical final projection. Also assert that an `ended(no_answer)` event without `started` stays `no_answer` when a late `started` event arrives.

- [ ] **Step 4: Implement the pure reducer**

```ts
export function projectCallState(input: {
  providerAccepted: boolean;
  cancelledAt: string | null;
  events: readonly CanonicalCallEvent[];
}): { status: CallStatus; analysisStatus: AnalysisStatus; result: string | null };
```

Recompute from all facts; never apply “last webhook wins”.

- [ ] **Step 5: Implement the store port**

```ts
export interface CallStore {
  reserveCall(input: ReserveCallInput): Promise<ReservedCall>;
  claimDispatch(callId: string, workerId: string): Promise<DispatchClaim>;
  attachProviderCall(callId: string, providerCallId: string): Promise<void>;
  appendEvent(event: CanonicalCallEvent): Promise<'recorded' | 'duplicate'>;
  recomputeProjection(callId: string): Promise<CallProjection>;
  findActiveByContact(contactId: string): Promise<CallProjection | null>;
}
```

- [ ] **Step 6: Run unit and store tests**

```bash
npm run test:unit -- tests/unit/calls/call-consent.test.ts tests/unit/calls/call-state.test.ts
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/call-store.test.ts
```

- [ ] **Step 7: Commit the domain and adapter**

```bash
git add src/features/calls tests/unit/calls tests/integration/call-store.test.ts
git commit -m "feat: add call consent and state domain"
```

### Task 5: Reserve One Call Atomically with Agent A's Decision

**Files:**

- Create: `src/features/calls/application/request-call.ts`
- Modify: `src/lib/services/decision.service.ts`
- Modify: `src/app/api/agent/turns/[turn_id]/decision/route.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Create: `tests/integration/agent-a-call-handoff.test.ts`

**Interfaces:**

- Consumes: validated Decision v4 and the claimed canonical turn.
- Produces: `call_request: { call_id, status } | null` in the commit response.

- [ ] **Step 1: Write the atomicity and replay tests**

Execute ten identical commits and two concurrent commits. Assert one decision, one call session, one `voice.call.dispatch` outbox event and the same `call_id` in every successful response.

- [ ] **Step 2: Write the refusal cases**

Assert no call for absent consent, stale offer, blocked contact, invalid/missing phone, active call or real Retell effect on a sandbox identity.

- [ ] **Step 3: Implement `requestCall` inside the existing transaction**

It derives contact, phone, provider and consent source from the turn, inserts `call_sessions`, appends canonical `requested`, and creates this immutable outbox payload:

```ts
{
  schema_version: 1,
  topic: 'voice.call.dispatch',
  call_id: callId,
  trace_id: traceId,
  idempotency_key: `voice-call:${callId}`,
}
```

Do not make a network call inside the transaction.

- [ ] **Step 4: Return the canonical request**

```ts
call_request: z.object({
  call_id: z.string().uuid(),
  status: z.literal('requested'),
}).nullable()
```

A duplicate decision reloads and returns the existing call request.

- [ ] **Step 5: Run concurrency and policy verification**

```bash
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/agent-a-call-handoff.test.ts
npm run test:unit -- tests/unit/orchestration/decision-v4-policy.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit the atomic handoff**

```bash
git add src/features/calls/application/request-call.ts src/lib/services/decision.service.ts src/app/api/agent/turns/'[turn_id]'/decision/route.ts botpress-agent/src/schemas/contracts.ts tests/integration/agent-a-call-handoff.test.ts
git commit -m "feat: reserve one call from agent decision"
```

### Task 6: Add Voice Providers and Immediate Dispatch

**Files:**

- Create: `src/features/calls/ports/voice-provider.ts`
- Create: `src/features/calls/adapters/fake-voice.provider.ts`
- Create: `src/features/calls/adapters/retell-voice.provider.ts`
- Create: `src/features/calls/adapters/telegram-sim-voice.provider.ts`
- Create: `src/features/calls/application/dispatch-call.ts`
- Create: `src/app/api/agent/calls/[call_id]/dispatch/route.ts`
- Create: `src/app/api/cron/reconcile-calls/route.ts`
- Modify: `src/lib/config.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Create: `tests/unit/calls/dispatch-call.test.ts`
- Create: `tests/unit/calls/retell-provider.test.ts`

**Interfaces:**

- Consumes: persisted call session and `voice.call.dispatch` outbox item.
- Produces: `provider_call_id` or an explicit ambiguous/retryable terminal verdict.

- [ ] **Step 1: Write the provider contract and fake tests**

```ts
export interface VoiceProvider {
  placeCall(input: {
    callId: string;
    phoneE164: string;
    context: CallContextV1;
    idempotencyKey: string;
  }): Promise<{ providerCallId: string; acceptedAt: string }>;
  findCallByInternalId(callId: string): Promise<{ providerCallId: string } | null>;
  cancelCall(providerCallId: string): Promise<void>;
}
```

The fake records requests by idempotency key and returns the same provider ID for replay.

- [ ] **Step 2: Test success, confirmed failure and timeout ambiguity**

The application test must assert:

```ts
expect(await dispatchCall(successInput)).toMatchObject({ status: 'provider_accepted' });
expect(await dispatchCall(ambiguousInput)).toMatchObject({ status: 'dispatch_ambiguous' });
expect(voiceProvider.placeCall).toHaveBeenCalledTimes(1);
```

- [ ] **Step 3: Implement the Retell adapter**

Use `POST /v2/create-phone-call`, `metadata: { call_id }`, `override_agent_id`, a fixed published agent version and `retell_llm_dynamic_variables` containing only the strings from `CallContextV1`. Use `Authorization: Bearer RETELL_API_KEY` and an abort timeout lower than the route timeout.

- [ ] **Step 4: Implement dispatch fencing**

Claim `requested` with a lease, move to `dispatching`, call the provider after commit, then attach the provider ID. On timeout, set `dispatch_ambiguous`; the Retell implementation of `findCallByInternalId` calls `/v3/list-calls` with a metadata filter `{ key: 'call_id', type: 'string', value: callId }`. It attaches the unique match; zero matches keep the row paused for another bounded lookup, and multiple matches dead-letter the request for operator review. It never redials automatically.

- [ ] **Step 5: Configure the exact environment surface**

Add `RETELL_API_KEY`, `RETELL_FROM_NUMBER`, `RETELL_AGENT_ID`, `RETELL_AGENT_VERSION`, `RETELL_REQUEST_TIMEOUT_MS`, and `VOICE_PROVIDER=telegram_sandbox|retell`. Validate all values at startup without logging them.

- [ ] **Step 6: Run provider and build checks**

```bash
npm run test:unit -- tests/unit/calls/dispatch-call.test.ts tests/unit/calls/retell-provider.test.ts
npm run typecheck
npm run lint
npm run build
```

- [ ] **Step 7: Commit provider dispatch**

```bash
git add src/features/calls src/app/api/agent/calls src/app/api/cron/reconcile-calls src/lib/config.ts .env.example package.json package-lock.json tests/unit/calls
git commit -m "feat: dispatch calls through voice provider port"
```

### Task 7: Secure and Reconcile Retell Webhooks

**Files:**

- Create: `src/features/calls/adapters/retell-webhook.ts`
- Create: `src/features/calls/application/record-call-event.ts`
- Create: `src/app/api/webhooks/voice/retell/route.ts`
- Modify: `src/proxy.ts`
- Modify: `tests/unit/security/proxy-public-paths.test.ts`
- Create: `tests/unit/calls/retell-webhook.test.ts`
- Create: `tests/integration/call-event-reconciliation.test.ts`

**Interfaces:**

- Consumes: Retell raw body and `x-retell-signature`.
- Produces: one canonical event linked through `metadata.call_id` and `provider_call_id`.

- [ ] **Step 1: Write public-path and signature tests**

Only `/api/webhooks/voice/retell` bypasses the internal Botpress key. Its handler must return 401 for missing/invalid Retell signatures and must verify the exact raw bytes.

- [ ] **Step 2: Implement signature verification**

Use:

```ts
const rawBody = await request.text();
const signature = request.headers.get('x-retell-signature');
const valid = signature !== null
  && await Retell.verify(rawBody, process.env.RETELL_API_KEY!, signature);
```

Parse JSON only after `valid` is true.

- [ ] **Step 3: Map Retell to the canonical event**

Map `call_started`, `call_ended`, and `call_analyzed`; use `metadata.call_id` as internal identity and Retell `call.call_id` as `provider_call_id`. Unknown calls are quarantined and never create contacts.

Derive the stable provider event key as `retell:<event>:<provider_call_id>` for lifecycle events. Retell retries the same lifecycle webhook, so this key must back `UNIQUE(provider,event_id)`.

- [ ] **Step 4: Persist before acknowledging**

Insert the event and recompute state in a short transaction. Return 204 immediately after durable acceptance; post-call work runs from the outbox.

- [ ] **Step 5: Prove dedupe and order independence**

Replay each webhook three times and submit every event permutation. Assert one event per unique key and the same final state/result.

- [ ] **Step 6: Run security and integration checks**

```bash
npm run test:unit -- tests/unit/security/proxy-public-paths.test.ts tests/unit/calls/retell-webhook.test.ts
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/call-event-reconciliation.test.ts
```

- [ ] **Step 7: Commit webhook ingestion**

```bash
git add src/features/calls/adapters/retell-webhook.ts src/features/calls/application/record-call-event.ts src/app/api/webhooks/voice/retell/route.ts src/proxy.ts tests/unit/security/proxy-public-paths.test.ts tests/unit/calls/retell-webhook.test.ts tests/integration/call-event-reconciliation.test.ts
git commit -m "feat: ingest signed retell call events"
```

### Task 8: Defer and Recover Messages Received During the Call

**Files:**

- Modify: `src/lib/services/ingestion.service.ts`
- Modify: `src/features/orchestration/domain/turn-policy.ts`
- Modify: `src/features/orchestration/application/claim-batch.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Create: `tests/unit/orchestration/active-call-policy.test.ts`
- Create: `tests/integration/messages-during-call.test.ts`

**Interfaces:**

- Consumes: active call projection for the contact.
- Produces: `deferred_call` ingestion outcome and ordered release after call end.

- [ ] **Step 1: Write the loss-prevention test**

Ingest three messages during `in_progress`; assert all messages exist, zero decisions exist for them, zero model/catalog calls occur and all three are linked to the same call.

- [ ] **Step 2: Write priority-control tests**

Assert that “no me escribas más”, “cancelá la llamada” and a phone correction are not deferred as normal conversation. Opt-out updates consent immediately; cancellation updates the call; phone correction requires confirmation before changing destination.

- [ ] **Step 3: Add a non-terminal ingest outcome**

Extend the response with:

```ts
status: z.enum(['accepted', 'duplicate', 'suppressed', 'deferred_call']),
deferred_call_id: z.string().uuid().nullable().default(null),
```

The Botpress workflow exits before claim/model when status is `deferred_call`.

- [ ] **Step 4: Release messages idempotently**

On terminal call state, mark the rows `released_at` in one transaction and enqueue exactly one `post_call.handback` action for that call.

- [ ] **Step 5: Run deferral checks**

```bash
npm run test:unit -- tests/unit/orchestration/active-call-policy.test.ts
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/messages-during-call.test.ts
```

- [ ] **Step 6: Commit call-aware ingestion**

```bash
git add src/lib/services/ingestion.service.ts src/features/orchestration/domain/turn-policy.ts src/features/orchestration/application/claim-batch.ts botpress-agent/src/schemas/contracts.ts botpress-agent/src/workflows/processInboundTurn.ts tests/unit/orchestration/active-call-policy.test.ts tests/integration/messages-during-call.test.ts
git commit -m "feat: defer customer messages during active calls"
```

### Task 9: Add Idempotent B Tools and the Botpress Command Bridge

**Files:**

- Create: `src/lib/contracts/voice-tool-request.ts`
- Create: `src/features/calls/application/execute-voice-tool.ts`
- Create: `src/app/api/voice/tools/[tool_name]/route.ts`
- Create: `src/features/calls/ports/agent-command-publisher.ts`
- Create: `src/features/calls/adapters/botpress-runtime-command.publisher.ts`
- Create: `src/app/api/cron/publish-agent-commands/route.ts`
- Modify: `src/proxy.ts`
- Modify: `src/lib/config.ts`
- Modify: `.env.example`
- Modify: `tests/unit/security/proxy-public-paths.test.ts`
- Create: `botpress-agent/src/triggers/processAgentCommand.ts`
- Create: `botpress-agent/src/actions/claimAgentCommand.ts`
- Modify: `botpress-agent/agent.config.ts`
- Create: `tests/unit/calls/voice-tools.test.ts`
- Create: `tests/unit/calls/botpress-command-publisher.test.ts`
- Create: `tests/integration/voice-tool-idempotency.test.ts`

**Interfaces:**

- Consumes: signed Retell custom function call linked by `call_id`.
- Produces: one stored tool result and, when needed, one Botpress `agentCommand` event.

- [ ] **Step 1: Freeze and test the strict tool envelope**

Use `VoiceToolRequestV1` from the spec. Only the exact `/api/voice/tools/:tool_name` prefix bypasses the internal Botpress key in `src/proxy.ts`; every tool handler requires `Authorization: Bearer RETELL_TOOL_SECRET` using constant-time comparison. Reject a missing/invalid secret, unknown tool, unknown/terminal call, reused `tool_call_id` with a different canonical payload hash and arguments outside each tool's Zod schema.

Add `RETELL_TOOL_SECRET` to validated configuration and `.env.example`; never reuse `RETELL_API_KEY` as the custom-function bearer.

- [ ] **Step 2: Implement only the safe initial tool allowlist**

Enable `consultar_curso`, `consultar_oferta`, `guardar_datos_contacto`, `enviar_material`, and `registrar_resultado`. `enviar_link_pago`, `verificar_pago`, `agendar_seguimiento`, transfer and human derivation return a structured `CAPABILITY_DISABLED` result until their own provider-backed plans are implemented.

- [ ] **Step 3: Create canonical Agent A commands**

`enviar_material` inserts one command with:

```ts
{
  schema_version: 1,
  command_id: commandId,
  call_id: callId,
  type: 'send_whatsapp_text',
  conversation_id: conversationId,
  deduplication_key: `call:${callId}:tool:${toolCallId}`,
}
```

The text remains in PostgreSQL; the event payload contains IDs only.

- [ ] **Step 4: Publish through the Botpress Runtime API**

Define custom `agentCommand` in `agent.config.ts`. The publisher calls `POST /v1/chat/events` with bot authentication, `type='agentCommand'`, `conversationId`, and `{ command_id }`.

- [ ] **Step 5: Send idempotently inside the trigger**

The trigger claims the command from the signed backend action and calls Runtime `getOrCreateMessage` with tag `studyxCommandId=command_id`, discriminating by that tag. It reports submission back to the backend using attempt fencing.

- [ ] **Step 6: Run tool, command and replay tests**

```bash
npm run test:unit -- tests/unit/calls/voice-tools.test.ts tests/unit/calls/botpress-command-publisher.test.ts
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/voice-tool-idempotency.test.ts
(cd botpress-agent && npm run typecheck && npm run check)
```

- [ ] **Step 7: Commit the tool bridge**

```bash
git add src/lib/contracts/voice-tool-request.ts src/features/calls src/app/api/voice/tools src/app/api/cron/publish-agent-commands src/proxy.ts src/lib/config.ts .env.example tests/unit/security/proxy-public-paths.test.ts botpress-agent/agent.config.ts botpress-agent/src/triggers/processAgentCommand.ts botpress-agent/src/actions/claimAgentCommand.ts tests/unit/calls tests/integration/voice-tool-idempotency.test.ts
git commit -m "feat: bridge voice tools to agent commands"
```

### Task 10: Route One Post-Call Handback

**Files:**

- Create: `src/features/calls/application/route-post-call.ts`
- Create: `src/lib/services/post-call.service.ts`
- Create: `botpress-agent/src/workflows/processPostCallHandback.ts`
- Create: `tests/unit/calls/post-call-routing.test.ts`
- Create: `tests/integration/post-call-handback.test.ts`

**Interfaces:**

- Consumes: terminal technical state, optional analysis and deferred messages.
- Produces: one `post_call_action` and one Botpress handback command at most.

- [ ] **Step 1: Write the complete routing table as tests**

Cover every result in `CallResultSchema`, technical failures, missing analysis, late analysis and deferred-message presence.

- [ ] **Step 2: Implement a pure router**

```ts
export type PostCallRoute =
  | { type: 'no_message'; reason: string }
  | { type: 'resume_with_deferred'; messageIds: string[] }
  | { type: 'offer_retry'; reason: 'no_answer' | 'busy' | 'failed' | 'timed_out' }
  | { type: 'payment_followup'; callId: string }
  | { type: 'post_sale'; callId: string };
```

`venta_confirmada` may select `post_sale` only when a structured payment fact is verified; otherwise select `payment_followup`.

- [ ] **Step 3: Enforce one action and bounded analysis wait**

Create the post-call action after both `ended` and `analyzed`, or after a 30-second analysis deadline. A late analysis may enrich stored facts but cannot enqueue a second customer message.

- [ ] **Step 4: Build the Botpress handback workflow**

It loads the authorized action, combines deferred messages into one claimed context, generates one Decision v4 without `request_call_now`, sends once and reports delivery through the existing fenced mechanism.

- [ ] **Step 5: Prove one follow-up under replays and concurrency**

Run duplicate ended/analyzed webhooks and two routers simultaneously. Assert one post-call action, one canonical outbound and one Botpress command.

- [ ] **Step 6: Run post-call verification**

```bash
npm run test:unit -- tests/unit/calls/post-call-routing.test.ts
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration -- tests/integration/post-call-handback.test.ts
(cd botpress-agent && npm run typecheck && npm run check)
```

- [ ] **Step 7: Commit handback routing**

```bash
git add src/features/calls/application/route-post-call.ts src/lib/services/post-call.service.ts botpress-agent/src/workflows/processPostCallHandback.ts tests/unit/calls/post-call-routing.test.ts tests/integration/post-call-handback.test.ts
git commit -m "feat: resume agent a after voice calls"
```

### Task 11: Execute the Fake-Provider Pilot and Production Gate

**Files:**

- Create: `tests/e2e/agent-a-b-call-lifecycle.test.ts`
- Modify: `docs/PILOT_MATRIX.md`
- Modify: `docs/FAILURE_MATRIX.md`
- Modify: `docs/PILOT_RUNBOOK.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**

- Consumes: complete fake-provider lifecycle.
- Produces: evidence-backed approval to configure Retell development, then production.

- [ ] **Step 1: Encode the mandatory E2E matrix**

Include direct request, accepted offer, ambiguous “sí”, missing phone, blocked contact, duplicate request, concurrent request, provider timeout, duplicate webhook, all event permutations, message during call, no answer, late analysis and exactly one handback.

- [ ] **Step 2: Run the complete local gate**

```bash
npm run test
TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55433/studyx_test npm run test:integration
bash scripts/verify-native-postgres-loop.sh
npm run typecheck
npm run lint
npm run build
(cd botpress-agent && npm run typecheck && npm run check)
```

- [ ] **Step 3: Record latency and correctness evidence**

Record `consent_to_request_ms`, `request_to_provider_accepted_ms`, `provider_accepted_to_started_ms`, `ended_to_handback_ms`, duplicate counts and deferred-message counts by `trace_id`/`call_id`, without customer content.

- [ ] **Step 4: Configure Retell development only**

Import the existing unpublished Agent B draft, remove human transfer and disabled tools, set the exact webhook URL/events, publish a fixed version, configure a development number and run ten allowlisted test identities.

- [ ] **Step 5: Require production acceptance criteria**

Proceed only with zero duplicates, zero lost deferred messages, zero invalid signatures accepted, all local gates green, p95 request-to-provider acceptance below 10 seconds and a documented kill switch that sets `VOICE_PROVIDER=telegram_sandbox` or disables call actions.

- [ ] **Step 6: Commit evidence and runbooks**

```bash
git add tests/e2e/agent-a-b-call-lifecycle.test.ts docs/PILOT_MATRIX.md docs/FAILURE_MATRIX.md docs/PILOT_RUNBOOK.md docs/ROADMAP.md
git commit -m "test: gate agent a b call lifecycle"
```

## References

- Retell Create Phone Call: https://docs.retellai.com/api-references/create-phone-call
- Retell webhook verification and retry behavior: https://docs.retellai.com/features/webhook-overview
- Botpress Runtime `createEvent`: https://botpress.com/docs/api-reference/runtime-api/openapi/createEvent/
- Botpress Runtime `getOrCreateMessage`: https://botpress.com/docs/api-reference/runtime-api/openapi/getOrCreateMessage
