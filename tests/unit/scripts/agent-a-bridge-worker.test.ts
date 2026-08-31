import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

describe('Agent A local bridge worker', () => {
  it('boots as a standalone tsx entrypoint without loading the ADK runtime as CommonJS', async () => {
    const child = spawn(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/run-agent-a-bridge-worker.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          STUDYX_LOCAL_API_BASE_URL: 'http://127.0.0.1:4300',
          STUDYX_ORCHESTRATOR_KEY: 'test-orchestrator',
          ORCHESTRATOR_KEY_ID: 'test-key-id',
          STUDYX_SIGNING_SECRET: 'test-signing',
          DEEPSEEK_API_KEY: 'test-deepseek',
          STUDYX_WORKER_RUN_ID: 'test-worker-run',
        },
        timeout: 10_000,
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.stdin.end();
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });

    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(JSON.parse(stdout.trim())).toEqual({ type: 'ready' });
  });
});
