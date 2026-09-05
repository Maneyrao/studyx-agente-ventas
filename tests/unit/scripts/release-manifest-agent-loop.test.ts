import { describe, expect, it } from 'vitest';
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
  promptVersion: 'studyx-agent-a-brain-v21',
  provider: 'deepseek-direct',
  model: 'deepseek-v4-flash',
  latestMigration: '20260905000004_agent_turn_preparations.sql',
  catalogSourceSha256: 'c'.repeat(64),
  builtAt: '2026-09-05T00:00:00.000Z',
  promptSha256: 'd'.repeat(64),
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

  it('refuses an empty tool contract version', () => {
    expect(() => createReleaseManifest({ ...base, toolContractVersion: '' }))
      .toThrow('INVALID_RELEASE_MANIFEST_TOOL_CONTRACT_VERSION');
  });

  it('hashes the effective identity-substituted prompt', async () => {
    const environment = {
      ...Object.fromEntries(REQUIRED_RELEASE_CONFIG.map((key) => [key, 'configured-for-test'])),
      NODE_ENV: 'test' as const,
      AGENT_A_ADVISOR_NAME: 'Ana',
      AGENT_A_ACADEMY_NAME: 'StudyX',
      RELEASE_BUILT_AT: '2026-09-05T00:00:00.000Z',
    };
    const first = await generateReleaseManifest(environment);
    const changedIdentity = await generateReleaseManifest({
      ...environment,
      AGENT_A_ADVISOR_NAME: 'Lucía',
    });

    expect(first.prompt_sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(changedIdentity.prompt_sha256).not.toBe(first.prompt_sha256);
  });
});
