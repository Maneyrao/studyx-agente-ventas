export const STUDYX_RELEASE_DESTINATION = Object.freeze({
  profile: 'default',
  workspaceId: 'wkspace_01M0X4K3H2EE7RGM39Q29GF6VS',
  botId: '15050253-3088-47a4-940d-dc849c03860c',
  botName: 'StudyX Pruebas',
  whatsappIntegrationId: 'intver_01KZV3JDSXJDX3AVKT00J3J5RW',
  whatsappBotPhoneNumberId: '1300545066485709',
});

export function assertBotpressReleaseDestination({ profile, workspaceId, botId }) {
  if (profile !== STUDYX_RELEASE_DESTINATION.profile
    || workspaceId !== STUDYX_RELEASE_DESTINATION.workspaceId
    || botId !== STUDYX_RELEASE_DESTINATION.botId) {
    throw new Error('DESTINATION_MISMATCH');
  }
}

export function assertBotpressReleaseRemoteIdentity(remote) {
  if (remote?.name !== STUDYX_RELEASE_DESTINATION.botName) {
    throw new Error('REMOTE_BOT_IDENTITY_MISMATCH');
  }
  const whatsapp = remote?.integrations?.whatsapp;
  if (whatsapp?.id !== STUDYX_RELEASE_DESTINATION.whatsappIntegrationId
    || whatsapp.enabled !== true
    || whatsapp.status !== 'registered'
    || remote?.configuration?.data?.whatsappAllowedBotPhoneNumberId
      !== STUDYX_RELEASE_DESTINATION.whatsappBotPhoneNumberId) {
    throw new Error('REMOTE_WHATSAPP_CONNECTION_MISMATCH');
  }
}

export function normalizeBotpressIntegrationField(alias, field, value) {
  if (field !== 'configuration') return value;
  if (alias === 'whatsapp') {
    return { ...(value ?? {}), listenMessageEchoes: value?.listenMessageEchoes ?? false };
  }
  if (alias === 'telegram') {
    return { ...(value ?? {}), typingIndicatorEmoji: value?.typingIndicatorEmoji ?? false };
  }
  return value;
}
