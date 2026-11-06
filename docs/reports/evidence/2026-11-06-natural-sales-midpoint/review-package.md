# Plan A review package

- Base:9b40a87; runtime541ecf0, evaluation-only alignmentc6cfb9a; brainv180/canonicalv110.
- Plan: docs/superpowers/plans/2026-11-06-agent-a-natural-sales-midpoint.md (literal approved copy).
- Summary and complete limitations: docs/reports/2026-11-06-agent-a-natural-sales-midpoint.md.
- Exact non-generated source/test diff: review-source.diff. Generated modules are byte-identical to the literal canonical source (14 parity/identity tests) and hash/line pinned by generator.
- Deterministic invocation/exit records: baseline-results.json, candidate-results.json; per-command logs.
- Failed workflow assertions: candidate-workflow-failures.txt and full candidate-workflow.log. Read these8 failures; no all-green offline claim.
- Operational source hashes: operational-contract-parity.json (8/8 unchanged).
- Lossless raw observations/replay/workflow captures: raw-evidence.tar.gz + raw-evidence-manifest.json. Local originals: .local-evidence/natural-sales-midpoint/raw/.
- Original real v174 source copies/hashes: recorded-v174-sha256.json; observations are in archive recorded-v174/.
- Ledger includes every decision/ruling and unresolved limitation; no per-task reviewer agents used.
- Actual principal preflight: exactly1 request, HTTP402 Insufficient Balance, usage not reported. Focused45/47/48/49/50 and formal16 NOT RUN. See provider-preflight.json and final-metadata.json. Provenance unchanged at v174; no deploy.
- Exact separated diffs: authority.diff, canonical-prompt.diff (including generated outputs), brain.diff (including schema description).
- Final architect coverage finding: case50 t05 includes explicit purchase intent, so it does not isolate a bare affirmative reply to trial close. No test was changed during402 stop.
- Local only, NO PUSH: unmet acceptance/provenance and candidate branch auto-deploy safety unestablished. No Vercel configuration/account changes.
