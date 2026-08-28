import { describe, expect, it } from 'vitest';
import {
  AGENT_A_REQUIRED_ENVIRONMENT,
  loadAgentACommercialConfig,
  loadAgentABrainConfig,
  loadConversationPipelineConfig,
} from '@/lib/config';

const environment = Object.fromEntries(
  AGENT_A_REQUIRED_ENVIRONMENT.map((key) => [key, key === 'BUSINESS_WORKSPACE_SLUG' ? 'studyx' : 'configured']),
) as NodeJS.ProcessEnv;

describe('loadAgentACommercialConfig', () => {
  it('returns the fixed workspace only when every commercial dependency is configured', () => {
    expect(loadAgentACommercialConfig(environment)).toEqual({ workspaceSlug: 'studyx' });
  });

  it.each(AGENT_A_REQUIRED_ENVIRONMENT)('fails closed when %s is absent', (missing) => {
    const incomplete = { ...environment, [missing]: '  ' } as NodeJS.ProcessEnv;

    expect(() => loadAgentACommercialConfig(incomplete))
      .toThrow(`MISSING_AGENT_A_CONFIG:${missing}`);
  });

  it('keeps the workspace slug validation on the mandatory commercial path', () => {
    expect(() => loadAgentACommercialConfig({ ...environment, BUSINESS_WORKSPACE_SLUG: 'wrong slug' }))
      .toThrow('INVALID_BUSINESS_CONFIG:BUSINESS_WORKSPACE_SLUG');
  });
});

describe('loadConversationPipelineConfig', () => {
  it('is disabled unless the exact true value is configured', () => {
    expect(loadConversationPipelineConfig({})).toEqual({ enabled: false });
    expect(loadConversationPipelineConfig({ CONVERSATION_PIPELINE_V1_ENABLED: '' }))
      .toEqual({ enabled: false });
    expect(loadConversationPipelineConfig({ CONVERSATION_PIPELINE_V1_ENABLED: 'invalid' }))
      .toEqual({ enabled: false });
  });

  it('accepts a trimmed case-insensitive true value', () => {
    expect(loadConversationPipelineConfig({ CONVERSATION_PIPELINE_V1_ENABLED: ' TRUE ' }))
      .toEqual({ enabled: true });
  });
});

describe('loadAgentABrainConfig', () => {
  it.each([
    [{}, { enabled: false, shadow: false, mode: 'legacy', ready: true }],
    [{ AGENT_A_BRAIN_V1_SHADOW: 'true' }, { enabled: false, shadow: true, mode: 'shadow', ready: true }],
    [{ AGENT_A_BRAIN_V1_ENABLED: 'true' }, { enabled: true, shadow: false, mode: 'authoritative', ready: true }],
    [{ AGENT_A_BRAIN_V1_ENABLED: 'true', AGENT_A_BRAIN_V1_SHADOW: 'true' },
      { enabled: true, shadow: true, mode: 'invalid', ready: false }],
  ] as const)('maps %j to an explicit rollout mode', (input, expected) => {
    expect(loadAgentABrainConfig(input)).toEqual(expected);
  });

  it('fails closed for non-boolean values', () => {
    expect(loadAgentABrainConfig({
      AGENT_A_BRAIN_V1_ENABLED: 'yes', AGENT_A_BRAIN_V1_SHADOW: '1',
    })).toEqual({ enabled: false, shadow: false, mode: 'legacy', ready: true });
  });
});
