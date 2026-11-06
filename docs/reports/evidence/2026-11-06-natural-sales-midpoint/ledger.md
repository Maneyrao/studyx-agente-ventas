# Plan A execution ledger

- Owner approval: principal dispatch explicitly authorizes Plan A and narrow Task 2 authority edits; no deployment.
- Single writer: worker; principal owns architect gates and paid runners.
- Baseline: clean `9b40a87b1b9523df4f2658ca1450c43a84f86cd9`, branch `codex/agent-a-natural-sales-midpoint`; brain v174 / canonical v109. Verified before writes.
- Skills applied: subagent-driven-development adapted to one writer and principal architect gates; TDD before runtime edits; verification-before-completion.
- Setup: exact approved plan copied from reference worktree; dependency directories linked read-only in practice (no installs or dependency writes).
- Baseline checks pending; no runtime edits.
- Offline exclusion: `tests/workflow/agent-a-payment-consent-regression.test.ts:22` invokes `runWorkflowConversationV1` without recorded provider mode or transport stub; principal agrees exclude from offline gate.

- Architect Task2 review: approved exact authority diff, no material findings (2026-11-06). Authority commit waits for baseline logs.
- DB bootstrap: sandbox shmget denied; escalation enabled initdb but PostgreSQL diagnosed missing valid locale. LC_ALL=C bootstrap passed (76 public tables); logs retained.
- Baseline integration sandbox attempt failed local DB availability; no product result can be inferred.
- Backend: Turbopack refuses external node_modules symlink; --webpack local flag resolved startup without source change.

- Task2 committed `b9b604e` after architect exact diff approval.
- Task1 baseline deterministic: root/bot typecheck, manifest, six unit suites, 427-attempt offline replay and baseline-v8 replay passed; integration failed local sandbox DB access and was terminated after retaining errors, not retried. Workflow baseline still in progress (recorded/fixture only).
- Task3 structure red: missing cases49/50; authority citations shifted by approved new paragraph (no behavioral verdict inferred). Structure green: 21 tests pass after scenarios and exact citations aligned.
- Behavioral red: byte-identical real v174 case49 and cases47/48 evidence stored with SHA256 manifest. Case49 2/4 (long area menu/flat options); 47+48 15/19 (47 repeated discovery/no trial close/material summary;48 passes). Judge misattribution for bonus and real Amparo/Edson story must not be treated as backend effect or fabricated testimony. No model response authored or edited.

- Task4 committed `64d80bb`: canonical v110 generated, literal parity and identity 14 tests pass, golden structure21 pass. Generator SHA/line guards updated, not weakened.
- Baseline workflow correction: interrupted/mixed source, NOT a frozen-v174 result. Prompt generation happened while fixture workflow still running; retained errors and stopped backend/suite. Candidate workflow will run only after frozen source commit with no edits. No baseline retry.
- Task5 red: new no-duplicate-strategy assertion fails on `<premisa_de_venta`; no manual model responses. Existing stale prompt version/citation and bounded prompt size also exposed.

- Ruling: replace combined 6300-word static prompt ceiling with <900-word technical wrapper ceiling, keeping byte-for-byte canonical parity. Approved authority v110 adds words; compressing authority to satisfy an old aggregate bound would violate Task4. Cost if wrong: allows authority size to grow without an aggregate ceiling, while its exact reviewed content remains pinned.

- Task5 committed `541ecf0` brain v180; 99 prompt/schema tests +21 golden structure pass. Eight operational/effect/repair functions match baseline source hashes byte-for-byte.
- Task6 frozen candidate: root/bot typechecks pass;14 integration suites214/214;6 unit suites57/57;offline427 attempts and baseline-v8 6/6 pass. Manifest8/9 with stale v174 pin expected. Corrected a nonexistent replay target caused by evidence-label replacement; original failed invocation retained, only actual existing target then executed.
- Task6 workflow frozen541ecf0: 8failed/2pass10,242.99s. Full assertions retained. Baseline remains interrupted/mixed, never claimed frozen-v174. Excluded live-default payment-consent file; no authored model response.
- Architect repeated-failure review: no causal regression found attributable541ecf0; fixed phase transport ignores prompt; backend/workflow/schema cardinality unchanged. Stale checkpoint/subject-code/handoff-count assertions and source-specific historical4f96b74 replay are not candidate acceptance. GenerationCount3vs2 at158/323 still needs fine continuation tracing.
- Review ruling (architect): permit one preflight plus focused diagnostic/commercial real-model evaluation, retaining all8 workflow failures; do not claim offline-green or release-ready. Cost if wrong: an operational concern could remain outside green214-integration coverage, so release remains gated by real operational evidence and final review.
- Test-only `c6cfb9a` aligns scenario50 to allow official material delivery while rejecting checkout before positive response;21 structural tests pass, no prompt/backend changes.
- Local services stopped; provider-preflight.mjs syntax-checked only. Paid calls by worker:0. Principal owns preflight/focused/full and final architect gate; no deployment or provenance repin.
