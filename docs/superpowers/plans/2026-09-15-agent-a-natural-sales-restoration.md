# Agent A Natural Sales Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore Thursday-level conversational naturalness while preserving durable contact memory, two call invitations, confirmed checkout, Stripe, Sheets, and safe post-payment handling.

**Architecture:** DeepSeek remains the sole author and commercial guide. Botpress supplies one coherent turn and delivers the model-authored messages; Next.js/Supabase persist facts and execute sensitive effects without rewriting style. The existing ledgers and schemas are reused, and the only transport change moves transcript cleanup out of the pre-ingest critical path.

**Tech Stack:** TypeScript, Botpress ADK 2.0.5, Next.js 16, PostgreSQL/Supabase, Vitest, DeepSeek Responses API.

**Spec:** `docs/superpowers/specs/2026-09-15-agent-a-natural-sales-restoration-design.md`

## Global Constraints

- Use `6cbec4a` as the conversational baseline and the current branch as the technical base; do not roll back the repository.
- DeepSeek owns wording, rhythm, interpretation, objection handling, and next-step selection.
- The backend owns only canonical facts, persistence, permissions, sensitive effects, idempotency, and concurrency safety.
- Use neutral Spanish without voseo or opening `¿`/`¡`.
- Do not add a planner, provider, table, migration, phrase library, fixed bubble count, or style-based backend guard.
- Preserve exactly three plans: `monthly_12`, `monthly_6`, and `one_time`.
- Preserve opt-out, no-fabrication, maximum-two-call, Stripe, Sheets, replay, and payment-verification protections.
- Do not deploy until the real-workflow five-case gate passes locally.

---

### Task 1: Restore the Thursday conversational core

**Files:**
- Modify: `docs/prompts/studyx-agent-a-canonical.md`
- Modify (generated): `botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts`
- Modify: `botpress-agent/src/prompts/agent-a-brain-v1.ts`
- Test: `tests/unit/botpress/agent-a-canonical-prompt.test.ts`
- Test: `tests/unit/botpress/agent-a-brain-prompt.test.ts`
- Test: `tests/unit/prompts/canonical-prompt-v2.test.ts`

**Interfaces:**
- Consumes: `AgentAContextV1` and the existing `AgentATurnProposalV1` JSON contract.
- Produces: `STUDYX_AGENT_A_CANONICAL_PROMPT` and `buildAgentABrainInstructionsV1(context)` with one non-duplicated source of sales behavior.

- [ ] **Step 1: Add failing prompt-boundary tests**

Add assertions proving that the canonical prompt contains the six Thursday principles, neutral Spanish, the two-call journey, progressive intake, data confirmation, and post-payment human verification. Add assertions that `EXECUTION_PREAMBLE` does not restate message length, tone, objection handling, or sales phases.

```ts
expect(prompt).toContain('responde primero')
expect(prompt).toContain('una sola intervención')
expect(prompt).toContain('español neutro')
expect(prompt).toContain('dos invitaciones')
expect(prompt).toContain('nombre, apellido, correo y teléfono')
expect(prompt).not.toMatch(/respuesta obligatoriamente|frase exacta|plantilla fija/i)
expect(instructions.indexOf('CAMINO COMERCIAL')).toBe(instructions.lastIndexOf('CAMINO COMERCIAL'))
```

- [ ] **Step 2: Run the focal prompt tests and verify RED**

Run:

```bash
npx vitest run --config vitest.config.mts tests/unit/botpress/agent-a-canonical-prompt.test.ts tests/unit/botpress/agent-a-brain-prompt.test.ts tests/unit/prompts/canonical-prompt-v2.test.ts
```

Expected: at least one new assertion fails against Brain v55/canonical v26.

- [ ] **Step 3: Rewrite only the behavioral source**

Port the direct Thursday behavior from `git show 6cbec4a:docs/prompts/studyx-agent-a-canonical.md` into the Markdown source. Convert voseo to neutral Spanish and add only the product invariants listed in the spec. Reduce `EXECUTION_PREAMBLE` to combined-turn handling, JSON contract consistency, authorized-context isolation, and one safety repair.

- [ ] **Step 4: Regenerate the prompt module**

Run:

```bash
npm run generate:agent-a-prompt
```

Expected: the generated TypeScript changes only as a consequence of the Markdown source/version update.

- [ ] **Step 5: Run focal tests and verify GREEN**

Run the command from Step 2 plus:

```bash
npx vitest run --config vitest.config.mts tests/unit/botpress/agent-a-meta-sales-brain.test.ts tests/workflow/agent-a-continuity-v52.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add docs/prompts/studyx-agent-a-canonical.md botpress-agent/src/prompts/studyx-agent-a-canonical.generated.ts botpress-agent/src/prompts/agent-a-brain-v1.ts tests/unit/botpress/agent-a-canonical-prompt.test.ts tests/unit/botpress/agent-a-brain-prompt.test.ts tests/unit/prompts/canonical-prompt-v2.test.ts
git commit -m "refactor(agent-a): restore natural sales voice"
```

### Task 2: Prove that safe natural prose is not stylistically vetoed

**Files:**
- Modify only if RED proves necessary: `botpress-agent/src/lib/conversation/agent-a-brain.ts`
- Modify only if RED proves necessary: `src/features/conversation/domain/agent-turn-policy-v2.ts`
- Test: `tests/unit/botpress/agent-a-brain.test.ts`
- Test: `tests/unit/conversation/plannerless-natural-evidence-regression.test.ts`
- Test: `tests/integration/agent-turn-v2.test.ts`

**Interfaces:**
- Consumes: `validateAgentATurnProposalV1`, `authorizeAgentTurnV2`, canonical fact registry, and effect capabilities.
- Produces: acceptance of safe free-form prose while retaining fact/action rejection codes.

- [ ] **Step 1: Add a natural-prose acceptance matrix**

Create table-driven cases with one, two, and three useful messages, varied vocabulary, a contextual objection response, a recommendation, and a model-authored call offer. Each uses only authorized facts and actions.

```ts
it.each([
  ['one concise answer', ['La opción que mejor encaja es Redes Informáticas. Avancemos con esa.']],
  ['two distinct ideas', ['Redes Informáticas te permite comenzar desde una base concreta.', 'Si buscas la cuota más baja, te recomiendo el plan de 12 pagos.']],
  ['natural objection handling', ['Entiendo que el precio pesa. La alternativa más liviana es USD 30 al mes.', 'Podemos avanzar con esa opción.']],
])('%s is accepted without style pruning', async (_name, messages) => {
  expect(validateProposal(messages)).toBeNull()
})
```

- [ ] **Step 2: Run the matrix and verify whether it is RED**

Run:

```bash
npx vitest run --config vitest.config.mts tests/unit/botpress/agent-a-brain.test.ts tests/unit/conversation/plannerless-natural-evidence-regression.test.ts tests/integration/agent-turn-v2.test.ts
```

Expected: any failure identifies an exact style-based veto; if all pass, make no runtime change in this task.

- [ ] **Step 3: Remove only demonstrated style vetoes**

If RED, delete the smallest failing style/shape branch. Do not remove checks for unauthorized money, course details, URLs, false operational claims, missing intake, call budget, opt-out, or unsupported actions.

- [ ] **Step 4: Re-run the matrix and safety neighbors**

```bash
npx vitest run --config vitest.config.mts tests/unit/botpress/agent-a-brain.test.ts tests/unit/conversation/plannerless-natural-evidence-regression.test.ts tests/unit/conversation/state-assertion-egress.test.ts tests/integration/agent-turn-v2.test.ts
```

Expected: natural cases pass and all safety cases remain green.

- [ ] **Step 5: Commit only if runtime or tests changed**

```bash
git add botpress-agent/src/lib/conversation/agent-a-brain.ts src/features/conversation/domain/agent-turn-policy-v2.ts tests/unit/botpress/agent-a-brain.test.ts tests/unit/conversation/plannerless-natural-evidence-regression.test.ts tests/integration/agent-turn-v2.test.ts
git commit -m "refactor(agent-a): keep validation out of sales prose"
```

### Task 3: Make newer customer input supersede an in-flight reply

**Files:**
- Modify: `botpress-agent/src/conversations/router.ts`
- Test: `tests/unit/botpress/router-dispatch.test.ts`
- Test: `tests/integration/inbound-batching.test.ts`
- Test: `tests/unit/botpress/process-inbound-turn-hot-path.test.ts`

**Interfaces:**
- Consumes: `processInboundTurn.getOrCreate`, existing `supports_turn_supersession`, and PostgreSQL conversation sequencing.
- Produces: workflow start before nonessential transcript cleanup and no visible stale outbound after a newer inbound is persisted.

- [ ] **Step 1: Write a failing router ordering test**

Use a deferred `chat.clearTranscript()` promise. Assert that `processInboundTurn.getOrCreate` is called before resolving that promise.

```ts
const transcriptGate = Promise.withResolvers<void>()
const chat = {
  clearTranscript: vi.fn(() => transcriptGate.promise),
  saveTranscript: vi.fn(async () => undefined),
}
const pending = definition.handler(telegramEvent({ chat }))
await vi.waitFor(() => expect(getOrCreate).toHaveBeenCalledTimes(1))
transcriptGate.resolve()
await pending
```

- [ ] **Step 2: Run the router test and verify RED**

```bash
npx vitest run --config vitest.config.mts tests/unit/botpress/router-dispatch.test.ts
```

Expected: the current router waits for transcript cleanup before workflow start.

- [ ] **Step 3: Start ingestion workflow before cleanup**

Move `processInboundTurn.getOrCreate({ key, input })` ahead of the transcript cleanup block. Preserve cleanup and its error log after the workflow has been created; do not add another handler or workflow.

- [ ] **Step 4: Verify router order and backend supersession**

```bash
npx vitest run --config vitest.config.mts tests/unit/botpress/router-dispatch.test.ts tests/integration/inbound-batching.test.ts tests/unit/botpress/process-inbound-turn-hot-path.test.ts
```

Expected: router starts the workflow before cleanup; existing `SUPERSEDED_BY_NEWER_INBOUND` test produces zero outbounds for the stale turn.

- [ ] **Step 5: Commit**

```bash
git add botpress-agent/src/conversations/router.ts tests/unit/botpress/router-dispatch.test.ts tests/integration/inbound-batching.test.ts tests/unit/botpress/process-inbound-turn-hot-path.test.ts
git commit -m "fix(agent-a): ingest before transcript cleanup"
```

### Task 4: Verify durable memory, two calls, checkout, and post-payment behavior

**Files:**
- Modify only on demonstrated RED: `src/lib/heuristics/contact-identity.ts`
- Modify only on demonstrated RED: `src/features/conversation/application/commit-agent-turn-v3.ts`
- Modify only on demonstrated RED: `src/features/conversation/domain/agent-turn-policy-v2.ts`
- Test: `tests/workflow/agent-a-natural-sales-restoration.test.ts`
- Reuse: `tests/helpers/agent-a-workflow-db-evidence.ts`

**Interfaces:**
- Consumes: real `processInboundTurn`, isolated PostgreSQL, DeepSeek proposal generation, contact intake, call ledger, outbox, and Sheets projection outbox.
- Produces: five complete transcript artifacts plus database evidence for every durable effect.

- [ ] **Step 1: Add the five real-workflow scenarios**

Implement the five scenarios from spec section 7.2. Drive every turn through the existing workflow harness. Record transcript, `call_offer_count`, contact intake, selected course/plan, outbound URLs, and projection key after every customer turn.

```ts
expect(evidence.contact).toMatchObject({ nombre: 'Marta', apellido: 'López', correo: 'marta@example.com' })
expect(evidence.callOffers).toHaveLength(2)
expect(new Set(evidence.callOffers).size).toBe(2)
expect(evidence.paymentLinks).toHaveLength(1)
expect(evidence.sheetProjectionKeys).toEqual([`lead:${workspaceId}:${contactId}`])
expect(evidence.finalAgentText).toMatch(/equipo.+verificar.+acceso/is)
```

- [ ] **Step 2: Run the five cases and classify RED by layer**

```bash
npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-natural-sales-restoration.test.ts --reporter=verbose
```

Expected: every failure identifies prompt/model behavior, transport sequencing, persistence, or sensitive-effect execution separately.

- [ ] **Step 3: Apply minimal fixes only to failing persistence/effect paths**

For a contact failure, fix contextual extraction or the existing contact upsert. For a call-count failure, correct the existing state transition without authoring call copy. For Stripe/Sheets failures, repair the existing idempotent path. Do not add fallback commercial prose.

- [ ] **Step 4: Repeat only the failing scenario until GREEN**

```bash
npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-natural-sales-restoration.test.ts -t "general fragmented inquiry"
npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-natural-sales-restoration.test.ts -t "English level choice"
npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-natural-sales-restoration.test.ts -t "call decline and later reminder"
npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-natural-sales-restoration.test.ts -t "price objection and contact correction"
npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-natural-sales-restoration.test.ts -t "payment link and payment report"
```

Run only the command for each scenario that failed. Expected: the targeted
scenario passes without changing its oracle.

- [ ] **Step 5: Run all five together**

```bash
npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-natural-sales-restoration.test.ts --reporter=verbose
```

Expected: 5/5 pass with no stale reply, duplicate, repeated intake field, third call, second link, or second Sheet row.

- [ ] **Step 6: Commit**

```bash
git add tests/workflow/agent-a-natural-sales-restoration.test.ts src/lib/heuristics/contact-identity.ts src/features/conversation/application/commit-agent-turn-v3.ts src/features/conversation/domain/agent-turn-policy-v2.ts
git commit -m "test(agent-a): prove natural sales journey end to end"
```

### Task 5: Full verification and supervised deployment

**Files:**
- Update: `docs/superpowers/specs/2026-09-15-agent-a-natural-sales-restoration-design.md`

**Interfaces:**
- Consumes: all earlier task commits.
- Produces: one verified SHA deployed to Vercel and Botpress, followed by one clean Telegram canary.

- [ ] **Step 1: Run all local gates**

```bash
npm run lint
npm run typecheck
npm run test:unit
npm --prefix botpress-agent run typecheck
npm --prefix botpress-agent run check
npm --prefix botpress-agent run build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Re-run the five-case workflow gate once**

```bash
npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-natural-sales-restoration.test.ts --reporter=verbose
```

Expected: 5/5 pass on the exact candidate SHA.

- [ ] **Step 3: Commit the verified release checkpoint**

```bash
git add docs/superpowers/specs/2026-09-15-agent-a-natural-sales-restoration-design.md
git commit -m "chore(agent-a): mark natural sales candidate verified"
```

If neither file changed, do not create an empty commit; record the already verified SHA.

- [ ] **Step 4: Deploy only changed surfaces**

Deploy Vercel if any root/backend file changed. Deploy Botpress whenever prompt, router, workflow, or bundle inputs changed. Confirm `/api/health` reports the candidate backend SHA and Botpress reports the matching prompt versions.

- [ ] **Step 5: Reset one supervised conversation and run one Telegram canary**

The human sends a fragmented warm-lead sequence covering greeting, name, course, first call decline, chat guidance, objection, second call reminder, contact confirmation, payment link, and payment report. Trace every inbound, decision, outbound part, contact update, call counter, Stripe link, and Sheets projection.

- [ ] **Step 6: Accept or roll back**

Accept only if Telegram matches the local behavior and all durable effects are singular. Otherwise disable the candidate Botpress deployment and report the exact first diverging boundary without modifying the oracle during the canary.
