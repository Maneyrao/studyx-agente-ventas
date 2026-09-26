import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('post-call deployment schedule', () => {
  it('schedules the existing Agent B to Agent A post-call worker', () => {
    const config = JSON.parse(readFileSync(join(process.cwd(), 'vercel.json'), 'utf8')) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    expect(config.crons).toContainEqual({
      path: '/api/cron/post-call-followup',
      schedule: '50 3 * * *',
    });
  });
});
