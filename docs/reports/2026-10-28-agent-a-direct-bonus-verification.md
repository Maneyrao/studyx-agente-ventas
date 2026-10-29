# Agent A direct multi-course bonus verification — 2026-10-28

Task 9 verification, not production rollout approval. Baseline source: `0e356e57353eadd0770c6388f4166bbd14609e7d`. Tested production fix: `9bac47df0bb010e6f0bddc9d5d16039fa8155633`. The final test/evidence commit is discoverable with `git log -1 --format=%H -- tests/workflow/agent-a-direct-course-bonus-negotiation.test.ts`.

## Execution boundary

The direct workflow runs the real Botpress `processInboundTurn` handler, signed HTTP actions, local Next backend, validators, transactional services, outbox, delivery reports, memory projection and PostgreSQL. DeepSeek responses are scripted at the provider HTTP boundary; Central responses and the physical channel adapter are explicit contract fixtures. Stripe signatures are generated and verified by the real Stripe SDK. This proves contracts and durable outcomes, not live model quality, WhatsApp delivery, external Central deployment or Botpress Cloud scheduling.

Only disposable local PostgreSQL at `127.0.0.1:54322` was used by application tests. Workflow database: `postgres`. Isolated integration database: `studyx_task9_final_20261028`, created from the local schema and the six configured seed files. No remote database, deployment or publication was performed. The unrelated historical evidence directory was not edited or staged.

Start the backend from the repository root:

```sh
bash scripts/run-agent-a-direct-bonus-verification-lab.sh npm run dev -- --hostname 127.0.0.1 --port 3217
```

The launcher clears ambient credentials, uses synthetic static Stripe test URLs, enables direct mode with cap 3, and installs `tests/helpers/local-only-network.cjs` before application code. The preload rejects nonlocal socket connections before DNS/TCP. Its denial was checked using an attempted `fetch('https://example.com')`; the local backend readiness and HTTP workflow pass through the same guard. Optional client-side projection flushing is disabled during these scenarios. Backend background projection attempts fail locally with the explicitly invalid ADC path `/dev/null`.

## Behavior and evidence

| Boundary | Evidence |
|---|---|
| Interest without selection, discovery/value, first objection without gift | Real workflow; durable selection stays null until acceptance; no offer on first objection |
| Repeated objection → gift in that same response; replies → second and third | Real workflow; ordered versioned rows linked to exact outbound IDs |
| Fourth gift refusal and stale acceptance | Useful same-agent repair; prior package preserved; stale version cannot seal |
| Exact acceptance, intake recap/confirmation, checkout | Real workflow; sealed version 3 copied unchanged to payment; USD 360 |
| Signed paid webhook and replay | Real SDK verification and canonical event handler; one fulfillment job |
| Complete versus one failed bonus | Real worker and persistence, scripted Central boundary; all four courses required for complete access; partial retains paid status and opens a durable manual case |
| Direct price, inability to pay, early call, call decline, duplicate inbound, opt-out | Real Botpress/backend workflow; no unearned gifts and durable submitted responses |
| Pending delivery and customer before confirmation | Real workflow plus service revalidation; useful repair, no early acceptance; course change cancels open offer |
| Failed delivery, concurrent offers, duplicate gifts | Real PostgreSQL direct-service matrix, including independent competing connections |
| Course change after checkout and late payment | Signed-webhook checkout integration matrix; immutable old package and manual reconciliation, no automatic wrong-course enrollment |
| No silence | Each successful commercial inbound is checked against its own durable submitted/delivered outbound; rejection/recovery unit and DB gates retain same-agent repair and durable recovery |

The task exposed a production incompatibility: direct capability and persistence required formal selection, and relied exclusively on semantic memories even though the real memory worker rejects the reserved commercial `price_objection` key. The fix resolves canonical interest from the scoped promotion context when selection is absent and validates a committed earlier structured objection against that context. Explicit selection wins. It never classifies customer text, changes memory policy, or relaxes checkout selection requirements. Real DB negatives cover foreign contact/source, future source, another course, another selection and current-turn-only objection. A separate RED demonstrated that concurrent interest changes were not blocked; the final service locks both canonical context and the correlated interest row until transaction completion.

## Commands and results

Complete logs are preserved under `.superpowers/sdd/2026-10-28-agent-a-direct-multi-course-bonus-v2/task-9-*.log`.

```sh
# Exact workflow gate, under the isolated launcher:
bash scripts/run-agent-a-direct-bonus-verification-lab.sh npx vitest run --config vitest.workflow.config.mts tests/workflow/agent-a-direct-course-bonus-negotiation.test.ts tests/workflow/agent-a-course-bonus-negotiation.test.ts

# Exact integration gate (TEST_DATABASE_URL points to the isolated local DB):
npx vitest run --config vitest.integration.config.mts tests/integration/course-bonus-followup.test.ts tests/integration/course-bonus-payment-correlation.test.ts tests/integration/direct-course-bonus-checkout.test.ts tests/integration/central-carga-enrollment-worker.test.ts tests/integration/post-sale.test.ts

npm run test:unit
npm run test:integration
npm run typecheck
npm run lint
npm run build
```

| Gate | Observed result |
|---|---|
| Exact workflow gate | 2 files, 5 passed; `task-9-workflow-contract-final.log` |
| Exact integration gate | 5 files, 125 passed |
| Direct service / atomic commit / voice regression | 3 files, 46 passed |
| Affected capability / rollout / Botpress hot path | 3 files, 145 passed |
| Full unit, first default-timeout run | 256 files passed; 4804 passed, 17 skipped, 7 todo |
| Full unit, later parallel build run | 4802 passed; 2 known 5-second timeout failures; preserved in `task-9-final-unit.log` |
| Full unit with existing 15-second allowance | 256 files passed; 4804 passed, 17 skipped, 7 todo |
| Full integration | 889 passed, 7 failed, 1 skipped; not green |
| Typecheck / lint / whitespace / build | Passed; final gate logs retained |

The two default-timeout failures were `agent-request-validation.test.ts / rejects an incomplete inbound envelope before touching the database` and `workflow-registration.test.ts / discovers both production workflows through the real ADK`. The unchanged tests are verified again using the previously documented 15-second allowance; no timeout configuration was edited.

The full integration run preceded only the final interest-row-lock refinement; the affected 46-test direct/service/voice/commit gate passed afterward. Its seven failures remain explicit:

- `course-bonus-invariants.test.ts / backfills legacy packages as sealed version one and quarantines ambiguous delivery without rewriting obligations`: the known fixture attempts to drop `promotion_cycle_id` despite newer dependent objects.
- `contact-profile-external-writers.test.ts / promotes an identical voice email only when the customer types it in WhatsApp`: preexisting clock/source-order sensitivity, not merely suite ordering. It passed unchanged in the subsequent isolated two-file run (9/9 with Telegram), but that does not resolve the sensitivity. Explicit follow-up remains open to make occurrence ordering deterministic and verify both source orders.
- Four `course-bonus-followup.test.ts` global-dispatch scenarios: recover unscheduled follow-up, reclaim expired processing lease, terminalize unconfirmed scheduling, and terminalize last-attempt scheduling reservation. Other suite files leave global jobs visible to the dispatcher. The exact five-file gate passes in isolation. This task now terminalizes only its own fixture jobs after each scenario; it does not modify foreign jobs to make the suite pass.
- `telegram-channel-reconciliation.test.ts / reclassifies only proven Telegram sandbox state and is idempotent`: isolated-DB bootstrap initially omitted pgcrypto/search-path settings. Those settings were restored; the unchanged test also passed on the original disposable DB. The original failing full run is retained.

Earlier observed fixture/environment corrections are also retained: expired fixed `2026-10-23` review fixture (now uses current time); cleanup initially referenced a nonexistent follow-up conversation column (corrected to the offer FK); a noncanonical acceptance phrase triggered legitimate gift-scope validation (changed the fixture to the supported paid-course subject form); an assertion used a nonexistent promotion acceptance-version column (the sealed package uses `offer_version`); and the first lab links were inferred live because their URLs lacked `test_` (the launcher now pins both URL prefix and expected environment, and supplies the required `PAYMENT_LINK_SANDBOX_*` variables). The Central request uses array order rather than a position member; assertions now run outside its transport fixture so the real client's network-error conversion cannot conceal assertion failures. None of those failing runs is represented as green.

## Laboratory incidents and remaining gates

The initial local backend's automatic `after()` projection drains picked up old synthetic Sheets jobs. GoogleAuth found local ADC and metadata GETs failed with `Requested entity was not found` before an update. No successful external write is evidenced. The process was stopped and replaced with cleared environment, invalid ADC and the network preload. Inspection immediately after the initial run found 154 retryable + 6 leased projection rows, all with `projected_at IS NULL`, zero marked projected. Full original backend logs were preserved. Later guarded runs contain local credential-file failures and no permitted external socket path.

An initial `createdb` command mistakenly treated a URI as a literal name on the local socket cluster. The newly created empty database was identified exactly and removed; the corrected creation explicitly used host `127.0.0.1`, port `54322` and user `postgres`. Schema-copy setup also needed vector, pgcrypto and schema-USAGE/search-path restoration. Supabase default-privilege-owner restore warnings are recorded; this is not claimed as a clean migration reset. No existing database was deleted or reset.

Release remains blocked until the full-suite issues above are resolved or explicitly dispositioned, and these external gates are met:

1. Real Botpress/WhatsApp authenticated confirmed-delivery receipts correlated with each exact outbound/version. Local adapter submission is not provider delivery.
2. Deployed Central V2 verifies every ordered course for new/existing students, advertises partial recovery, honors only the pending subset, and replays without duplicate enrollment/email.
3. Retell/Xendra publishes and forwards the additive promotion identity/acceptance contract with authenticated call scope. Local voice integration does not prove that external configuration.

## Task 9 Fix round 1

The review found that a prior objection for course A could be combined with a same-turn context for course B, and that explicit selection skipped context-source validation/locking. RED: `task-9-fix1-evidence-red.log`, five failures / one pass. The service now locks the scoped promotion context and its correlated inbound messages for both selected and interest-only identities. Structured evidence must have a source strictly earlier than the authorized current turn, same conversation/contact/course, with positive objection count. Selection still wins course identity but never bypasses evidence provenance. Capability applies the same strict prior-source boundary. The earlier committed objection need not equal the latest context source: a later non-objection turn is valid only when that context itself is prior and retains the same-course objection count.

Real PostgreSQL negatives cover A→B/current context, selected/current, selected/future and selected/foreign source. Positives preserve prior B objection after a later non-objection turn, with and without selection. An independent competing context update must time out under the transaction lock. GREEN: 52/52 direct service, atomic commit and voice integrations (`task-9-fix1-evidence-green.log`); affected units: 145/145 (`task-9-fix1-focused-unit.log`).

Post-sale RED: both complete/partial scenarios left notifications pending when the workflow only called the assembler (`task-9-fix1-post-sale-red.log`). The workflow now reads the worker-created notification and invokes real dispatch → claim → delivery with explicit simulated channel/event adapters. It asserts exact persisted event identity, sent/provider-message state, and replay rejection with one physical send. Complete output derives four course names from persisted fulfillment, labels the paid course plus three gifts, and excludes invoice language. Partial output dispatches delayed status, excludes credentials/complete access/invoice, and retains one durable manual case. No assembler is called directly by this workflow. The first rerun (`task-9-fix1-workflow-green.log`, despite its provisional filename) retained two assertion failures: a sent notification is excluded by the source query and returns `not_authorized`, not the initially expected `claim_lost`. The expectation was corrected to that real contract, without changing production delivery behavior.

Fix-round logs use `task-9-fix1-*.log`. Final exact workflow gate: two files, 5/5 passed in 203.92 seconds (`task-9-fix1-workflow-final.log`). The exact five-file integration command above was repeated against new disposable local database `studyx_task9_fix1_20261028`: 125/125 passed. The previous broad integration failures remain open; this round does not reclassify that suite as green. Isolation and external rollout gates above remain unchanged. Fix-round source/evidence SHA is discoverable with `git log -1 --format=%H -- src/features/promotions/application/direct-course-bonus-service.ts` (separate commit after `44bfc7d2c6bd65affcc29556fac27e628f7a758a`).

Full unit with the existing `--testTimeout=15000` allowance initially returned 4802 passed / two known timeout failures while typecheck/lint ran concurrently (`task-9-fix1-full-unit.log`). Repeating without those concurrent static gates passed 4804, with 17 skipped / 7 todo (`task-9-fix1-full-unit-serial-gates.log`). No timeout configuration was edited. Typecheck (including final rerun), lint, whitespace check and guarded production build passed (`task-9-fix1-typecheck-final.log`, `task-9-fix1-lint.log`, `task-9-fix1-build.log`).

Additional fix-round commands (besides the unchanged exact gates above):

```sh
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/studyx_task9_fix1_20261028 npx vitest run --config vitest.integration.config.mts tests/integration/direct-course-bonus-service.test.ts tests/integration/agent-turn-direct-bonus-commit.test.ts tests/integration/direct-course-bonus-voice.test.ts
npx vitest run --config vitest.config.mts tests/unit/promotions/course-bonus-capability.test.ts tests/unit/promotions/direct-course-bonus-service.test.ts tests/unit/botpress/process-inbound-turn-hot-path.test.ts
npm run test:unit -- --testTimeout=15000
bash scripts/run-agent-a-direct-bonus-verification-lab.sh npm run build
```

No production enablement is recommended by this report.
