# Agent A Nonblocking Orchestrator

Date: 2026-10-01
Status: approved conceptually in chat; pending written-spec review
Implementation base: `codex/agent-a-logical-turn-recovery`

## 1. Outcome

Restore Agent A as the uninterrupted conversational owner while retaining every
operational capability already built: calls, Agent B, Stripe, payment
verification, contact intake, Supabase, Sheets, memory, campaign attribution,
multiple courses, WhatsApp and Telegram.

DeepSeek interprets and writes the commercial conversation. The orchestrator
executes authorized actions, records state and returns structured results. A
failed, incomplete or rejected action must never invalidate the useful
conversation around it.

This is an architectural separation, not a rollback of product features and not
a new collection of conversational rules.

## 2. Current failure

The current turn path treats model generation, schema parsing, commercial fact
validation, action authorization, repair and persistence as one success unit. A
failure in any later step can enter the same catch path used for a model outage
and replace the entire Agent A answer with a generic technical fallback.

Production evidence on 2026-10-01 showed correctly batched and claimed messages
ending as `MODEL_UNAVAILABLE` with provider `botpress` and model
`policy:conversation-pipeline-v1-unavailable`, although the user input itself was
valid. By contrast, the stable Tuesday baseline produced 51 direct DeepSeek
decisions out of 52. The regression correlates with additional action and policy
gates, not with a material increase in prompt size.

The database currently persists the generic terminal classification but not the
exact internal failure stage. This prevents distinguishing a real DeepSeek
outage from an action rejection or a projection failure.

## 3. Non-goals

- Do not move sales wording into the backend.
- Do not add planners, regex-based intent routing, phrase libraries or canned
  commercial fallbacks.
- Do not make message length, bubble count, vocabulary, sales phases or call
  invitation wording backend policy.
- Do not remove truth, security, opt-out, authorization, idempotency or duplicate
  prevention controls.
- Do not replace DeepSeek silently with another language model.
- Do not rewrite all endpoints, database tables or integrations at once.

## 4. Product invariants

1. Agent A remains the only author of customer-facing commercial prose.
2. The orchestrator remains the authority for facts, permissions and effects.
3. An action result may change what Agent A says next, but cannot erase the
   conversation that requested the action.
4. Persistence and external projections may retry independently and cannot block
   message delivery.
5. Every sensitive effect is idempotent and correlated to the same lead,
   conversation and logical turn.
6. Provider failures, invalid model output, action rejections and projection
   failures are distinct failure classes in storage and observability.
7. DeepSeek is the sole conversational provider. There is one bounded retry only
   for timeout, network failure or provider `5xx`.

## 5. Target architecture

The turn is divided into three lanes with explicit boundaries.

### 5.1 Conversation lane

The conversation lane:

- builds the canonical logical context;
- sends the complete current intervention to DeepSeek;
- receives Agent A's conversational proposal and optional action request;
- delivers the proposal directly when no sensitive action is needed;
- asks Agent A to continue from a real structured action result when an action is
  attempted.

The internal draft contract is versioned rather than retrofitted into every old
policy field:

```ts
type AgentTurnDraftV3 = {
  messages: AgentMessage[]
  move: CommercialMove
  memory_candidates: MemoryCandidate[]
  action_request?: AgentActionRequest
}
```

For a normal answer, `messages` are final. For a sensitive action, the draft must
not claim that the action succeeded before execution. The action result is added
to the same logical turn and Agent A produces the final continuation.

### 5.2 Action lane

The action lane uses the existing call, payment, contact and orchestration
services. It validates and executes effects but returns data, never sales copy:

```ts
type ActionResultV1 = {
  request_id: string
  action: AgentActionName
  status:
    | 'succeeded'
    | 'needs_input'
    | 'rejected'
    | 'temporarily_unavailable'
    | 'ambiguous'
  code: string
  missing_fields: string[]
  canonical_data: Record<string, unknown>
  retryable: boolean
}
```

Examples include `MISSING_LAST_NAME`, `MISSING_PAYMENT_PLAN`,
`CALL_ALREADY_ACTIVE`, `PAYMENT_NOT_VERIFIED` and `PROVIDER_UNAVAILABLE`.
Agent A decides how to request a missing value, explain a temporary problem or
continue selling by chat. The backend does not convert these codes into customer
messages.

An invalid action request rejects only the action. It is never reclassified as a
model outage and never discards safe conversational content.

### 5.3 Projection lane

Memory selection, Sheets projection, embeddings, campaign attribution,
multi-course projection and noncritical summaries run through the existing
outbox/idempotent jobs after the conversational turn is committed.

Projection failure records an exact retryable error and retries independently.
It cannot replace, delay or retract an Agent A reply. Sheets continues to update
one row per lead, while normalized Supabase state remains the source of truth.

## 6. Turn data flow

1. Persist and batch the user's logical intervention.
2. Claim the batch once using the current correlation and concurrency controls.
3. Build conversation context from logical turns and durable commercial state.
4. Generate `AgentTurnDraftV3` with DeepSeek.
5. If no sensitive action is requested, commit and deliver Agent A's messages.
6. If an action is requested, execute it once in the action lane.
7. Give `ActionResultV1` to DeepSeek and request the natural continuation.
8. Commit the final messages and durable commercial effects atomically where
   required.
9. Enqueue noncritical projections and delivery reconciliation.

The second DeepSeek call exists only when the customer-visible response depends
on a real action result. A normal conversational turn uses one generation.

## 7. Error model

### 7.1 Conversational provider failure

Retry once with the same DeepSeek model only for timeout, network failure or
provider `5xx`. Do not retry `4xx`, schema-policy rejection or application
validation as if they were provider outages.

If both transient attempts fail, keep the batch recoverable as `retry_pending`
with the same idempotency keys. Do not complete it with backend-authored sales
copy. An operational notice after the retry window may be sent as a technical
channel message, but it must not mutate the commercial state or pretend to be
Agent A.

### 7.2 Invalid model structure or unsupported fact

Return a structured validation result to DeepSeek for one repair. Preserve all
safe content and remove or correct only the unsupported assertion. Exhausting
that repair records the exact validation code; it does not become
`MODEL_UNAVAILABLE`.

### 7.3 Action failure

Return `ActionResultV1` and let Agent A continue. Missing data is requested
naturally. Temporary provider failure is explained naturally and the sale
continues by chat. Duplicate effects return the existing canonical effect rather
than executing again.

### 7.4 Projection failure

Record, retry and alert independently. Never block the conversation.

## 8. Authority boundary

### Agent A owns

- interpretation of typos, fragments, slang, ambiguity and references;
- conversational wording, rhythm and useful message splitting;
- sales guidance, objection handling and next-step proposals;
- deciding what missing information to ask the user for;
- natural continuation from structured action results.

### The orchestrator owns

- canonical course, plan, price and payment facts;
- authorization and execution of calls, links and payment verification;
- opt-out, blocked-contact, security and privacy enforcement;
- idempotency, replay protection and duplicate prevention;
- contact, conversation, call and commercial state;
- memory and Sheets projection;
- exact technical diagnostics.

The backend may reject a fabricated fact, an unverified payment claim or an
unauthorized effect. It may not reject an otherwise valid conversation because
of style, phrasing, message count or sales-sequence preference.

## 9. State and idempotency

- Preserve the existing `lead_id`, `conversation_id`, logical turn/batch id,
  `internal_call_id`, provider ids and payment reservation ids.
- Derive an action idempotency key from conversation, logical turn, action type
  and canonical target.
- Store the action request and action result separately from the conversational
  decision.
- Store an exact failure stage and code for every failed attempt.
- Keep Agent A and Agent B as two channels into the same commercial lead state.
- A completed Agent B call updates durable state and memory; Agent A reads that
  state on the next turn without asking for confirmed information again.
- Project each lead idempotently to one Sheets row; multiple courses and plans
  remain normalized in Supabase and are rendered deterministically in the row.

## 10. Incremental migration

The change is introduced behind a production-readable feature flag and reuses
the existing integrations.

1. Persist exact stage/code diagnostics before changing behavior.
2. Restore the bounded transient DeepSeek retry.
3. Introduce the versioned draft and action-result contracts.
4. Split action authorization/execution from conversational acceptance.
5. Add the Agent A continuation after action results.
6. Make noncritical projections strictly nonblocking.
7. Run a canary through the same workflow and validators used in production.
8. Enable the new path gradually, keeping an immediate flag rollback to the
   prior stable SHA.

This is not a full rollback to Tuesday. Tuesday's conversational behavior is the
quality baseline; current operational features remain and are moved behind the
new boundary.

## 11. Observability

Each logical turn records:

- `conversation_attempt_id` and provider attempt count;
- provider/model and latency;
- failure stage: generation, parsing, fact validation, action validation, action
  execution, commit, delivery or projection;
- exact error code and retryability;
- requested action and resulting status, without secrets or unnecessary PII;
- delivery, action and projection correlation ids.

Required metrics:

- conversation survival rate;
- direct DeepSeek decision rate;
- action rejection to technical fallback rate;
- provider retry and exhaustion rate;
- duplicate calls, payment links, contacts and Sheets rows;
- projection backlog and age.

## 12. Verification

Tests must exercise the same workflow, resolver, validator, action services and
PostgreSQL boundary used by production. Generator-only prompt tests are
insufficient.

The regression corpus includes:

- stable Tuesday conversations as the naturalness baseline;
- typos, slang, fragments and consecutive messages;
- short ambiguous replies such as `sí` and `entonces`;
- unsupported amounts and media placeholders;
- missing call or payment fields;
- rejected, unavailable and duplicate actions;
- call interruption and Agent B post-call continuation;
- payment link delivery and verified/unverified payment states;
- projection failure while the conversation succeeds.

Acceptance criteria:

1. Action rejection produces an Agent A continuation and never
   `MODEL_UNAVAILABLE`.
2. `action_rejection_to_technical_fallback` is zero.
3. Every fallback has an exact persisted failure stage and code.
4. No call, link, contact, event or Sheets row is duplicated under replay.
5. Safe conversational text is not shortened, rewritten or removed by backend
   style policy.
6. Existing call, Agent B, Stripe, Sheets, memory, campaign and multi-course
   flows pass focused vertical tests.
7. The supervised clean smoke passes on Telegram and WhatsApp from the same
   Vercel/Botpress SHA.
8. Conversation survival is at least 99% excluding confirmed provider outages;
   outages leave recoverable turns rather than false commercial completion.

## 13. Expected implementation surface

Likely affected components are limited to:

- Botpress inbound workflow and DeepSeek attempt handling;
- plannerless resolution/validation orchestration;
- Agent A decision contracts and schemas;
- backend decision commit and action execution contracts;
- outbox/projection workers for memory and Sheets;
- structured decision and action diagnostics;
- vertical workflow/integration tests and deployment health checks.

The canonical behavioral prompt changes only if an observed contract mismatch
requires it. Its personality, sales phases, call invitations and existing
StudyX guidance are not redesigned by this migration.

## 14. Rollout and rollback

- Build and verify from one commit.
- Deploy Vercel and Botpress from the same SHA.
- Confirm health, active feature flags and DeepSeek configuration before smoke.
- Canary with a clean conversation, then test one call and one payment path.
- Stop rollout on duplicate effects, conversation loss or correlation drift.
- Roll back the feature flag or deployment SHA without reverting database data;
  new records are additive and versioned.
