import { describe, expect, it } from 'vitest';
import { claimsImmediateCallDispatchV1 as backendDetector } from '@/features/conversation/domain/operational-promise-guard';
import { claimsImmediateCallDispatchV1 as botpressDetector } from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import {
  claimsImmediateCallDispatchV1,
  pruneCallDispatchClaimsV1,
} from '@/shared/conversation/call-dispatch-claim';

describe('call dispatch claim (shared by backend and Botpress)', () => {
  it('backend and Botpress use the same detector', () => {
    expect(backendDetector).toBe(claimsImmediateCallDispatchV1);
    expect(botpressDetector).toBe(claimsImmediateCallDispatchV1);
  });

  it.each([
    ['Dale, te llamamos.', true],
    ['Y si puedes, te llamo.', false],
    ['¿Te llamo ahora?', false],
    ['No te llamo hasta que confirmes.', false],
  ])('detects %s -> %s', (text, expected) => {
    expect(claimsImmediateCallDispatchV1(text)).toBe(expected);
  });

  it('prunes by sentence and keeps the rest of the bubble', () => {
    expect(pruneCallDispatchClaimsV1({ messages: ['Dale, te llamamos. Pasame tu nombre, apellido y correo.'] }))
      .toEqual({ messages: ['Pasame tu nombre, apellido y correo.'], kept_indices: [0], call_offer: null });
  });

  it('drops an emptied bubble and reports the kept indices', () => {
    expect(pruneCallDispatchClaimsV1({ messages: ['Te llamamos.', 'Pasame tu correo.'] }))
      .toEqual({ messages: ['Pasame tu correo.'], kept_indices: [1], call_offer: null });
  });

  it('returns null when nothing claims a dispatch or nothing remains', () => {
    expect(pruneCallDispatchClaimsV1({ messages: ['Pasame tu correo.'] })).toBeNull();
    expect(pruneCallDispatchClaimsV1({ messages: ['Te llamamos.'] })).toBeNull();
  });
});
