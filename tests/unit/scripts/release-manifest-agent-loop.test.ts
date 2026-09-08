import { describe, expect, it, vi } from 'vitest';
import {
  createReleaseManifest,
  generateReleaseManifest,
  REQUIRED_RELEASE_CONFIG,
} from '../../../scripts/generate-release-manifest.mjs';

const complete = Object.fromEntries(REQUIRED_RELEASE_CONFIG.map((key) => [key, true]));
const base = {
  requiredConfig: complete,
  environment: 'test',
  gitSha: 'a'.repeat(40),
  botpressArtifactSha: 'b'.repeat(64),
  promptVersion: 'studyx-agent-a-brain-v24',
  provider: 'deepseek-direct',
  model: 'deepseek-v4-flash',
  latestMigration: '20260905000004_agent_turn_preparations.sql',
  catalogSourceSha256: 'c'.repeat(64),
  builtAt: '2026-09-05T00:00:00.000Z',
  promptSha256: 'd'.repeat(64),
  promptTemplateSha256: 'e'.repeat(64),
  toolContractVersion: 'agent-tools-v3.0.0',
};

describe('release manifest for the agent loop', () => {
  it('carries the effective prompt digest and the tool contract version', () => {
    const manifest = createReleaseManifest(base);
    expect(manifest.prompt_sha256).toBe('d'.repeat(64));
    expect(manifest.tool_contract_version).toBe('agent-tools-v3.0.0');
  });

  it('refuses a prompt digest that is not a sha256', () => {
    expect(() => createReleaseManifest({ ...base, promptSha256: 'nope' }))
      .toThrow('INVALID_RELEASE_MANIFEST_PROMPT_SHA256');
  });

  it('preserves explicit prompt absence but rejects missing prompt evidence', () => {
    expect(createReleaseManifest({ ...base, promptSha256: null }).prompt_sha256).toBeNull();
    expect(() => createReleaseManifest({ ...base, promptSha256: undefined }))
      .toThrow('INVALID_RELEASE_MANIFEST_PROMPT_SHA256');
    const { promptSha256, ...withoutPromptEvidence } = base;
    void promptSha256;
    expect(() => createReleaseManifest(withoutPromptEvidence))
      .toThrow('INVALID_RELEASE_MANIFEST_PROMPT_SHA256');
  });

  it('refuses an empty tool contract version', () => {
    expect(() => createReleaseManifest({ ...base, toolContractVersion: '' }))
      .toThrow('INVALID_RELEASE_MANIFEST_TOOL_CONTRACT_VERSION');
  });

  it('binds an exact turn prompt and identifies the Agent Loop runtime', async () => {
    const environment = {
      ...Object.fromEntries(REQUIRED_RELEASE_CONFIG.map((key) => [key, 'configured-for-test'])),
      NODE_ENV: 'test' as const,
      RELEASE_BUILT_AT: '2026-09-05T00:00:00.000Z',
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      BOTPRESS_ARTIFACT_SHA256: 'f'.repeat(64),
    };
    const first = await generateReleaseManifest(environment, {
      promptSha256: '1'.repeat(64),
    });
    const secondTurn = await generateReleaseManifest(environment, {
      promptSha256: '2'.repeat(64),
    });

    expect(first).toMatchObject({
      botpress_artifact_sha: 'f'.repeat(64),
      prompt_sha256: '1'.repeat(64),
      prompt_version: 'studyx-agent-a-brain-v37',
      provider: 'deepseek-direct',
      model: 'deepseek-v4-flash',
    });
    expect(first.prompt_template_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(secondTurn.prompt_sha256).toBe('2'.repeat(64));
    expect(secondTurn.prompt_template_sha256).toBe(first.prompt_template_sha256);
  });

  it('rejects a divergent release model before provider fetch or commit', async () => {
    const providerFetch = vi.fn(async (url: string) => {
      void url;
      return new Response(null, { status: 200 });
    });
    const commit = vi.fn();
    const environment = {
      ...Object.fromEntries(REQUIRED_RELEASE_CONFIG.map((key) => [key, 'configured-for-test'])),
      NODE_ENV: 'test' as const,
      RELEASE_BUILT_AT: '2026-09-05T00:00:00.000Z',
      DEEPSEEK_MODEL: 'deepseek-reasoner',
      BOTPRESS_ARTIFACT_SHA256: 'f'.repeat(64),
    };

    const run = async () => {
      const manifest = await generateReleaseManifest(environment, {
        promptSha256: '1'.repeat(64),
      });
      await providerFetch('https://api.deepseek.com/responses');
      await commit(manifest);
    };

    await expect(run()).rejects.toThrow('RELEASE_MANIFEST_MODEL_MISMATCH');
    expect(providerFetch).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('refuses to invent a turn prompt digest during release generation', async () => {
    const environment = {
      ...Object.fromEntries(REQUIRED_RELEASE_CONFIG.map((key) => [key, 'configured-for-test'])),
      NODE_ENV: 'test' as const,
      RELEASE_BUILT_AT: '2026-09-05T00:00:00.000Z',
      BOTPRESS_ARTIFACT_SHA256: 'f'.repeat(64),
    };
    await expect(generateReleaseManifest(environment)).rejects
      .toThrow('RELEASE_MANIFEST_TURN_PROMPT_REQUIRED');
  });

  it('generates a truthful manifest for an explicit zero-request turn', async () => {
    const environment = {
      ...Object.fromEntries(REQUIRED_RELEASE_CONFIG.map((key) => [key, 'configured-for-test'])),
      NODE_ENV: 'test' as const,
      RELEASE_BUILT_AT: '2026-09-05T00:00:00.000Z',
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
      BOTPRESS_ARTIFACT_SHA256: 'f'.repeat(64),
      AGENT_A_PROMPT_SHA256: '9'.repeat(64),
    };
    const manifest = await generateReleaseManifest(environment, { promptSha256: null });
    expect(manifest.prompt_sha256).toBeNull();
  });

  it('fails closed when the deployed Botpress bundle digest is absent', async () => {
    const environment = {
      ...Object.fromEntries(REQUIRED_RELEASE_CONFIG.map((key) => [key, 'configured-for-test'])),
      NODE_ENV: 'test' as const,
      RELEASE_BUILT_AT: '2026-09-05T00:00:00.000Z',
      DEEPSEEK_MODEL: 'deepseek-v4-flash',
    };

    await expect(generateReleaseManifest(environment, { promptSha256: '1'.repeat(64) }))
      .rejects.toThrow('RELEASE_MANIFEST_BOTPRESS_ARTIFACT_SHA_REQUIRED');
  });
});
