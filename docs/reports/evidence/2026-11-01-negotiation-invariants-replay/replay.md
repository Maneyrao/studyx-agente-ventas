# Offline negotiation invariant replay

Evaluation SHA: 961c991bcb2a6afc3ea6b0f30d56a7ec0b0f60b8. Source hashes and dirty-worktree flag are in replay.json. No model calls; original scores remain in archived inputs.

| Run | Case | Execution SHA | Status | Approved |
|---|---|---|---|---|
| r1 | 06_repeated_price_bonus_ladder | 10d7b3e5e7b5cdce3c88901cfedd3493346ecce2 | INDETERMINATE | null |
| r1 | 14_course_change_cancels_promotion | 10d7b3e5e7b5cdce3c88901cfedd3493346ecce2 | INDETERMINATE | null |
| r2 | 06_repeated_price_bonus_ladder | 10d7b3e5e7b5cdce3c88901cfedd3493346ecce2 | INDETERMINATE | null |
| r2 | 14_course_change_cancels_promotion | 10d7b3e5e7b5cdce3c88901cfedd3493346ecce2 | FAIL | false |

## Gate 06/07/14, ambas corridas

Full-suite prerequisite passed: false. Original case07 stays unchanged;03/04 scores are preserved and not rejudged. This is not a measurement of the new v147 repair prompt.

INDETERMINATE and NOT_EXERCISED cannot pass acceptance. Historical semantic failures without a reviewed same-criterion/evidence mapping remain explicitly preserved as nonportable, never silently approved.
