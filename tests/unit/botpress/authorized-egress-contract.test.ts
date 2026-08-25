import { describe, expect, it } from 'vitest';

import { CommitDecisionResponseSchema } from '../../../botpress-agent/src/schemas/contracts';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';

function responseWithOutbound(outbound: Record<string, unknown>) {
  return {
    status: 'committed',
    replayed: false,
    trace_id: UUID,
    turn_id: UUID,
    decision_id: UUID,
    next_state: 'completed',
    outbound: {
      id: UUID,
      content: 'Contenido autorizado',
      status: 'pending',
      delivery_attempt: 1,
      ...outbound,
    },
    call_request: null,
  };
}

describe('Botpress authorized egress contract', () => {
  it('rejects a committed outbound that omits its authorization manifest', () => {
    expect(CommitDecisionResponseSchema.safeParse(responseWithOutbound({})).success).toBe(false);
  });

  it('accepts only the exact v1 manifest shape', () => {
    const manifest = {
      schema_version: 1,
      content_hash: 'a'.repeat(64),
      authorized_urls: ['https://buy.stripe.com/pay?plan=one#checkout'],
      protected_facts: [{ kind: 'price', value: 'USD 360' }],
    };

    expect(CommitDecisionResponseSchema.safeParse(responseWithOutbound({
      authorized_egress: manifest,
    })).success).toBe(true);
    expect(CommitDecisionResponseSchema.safeParse(responseWithOutbound({
      authorized_egress: { ...manifest, unexpected_capability: true },
    })).success).toBe(false);
  });

  it('rejects non-http URL capabilities and unknown protected fact kinds', () => {
    const base = {
      schema_version: 1,
      content_hash: 'a'.repeat(64),
      authorized_urls: [],
      protected_facts: [],
    };

    expect(CommitDecisionResponseSchema.safeParse(responseWithOutbound({
      authorized_egress: { ...base, authorized_urls: ['ftp://files.example.test/catalog'] },
    })).success).toBe(false);
    expect(CommitDecisionResponseSchema.safeParse(responseWithOutbound({
      authorized_egress: {
        ...base,
        protected_facts: [{ kind: 'discount', value: '50%' }],
      },
    })).success).toBe(false);
  });
});
