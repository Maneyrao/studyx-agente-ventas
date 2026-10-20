# Gabi + Lisandro Commercial Recovery Plan

> Scope: local implementation only. Production remains unchanged until the full verification gate passes.

## Outcome

Preserve Lisandro's consultative WhatsApp approach while correcting the concrete failures observed in the Gabi and Lisandro conversations:

1. Offer a call for a commercial reason after repeated price friction or an exception request, not after a greeting or by turn count.
2. Give Agent A one bounded rewrite when that high-value call opportunity is missed, while retaining the original safe answer if the provider cannot repair it.
3. Let the customer's current exact course override stale course state before a call, and refuse a voice-tool payment plan that contradicts an already confirmed plan.
4. Prevent unmaterialized promises such as "I will raise your exception" from reaching the customer.
5. Keep verified access delivery running when generated prose has only stylistic defects or the language model is unavailable; keep URLs and credentials backend-owned.
6. Make the canonical prompt less form-like, more adaptive to the customer's register, and explicit about referents such as "send me that link".

## TDD slices

- [x] Slice A — call opportunity policy and bounded rewrite
- [x] Slice B — current-course and confirmed-plan precedence
- [x] Slice C — operational exception-promise guard
- [x] Slice D — post-sale normalization and safe transactional fallback
- [x] Slice E — canonical prompt adaptation and generated prompt parity
- [x] Slice F — targeted/full unit suites, typecheck, lint, Botpress build, and architecture review
- [ ] Environment gate — database-backed integration suite and complete Next.js page collection

## Explicit non-goals for this patch

- No production deploy or Botpress publish.
- No change to WhatsApp account/integration routing.
- No naive "last webhook wins" rule for duplicate call-analysis events; that requires a provider-revision reducer and remains a separate hardening slice.
- No resend of passwords when a customer asks only for the campus URL.
- No new on-demand campus-link resend capability; verified initial access delivery now includes the backend-owned URL.
- No audio-transcription or duplicate call-analysis reducer changes in this patch.

## Verification gate

- Unit tests for each observed failure, first red and then green.
- Targeted workflow tests for call-offer repair and current course continuity.
- Existing call, post-sale, operational-guard, and canonical-prompt suites.
- TypeScript, lint, Botpress production build, and Next.js compile. Full Next.js
  page collection and integration tests require the unavailable local test database.
- Architect review before completion.
