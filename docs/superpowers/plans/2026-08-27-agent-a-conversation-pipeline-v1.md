# Agent A Conversation Pipeline V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar el pipeline semántico intérprete → planner → compositor detrás de un flag apagado, con estado V1 por conversación y autoridad comercial exclusivamente backend.

**Architecture:** Botpress produce `ConversationMoveV1` mediante un modelo rápido. Un endpoint backend ejecuta el planner puro y devuelve `TurnPlanV1` más referencias de facts sin valores; Botpress compone narrativa opcional y el commit vuelve a planificar, renderiza facts canónicos y persiste el estado V1. El flujo legado y sus tablas permanecen intactos con el flag apagado.

**Tech Stack:** TypeScript 5.9, Zod 4, Next.js 16, PostgreSQL, Vitest 4, Botpress ADK 2, Groq structured output.

**Spec:** `docs/superpowers/specs/2026-08-27-conversation-pipeline-v1-design.md`

## Global Constraints

- No agregar regex ni listas de frases para reconocer movimientos.
- `CONVERSATION_PIPELINE_V1_ENABLED` debe ser `false` por defecto.
- Crear tablas V1; no modificar PKs ni semántica de `sales_context_states`.
- `secondary_moves` tiene máximo 2 y `vetoes` precede toda acción.
- `canonical_fact_requests` y `missing_information` son unions estrictas.
- El compositor recibe IDs/kinds, nunca valores, precios o links.
- El guard global, opt-out, autorización backend e idempotencia permanecen.
- `event_to_visible_outbound_ms` incluye batching y debe alcanzar p95 <10 s en canary.
- No activar producción durante esta ejecución.

---

### Task 1: Contratos estrictos y flag

**Files:**
- Create: `src/features/conversation/domain/conversation-pipeline.ts`
- Create: `src/features/conversation/adapters/conversation-pipeline-schema.ts`
- Create: `botpress-agent/src/schemas/conversation-pipeline.ts`
- Modify: `src/lib/config.ts`
- Modify: `src/features/orchestration/application/claim-batch.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Test: `tests/unit/conversation/conversation-contracts.test.ts`
- Test: `tests/contract/botpress-response-parity.test.ts`

**Interfaces:**
- Produces: `ConversationMoveV1`, `TurnPlanV1`, `ComposedNarrativeV1` and strict Zod mirrors.
- Produces: `loadConversationPipelineConfig(env): { enabled: boolean }` and claim feature projection.

- [ ] **Step 1: Write failing tests**

```ts
expect(ConversationMoveV1Schema.parse({
  schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: [], confidence: 0.9,
})).toMatchObject({ move: 'continue_by_chat' });
expect(() => ConversationMoveV1Schema.parse({
  schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: ['call'], confidence: 1,
})).toThrow();
expect(loadConversationPipelineConfig({})).toEqual({ enabled: false });
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/conversation/conversation-contracts.test.ts tests/contract/botpress-response-parity.test.ts`

Expected: FAIL because contracts and feature projection do not exist.

- [ ] **Step 3: Implement minimal contracts**

```ts
export const CONVERSATION_MOVE_KINDS_V1 = [
  'greeting', 'browse_catalog', 'select_area', 'select_course',
  'ask_course_information', 'continue_by_chat', 'request_call', 'decline_call',
  'ask_payment_options', 'select_payment_plan', 'defer_payment',
  'request_payment_link', 'decline_purchase', 'unknown',
] as const;

export function loadConversationPipelineConfig(env: NodeJS.ProcessEnv = process.env) {
  return { enabled: env.CONVERSATION_PIPELINE_V1_ENABLED?.trim().toLowerCase() === 'true' };
}
```

Add strict refinements for max-two secondary moves, uniqueness, veto conflicts and field/move compatibility. Project the backend flag into `claimed.features.conversation_pipeline_v1_enabled` and mirror it in Botpress.

- [ ] **Step 4: Run GREEN**

Run the Step 2 command. Expected: selected tests pass.

- [ ] **Step 5: Commit explicit Task 1 files**

Commit message: `feat(agent-a): define conversation pipeline contracts`.

### Task 2: Tablas y store V1 por conversación

**Files:**
- Create: `supabase/migrations/20260827020001_conversation_pipeline_v1_state.sql`
- Create: `src/features/conversation/ports/conversation-state-store.ts`
- Create: `src/features/conversation/adapters/postgres-conversation-state-store.ts`
- Test: `tests/integration/conversation-state-v1.test.ts`

**Interfaces:**
- Produces: `ConversationStateStoreV1.load(workspaceSlug, conversationId, contactId)`.
- Produces: exact-state, replay-safe `transition(input)`.

- [ ] **Step 1: Write failing isolation/replay tests**

```ts
const a = await store.transition(state({ conversation_id: conversationA, call_preference: 'chat' }));
const b = await store.transition(state({ conversation_id: conversationB }));
expect(a.call_preference).toBe('chat');
expect(b).toMatchObject({ call_preference: 'unknown', call_offer_status: 'not_offered' });
expect((await store.transition({ ...a, source_turn_id: turnA })).version).toBe(a.version);
```

- [ ] **Step 2: Run RED**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/postgres npx vitest run --config vitest.integration.config.mts tests/integration/conversation-state-v1.test.ts`

Expected: FAIL because V1 tables/store do not exist.

- [ ] **Step 3: Implement new tables and store**

```sql
CREATE TABLE conversation_sales_context_states_v1 (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  conversation_id uuid NOT NULL REFERENCES conversations(id),
  contact_id uuid NOT NULL REFERENCES contacts(id),
  call_preference text NOT NULL DEFAULT 'unknown',
  call_offer_status text NOT NULL DEFAULT 'not_offered',
  awaiting_reply text NOT NULL DEFAULT 'none',
  version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (workspace_id, conversation_id)
);
```

Complete all canonical course/plan/stage fields, CHECKs, V1 events table, RLS/grants and same-source replay fencing. Do not alter legacy tables.

- [ ] **Step 4: Run GREEN plus three migration cycles**

Run Step 2 and `npm run test:db:reset-loop`. Expected: integration and three cycles pass.

- [ ] **Step 5: Commit explicit Task 2 files**

Commit message: `feat(agent-a): persist conversation state v1`.

### Task 3: Planner puro, facts tipados y plan endpoint

**Files:**
- Create: `src/features/conversation/domain/conversation-planner.ts`
- Create: `src/features/conversation/domain/canonical-fact-registry.ts`
- Create: `src/features/conversation/application/plan-conversation-turn.ts`
- Create: `src/app/api/agent/turns/[turn_id]/plan/route.ts`
- Create: `botpress-agent/src/actions/planConversation.ts`
- Test: `tests/unit/conversation/conversation-planner.test.ts`
- Test: `tests/unit/conversation/canonical-fact-registry.test.ts`

**Interfaces:**
- Produces: pure `planConversationTurn(input): TurnPlanV1`.
- Produces: authenticated plan response `{ plan, fact_refs, plan_hash }` without fact values.

- [ ] **Step 1: Write failing table-driven planner tests**

```ts
expect(plan(move('continue_by_chat'), state({ awaiting_reply: 'call_or_chat' })))
  .toMatchObject({ next_call_preference: 'chat', next_call_offer_status: 'declined', should_offer_call: false });
expect(plan(move('request_payment_link', { vetoes: ['payment_link'] }), paidState).allowed_business_action)
  .toEqual({ type: 'none' });
expect(plan(move('select_course'), plannedState).selected_payment_plan).toBeNull();
```

Cover direct later call, one call offer, chat without offer, plan selection without link, deferral/resume, compound compatible moves, incompatible moves, strict missing-info values and unavailable catalog.

- [ ] **Step 2: Run RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/conversation/conversation-planner.test.ts tests/unit/conversation/canonical-fact-registry.test.ts`

Expected: FAIL because planner/registry do not exist.

- [ ] **Step 3: Implement pure planner and registry**

```ts
export function planConversationTurn(input: PlanConversationTurnInputV1): TurnPlanV1 {
  const vetoed = applyVetoes(input.move.vetoes);
  if (input.move.confidence < 0.75 || incompatible(input.move)) return safeClarification(input);
  return applyCompatibleMoves(vetoed, [input.move.move, ...input.move.secondary_moves], input);
}
```

The route authenticates with the existing HMAC layer, loads V1 state and canonical snapshot, resolves references, returns strict fact refs and hashes canonical JSON. No value or link leaves the backend.

- [ ] **Step 4: Run GREEN**

Run Step 2. Expected: planner and registry pass.

- [ ] **Step 5: Commit explicit Task 3 files**

Commit message: `feat(agent-a): plan conversation moves canonically`.

### Task 4: Intérprete semántico y corpus held-out

**Files:**
- Create: `botpress-agent/src/prompts/conversation-interpreter-v1.ts`
- Create: `botpress-agent/src/lib/conversation/conversation-interpreter.ts`
- Create: `tests/fixtures/conversation-pipeline-v1-held-out.json`
- Test: `tests/unit/botpress/conversation-interpreter.test.ts`
- Test: `tests/evals/conversation-interpreter-v1.eval.test.ts`

**Interfaces:**
- Produces: `interpretConversationMove(input, deps): Promise<ConversationMoveV1>`.
- Model: `openai/gpt-oss-20b`, JSON Schema, timeout 1.8 s, zero retries.

- [ ] **Step 1: Write failing parse/timeout/source-separation tests**

```ts
await expect(interpretConversationMove(input, fake({ move: 'continue_by_chat' })))
  .resolves.toMatchObject({ move: 'continue_by_chat' });
await expect(interpretConversationMove(input, neverResolving({ timeoutMs: 5 })))
  .rejects.toMatchObject({ code: 'CONVERSATION_INTERPRETER_TIMEOUT' });
```

Create 12 opaque-ID held-out cases only in the fixture and assert none of their exact phrases appears under production source roots.

- [ ] **Step 2: Run RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/conversation-interpreter.test.ts`

Expected: FAIL because interpreter does not exist.

- [ ] **Step 3: Implement strict structured interpreter**

```ts
export const CONVERSATION_INTERPRETER_PROMPT_VERSION = 'studyx-conversation-move-v1';
export const buildInterpreterInstructions = (input: ConversationInterpreterInputV1) =>
  `${ENUM_AND_PRECEDENCE_RULES}\nUNTRUSTED_CONTEXT_START\n${JSON.stringify(input)}\nUNTRUSTED_CONTEXT_END`;
```

Prompt enum semantics and veto precedence without phrase examples. Validate provider JSON with the Botpress schema and fail closed on timeout/schema error.

- [ ] **Step 4: Run GREEN and one bounded dev eval if a key exists**

Run Step 2, then the eval once without retries. Record exact X/12; do not make external availability a unit-test dependency.

- [ ] **Step 5: Commit explicit Task 4 files**

Commit message: `feat(agent-a): interpret semantic conversation moves`.

### Task 5: Compositor y ensamblador canónico

**Files:**
- Create: `botpress-agent/src/prompts/conversation-composer-v1.ts`
- Create: `botpress-agent/src/lib/conversation/conversation-composer.ts`
- Create: `src/features/conversation/domain/canonical-response-assembler.ts`
- Test: `tests/unit/botpress/conversation-composer.test.ts`
- Test: `tests/unit/conversation/canonical-response-assembler.test.ts`

**Interfaces:**
- Produces narrative plus `used_fact_ids`; consumes refs without values.
- Backend assembler renders exact canonical values and protected facts.

- [ ] **Step 1: Write failing no-value/subset/timeout tests**

```ts
expect(JSON.stringify(buildComposerInput(plan, refs))).not.toContain(canonicalPrice);
expect(() => assemble({ ...input, used_fact_ids: ['unknown'] })).toThrow('UNKNOWN_FACT_ID');
expect(assemble(validInput).content).toContain(canonicalDuration);
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/conversation-composer.test.ts tests/unit/conversation/canonical-response-assembler.test.ts`

Expected: FAIL because composer/assembler do not exist.

- [ ] **Step 3: Implement optional composer and deterministic fallback**

```ts
export function assembleCanonicalResponse(input: AssembleInput) {
  assertSubset(input.composition.used_fact_ids, input.fact_refs);
  return joinNarrativeAndRenderedFacts(input.composition.narrative, renderCanonicalFacts(input.facts));
}
```

Composer timeout is 3 s, no retry. Skip it for greeting, opt-out and complete canonical/transaction responses.

- [ ] **Step 4: Run GREEN**

Run Step 2. Expected: both files pass.

- [ ] **Step 5: Commit explicit Task 5 files**

Commit message: `feat(agent-a): compose around canonical facts`.

### Task 6: Workflow, commit replan and V1 state transition

**Files:**
- Modify: `botpress-agent/src/workflows/processInboundTurn.ts`
- Modify: `botpress-agent/src/actions/commitDecision.ts`
- Modify: `botpress-agent/src/schemas/contracts.ts`
- Modify: `src/app/api/agent/turns/[turn_id]/decision/route.ts`
- Modify: `src/lib/services/decision.service.ts`
- Test: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`
- Test: `tests/unit/orchestration/decision-policy.test.ts`

**Interfaces:**
- Flag-on flow: interpret → plan endpoint → compose/fallback → commit.
- Commit reloads V1 state, replans, compares hash, renders facts and persists exact state.

- [ ] **Step 1: Write failing flag-off/flag-on/tamper tests**

```ts
expect(flagOffTrace).toEqual(legacyTrace);
expect(flagOnSource).toContain('interpretConversationMove(');
await expect(commit({ ...valid, plan_hash: 'tampered' })).rejects.toThrow('CONVERSATION_PLAN_MISMATCH');
```

- [ ] **Step 2: Run RED**

Run: `npx vitest run --config vitest.config.mts tests/unit/botpress/process-inbound-turn-hot-path.test.ts tests/unit/orchestration/decision-policy.test.ts`

Expected: FAIL because workflow/commit do not know V1.

- [ ] **Step 3: Implement flagged vertical wiring**

```ts
if (owned.features.conversation_pipeline_v1_enabled && isPipelineEligible(owned)) {
  const move = await interpretConversationMove(buildInterpreterInput(owned));
  const planned = await planConversation.execute({ client, input: { turn_id: owned.turn_id, move } });
  const composition = await composeOrFallback(planned);
  pipelineCommit = { move, plan: planned.plan, plan_hash: planned.plan_hash, composition };
}
```

Backend replans from current V1 state/snapshot, derives course/plan again, applies vetoes, preserves opt-out/payment/call authorizers and writes `call_offer_status` atomically.

- [ ] **Step 4: Run GREEN and Botpress typecheck**

Run Step 2 and `(cd botpress-agent && npm run typecheck)`. Expected: pass.

- [ ] **Step 5: Commit explicit Task 6 files**

Commit message: `feat(agent-a): run flagged conversation pipeline`.

### Task 7: Vertical PostgreSQL, replay, concurrency and latency metric

**Files:**
- Create: `tests/integration/conversation-pipeline-v1.test.ts`
- Modify: `scripts/run-agent-a-conversations.ts`
- Modify: `tests/unit/scripts/agent-a-conversation-runner.test.ts`

**Interfaces:**
- Exercises claim → interpretation → planner → composition → commit → egress → outbound.
- Proves one link, one projection and one call offer.

- [ ] **Step 1: Write failing full-conversation matrix**

```ts
expect(result.finalState).toMatchObject({
  selected_offering_code: 'redes-informaticas',
  call_preference: 'chat',
  call_offer_status: 'declined',
});
expect(result.paymentLinkOutbounds).toHaveLength(1);
expect(result.paymentProjectionJobs).toHaveLength(1);
expect(result.callOffers).toHaveLength(1);
```

Cover chat after offer, chat without offer, decline then later direct call, course change clearing plan, defer/resume, compound vetoes, ambiguity, both timeouts, replay and concurrent commits.

- [ ] **Step 2: Run RED**

Run: `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/postgres npx vitest run --config vitest.integration.config.mts tests/integration/conversation-pipeline-v1.test.ts`

Expected: FAIL on the first missing vertical behavior.

- [ ] **Step 3: Correct only wiring exposed by the matrix**

```ts
pipeline_move: planned?.move ?? null,
pipeline_plan: planned?.plan ?? null,
pipeline_plan_hash: planned?.planHash ?? null,
pipeline_composition: planned?.composition ?? null,
```

Do not change oracles or add phrase matching.

- [ ] **Step 4: Run GREEN and record local metric**

Run Step 2. Expected: all vertical cases pass with exact side-effect counts; record `event_to_visible_outbound_ms` including batch time.

- [ ] **Step 5: Commit explicit Task 7 files**

Commit message: `test(agent-a): verify conversation pipeline end to end`.

### Task 8: Full gates and diff-review stop

**Files:**
- Modify only regressions caused by Tasks 1–7.

**Interfaces:**
- Produces exact counts and a reviewed diff; performs no remote mutation.

- [ ] **Step 1: Run all local gates**

```bash
npm run test:unit
npm run typecheck
(cd botpress-agent && npm run typecheck && npm run check && npm run build)
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55435/postgres npm run test:integration
npm run test:db:reset-loop
git diff --check
```

- [ ] **Step 2: Review scope, secrets and artifacts**

```bash
git status --short
git diff --stat 0ce9d1a4de8af92673e706977380b830651e0203..HEAD
git diff --name-only 0ce9d1a4de8af92673e706977380b830651e0203..HEAD
```

Inspect the diff for secrets and confirm no `node_modules`, generated artifacts, fixtures unrelated to held-out evals, payments, prompts outside V1 or Sheets changes.

- [ ] **Step 3: Verify flag behavior and latency report**

Run legacy behavior with flag false and V1 local behavior with flag true. Report p50/p95/max for `event_to_visible_outbound_ms`; local evidence does not authorize production.

- [ ] **Step 4: Present diff and GREEN evidence**

Report RED→GREEN per layer, exact tests, files/commits, side-effect counts, flag state, latency and remaining risks.

- [ ] **Step 5: Stop before production**

Do not push, migrate remote data, deploy Vercel/Botpress production or send Telegram messages. Await explicit diff review and authorization for the next promotion stage.

