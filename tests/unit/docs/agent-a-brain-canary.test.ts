import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const runbook = readFileSync(resolve(
  __dirname,
  '../../../docs/runbooks/agent-a-brain-canary.md',
), 'utf8');

describe('Agent A brain canary runbook', () => {
  it('documents the current DeepSeek provider and all reversible rollout flags', () => {
    expect(runbook).toContain('DEEPSEEK_API_KEY');
    expect(runbook).toContain('deepseek-v4-flash');
    for (const flag of [
      'AGENT_A_CONTEXT_SCOPING',
      'AGENT_A_STATE_ASSERTIONS',
      'AGENT_A_REPAIR_ENABLED',
      'AGENT_A_SINGLE_ROUTE',
    ]) expect(runbook).toContain(flag);
    expect(runbook).not.toContain('OPENAI_API_KEY');
    expect(runbook).not.toContain('gpt-5.6');
  });

  it('requires same SHA, independent quality and reverse-order rollback', () => {
    expect(runbook).toMatch(/mismo SHA/iu);
    expect(runbook).toContain('conversation_quality_complete=true');
    expect(runbook).toMatch(/orden inverso/iu);
    expect(runbook).toContain('AGENT_A_SINGLE_ROUTE=false');
    expect(runbook).toContain('AGENT_A_STATE_ASSERTIONS=false');
  });
});
