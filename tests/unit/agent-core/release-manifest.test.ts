import { describe, expect, it } from 'vitest';
import {
  bindTurnPromptSha256V1,
  parseReleaseManifestV1,
  REQUIRED_RELEASE_CONFIG_V1,
} from '../../../agent-core/src/domain/release-manifest';

const valid = {
  environment: 'test',
  git_sha: 'a'.repeat(40),
  botpress_artifact_sha: 'b'.repeat(64),
  prompt_version: 'studyx-agent-a-brain-v24',
  provider: 'deepseek-direct',
  model: 'deepseek-v4-flash',
  latest_migration: '20260905000005_agent_loop_commit_trace.sql',
  catalog_source_sha256: 'c'.repeat(64),
  prompt_sha256: 'd'.repeat(64),
  prompt_template_sha256: 'e'.repeat(64),
  tool_contract_version: 'agent-tools-v3.0.0',
  required_config: Object.fromEntries(
    REQUIRED_RELEASE_CONFIG_V1.map((key) => [key, true]),
  ),
  complete: true as const,
  built_at: '2026-09-05T16:00:00.000Z',
};

describe('ReleaseManifestV1 boundary', () => {
  it('accepts one complete per-turn manifest', () => {
    expect(parseReleaseManifestV1(valid)).toEqual(valid);
  });

  it('preserves explicit prompt absence for a turn with zero model requests', () => {
    const withoutModelRequest = { ...valid, prompt_sha256: null };
    expect(parseReleaseManifestV1(withoutModelRequest)).toEqual(withoutModelRequest);
  });

  it.each([
    {},
    { ...valid, prompt_sha256: 'synthetic' },
    { ...valid, prompt_template_sha256: null },
    { ...valid, required_config: { ...valid.required_config, DEEPSEEK_API_KEY: false } },
    { ...valid, complete: false },
  ])('rejects incomplete or corrupt evidence: %j', (candidate) => {
    expect(() => parseReleaseManifestV1(candidate))
      .toThrow('INVALID_AGENT_LOOP_RELEASE_MANIFEST');
  });

  it('binds the exact accepted turn hash without changing release identity', () => {
    const { prompt_sha256: oldPromptSha256, ...template } = valid;
    void oldPromptSha256;
    const bound = bindTurnPromptSha256V1(template, 'f'.repeat(64));
    expect(bound).toEqual({ ...valid, prompt_sha256: 'f'.repeat(64) });
  });
});
