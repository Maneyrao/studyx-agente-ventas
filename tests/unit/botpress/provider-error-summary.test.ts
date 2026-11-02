import { describe, expect, it } from 'vitest';
import { summarizeProviderError } from '../../../botpress-agent/src/lib/observability/provider-error-summary';

// Exact text observed on 2026-11-02 in the workflow step cache (wrkflow_01M6DV4FKN9YPZ85RW6Q20GP6R).
const LIVE_MESSAGE = '[Create Message] Received error response when sending scheduled message to integration '
  + '"8a7bb148-c95c-4527-a75f-611b4255f53c": [Internal] Request failed with status code 502 '
  + '(Error ID: err_20261102095847xE9BC49AA)';

class FakeApiError extends Error {
  readonly isApiError = true;
  constructor(readonly code: number, readonly type: string, message: string, readonly id?: string) { super(message); }
}

describe('summarizeProviderError', () => {
  it('extracts upstream status and Error ID from the live Botpress createMessage failure', () => {
    expect(summarizeProviderError(new FakeApiError(500, 'Runtime', LIVE_MESSAGE, 'err_20261102095847xE9BC49AA'))).toEqual({
      api_type: 'Runtime', api_code: 500, upstream_type: 'Internal', upstream_status: 502,
      error_id: 'err_20261102095847xE9BC49AA',
    });
  });

  it('reads the same facts from a plain Error restored by an ADK step', () => {
    expect(summarizeProviderError(new Error(`Error: ${LIVE_MESSAGE}`))).toEqual({
      upstream_type: 'Internal', upstream_status: 502, error_id: 'err_20261102095847xE9BC49AA',
    });
  });

  it('never copies free text or malformed fields', () => {
    const summary = summarizeProviderError(new FakeApiError(500, 'Bad type; drop', 'customer said hola (Error ID: nope)', 'not-an-id'));
    expect(summary).toEqual({ api_code: 500 });
    expect(JSON.stringify(summary)).not.toContain('hola');
  });

  it('returns null when there is nothing structured to report', () => {
    expect(summarizeProviderError(new Error('boom'))).toBeNull();
    expect(summarizeProviderError('boom')).toBeNull();
  });
});
