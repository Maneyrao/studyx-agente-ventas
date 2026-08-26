# Agent A recovery baseline — 2026-08-26

## Frozen integration base

- Target branch: `codex/integration-agent-a-outbound-prod`
- Integration SHA: `fe8f06ceffd4d1e6d41ebeed1525cb6368425e72`
- Published remote SHA at audit: `f7f2fcf`
- This SHA is an integration base, not an approved deployment.

## Baseline verification

- `npm run test:unit`: 1,434 passed, 23 skipped.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `botpress-agent: npm run typecheck && npm run check`: passed.

## Guardrails established by this phase

- `npm run release:manifest` creates a value-safe release identity only when all required configuration values are present in the process environment.
- The manifest includes Git SHA, Botpress source digest, prompt version, provider/model, latest migration, canonical catalog-source digest and boolean configuration presence.
- The manifest never reads or emits secret values.
- Runtime catalog count/digest and queue status are intentionally added by readiness in the next phase; this initial manifest is a build identity, not proof that a deployment is ready.

## Existing untracked files preserved

- `botpress-agent/node_modules/`
- `docs/superpowers/plans/2026-08-26-agent-a-sales-playbook-v16.md`
- `specs/008-agent-a-sales-playbook-v16/`

They predate this phase and are not part of its commit.
