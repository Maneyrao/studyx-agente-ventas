import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configuration, secrets } from '@botpress/runtime';

const { getOrCreate, ingestCanonicalTurnV1 } = vi.hoisted(() => ({
  getOrCreate: vi.fn(),
  ingestCanonicalTurnV1: vi.fn(),
}));

vi.mock('../../../botpress-agent/src/workflows/processInboundTurn', () => ({
  processInboundTurn: { getOrCreate },
}));
vi.mock('../../../botpress-agent/src/lib/inbound/ingest-canonical-turn', () => ({
  ingestCanonicalTurnV1,
}));

import router from '../../../botpress-agent/src/conversations/router';

type RouterHandler = (props: {
  type: string;
  channel: string;
  message: unknown;
  conversation: { id: string; alias?: string; integration?: string; tags?: Record<string, string> };
}) => Promise<void>;

const handler = (
  router as unknown as { definition: { channel: string; handler: RouterHandler } }
).definition.handler;

const successSecrets = {
  messageId: 'wamid.raw-sensitive-success',
  conversationId: 'raw-sensitive-conversation-success',
  phone: '5491112345678',
  body: 'raw-sensitive-body-success',
  mediaUrl: 'https://media.example.invalid/raw-sensitive-success',
};

const successConversation = {
  id: successSecrets.conversationId,
  alias: 'whatsapp',
  integration: 'whatsapp',
  tags: {
    'whatsapp:userPhone': successSecrets.phone,
    'whatsapp:botPhoneNumberId': 'safe-sender-reference',
  },
};

const successMessage = {
  id: successSecrets.messageId,
  createdAt: '2026-08-25T10:15:00.000Z',
  type: 'text',
  direction: 'incoming',
  userId: 'raw-sensitive-user-success',
  conversationId: successSecrets.conversationId,
  payload: { text: successSecrets.body, mediaUrl: successSecrets.mediaUrl },
  tags: {},
};

function capturedRecords(info: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> {
  return info.mock.calls.map((call: unknown[]) =>
    JSON.parse(String(call[0])) as Record<string, unknown>);
}

function expectSecretsAbsent(records: Array<Record<string, unknown>>, secrets: string[]): void {
  const serialized = JSON.stringify(records);
  for (const secret of secrets) expect(serialized).not.toContain(secret);
}

beforeEach(() => {
  getOrCreate.mockReset();
  getOrCreate.mockResolvedValue({ id: 'workflow-safe-reference' });
  ingestCanonicalTurnV1.mockReset();
  ingestCanonicalTurnV1.mockResolvedValue({
    status: 'accepted', replayed: false,
    trace_id: '18a823e8-27c2-4279-9956-058f45f33cd5',
    turn_id: '18a823e8-27c2-4279-9956-058f45f33cd5',
    conversation_id: '18a823e8-27c2-4279-9956-058f45f33cd5',
    batch: {
      id: '18a823e8-27c2-4279-9956-058f45f33cd5', state: 'waiting',
      joined_existing: false, due_at: '2026-09-23T12:00:02.000Z',
      hard_deadline_at: '2026-09-23T12:00:10.000Z', conversation_seq: 1, message_count: 1,
    },
    policy: { may_respond: true, allowed_response_types: ['commercial_reply'], reason: null },
    contact: {
      id: '18a823e8-27c2-4279-9956-058f45f33cd5', status: 'prospecto', name: null,
      blocked: false, consent_status: 'allowed',
    },
    existing_result: null,
  });
  configuration.automationEnabled = true;
  configuration.whatsappCanaryEnabled = true;
  secrets.WHATSAPP_CANARY_PHONE_E164S = `+${successSecrets.phone}`;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WhatsApp router log boundary', () => {
  it('blocks a non-allowlisted WhatsApp identity before creating any workflow', async () => {
    const deniedPhone = '5491198765432';
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await handler({
      type: 'message',
      channel: 'whatsapp.channel',
      message: successMessage,
      conversation: {
        ...successConversation,
        tags: { ...successConversation.tags, 'whatsapp:userPhone': deniedPhone },
      },
    });

    expect(getOrCreate).not.toHaveBeenCalled();
    const records = capturedRecords(info);
    expect(records).toEqual([{
      event: 'studyx.router.whatsapp_canary_blocked',
      adapter: 'whatsapp',
      trace_id: expect.any(String),
      reason: 'WHATSAPP_CANARY_PHONE_NOT_ALLOWED',
    }]);
    expectSecretsAbsent(records, [deniedPhone, secrets.WHATSAPP_CANARY_PHONE_E164S]);
  });

  it('blocks official WhatsApp before workflow creation when automation is disabled', async () => {
    configuration.automationEnabled = false;
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await handler({
      type: 'message',
      channel: 'whatsapp.channel',
      message: successMessage,
      conversation: successConversation,
    });

    expect(getOrCreate).not.toHaveBeenCalled();
    expect(capturedRecords(info)).toEqual([{
      event: 'studyx.router.whatsapp_canary_blocked',
      adapter: 'whatsapp',
      trace_id: expect.any(String),
      reason: 'AUTOMATION_DISABLED',
    }]);
  });
  it('omits WhatsApp identifiers and payload values from workflow-start logs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await handler({
      type: 'message',
      channel: 'whatsapp.channel',
      message: successMessage,
      conversation: successConversation,
    });

    const records = capturedRecords(info);
    expect(records).toEqual([
      {
        event: 'studyx.router.workflow_started',
        adapter: 'whatsapp',
        trace_id: expect.any(String),
        workflow_id: 'workflow-safe-reference',
      },
    ]);
    expectSecretsAbsent(records, Object.values(successSecrets));
  });

  it('omits WhatsApp identifiers and payload values when workflow start fails', async () => {
    getOrCreate.mockRejectedValueOnce(new Error('safe failure'));
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(handler({
      type: 'message',
      channel: 'whatsapp.channel',
      message: successMessage,
      conversation: successConversation,
    })).rejects.toThrow('safe failure');

    const records = capturedRecords(info);
    expect(records).toEqual([
      {
        event: 'studyx.router.workflow_start_failed',
        adapter: 'whatsapp',
        trace_id: expect.any(String),
        error_code: 'Error',
      },
    ]);
    expectSecretsAbsent(records, Object.values(successSecrets));
  });

  it('omits WhatsApp identifiers and payload values from skip logs', async () => {
    const skipSecrets = {
      messageId: 'wamid.raw-sensitive-skip',
      conversationId: 'raw-sensitive-conversation-skip',
      phone: '+9990012345678',
      body: 'raw-sensitive-caption-skip',
      mediaUrl: 'https://media.example.invalid/raw-sensitive-skip',
    };
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await handler({
      type: 'message',
      channel: 'whatsapp.channel',
      message: {
        id: skipSecrets.messageId,
        createdAt: '2026-08-25T10:16:00.000Z',
        type: 'image',
        direction: 'incoming',
        userId: 'raw-sensitive-user-skip',
        conversationId: skipSecrets.conversationId,
        payload: { caption: skipSecrets.body, url: skipSecrets.mediaUrl },
        tags: {},
      },
      conversation: {
        id: skipSecrets.conversationId,
        alias: 'whatsapp',
        integration: 'whatsapp',
        tags: { 'whatsapp:userPhone': skipSecrets.phone },
      },
    });

    const records = capturedRecords(info);
    expect(records).toEqual([
      {
        event: 'studyx.router.message_skipped',
        adapter: 'whatsapp',
        channel: 'whatsapp.channel',
        trace_id: expect.any(String),
        reason: 'PHONE_E164_UNRESOLVED',
      },
    ]);
    expectSecretsAbsent(records, Object.values(skipSecrets));
  });
});
