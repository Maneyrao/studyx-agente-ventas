import { describe, it } from 'vitest';

/**
 * Acceptance criteria for delivering 1–3 real messages per turn.
 *
 * These are deliberately PENDING, not failing: the change is blocked by
 * `agent_decisions.outbound_message_id UNIQUE`, so it needs an additive
 * migration plus per-part delivery fencing before any of it can go green.
 * The full contract and the ten invariants live in
 * `docs/AGENT_A_MULTI_MESSAGE_CONTRACT.md`.
 *
 * Turning these on is the definition of done for that follow-up task.
 */
describe.todo('Agent A multi-message delivery (deferred — see docs/AGENT_A_MULTI_MESSAGE_CONTRACT.md)', () => {
  it('delivers three ordered parts when the model writes three messages', () => {});

  it('behaves exactly like today when the model writes a single message', () => {});

  it('places an authorized payment link in exactly one part', () => {});

  it('keeps exactly three outbound messages after ten replays of the same commit', () => {});

  it('retries only the failed part and never resends a confirmed one', () => {});

  it('drops one part that fails the egress guard without losing the others', () => {});

  it('materializes the business action once per turn, not once per part', () => {});
});
