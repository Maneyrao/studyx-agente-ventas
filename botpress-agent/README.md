# StudyX Botpress adapter

This package coordinates a conversation turn. It does not own contacts, consent, commercial state, messages, memory, decisions, or delivery truth. Next.js and Supabase remain canonical.

## Implemented locally

- Versioned Zod contracts for inbound events, policy, structured decisions, and delivery reports.
- HMAC-SHA256 request signing with timestamp, trace ID, request ID, and idempotency key.
- An 8-second default timeout and exactly three additional retries for retryable HTTP failures.
- Full-jitter backoff for `408`, `425`, `429`, `500`, `502`, `503`, `504`, network failures, and timeouts.
- Typed Actions for ingest, decision commit, and delivery reporting. They are imported directly by the Workflow and are never exposed as model tools.
- A resumable Workflow with fail-closed states and stable step names.
- A default-disabled automation kill switch.
- Emulator input normalization using Botpress message, conversation, and user IDs plus an explicit development-only E.164 identity.
- An explicit stable `integration_id` (integration alias when available, channel fallback in the emulator) for provider-scoped deduplication.
- One Botpress delivery attempt only after Next.js confirms the outbound record.
- Ambiguous or incompletely reported deliveries pause for reconciliation and are never automatically sent a second time.

## Required backend contract

The Workflow expects these endpoints:

```text
POST /api/agent/ingest
POST /api/agent/turns/:turn_id/decision
POST /api/agent/outbounds/:outbound_id/delivery
```

Their request and response schemas are defined in `src/schemas/contracts.ts`. The local Next.js backend implements these schemas; cualquier incompatibilidad futura hace que el Workflow termine en `paused_error` sin enviar una respuesta comercial.

The backend must verify:

```text
X-Orchestrator-Key-Id
X-Orchestrator-Key
X-Request-Timestamp
X-Signature
X-Request-Id
X-Trace-Id
Idempotency-Key
```

The signature input is:

```text
timestamp + "\n" + HTTP method + "\n" + URL pathname + "\n" + exact JSON body
```

## Local configuration

Non-secret configuration is declared in `agent.config.ts`. Automation defaults to disabled. Runtime credentials must be set with Botpress secrets, never committed or placed in conversation state:

```bash
adk secret:set STUDYX_ORCHESTRATOR_KEY <value>
adk secret:set STUDYX_SIGNING_SECRET <value>
```

Configure `apiBaseUrl`, `orchestratorKeyId`, `emulatorPhoneE164`, and `automationEnabled` through ADK configuration for each environment. `emulatorPhoneE164` is validated before a Workflow can call the backend; it is never inferred from the Botpress user ID. Its default, `+15550000001`, is synthetic and exists only so a local Emulator smoke can reach the canonical backend.

For a local test-only smoke, set a synthetic E.164 identity and explicitly enable automation:

```bash
adk config:set emulatorPhoneE164 +15550000001
adk config:set automationEnabled true
```

Do not use a real customer's number for the Emulator. Disable autonomy again after the smoke with `adk config:set automationEnabled false`. A future WhatsApp handler must obtain the real phone identity from the official integration payload and must not reuse `emulatorPhoneE164` or the Emulator envelope helper.

## WhatsApp blocker

No WhatsApp integration is installed and the generated ADK types contain no `whatsapp.channel`. A WhatsApp handler is therefore intentionally not registered. Installing and inspecting the official integration is required before mapping its phone number, provider message ID, quoted message ID, audio, or image payloads.

The existing wildcard Conversation is filtered to `chat.channel` and `webchat.channel`; it cannot accidentally process a future WhatsApp event using guessed fields.

## Delivery limitation in ADK 2.0.5

The raw Botpress HTTP client package contains `getOrCreateMessage`, but the `BotClient` exposed to an ADK Workflow does not. The implementation therefore uses the supported `client.createMessage` with `maxAttempts: 1`.

This prevents Botpress Workflow retries from intentionally creating another channel message, but it cannot resolve an ambiguous network failure where Botpress created the message and lost the response. Strict physical delivery deduplication remains blocked until the installed integration or ADK exposes an idempotent send operation. Database decisions and business actions must still be deduplicated by Next.js.

## Verification

```bash
npm run typecheck
npm run check
npm run build
```

`npm run typecheck` and `npm run check` are fully local. The production build also asks Botpress to sync its internal `typing-indicator`, `llm`, and `listable` interfaces. Without an authenticated ADK profile it stops before bundling those generated modules; do not fabricate or commit replacements for them. Run `adk login` only in an authorized environment, then repeat the build.

The fail-closed eval can be discovered without credentials, but execution requires the ADK development runtime. Full idempotency, concurrency, blocked-contact, and failure-injection tests require the matching Next.js test backend and cannot be proven by a conversational LLM eval alone.
