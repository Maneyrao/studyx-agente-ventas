# Agent B Telegram smoke — local evidence

Status: `LOCAL_IMPLEMENTATION_COMPLETE`; live Telegram execution remains gated
and requires explicit external configuration and authorization.

The local vertical slice proves:

- strict `CallContextV1`, fixed-order UTF-8 serialization and SHA-256;
- 1,200-character boundary, no inferred facts, display-only sanitization;
- deterministic receipt without email, phone, token or LLM generation;
- one send per idempotency key, with timeouts paused as ambiguous;
- exact allowlisted chat/user/message/nonce callback verification;
- callback replay idempotency and immutable human verdict;
- one active call per contact, one call per source turn, append-only events;
- state projection independent from lifecycle-event arrival order;
- no Agent A, Retell, WhatsApp, Sheets or payment side effect.

Fresh command outputs and final counts are recorded in the implementation handoff,
not copied here, so this file cannot become stale test evidence.
