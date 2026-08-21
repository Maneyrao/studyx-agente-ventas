import { describe, expect, it } from 'vitest';
import {
  requireGeminiApiKey,
  resolveLocalQueueDatabaseUrl,
} from '../../../scripts/lib/durable-queue-cli';

describe('durable queue CLI database guard', () => {
  it('accepts only the explicit disposable local TEST_DATABASE_URL', () => {
    expect(resolveLocalQueueDatabaseUrl({
      TEST_DATABASE_URL: 'postgresql://postgres@127.0.0.1:55433/studyx_test',
      DATABASE_URL: 'postgresql://production.example.com/postgres',
    })).toBe('postgresql://postgres@127.0.0.1:55433/studyx_test');
  });

  it('never falls back to DATABASE_URL and rejects remote or non-test databases', () => {
    expect(() => resolveLocalQueueDatabaseUrl({
      DATABASE_URL: 'postgresql://postgres@127.0.0.1:55433/studyx_test',
    })).toThrow('TEST_DATABASE_URL is required');
    expect(() => resolveLocalQueueDatabaseUrl({
      TEST_DATABASE_URL: 'postgresql://prod.example.com:5432/studyx_test',
    })).toThrow('disposable local PostgreSQL');
    expect(() => resolveLocalQueueDatabaseUrl({
      TEST_DATABASE_URL: 'postgresql://postgres@127.0.0.1:55433/postgres',
    })).toThrow('studyx_test');
  });

  it('refuses to drain without an embedding provider key', () => {
    expect(() => requireGeminiApiKey({})).toThrow('GEMINI_API_KEY is required');
    expect(() => requireGeminiApiKey({ GEMINI_API_KEY: '  ' })).toThrow('GEMINI_API_KEY is required');
    expect(() => requireGeminiApiKey({ GEMINI_API_KEY: 'local-test-key' })).not.toThrow();
  });
});
