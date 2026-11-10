/** Private ADK entry points reviewed against the repository's pinned 2.0.8 SDK. */
const REVIEWED_VERSION = '2.0.8';
const PREFIX = 'node_modules/@botpress/adk-cli/dist/';

export function requireBotpressReleaseProfile(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    throw new Error('EXPLICIT_BOTPRESS_PROFILE_REQUIRED');
  }
  return value;
}

/** Loads capabilities only; the caller retains the destination and publication guards. */
export async function loadReviewedBotpressAdk(version, load) {
  if (version !== REVIEWED_VERSION) throw new Error('UNREVIEWED_ADK_VERSION');
  const { auth } = await load(`${PREFIX}chunk-wsf9y305.js`);
  if (typeof auth?.setProfileOverride !== 'function') throw new Error('ADK_ENTRY_POINT_INVALID:auth');
  const { resolveCommandContext } = await load(`${PREFIX}chunk-f04r0wm7.js`);
  if (typeof resolveCommandContext !== 'function') throw new Error('ADK_ENTRY_POINT_INVALID:resolveCommandContext');
  const { refreshDependencySnapshotOnce } = await load(`${PREFIX}chunk-ygga1k24.js`);
  if (typeof refreshDependencySnapshotOnce !== 'function') throw new Error('ADK_ENTRY_POINT_INVALID:refreshDependencySnapshotOnce');
  const { adkBuild } = await load(`${PREFIX}chunk-6yzpbh79.js`);
  if (typeof adkBuild !== 'function') throw new Error('ADK_ENTRY_POINT_INVALID:adkBuild');
  return { auth, resolveCommandContext, refreshDependencySnapshotOnce, adkBuild };
}
