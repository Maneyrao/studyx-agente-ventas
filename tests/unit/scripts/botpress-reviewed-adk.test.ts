import { describe, expect, it, vi } from 'vitest';
import { loadReviewedBotpressAdk, requireBotpressReleaseProfile } from '../../../scripts/lib/botpress-reviewed-adk.mjs';

describe('reviewed Botpress publication SDK boundary', () => {
  it('rejects an unreviewed SDK before loading any private entry point', async () => {
    const load = vi.fn();
    await expect(loadReviewedBotpressAdk('2.0.9', load)).rejects.toThrow('UNREVIEWED_ADK_VERSION');
    expect(load).not.toHaveBeenCalled();
  });

  it('loads only the reviewed 2.0.8 entry points with required callable contracts', async () => {
    const auth = { setProfileOverride: vi.fn() };
    const resolveCommandContext = vi.fn();
    const refreshDependencySnapshotOnce = vi.fn();
    const adkBuild = vi.fn();
    const load = vi.fn(async (file: string) => {
      if (file.endsWith('chunk-wsf9y305.js')) return { auth };
      if (file.endsWith('chunk-f04r0wm7.js')) return { resolveCommandContext };
      if (file.endsWith('chunk-ygga1k24.js')) return { refreshDependencySnapshotOnce };
      if (file.endsWith('chunk-6yzpbh79.js')) return { adkBuild };
      throw new Error('UNREVIEWED_PRIVATE_MODULE');
    });
    await expect(loadReviewedBotpressAdk('2.0.8', load)).resolves.toEqual({
      auth, resolveCommandContext, refreshDependencySnapshotOnce, adkBuild,
    });
    expect(load).toHaveBeenCalledTimes(4);
    // Loading an adapter may not resolve credentials, build or publish anything.
    expect(resolveCommandContext).not.toHaveBeenCalled();
    expect(adkBuild).not.toHaveBeenCalled();
  });

  it.each(['auth', 'resolveCommandContext', 'refreshDependencySnapshotOnce', 'adkBuild'])(
    'fails closed when the reviewed SDK no longer exports %s', async (missing) => {
      const valid = { auth: { setProfileOverride: vi.fn() }, resolveCommandContext: vi.fn(),
        refreshDependencySnapshotOnce: vi.fn(), adkBuild: vi.fn() };
      const load = vi.fn(async () => ({ ...valid, [missing]: undefined }));
      await expect(loadReviewedBotpressAdk('2.0.8', load)).rejects.toThrow(`ADK_ENTRY_POINT_INVALID:${missing}`);
    });

  it('requires an explicit release profile for the confirmed account', () => {
    expect(() => requireBotpressReleaseProfile(undefined)).toThrow('EXPLICIT_BOTPRESS_PROFILE_REQUIRED');
    expect(() => requireBotpressReleaseProfile('')).toThrow('EXPLICIT_BOTPRESS_PROFILE_REQUIRED');
    expect(() => requireBotpressReleaseProfile(' studyx-detmaneyro ')).toThrow('EXPLICIT_BOTPRESS_PROFILE_REQUIRED');
    expect(requireBotpressReleaseProfile('studyx-detmaneyro')).toBe('studyx-detmaneyro');
  });
});
