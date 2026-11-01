# Conversation invariants for 06 and 14

Only these two cases use `evaluationMode: negotiation_invariants`. Their customer
stimuli and original labels remain intact for provenance. Expected move names,
bonus counts by fixed turn, and the old `priorPromotion` gate do not determine
this mode's result. Other fourteen cases retain their original evaluator.

The deterministic ledger checks prior committed model objection sources and
prior call facts (AGENTS rule 10; prompt 106–129), one distinct active addition
per intervention, package membership facts, cap exposure, and the
old package's actual cancellation on paid-course change (spec 40). A new empty
package is insufficient evidence of the old one's cancellation. It never
classifies sales wording or implicit gifts with a new regex.

Package recap is semantic (prompt 124); natural aliases need no exact canonical
display-name substring. The live semantic judge receives delivered chronological history, per-turn authorized facts and used fact IDs, current
facts and the ledger. It still judges value, installments, isolation and
conditional close, appropriate call, affinity, order, closure, and explicit or
implicit unauthorized bonus offers. Earlier completed steps count. Recalling
an actually delivered course does not require another bonus action.

Each check is PASS, FAIL, INDETERMINATE, or NOT_EXERCISED. A concrete structural
violation is attributed to its turn. Missing evidence remains indeterminate.
Three additions followed by the annotated fourth-course request exercise the
cap in case 06; a paid-course change with a real cancellable package exercises
case 14. Missing exposure is not a demand to sell three courses and is not a
business failure, but cannot produce a complete acceptance PASS.

## Offline reproduction (zero model calls)

```bash
npx tsx evals/golden/replay-negotiation-invariants.ts \
  docs/reports/evidence/2026-11-01-backend-negotiation-ladder/raw \
  /tmp/studyx-negotiation-invariants
```

`replay.json` and `replay.md` are new evaluation artifacts. Inputs are hashed
before/after and never overwritten. Execution SHA remains 10d7; evaluation SHA,
source hashes, and dirty-worktree status are separate. Run after the evaluation
commit for an exact evaluator SHA.

Fixed-turn action/move/package expectations are explicitly RETIRED_POSITIONAL.
Their removal is separate from missing semantic evidence. Original semantic verdicts, failure evidence, literal requirement IDs/text,
and citations at the execution commit remain attached. Only an explicitly
reviewed same-criterion/evidence mapping can port a failure. Historical
successes do not prove newly introduced conversation invariants. Unmapped
failures remain visible as nonportable/indeterminate, never silently PASS.
The narrow r2 14/bonus_1 mapping preserves the recorded failure of proposing an
implied new extra with action `none`; it does not reuse the old fixed-turn
requirement. Cases skipped by the original semantic judge are NOT_EXERCISED,
not newly judged offline.
