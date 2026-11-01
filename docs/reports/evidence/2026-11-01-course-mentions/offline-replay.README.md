# Recorded course-mention shadow replay

Run from the repository root:

```bash
npx tsx evals/golden/replay-course-mentions.ts
```

The executable calls the **current** `validateCourseMentionsV1`, asserts every
expected outcome and writes only `offline-replay.json` and `offline-replay.md`
in this directory. It imports no database/client/model code; fetch is disabled.
An optional output directory may be passed as the first argument.

## Historical evidence and explicit annotations

Inputs are immutable `2026-11-01-flash-v147-acceptance/delivery-audit.json`, its
raw/r1 and raw/r2 provider/report/durable artifacts, and the existing v3–v8 replay
index. raw/r1 contains the actual r1b stem. JSON records include each source file,
call/trace/commit ID, raw draft, exact delivered text/hash, action, package and
role-field absence. Input hashes are checked again before writing output.

The five recorded unsupported deliveries have **no** course_mentions field in
the original model JSON. One row per delivery tests that original omission;
a separate row supplies an explicit Codex reviewer sidecar with role=bonus.
The sidecar is not inferred by the matcher, not inserted into old files, and
not attributed to the old model. These are two distinct experiments, not two
historical outputs. No original score or verdict is changed.

The authorized first offer at r1b14/call_step has a matching committed action
and capability. Its later recap at r1b14/bonus_1 has confirmed delivered outbound
proof plus a delivered-only package projection: no fresh gift action is needed.
Reservations are never substituted for delivery evidence.

## Contrasts and limits

The v3–v8 index contains427 attempt occurrences including supplementary drafts.
A bounded discovery search over canonical catalog names/payment terms yielded
three candidates; Codex read each, and all explicitly offered an extra **sin
costo adicional**. No unambiguous separate paid-complement example was identified
by that search. Its terms are recorded as discovery provenance, not used to
infer roles or decide validator outcomes.

Therefore the paid_complement positive is an explicitly **controlled** separate
purchase, with no invented price or bonus effect. Pending delivery, cancelled
old-package carryover, a false paid role and an effect/role contradiction are
also controlled mutants. Each records the changed facts and does not pretend
to be a historical model utterance. The cancelled mutant clears the old course's
ladder/delivered authority while retaining the actual new validated selection.

Expected results:17/17 assertions; five undeclared originals rejected; five bonus
sidecars rejected as unauthorized; two legitimate historical positives allowed;
one controlled paid-complement positive allowed; four controlled negatives rejected.

This proves finite deterministic guard behavior, **not** v148 generation quality,
full acceptance, live database authorization or production delivery. Execution
SHA961c991 and evaluator SHA/source hashes/dirty status are separate in JSON.
After committing the evaluator, rerun to bind an exact committed evaluation SHA.
