# StudyX test harness

The active suite separates deterministic unit/contract checks from disposable-database integration tests.

## Active now

- `tests/unit/**`: deterministic heuristics and the delivery retry-policy oracle.
- `tests/integration/**`: local guard, lifecycle, replay, concurrency, rollback and relational isolation.
- `supabase/tests/001_*.sql` through `006_*.sql`: schema, permissions, memory isolation,
  durable jobs/outbox structure and a ten-delivery idempotency replay at the database boundary.

Run:

```bash
npm run test:unit
npm run test:coverage
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:integration
npm run test:db:invariants
```

No `todo` test is counted as a passing invariant. External WhatsApp, backup/failover and production-load gaps are tracked in `docs/FAILURE_MATRIX.md`.

## Safety

Integration helpers accept only an allowlist of disposable ports on `127.0.0.1`; every remote host is rejected. The Supabase reset loop accepts only `127.0.0.1:54322`, always passes `--local --no-seed` and runs
three attempts so role/migration non-idempotency is visible.

The reset loop requires a container runtime supported by Supabase CLI:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run test:db:reset-loop
```
