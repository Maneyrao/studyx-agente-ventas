import { describe, expect, it } from 'vitest';
import { classifyAgentAAttemptFailure } from '../../../botpress-agent/src/lib/conversation/agent-a-attempt';
import * as channel from '../../../botpress-agent/src/lib/conversation/channel-preference-evidence';
import * as backendChannel from '@/features/conversation/domain/channel-preference-evidence';
import { enforceCommercialTruthV1 } from '@/features/orchestration/domain/commercial-truth-guard';

describe('14 October conversation: cross-boundary regressions', () => {
  it.each(['DECISION_REJECTED', 'PROFILE_UPDATE_REJECTED'])(
    'preserves backend rejection %s instead of blaming generation', code => {
      expect(classifyAgentAAttemptFailure(Object.assign(new Error(code), { code })))
        .toMatchObject({ stage: 'backend_rejected', retryable: false });
    });
  it('does not treat backend transport failure as a model failure', () => {
    expect(classifyAgentAAttemptFailure(Object.assign(new Error('timeout'), { code: 'STUDYX_TIMEOUT' })))
      .toMatchObject({ stage: 'backend_transport', retryable: false });
  });
  for (const implementation of [channel, backendChannel]) {
    it.each(['te dije que si, pero no me llamaste', 'no me han llamado', 'no me llamaron todavía', 'no me contactaste'])
      ('does not revoke consent from a complaint: %s', message => {
        expect(implementation.supportsCallDeclineV1(message, true)).toBe(false);
        expect(implementation.supportsChatPreferenceV1(message, true)).toBe(false);
      });
    it.each(['no me llames', 'no quiero una llamada', 'prefiero que no me contacten', 'no gracias'])
      ('still respects an actual refusal: %s', message => {
        expect(implementation.supportsCallDeclineV1(message, true)).toBe(true);
      });
  }
  it('allows the real canonical course enumeration followed by a shared description', () => {
    const content = 'Tenemos Inglés 1, Inglés 2 e Inglés 3, todos online y de 12 clases, salvo Inglés 3 que son 21.';
    const result = enforceCommercialTruthV1({ content, authorized_urls: [], canonical: {
      prices: [], durations: ['12 clases', '21 clases'], modality: null, certification: null,
      offering_names: ['Inglés 1', 'Inglés 2', 'Inglés 3'],
    } });
    expect(result.violations).toEqual([]);
    expect(result.content).toBe(content);
  });
  it('still rejects an invented course inside the enumeration', () => {
    expect(enforceCommercialTruthV1({ content: 'Tenemos Inglés 1, Inglés 4 e Inglés 3, todos online.',
      authorized_urls: [], canonical: { prices: [], durations: [], modality: null, certification: null,
        offering_names: ['Inglés 1', 'Inglés 2', 'Inglés 3'] } }).violations)
      .toContainEqual(expect.objectContaining({ code: 'OFFERING_NOT_CANONICAL' }));
  });
});
