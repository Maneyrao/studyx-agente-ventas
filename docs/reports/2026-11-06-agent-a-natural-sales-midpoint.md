# Agent A natural sales midpoint — candidate verification

Status: acceptance blocked by the actual provider preflight HTTP402 (Insufficient Balance). Exactly one synthetic request was sent by the principal; usage was not reported. Focused and formal16 evaluations were NOT RUN. Runtime stays frozen at `541ecf0`, test-only material alignment `c6cfb9a` plus the final isolated-affirmative customer-input fix; candidate HEAD at preflight `597c690`. Fixture workflows also remain 8/10 failed. No acceptance, release readiness or deployment claimed.

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

| Real v174 run | Verdict | Observations / attribution | Historical provider usage | Candidate comparison |
|---|---|---|---|---|
| Case49 | 2/4 | d03 long area menu; d04 flat seven-course menu. Judge `bonificación` attribution is wrong: backend rejections empty; this is commercial orientation. | 8 calls; 109301 input +1769 output =111070 tokens | Unavailable: preflight402; no candidate observation |
| Cases47+48 | 15/19 |47g02 missing material summary; g03 repeated agency/invest choice; g06 no trial close.47g05 fabricated-story label is a judge false attribution: Amparo/Edson are authorized real stories.48 passed. |46 calls;845100 input +11535 output =856635 tokens | Unavailable: preflight402; no candidate observation |

Scenario50 is a new behavioral probe; no matching real v174 response is invented. The final architect found that t05 mixed affirmative fit with explicit purchase intent. The principal required this evaluation gap to be addressed: t05 now says only «sí, es lo que estaba buscando», with no separate purchase intent. Existing contact_details, selected Real Estate and no-link assertions remain unchanged. The relevant structure suites passed21/21 once after this single customer-input change. Coverage is fixed structurally; its model behavior remains unvalidated because402 prevented the run. No model response was authored. Candidate commercial behavior is unmeasured: the actual preflight returned402 before any focused or formal runner. This is an environment verdict only, with no candidate model response from which to judge copy, schema, backend rejection or media behavior.

| Current evaluation | Actual result | Requests / tokens |
|---|---|---|
| Synthetic provider preflight (2026-11-06 12:13:04.992–12:13:06.968Z) | HTTP402, insufficient_balance_error, Insufficient Balance | Exactly1 request; usage=null, tokens not reported |
| Focused45,47,48,49,50 | NOT RUN — stopped by preflight402 | No runner invoked |
| Formal16 | NOT RUN — successful preflight/focused prerequisites unmet | No runner invoked |

Historical v174 usage above is separate from this delivery's single preflight request. Missing usage is not reported as zero tokens. See `provider-preflight.json` for the safe complete response and `final-metadata.json` for machine-readable status and layers.

## Release and execution limits

No deployment. Provenance remains pinned to the operational v174 release until focused cases45,47,48,49,50 and formal16 acceptance pass. No focused/full runner was invoked after402; no provenance values were changed. The principal owns the final architect review.

The principal's running configuration reports gpt-6.1-sol/xhigh; it cannot be changed by an available tool, so medium is not claimed. Explorer: luna/medium read-only, worker: sol/medium single writer, architect: astra/high; maximum4 slots. Orchestration token usage is not exposed; only provider evaluation usage is verifiable.

## Rulings I made

- Replace the aggregate6300-word static prompt ceiling with a strict <900-word technical wrapper ceiling while retaining literal canonical parity. Cost if wrong: authority can grow beyond an aggregate bound, but exact reviewed content remains hash/line pinned.
- Architect review allowed one preflight plus focused diagnostic evaluation while retaining8 workflow failures; it did not certify release readiness. Cost if wrong: an operational concern may remain beyond the214 green integration tests. The actual402 stopped all further evaluation.
- Principal release ruling: keep the branch local and do not push while acceptance/provenance are unmet and push-triggered deployment safety is unestablished. Cost: the candidate is not remotely shared; the owner can later approve a safe release flow.

## Evaluation handoff and actual stop

Ports3217/55435 were shut down after verification. Root dependencies are an isolated APFS clone; Botpress dependencies remain linked to the unchanged reference installation. `.eval/.env.local` is an ignored symlink to the exact existing evaluation config, with no credential/provider edits.

The principal executed the synthetic preflight exactly once; HTTP402 stopped Plan A acceptance. Focused45,47,48,49,50 and formal16 were not invoked. The recorded preflight must not be rerun as part of this stopped delivery. The worker syntax-checked the utility only and made no paid request. Credentials/provider selection remain unchanged.

The branch remains **local only; not pushed**. Acceptance/provenance prerequisites are unmet. In addition, `vercel.json` does not establish deployment-disabled safety for this candidate branch (its disabled branch is `codex/studyx-bonus-staged-release`). The owner's no-deploy instruction therefore rules out pushing this branch now. Vercel configuration/account were not changed; any future release flow needs an owner-approved path.

## Exact review artifacts

- `authority.diff`: complete baseline-to-candidate AGENTS and authority prompt diff.
- `canonical-prompt.diff`: complete canonical source, generator invariants and both generated modules.
- `brain.diff`: complete brain prompt diff and the `already_said` schema-description diff.
- `review-source.diff`: source and test changes together; `operational-contract-parity.json` preserves8/8 unchanged operational function hashes.
- `final-metadata.json`: evaluated source identities, failure layers, NOT RUN statuses, actual versus historical usage, artifact SHA256 values.

Material blockers remain environment402, unmeasured real-model commercial/operational behavior,8 open fixture workflow failures (including unresolved3-vs2 continuations), and the deliberately stale release pin. The final architect review is handled by the principal. Its case50 finding was addressed with the isolated affirmative input and21/21 structure checks; real-model validation remains blocked by402.

Final review record: the architect found structural conformity with Plan A and no new material implementation defect; literal authority/annex, generated modules, hash/213-line pin,118 archive members and14 original v174 files were verified. Backend, operational contracts and fallback builder remain preserved. The case50 evaluation input finding was then corrected as described above; the architect scoped review of `f06dfe3b172e8d8291898e1684294119a2ca6731` confirmed the finding structurally resolved, with no additional finding. This does not establish commercial acceptance or release readiness.
