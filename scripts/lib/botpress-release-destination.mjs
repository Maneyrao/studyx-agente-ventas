export const STUDYX_RELEASE_DESTINATION = Object.freeze({
  profile: 'studyx-admissions',
  workspaceId: 'wkspace_01M75G5S9RYXD656HZ6J4SAHYQ',
  botId: 'e0f6be70-db0e-48e0-a9b7-f7864b6699d1',
  botName: 'Asesor de admisiones Studyx',
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

export function assertBotpressReleaseRemoteIdentity(remote, { mode = 'live' } = {}) {
  if (remote?.name !== STUDYX_RELEASE_DESTINATION.botName) {
    throw new Error('REMOTE_BOT_IDENTITY_MISMATCH');
  }
  if (!['live', 'preparation'].includes(mode)) {
    throw new Error('REMOTE_RELEASE_MODE_INVALID');
  }
  const whatsapp = remote?.integrations?.whatsapp;
  if (whatsapp?.id !== STUDYX_RELEASE_DESTINATION.whatsappIntegrationId
    || whatsapp.status !== 'registered'
    || remote?.configuration?.data?.whatsappAllowedBotPhoneNumberId
      !== STUDYX_RELEASE_DESTINATION.whatsappBotPhoneNumberId) {
    throw new Error('REMOTE_WHATSAPP_CONNECTION_MISMATCH');
  }
  const configuration = remote?.configuration?.data ?? {};
  if (mode === 'live') {
    if (whatsapp.enabled !== true
      || configuration.automationEnabled !== true
      || configuration.whatsappPublicEnabled !== true
      || configuration.whatsappCanaryEnabled !== false) {
      throw new Error('REMOTE_WHATSAPP_CONNECTION_MISMATCH');
    }
    return;
  }
  if (whatsapp.enabled !== false
    || configuration.automationEnabled !== false
    || configuration.whatsappPublicEnabled !== false
    || configuration.whatsappCanaryEnabled !== false) {
    throw new Error('REMOTE_PREPARATION_SAFETY_MISMATCH');
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
