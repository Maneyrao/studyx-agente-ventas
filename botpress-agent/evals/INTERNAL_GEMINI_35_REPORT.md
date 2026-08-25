# Internal Gemini-Direct 35-Case Suite — Smoke Report (Task 6)

**Date:** 2026-08-24
**Suite:** `botpress-agent/evals/personas/studyx-internal-gemini-35-v1.json`
**Status:** BLOCKED — infrastructure (Gemini API quota / rate limiting)

## Environment fingerprint

| Field | Value |
|---|---|
| `decisionProvider` (dev) | `gemini_direct` |
| Gemini adapter provider tag | `google-ai-direct` (`botpress-agent/src/lib/decision/gemini-direct.ts`) |
| Gemini model | `gemini-3.6-flash` (`DEFAULT_GEMINI_MODEL`, matches `agent.config.ts` `geminiDecisionModel` default and `adk models`) |
| Suite `prompt_version` | `studyx-agent-a-sales-v11` |
| Active `AGENT_A_PROMPT_VERSION` | `studyx-agent-a-sales-v11` (match confirmed via `assertSuitePromptVersion`) |
| `GEMINI_API_KEY` | declared: true, set: true (dev + prod) — value never printed |
| Bot runtime | http://localhost:3001 |
| Dev console | http://localhost:3021 |
| Next.js backend | http://localhost:3000 |
| Disposable Postgres | postgresql://postgres@127.0.0.1:55433/studyx_test |

## Preflight (all passed)

| Check | Result |
|---|---|
| Dev console health `GET /api/health` | HTTP 200 |
| Backend `GET http://localhost:3000` | HTTP 200 |
| Postgres `SELECT 1` on 55433/studyx_test | returned `1` |
| `npx adk config --format json` | `decisionProvider: "gemini_direct"` |
| `npx adk secret --format json` | `GEMINI_API_KEY` declared:true, set:true (dev and prod) |

## Case ID mapping

Suite cases are 1-indexed by array position and the numeric suffix in each `id` matches that position (e.g. array index 0 = `g35_01_...`). Requested order numbers 1, 17, 27, 28, 30 map to:

| Order | Case id |
|---|---|
| 1 | `g35_01_doce_meses_redes` |
| 17 | `g35_17_devolucion_coaching` |
| 27 | `g35_27_no_link_todavia_maquillaje` |
| 28 | `g35_28_retoma_memoria_vino` |
| 30 | `g35_30_manipulacion_prompt_ecommerce` |

## Runner support

`scripts/run-agent-a-conversations.ts` already supports single-case selection via `--case <id>` (line 77-81, from Task 1). No runner change was needed.

## Smoke results

| Case id | Turns run | 1 response/turn | DecisionSchema valid | Decision persisted (trace_id) | No managed AI-spend span | No technical fallback | Overall |
|---|---|---|---|---|---|---|---|
| `g35_01_doce_meses_redes` | 4/4 | PASS (all turns) | PASS (mechanically — see note) | PASS (4/4 decisions, 4/4 with trace_id) | PASS (traces show only `http.client` spans; no cognitive/autonomous generation spans) | **FAIL** (4/4 turns returned the generic `technical_fallback` reply) | **FAIL** |
| `g35_17_devolucion_coaching` | not run | — | — | — | — | — | NOT RUN (blocked before dispatch — see below) |
| `g35_27_no_link_todavia_maquillaje` | not run | — | — | — | — | — | NOT RUN |
| `g35_28_retoma_memoria_vino` | not run | — | — | — | — | — | NOT RUN |
| `g35_30_manipulacion_prompt_ecommerce` | not run | — | — | — | — | — | NOT RUN |

Note on "DecisionSchema valid": the committed decision in every failed turn was the synthesized `technical_fallback` / `suppress` decision (`processInboundTurn.ts` catch branch), which is a mechanically valid `Decision` object. It is **not** a real Gemini-generated decision — no live model output ever reached `DecisionSchema.safeParse` successfully in this run. Treating this as a "pass" would misrepresent the smoke's purpose, so the case is marked FAIL overall.

### `g35_01_doce_meses_redes` — two full attempts

**Attempt 1** (`--run-id internal-gemini-35-smoke-g35_01`): failed at turn 1 — `adk chat` client-side timeout at 1m (`Bot did not respond within 1m`). Root cause found in `adk logs`: `studyx.turn.model_failed` with `error_code":"GEMINI_HTTP_503"` and, on a preceding attempt, `"GEMINI_SCHEMA_INVALID"`.

**Attempt 2** (`--run-id internal-gemini-35-smoke-g35_01-r2`, run after two explicit waits of 70s+90s+60s and several minutes of additional diagnostic work — well outside a per-minute rate-limit window): all 4 turns completed structurally (no client timeout), but every turn's model call still failed:

```
turn 1: GEMINI_HTTP_429
turn 2: GEMINI_SCHEMA_INVALID
turn 3: GEMINI_HTTP_429
turn 4: GEMINI_HTTP_429
```

Every turn fell back to `"No pude procesar tu consulta en este momento. Por favor, intentá nuevamente más tarde."` (the `technical_fallback` response). Persistence checks (`contact_registered`, `decisions_with_trace: 4`) passed because the fallback path still commits a valid decision with a `trace_id` — but `expected_interest_persisted`, `sheet_rows`, `active_memories`, `payment_link_count`, and `course_fact_present` all failed because no real sales decision was ever produced.

## Diagnosis

`GEMINI_HTTP_429` (rate limited) was the dominant failure across both attempts (5 of 8 observed `model_failed` events); `GEMINI_HTTP_503` and `GEMINI_SCHEMA_INVALID` appeared once and twice respectively, always interleaved with the 429s. This pattern — persistent 429s across a multi-minute window that included two explicit waits (70s, then 90s) plus several minutes of unrelated diagnostic work in between — points to a quota/rate-limit condition on the `GEMINI_API_KEY`, not a code defect:

- `botpress-agent/src/lib/decision/gemini-direct.ts` retries only 429/503, exactly once, with a fixed 200ms backoff (`ADDITIONAL_RETRIES = 1`, `RETRY_BACKOFF_MS = 200`) — confirmed as the **intentional** design in `tests/unit/botpress/gemini-direct-decision.test.ts` ("retries exactly once on 429...", "gives up after exactly one retry when 429 persists"). This is deliberately bounded and does not attempt to out-wait a rate limit measured in requests-per-minute or requests-per-day.
- `secret list` describes `GEMINI_API_KEY` as "Google AI Studio key used by transcribeAudio (Phase 4)... Model: gemini-2.5-flash" — i.e. the same key is shared across the audio-transcription feature and the new `gemini_direct` decision path, and is very plausibly on a constrained (free-tier) quota tier.
- `adk traces --format json` shows only `http.client` spans around the Gemini calls (no managed cognitive/autonomous generation spans anywhere in the trace window) — confirming the pipeline is correctly calling Gemini directly (provider `google-ai-direct`) and never falling back to managed Botpress AI Spend, which rules out a wiring regression as the cause.
- The `GEMINI_SCHEMA_INVALID` occurrences (3 total across both attempts) were not isolated to a single turn or case, are consistent with malformed/truncated output from an API under throttling pressure, and I was unable to capture a raw payload for one (a temporary diagnostic `console.error` was added and reverted — see below — but the very next call returned `429` before hitting the schema-invalid branch again). I cannot rule out a separate, narrower schema issue without quota headroom to reproduce it in isolation, so it is flagged as an open question rather than diagnosed as a code defect.

Per the task's stop condition ("infrastructure — server down, quota, network... STOP and return BLOCKED"), and per the repo-wide rule to retry transient failures at most three times before escalating, this is stopped here rather than continuing to burn quota against cases 17/27/28/30, which would only reproduce the same block.

## Fixes made

None. A temporary diagnostic `console.error` was added to `gemini-direct.ts`'s schema-invalid branch to try to capture a raw Gemini payload for triage, then **reverted immediately** once it was clear the dominant failure was `429`, not a schema issue on that attempt. `git diff` on `botpress-agent/src/lib/decision/gemini-direct.ts` is empty (confirmed) — no residual change.

## Recommendation

1. Confirm the `GEMINI_API_KEY` quota tier/limits in Google AI Studio (RPM/RPD for `gemini-3.6-flash`) and, if this is a shared low-quota dev key, provision a higher-quota or dedicated key for this suite before re-running.
2. Re-run this smoke (cases 1, 17, 27, 28, 30) once quota headroom is confirmed. If `GEMINI_SCHEMA_INVALID` recurs with quota healthy, capture the raw model payload (e.g. via a short-lived diagnostic log, as attempted here) to determine whether it is a prompt/schema mismatch worth fixing in `gemini-direct.ts` or `DecisionSchema`.
3. Only after a clean 5/5 smoke should the full 35-case loop run.
