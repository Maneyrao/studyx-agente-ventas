export function parseConversationStateVersionV1(value: number | string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error('CONVERSATION_STATE_VERSION_INVALID');
  }
  return parsed;
}
