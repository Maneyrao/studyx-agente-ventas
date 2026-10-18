# Agent A action-boundary production release — 2026-10-17

## Outcome

The StudyX production flow now restores Agent A as the conversational owner while keeping the backend authoritative for validation, persistence, side effects, and commercial truth.

- Missing course, plan, or intake data returns structured `needs_input` feedback. Agent A decides how to ask for it naturally.
- The backend no longer supplies customer-facing fallback prose or turns a recoverable missing-data condition into `MODEL_UNAVAILABLE`.
- A same-turn call acceptance such as `dale de una` can authorize the call once the required contact data is present.
- Pending call intent survives intake completion and is consumed when the last required field arrives.
- Pending payment intent can produce the payment link when the final contact field is supplied.
- First-name use is optional and contextual. Mechanical or consecutive repetition such as `Thiago,` / `Okay, Thiago` is explicitly discouraged.
- Existing batching, memory, commercial-truth validation, Agent B events, Stripe enrollment, Central de Carga, credential delivery, and post-sale behavior remain in scope and were covered by regression gates.

No database migration was required for this release.

## Deployed candidate

- Source commit: `ffc5fa5a69969a61a6602b8b7f7960b5295b58b5`
- Vercel deployment: `dpl_AQGbRQXaWfRL1Dig5VL6iZZFBT8y`
- Production URL: `https://studyx-agente-ventas.vercel.app`
- Botpress bot: `2f7fe6e1-1fc9-40d9-9045-d0c96b456f4b`
- Botpress workspace: `wkspace_01M0X4K3H2EE7RGM39Q29GF6VS`
- Botpress production deployment timestamp: `2026-10-18T00:41:30.656Z`

## Verification

- Unit suite: 239 files passed; 4,251 tests passed, 17 skipped, 7 todo.
- Integration suite on a fresh disposable PostgreSQL database: 82 files passed; 681 tests passed, 1 skipped.
- Historical workflow suite: 10/10 passed.
- Action-boundary and commercial-truth workflows: 6/6 passed.
- Focused call, delivery-fencing, and post-sale integrations: 43/43 passed.
- Central de Carga and post-sale unit coverage: 22/22 passed.
- Root typecheck, lint, and production build passed.
- Botpress typecheck, ADK validation, production build, deployment, contract parity, and integration preservation passed.
- Botpress preflight after deployment confirmed 15 integrations, 2 plugins, and unchanged contracts.
- Production `/api/health`: HTTP 200 and exact source commit confirmed.
- Production `/api/ready`: HTTP 200, `ready=true`; configuration, brain configuration, PostgreSQL, agent-loop schema, and commercial snapshot probes all passed. Trace: `ca7a08c6-284f-465d-8779-9541593d0b63`.

## Acceptance boundary

The production software path and deployment are verified. This release did not initiate a real customer call, charge a card, or send a real enrollment message. Those external side effects remain the final supervised acceptance test using an authorized test contact and payment.
