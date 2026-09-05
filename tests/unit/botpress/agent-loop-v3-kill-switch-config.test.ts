import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Agent Loop V3 bundle kill switch configuration', () => {
  it('declares an explicit boolean that defaults to disabled for legacy bundles', () => {
    const source = readFileSync(join(process.cwd(), 'botpress-agent/agent.config.ts'), 'utf8');

    expect(source).toMatch(
      /agentAAgentLoopV3KillSwitch:\s*z\.boolean\(\)\.default\(false\)/u,
    );
  });
});
