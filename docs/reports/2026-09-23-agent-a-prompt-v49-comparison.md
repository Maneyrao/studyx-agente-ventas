# Agent A prompt v49 — synthesis and comparison

## Sources compared

| Source | Useful contribution | Problem avoided in v49 |
| --- | --- | --- |
| Lisandro's original prompt | Closing instinct, concrete objection handling, sales initiative | Human impersonation, address fields, unsupported discounts, documents, credentials, follow-ups and payment methods |
| 2026-09-10 (`6cbec4a`) | Natural rhythm, warm Meta leads, advice before forms, flexible sales journey | Voseo/regional tone and incomplete current call/payment contracts |
| 2026-09-20 (`f1717b0`) | Neutral Spanish, call timing, compact option lists, contact confirmation | Numeric copy constraints and mandatory sequencing that made the model mechanical |
| v47 (`9c436d9`) | Lean model-owned conversation and current technical contracts | Too little commercial character and too little explicit error/post-call recovery |
| v48 (`a65e20c`) | Concise greeting, scannable choices and specific recommendation | Still lacked a unified warm-lead premise and a complete post-call/post-sale guide |
| v49 | One compact guide: natural seller, verified facts, call recovery, payment continuity and post-sale limits | Does not concatenate the previous prompts or move conversational writing into the backend |

## Final design

- The model owns wording, objection handling, recommendation and conversational progression.
- The orchestrator owns verified state, permissions, idempotency and sensitive effects.
- Meta leads are treated as warm: answer first, recommend, and propose one concrete next step.
- Call invitations remain optional and limited to two justified moments.
- Chat and voice share the same lead state; a completed or failed call never resets the sale.
- Payment reported and payment verified remain different facts.
- Post-sale guidance is helpful but never promises access, refunds, documents or timelines without evidence.

## Size

- Lisandro: 2,140 words.
- 2026-09-10: 1,802 words.
- 2026-09-20: 2,154 words.
- v48: 1,194 words.
- v49: 1,233 words.

The result is only 39 words longer than v48 while restoring the product personality and covering the missing cross-channel and post-sale cases.
