# Agent A logical-turn recovery and production rollout

> Execute inline with TDD. Preserve natural language generation: the backend may authorize actions and facts, but must not compose sales copy.

## Goal

Make the production Telegram path interpret a burst of user messages as one logical turn, retain identity and full multi-bubble history, offer/carry out calls from the model's existing structured intent, and preserve short natural sales replies without new conversational blockers.

## Global constraints

- Start from `b66b21463d7f3896f58ea873e10132413dccbef9` in an isolated worktree.
- Preserve commit `82bd008` logical history projection.
- No new planner, positive-intent regex, mandatory evidence field, canned commercial fallback, post-generation truncation, or forced single-message renderer.
- The current proposal is already tied to the claimed batch/turn. Use its existing `move`, `proposed_action`, vetoes, capabilities, persisted state, and idempotency.
- Keep safety invariants: opt-out, negative veto, canonical facts/prices, phone required to call, one link/action under retries, `payment_reported != payment_verified`.
- Botpress and Vercel must deploy the same final SHA.

## Task 1 — Persist inbound text before scheduling

**Intent:** eliminate the race where rapid Telegram messages are scheduled before they are durably grouped.

1. Add failing router/workflow tests proving text is ingested before `workflow.getOrCreate`, the ingest result is passed into the workflow, and retryable failures are rethrown.
2. Extract the current canonical ingest HTTP operation into a shared function used by the action and router.
3. Extend workflow input with optional `preingested`; reuse it instead of ingesting twice. Audio keeps the current transcribe-then-ingest path.
4. Verify idempotent retries create no duplicate message, batch, decision, or outbound.

## Task 2 — Trust provider ordering safely

**Intent:** keep the user's real message order when delivery/scheduling latency differs.

1. Add failing tests for provider timestamps inside a bounded skew window and for untrusted/invalid timestamps.
2. Normalize provider occurrence time only inside `received_at - 5m` through `received_at + 2m`; otherwise fall back to durable receive/sequence order.
3. Persist trusted/effective timing metadata without a migration.
4. Make batch reads and decision construction share the same store ordering.

## Task 3 — Persist identity and unblock the first call offer

1. Add failing tests for explicit inverted identity such as `Thiago me llamo` and reject ambiguous prose.
2. Persist only conservative explicit identity evidence; remove duplicate local name heuristics.
3. Do not require a known first name merely to offer a call. Still require a phone number to execute one.
4. Verify the contact and conversation context expose the same durable name.

## Task 4 — Use existing semantic call authority

1. Add failing policy/workflow tests for `move=request_call` plus `proposed_action=request_call_now`, explicit refusal, missing phone, later phone, active call, and replay.
2. Remove the positive literal-call regex as a hard authorization requirement. Do not add a replacement evidence field.
3. Authorize from the current proposal's structured move/action plus capability, no `vetoes.call`, no explicit negative refusal, and no active call.
4. If the phone is missing, persist accepted call preference and let the model ask for it. When the phone arrives later, resume exactly one call.

## Task 5 — Keep visible behavior honest and natural

1. Add failing tests proving response classification and metrics describe the authorized visible output, not a stripped original proposal.
2. Record `proposed_call_offer` and `visible_call_offer` separately.
3. Make one concise prompt edit only: respond to the whole logical turn; use one or two short messages according to natural rhythm, and three only for a real options/list plus close; do not repeat a fact, question, or invitation already made.
4. Regenerate the prompt artifact and increment its version once. Do not enforce message count in backend code.

## Task 6 — Production-parity proof and rollout

1. Add a vertical test covering router dispatch -> shared ingest -> PostgreSQL batch -> real workflow/policy -> commit/outbound. Mock only DeepSeek transport and the physical channel delivery.
2. Prove rapid messages with delayed workers form one logical batch/decision/outbound.
3. Prove: name -> course -> first call offer -> doubt -> second offer -> request call -> phone; max two offers and one call action.
4. Run affected focal tests, then one final full gate: unit, affected PostgreSQL integration, both typechecks, lint, ADK check/build, `git diff --check`.
5. Commit and push this branch. Deploy Vercel production and Botpress production from the same SHA. Verify health/readiness and one clean Telegram smoke.
6. Resolve the user's current Telegram test conversation by exact external identity, then clear only that conversation's session/memory after deployment. Do not delete unrelated leads or conversations.

## Acceptance

- Rapid user messages are interpreted together and answered once.
- Full logical agent replies are present in context; no bubble duplication.
- Identity survives turns.
- Calls are offered naturally and can be executed without positive phrase matching.
- No new repair loop or rejection reason exists solely for conversational wording.
- Visible output stays concise without backend-written sales copy.
- Vercel, Botpress, and reported health identify the same SHA.
- The exact tester conversation starts clean.
