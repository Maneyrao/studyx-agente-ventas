import { describe, expect, it } from 'vitest';
import {
  AGENT_A_REQUIRED_ENVIRONMENT,
  loadAgentACommercialConfig,
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
