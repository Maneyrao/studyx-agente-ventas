import { describe, expect, it } from 'vitest';
import {
  AGENT_A_IDENTITY_VARIABLES_V1,
  loadAgentAIdentityV1,
  resolveCanonicalPromptIdentityV1,
} from '../../../botpress-agent/src/prompts/agent-a-identity';
import { STUDYX_AGENT_A_CANONICAL_PROMPT } from '../../../botpress-agent/src/prompts/studyx-agent-a-canonical.generated';

const identity = {
  advisor_name: 'Camila',
  academy_name: 'StudyX',
  website: 'studyx.com',
  instagram: '@studyx',
};

describe('canonical prompt identity resolution', () => {
  it('resolves every identity variable the canonical prompt declares', () => {
    const resolved = resolveCanonicalPromptIdentityV1(STUDYX_AGENT_A_CANONICAL_PROMPT, identity);

    expect(resolved.unresolved).toEqual([]);
    expect(resolved.prompt).toContain('Eres el asistente virtual de StudyX');
    for (const variable of AGENT_A_IDENTITY_VARIABLES_V1) {
      expect(resolved.prompt).not.toContain(`{{${variable}}}`);
    }
  });

  it('reports an identity variable that configuration could not resolve', () => {
    const resolved = resolveCanonicalPromptIdentityV1(
      'Sos {{NOMBRE_ASESOR}} de {{NOMBRE_ACADEMIA}}. WEB: {{WEB}}',
      { ...identity, website: null },
    );

    expect(resolved.unresolved).toEqual(['WEB']);
    expect(resolved.prompt).toContain('Sos Camila de StudyX.');
  });

  it('leaves behavioural example slots untouched so they stay slots, not facts', () => {
    const resolved = resolveCanonicalPromptIdentityV1(
      'Hola {{nombre}}, ¿ya pensabas estudiar {{CURSO}}? ¿Hacés el de {{X}} o el de {{Y}}?',
      identity,
    );

    expect(resolved.prompt).toBe('Hola {{nombre}}, ¿ya pensabas estudiar {{CURSO}}? ¿Hacés el de {{X}} o el de {{Y}}?');
  });

  it('reads identity from configuration and refuses a blank advisor or academy name', () => {
    expect(loadAgentAIdentityV1({
      AGENT_A_ADVISOR_NAME: 'Camila',
      AGENT_A_ACADEMY_NAME: 'StudyX',
      AGENT_A_WEBSITE: 'studyx.com',
      AGENT_A_INSTAGRAM: '@studyx',
    })).toEqual(identity);

    expect(loadAgentAIdentityV1({ AGENT_A_ADVISOR_NAME: '  ', AGENT_A_ACADEMY_NAME: 'StudyX' }))
      .toBeNull();
  });
});
