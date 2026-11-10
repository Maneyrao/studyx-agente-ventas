import { describe, expect, it } from 'vitest';

import { goldenCallSettlementDecisionV1 } from './call-settlement';

describe('golden call settlement', () => {
  it.each(['requested', 'dispatching', 'provider_accepted', 'dispatch_ambiguous', 'in_progress'])(
    'permite completar una llamada activa desde %s',
    (status) => {
      expect(goldenCallSettlementDecisionV1({
        status,
        result: null,
        desiredResult: 'buzon_de_voz',
      })).toEqual({ kind: 'transition', expectedStatus: status });
    },
  );

  it('es idempotente si el mismo resultado ya quedó completado', () => {
    expect(goldenCallSettlementDecisionV1({
      status: 'completed',
      result: 'buzon_de_voz',
      desiredResult: 'buzon_de_voz',
    })).toEqual({ kind: 'already_settled' });
  });

  it.each([
    ['completed', null],
    ['completed', 'atendida'],
    ['failed', 'VOICE_PROVIDER_CONFIGURATION_UNAVAILABLE'],
    ['no_answer', null],
    ['timed_out', null],
    ['cancelled', null],
  ])('rechaza el terminal incompatible %s/%s', (status, result) => {
    expect(goldenCallSettlementDecisionV1({
      status,
      result,
      desiredResult: 'buzon_de_voz',
    })).toEqual({ kind: 'incompatible_terminal', status, result });
  });
});
