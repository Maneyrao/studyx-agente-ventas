import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * Exact-attempt-count contract for requestStudyxJson.
 *
 * The 24s production trace showed the catalog step burning ~3.4s in redundant
 * retries: the HTTP layer allowed up to 3 additional retries AND the workflow
 * step declared maxAttempts: 2. These tests pin the new contract:
 *
 *   - default (critical, idempotent ops): 1 + 3 attempts, unchanged
 *   - degradable catalog: 1 + 1 attempts on transient failures only
 *   - permanent data errors (422 CATALOG_INVALID_DATA): exactly 1 attempt
 *
 * `@botpress/runtime` resolves to the test stub via the vitest alias.
 */
import { requestStudyxJson, StudyxHttpError } from '../../../botpress-agent/src/utils/http';

const okBody = { ok: true };
// At runtime the vitest alias makes both `z` instances the same zod package;
// the cast only reconciles the divergent compile-time nominal types.
type StudyxResponseSchema = Parameters<typeof requestStudyxJson>[0]['responseSchema'];
const OkSchema = z.object({ ok: z.boolean() }) as unknown as StudyxResponseSchema;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const baseParams = {
  path: '/api/agent/tools/catalog',
  method: 'GET' as const,
  idempotencyKey: 'catalog:list',
  traceId: '18a823e8-27c2-4279-9956-058f45f33cd5',
  responseSchema: OkSchema,
};

describe('requestStudyxJson attempt counts', () => {
  it('uses the default 1+3 attempts for critical operations on persistent 503', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(503, { error: 'CATALOG_UNAVAILABLE' }));

    await expect(requestStudyxJson(baseParams)).rejects.toMatchObject({
      code: 'CATALOG_UNAVAILABLE',
      attempts: 4,
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('makes exactly 2 attempts (1 + 1 retry) when additionalRetries is 1 and the failure is transient', async () => {
    fetchMock.mockImplementation(async () => jsonResponse(503, { error: 'CATALOG_UNAVAILABLE' }));

    await expect(
      requestStudyxJson({ ...baseParams, additionalRetries: 1 }),
    ).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE', attempts: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('recovers on the single retry when the transient failure clears', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503, { error: 'CATALOG_UNAVAILABLE' }))
      .mockResolvedValueOnce(jsonResponse(200, okBody));

    const result = await requestStudyxJson({ ...baseParams, additionalRetries: 1 });
    expect(result).toEqual(okBody);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('makes exactly 1 attempt — zero retries — on 422 CATALOG_INVALID_DATA', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: 'CATALOG_INVALID_DATA' }));

    await expect(
      requestStudyxJson({ ...baseParams, additionalRetries: 1 }),
    ).rejects.toMatchObject({ code: 'CATALOG_INVALID_DATA', retryable: false, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('makes exactly 1 attempt when additionalRetries is 0, even on a transient failure', async () => {
    fetchMock.mockResolvedValue(jsonResponse(503, { error: 'CATALOG_UNAVAILABLE' }));

    await expect(
      requestStudyxJson({ ...baseParams, additionalRetries: 0 }),
    ).rejects.toMatchObject({ attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 within the single-retry budget', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { error: 'RATE_LIMITED' }))
      .mockResolvedValueOnce(jsonResponse(200, okBody));

    const result = await requestStudyxJson({ ...baseParams, additionalRetries: 1 });
    expect(result).toEqual(okBody);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries network errors within the single-retry budget', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200, okBody));

    const result = await requestStudyxJson({ ...baseParams, additionalRetries: 1 });
    expect(result).toEqual(okBody);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never retries a schema-invalid 200 response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { unexpected: 'shape' }));

    await expect(
      requestStudyxJson({ ...baseParams, additionalRetries: 1 }),
    ).rejects.toMatchObject({ code: 'INVALID_STUDYX_RESPONSE', retryable: false, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('exposes StudyxHttpError with a stable non-retryable code for invalid data', async () => {
    fetchMock.mockResolvedValue(jsonResponse(422, { error: 'CATALOG_INVALID_DATA' }));

    try {
      await requestStudyxJson({ ...baseParams, additionalRetries: 1 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(StudyxHttpError);
      expect((error as StudyxHttpError).retryable).toBe(false);
    }
  });
});
