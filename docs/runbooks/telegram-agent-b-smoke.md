# Runbook — Agent B Telegram smoke

## Scope

This smoke starts from an already-authorized `call_sessions` row. It validates
the B side only: canonical context → Telegram receipt → human verdict. It does
not claim that Agent A, Decision v4, or the post-call handback are connected.

## Prerequisites

1. Apply `20260816010002_call_ledger.sql` to the intended development database.
2. Configure the Agent B variables from `.env.example`; never paste their
   values into logs or commits.
3. Configure Telegram's webhook separately to the exact path
   `/api/webhooks/voice/telegram`, including the same webhook secret header.
4. Open Bot B from the allowlisted tester account and send `/start` once. A bot
   cannot initiate a new private conversation in cold state.
5. Ensure the test contact has a `sandbox_identities` row and the preauthorized
   call uses `provider='telegram_sandbox'`. The resolver refuses any other row.

External webhook, deployment, BotFather, Supabase remote, Retell and Botpress
configuration are intentionally not performed by this implementation.

## Live execution

Start the backend with the Agent B environment, then run:

```bash
TELEGRAM_AGENT_B_SMOKE_ENABLED=true \
node scripts/smoke-telegram-agent-b.mjs \
  --confirm-sandbox \
  --call-id <preauthorized-call-uuid>
```

The script requires both the environment guard and the CLI confirmation. It
prints only HTTP status and the sanitized dispatch result. A successful send
shows one deterministic receipt with two buttons. Press one button; re-pressing
or replaying the same update must not create another verdict.

## Evidence and latency

`call_context_receipts` separates three facts:

- `ack.status='accepted'`: B loaded and hashed the complete transport context.
- `delivery_status='accepted'`: Telegram acknowledged `sendMessage`.
- `verdict`: the allowlisted tester marked the visible information correct or
  incorrect.

`request_to_telegram_accepted_ms` records dispatch acceptance latency. Compute
p50/p95 only over accepted sandbox receipts; do not log context or identifiers.
The target for this adapter is p95 below 2 seconds.

## Failure policy

- Timeout or connection loss after attempting `sendMessage` becomes
  `ambiguous`; never send again blindly.
- A confirmed Telegram rejection becomes `failed`.
- A callback from another user/chat, an expired/unknown nonce, mismatched
  message, incomplete ack, or changed hash fails closed.
- Set `TELEGRAM_AGENT_B_SMOKE_ENABLED=false` to disable the manual script. Do
  not set `VOICE_PROVIDER=retell` until the real provider plan is implemented.
