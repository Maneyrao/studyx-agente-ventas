import { describe, expect, it } from 'vitest';
import {
  createReleaseManifest,
  REQUIRED_RELEASE_CONFIG,
} from '../../../scripts/generate-release-manifest.mjs';

const input = {
  environment: 'development',
  gitSha: '0123456789abcdef0123456789abcdef01234567',
  botpressArtifactSha: 'a'.repeat(64),
  promptVersion: 'studyx-agent-a-sales-v16',
  provider: 'google-ai-direct',
  model: 'gemini-3.6-flash',
  latestMigration: '20260825010001_payment_projection_jobs.sql',
  catalogSourceSha256: 'b'.repeat(64),
  requiredConfig: Object.fromEntries(REQUIRED_RELEASE_CONFIG.map((key) => [key, true])),
  builtAt: '2026-08-26T20:00:00.000Z',
};

describe('createReleaseManifest', () => {
  it('creates a deterministic value-safe manifest for one complete release', () => {
    const first = createReleaseManifest(input);
    const second = createReleaseManifest(input);

    expect(first).toEqual(second);
    expect(first).toEqual({
      environment: 'development',
      git_sha: input.gitSha,
      botpress_artifact_sha: input.botpressArtifactSha,
      prompt_version: input.promptVersion,
      provider: input.provider,
      model: input.model,
      latest_migration: input.latestMigration,
      catalog_source_sha256: input.catalogSourceSha256,
      required_config: input.requiredConfig,
      complete: true,
      built_at: input.builtAt,
    });
    expect(JSON.stringify(first)).not.toContain('secret');
  });

  it('fails closed when a required configuration presence bit is false', () => {
    expect(() => createReleaseManifest({
      ...input,
      requiredConfig: { ...input.requiredConfig, BUSINESS_WORKSPACE_SLUG: false },
    })).toThrow('RELEASE_MANIFEST_INCOMPLETE:BUSINESS_WORKSPACE_SLUG');
  });

  it.each([
    ['git SHA', { gitSha: 'not-a-git-sha' }, 'INVALID_RELEASE_MANIFEST_GIT_SHA'],
    ['Botpress artifact digest', { botpressArtifactSha: 'not-a-digest' }, 'INVALID_RELEASE_MANIFEST_BOTPRESS_ARTIFACT_SHA'],
    ['catalog digest', { catalogSourceSha256: 'not-a-digest' }, 'INVALID_RELEASE_MANIFEST_CATALOG_SOURCE_SHA256'],
    ['prompt version', { promptVersion: '' }, 'INVALID_RELEASE_MANIFEST_PROMPT_VERSION'],
  ])('rejects an invalid %s', (_label, override, expectedError) => {
    expect(() => createReleaseManifest({ ...input, ...override })).toThrow(expectedError);
  });
});
