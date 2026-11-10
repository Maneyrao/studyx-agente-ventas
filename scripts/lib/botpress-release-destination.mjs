export const STUDYX_RELEASE_DESTINATION = Object.freeze({
  profile: 'studyx-ipsj',
  workspaceId: 'wkspace_01KZ3JKAY3J597821CASY95DJT',
  botId: '28eefcf3-4623-4d5f-b08e-7d4c20a84d28',
});

export function assertBotpressReleaseDestination({ profile, workspaceId, botId }) {
  if (profile !== STUDYX_RELEASE_DESTINATION.profile
    || workspaceId !== STUDYX_RELEASE_DESTINATION.workspaceId
    || botId !== STUDYX_RELEASE_DESTINATION.botId) {
    throw new Error('DESTINATION_MISMATCH');
  }
}
