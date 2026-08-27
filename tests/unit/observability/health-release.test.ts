import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';

const originalReleaseSha = process.env.STUDYX_RELEASE_SHA;
const originalVercelSha = process.env.VERCEL_GIT_COMMIT_SHA;

afterEach(() => {
  if (originalReleaseSha === undefined) delete process.env.STUDYX_RELEASE_SHA;
  else process.env.STUDYX_RELEASE_SHA = originalReleaseSha;
  if (originalVercelSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = originalVercelSha;
});

describe('GET /api/health release identity', () => {
  it('exposes the explicit non-secret release SHA for CLI deployments', async () => {
    process.env.STUDYX_RELEASE_SHA = '0123456789abcdef0123456789abcdef01234567';
    delete process.env.VERCEL_GIT_COMMIT_SHA;

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      status: 'ok',
      commit: '0123456789abcdef0123456789abcdef01234567',
    });
  });
});
