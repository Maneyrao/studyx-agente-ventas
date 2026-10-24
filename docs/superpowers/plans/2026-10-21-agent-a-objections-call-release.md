# Agent A objection handling and early call release

**Objective:** Deploy the approved contextual objection handling and early call-offer behavior without discounts, installment reframing, bonuses, monetary comparisons, unsupported facts, or rigid scripts.

**Binding behavior:**

- A direct price question receives the exact authorized price and terms.
- A price objection distinguishes perceived value from a real budget limit only when context does not already distinguish them.
- Price objections never use the smallest installment, cost-per-day, daily-expense comparisons, discounts, bonus courses, or invented alternatives as persuasion.
- Persuasion uses the lead's expressed goal, motivation, situation, or constraint plus an authorized course fact and a conditional possible use.
- If the lead states a real inability to pay, acknowledge it without pressure.
- Repeated objections change the argument dimension instead of paraphrasing the prior response.
- The first relevant uncertainty may require a call offer once a concrete need or area is known, even without a selected course or level.
- A direct call request continues through the existing data, written-email, availability, and dispatch gates. A rejected call continues by chat.
- Tone remains warm, brief, specific, and adaptive between tú and vos. The model does not follow a visible fixed formula.

**Global constraints:** Preserve all existing user changes in this worktree. Use test-first changes. Keep Lisandro's canonical personality as the axis. Do not change production price data, payment links, integrations, WhatsApp accounts, databases, or contact records. Deployment is code-only for Botpress connections; deploy the backend only if the final diff affects its production runtime.

## Task 1: Pin the approved behavior with failing tests

- Add a policy test proving that an English need plus first relevant uncertainty requires a call offer without a selected course or prior exact level recommendation.
- Add objection tests proving that installment reframing, cost-per-day comparisons, and bonus-course tactics are rejected during a price objection while contextual value responses remain valid.
- Add runtime-instruction assertions for the no-price-reframing and early-call criteria.
- Run the focused tests and observe the intended failures.

## Task 2: Implement the smallest policy and prompt changes

- Broaden call orientation from exact course-name evidence to a concrete catalog need or topic in the current/recent conversation.
- Add the price-objection tactic guard to proposal validation.
- Update the canonical prompt and current-turn guidance to remove proactive installment recommendations and to add contextual warmth, value, real-budget handling, non-repetition, and first-relevant-doubt call behavior.
- Regenerate both canonical prompt modules and bump prompt versions.
- Run focused tests until green.

## Task 3: Certify the full retained system

- Run the complete unit suite, typecheck, lint, prompt generation consistency, release manifest checks, and Botpress ADK check/build.
- Review the complete branch diff with a fresh architect and fix any critical or important findings with a failing test first.
- Commit the complete retained changes as one release candidate.

## Task 4: Deploy and verify

- Record the candidate SHA and current remote Botpress identity/configuration.
- Deploy the backend only if required by the final runtime diff, then verify health/readiness and exact SHA.
- Publish the Botpress code bundle with the connection-preserving helper from the same candidate SHA.
- Verify ADK production status, prompt/brain versions, bot/workspace identity, deployment timestamp, and immediate error logs without sending a live lead message or phone call.
- Report the deployed state, remaining external boundaries, and overall agent health.

## Review focus

- No installment or price reduction tactic survives on price-objection turns.
- Direct price and payment-term questions remain answerable.
- The call is offered at the first relevant uncertainty, not on greetings or ordinary first-interest messages.
- A call offer never replaces the substantive chat answer.
- Validators repair or preserve a useful answer rather than producing silence.
- No prompt-only claim is presented as proof of production behavior without policy and end-to-end evidence.
