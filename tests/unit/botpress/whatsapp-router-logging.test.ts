import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getOrCreate } = vi.hoisted(() => ({ getOrCreate: vi.fn() }));

vi.mock('../../../botpress-agent/src/workflows/processInboundTurn', () => ({
  processInboundTurn: { getOrCreate },
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WhatsApp router log boundary', () => {
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

    await handler({
      type: 'message',
      channel: 'whatsapp.channel',
      message: successMessage,
      conversation: successConversation,
    });

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
