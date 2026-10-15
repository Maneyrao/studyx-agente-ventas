import { beforeEach, describe, expect, it, vi } from 'vitest';
const { requestStudyxJson, ingestCanonicalTurnV1 } = vi.hoisted(() => ({
  requestStudyxJson: vi.fn(), ingestCanonicalTurnV1: vi.fn(),
}));
vi.mock('../../../botpress-agent/src/utils/http', async importOriginal => ({
  ...await importOriginal<typeof import('../../../botpress-agent/src/utils/http')>(), requestStudyxJson,
}));
vi.mock('../../../botpress-agent/src/lib/inbound/ingest-canonical-turn', () => ({ ingestCanonicalTurnV1 }));
import { synchronizeConversationInbound } from '../../../botpress-agent/src/lib/inbound/sync-conversation-inbound';
import { dispatch } from '../../../botpress-agent/src/channels';

const conversation = { id: 'conv_source_test', tags: { 'whatsapp:userPhone': '5491100000000' } };
const at = Date.now();
const message = (id: string, offset = 0, type = 'text') => ({ id, type, direction: 'incoming',
  conversationId: conversation.id, userId: 'user_source_test', createdAt: new Date(at + offset).toISOString(),
  payload: { text: id }, tags: {} });
const first = message('first', -2800), second = message('second');
function input() {
  const result = dispatch({ type: 'message', channel: 'whatsapp.channel', message: second,
    conversation, traceId: '18a823e8-27c2-4279-9956-058f45f33cd5' });
  if (result.kind !== 'envelope') throw new Error(result.reason);
  return result.input;
}
let persisted: Set<string>;
beforeEach(() => {
  persisted = new Set(['second']);
  requestStudyxJson.mockReset(); ingestCanonicalTurnV1.mockReset();
  requestStudyxJson.mockImplementation(async () => ({ persisted_message_ids: [...persisted] }));
  ingestCanonicalTurnV1.mockImplementation(async value => { persisted.add(value.external_message_id); return {}; });
});
const client = (messages: unknown[], nextToken?: string) => ({
  getConversation: vi.fn(async () => ({ conversation })),
  listMessages: vi.fn(async () => ({ messages, meta: { nextToken } })),
});

describe('complete durable source before batch claim', () => {
  it('persists the earlier missing bubble before allowing a later one to proceed', async () => {
    const source = client([second, first]);
    await synchronizeConversationInbound({ input: input(), client: source as never });
    expect([...persisted].sort()).toEqual(['first', 'second']);
    expect(ingestCanonicalTurnV1.mock.calls[0]?.[0]).toMatchObject({
      external_message_id: 'first', message: { text: 'first', occurred_at: first.createdAt },
    });
  });
  it('reads every source page before deciding what is complete', async () => {
    const source = client([]);
    source.listMessages.mockResolvedValueOnce({ messages: [second], meta: { nextToken: 'page2' } })
      .mockResolvedValueOnce({ messages: [first], meta: { nextToken: undefined } });
    await synchronizeConversationInbound({ input: input(), client: source as never });
    expect(persisted.has('first')).toBe(true);
    expect(source.listMessages).toHaveBeenCalledTimes(2);
  });
  it('blocks a truncated snapshot and one that cannot prove the origin exists', async () => {
    await expect(synchronizeConversationInbound({ input: input(), client: client([second], 'loop') as never }))
      .rejects.toMatchObject({ retryable: true });
    await expect(synchronizeConversationInbound({ input: input(), client: client([first]) as never }))
      .rejects.toMatchObject({ retryable: true });
  });
  it('blocks an unpersisted audio bubble until its own transcription workflow saves it', async () => {
    const audio = { ...first, type: 'audio', payload: { audioUrl: 'https://example.invalid/audio.ogg' } };
    await expect(synchronizeConversationInbound({ input: input(), client: client([audio, second]) as never }))
      .rejects.toMatchObject({ retryable: true });
    expect(ingestCanonicalTurnV1).not.toHaveBeenCalled();
  });
  it('blocks when canonical persistence of the missing fragment fails', async () => {
    ingestCanonicalTurnV1.mockRejectedValueOnce(new Error('backend unavailable'));
    await expect(synchronizeConversationInbound({ input: input(), client: client([first, second]) as never }))
      .rejects.toMatchObject({ retryable: true });
  });
  it('preserves old missing input for review instead of dating it as a new turn', async () => {
    const old = { ...first, createdAt: new Date(Date.now() - 11 * 60_000).toISOString() };
    await expect(synchronizeConversationInbound({ input: input(), client: client([old, second]) as never }))
      .rejects.toMatchObject({ code: 'SOURCE_EVENT_REQUIRES_REVIEW', retryable: false });
    expect(ingestCanonicalTurnV1).not.toHaveBeenCalled();
  });
  it('refuses a snapshot belonging to another user', async () => {
    await expect(synchronizeConversationInbound({ input: input(),
      client: client([{ ...first, userId: 'another-user' }, second]) as never }))
      .rejects.toMatchObject({ retryable: true });
    expect(ingestCanonicalTurnV1).not.toHaveBeenCalled();
  });
  it('refuses a conversation whose platform phone no longer matches the canonical input', async () => {
    const source = client([first, second]);
    source.getConversation.mockResolvedValueOnce({ conversation: { ...conversation,
      tags: { 'whatsapp:userPhone': '5491100000001' } } });
    await expect(synchronizeConversationInbound({ input: input(), client: source as never }))
      .rejects.toMatchObject({ retryable: true });
    expect(ingestCanonicalTurnV1).not.toHaveBeenCalled();
  });
});
