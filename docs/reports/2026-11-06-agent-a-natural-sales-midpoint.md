# Agent A natural sales midpoint — candidate verification

Status: runtime frozen at `541ecf0`; test-only scenario alignment `c6cfb9a`. Offline verification is incomplete: fixture workflows failed 8/10. No real-model acceptance or deployment claimed.

## Identity and changes

- Baseline: clean deployed source `9b40a87b1b9523df4f2658ca1450c43a84f86cd9`, brain v174, canonical v109.
- Branch: `codex/agent-a-natural-sales-midpoint`. Authority decision `b9b604e`; scenario tests `3f8135e`; literal canonical v110 `64d80bb`; brain v180 `541ecf0`.
- Authority changes are limited to answering the current request, criterion-local discovery, concise orientation and trial-close versus checkout. Architect reviewed and approved the exact diff before its commit.
- Canonical behavior is byte-identical to the authority plus its unchanged technical annex. Brain adds contracts, evidence and verified package/expiry facts; removed duplicated sales premise and question/cadence policy.
- Preserved all current effect contracts and repairs, including 1–2-sentence course material summary; no runtime backend policy, provider, credential, typing or delay changes.

## Deterministic evidence

All logs are under `docs/reports/evidence/2026-11-06-natural-sales-midpoint/`.

| Check | Baseline | Candidate |
|---|---|---|
| Root / Botpress typecheck | pass / pass | pass / pass |
| Release manifest | 9/9 | 8/9: stale v174 assertion (expected Task7 gate) |
| No romper integration, 14 suites | sandbox DB unavailable; interrupted without retry | 214/214 on fresh disposable PG17 |
| Operational unit controls, 6 suites | 57/57 | 57/57 |
| Recorded offline replay | 427 attempts, 0 model calls | 427 attempts, 0 model calls |
| Baseline-v8 replay | 6/6 | 6/6 |
| Canonical parity / identity | not rerun | 14/14 |
| Brain prompt / schema parity | not rerun | 99/99 |
| Golden scenario structure | not rerun | 21/21 |
| Recorded / fixture workflow | interrupted, mixed-source; no frozen-v174 claim | 2/10 pass; 8 failures retained, architect reviewed |

The initial candidate baseline-v8 command accidentally selected nonexistent `replay-candidate-v8.test.ts`; no test ran. The corrected existing target passed 6/6. Both invocation logs are retained. The live-default payment-consent workflow is excluded: `tests/workflow/agent-a-payment-consent-regression.test.ts:22` calls generation without a recorded transport or fixture mode. No new model response was authored.

## Workflow failures and reviewed boundary

Frozen candidate `541ecf0`: 8 failures / 2 passes, 242.99s, no rerun. `candidate-workflow-failures.txt` preserves assertions and lines.

| Assertion | Expected → actual | Assessment |
|---|---|---|
| call-recovery:158,323 | generationCount2 →3 | Exact continuation tracing unresolved; not evidence by itself that the paid-provider retry limit broke. |
| call-recovery:193 | call_or_chat →contact_details | Fixture expectation contradicts current missing-contact checkpoint. |
| call-recovery:270 | bare UNSUPPORTED_OPERATIONAL_CLAIM →subjectful call_confirmation plus MISSING_INTAKE fields | Diagnostic expectation predates v174 subjectful failure codes and complete call intake. |
| call-recovery:363 (3 plan cases) | generationCount2 →1; commit succeeds/no error | Existing v174 handoff can deliver in one generation; exact-count assertion stale. |
| historical replay:69 | contact.name Si Ludmi Medina →null | This fixture declares sourceSHA4f96b74 (2026-09-23), not candidate acceptance; its historical contact capture is incompatible. |

The architect found no causal regression route attributable to `541ecf0`: call fixture transport ignores the commercial instructions, while backend/workflow and schema cardinality remain unchanged. Eight named operational/effect/repair functions are byte-identical to9b40a87 (`operational-contract-parity.json`). The mixed baseline is not proof of inheritance. No existing fixture responses, historical raw outputs, test assertions or runtime were altered to make these workflows green.

Architect review permits a single provider preflight and focused real-model diagnostic/commercial evaluation with all eight failures retained; this does **not** certify an all-green offline gate or release readiness. Fine tracing of the two3-vs2 generation counts remains a material limitation.

## Real observed red baseline and comparison boundary

Original v174 evidence was copied byte-identically; `recorded-v174-sha256.json` records source and SHA256. Raw observations, workflow captures and both 427-attempt replay artifacts are losslessly packaged in `raw-evidence.tar.gz`, with every member verified against its original bytes in `raw-evidence-manifest.json`. Local originals remain under `.local-evidence/natural-sales-midpoint/raw/`.

| Real v174 run | Verdict | Observations / attribution | Provider usage |
|---|---|---|---|
| Case49 | 2/4 | d03 long area menu; d04 flat seven-course menu. Judge `bonificación` attribution is wrong: backend rejections empty; this is commercial orientation. | 8 calls; 109301 input +1769 output =111070 tokens |
| Cases47+48 | 15/19 |47g02 missing material summary; g03 repeated agency/invest choice; g06 no trial close.47g05 fabricated-story label is a judge false attribution: Amparo/Edson are authorized real stories.48 passed. |46 calls;845100 input +11535 output =856635 tokens |

Scenario50 is a new behavioral probe; no matching real v174 response is invented. Candidate model behavior is pending the principal's preflight and real-model gates. Commercial quality, schema/response errors, backend/media rejection and provider/environment failures must remain separate. HTTP402 stops paid evaluation and does not justify a prompt verdict.

## Release and execution limits

No deployment. Provenance remains pinned to the operational v174 release until focused cases45,47,48,49,50 and formal16 acceptance pass. The principal owns paid execution and the final architect review.

The principal's running configuration reports gpt-6.1-sol/xhigh; it cannot be changed by an available tool, so medium is not claimed. Explorer: luna/medium read-only, worker: sol/medium single writer, architect: astra/high; maximum4 slots. Orchestration token usage is not exposed; only provider evaluation usage is verifiable.

## Rulings I made

- Replace the aggregate6300-word static prompt ceiling with a strict <900-word technical wrapper ceiling while retaining literal canonical parity. Cost if wrong: authority can grow beyond an aggregate bound, but exact reviewed content remains hash/line pinned.

## Principal-only evaluation handoff

Ports3217/55435 were shut down after verification. Root dependencies are an isolated APFS clone; Botpress dependencies remain linked to the unchanged reference installation. `.eval/.env.local` is an ignored symlink to the exact existing evaluation config, with no credential/provider edits.

1. Run exactly once: `node docs/reports/evidence/2026-11-06-natural-sales-midpoint/provider-preflight.mjs`. It reserves its result file before exactly one official Responses fetch, max16 output tokens, no retry; saves safe body/status/usage.402 means environment failure and stops paid evaluation.
2. Only after successful preflight: `LANG=C STUDYX_GOLDEN_CASE_IDS=45,47,48,49,50 STUDYX_GOLDEN_RESULT_STEM=midpoint-<HEAD>-focused node evals/golden/run-local.mjs`.
3. Only if focused cases pass: omit CASE_IDS and choose a new result stem for one formal16 run. Do not run concurrently or repin provenance before accepted evidence.

The preflight script passed `node --check`; the worker did not execute it or any paid runner.
