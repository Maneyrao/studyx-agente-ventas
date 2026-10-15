import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const botpressAgentDir = fileURLToPath(
  new URL('../../../botpress-agent/', import.meta.url),
);
const adk = fileURLToPath(
  new URL('../../../botpress-agent/node_modules/.bin/adk', import.meta.url),
);

describe('Botpress workflow registration', () => {
  it('discovers both production workflows through the real ADK', () => {
    const result = spawnSync(adk, ['status', '--format', 'json'], {
      cwd: botpressAgentDir,
      encoding: 'utf8',
      env: { ...process.env, DO_NOT_TRACK: '1' },
    });

    expect(result.status, result.stderr).toBe(0);

    const status = JSON.parse(result.stdout) as {
      primitives: { workflows: { details: Array<{ name: string }> } };
    };

    expect(status.primitives.workflows.details.map(({ name }) => name)).toEqual(
      expect.arrayContaining(['processInboundTurn', 'transportRecoveryCanary']),
    );
  });
});
