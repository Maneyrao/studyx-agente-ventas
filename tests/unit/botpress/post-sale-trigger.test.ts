import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestStudyxJson = vi.hoisted(() => vi.fn());

vi.mock('../../../botpress-agent/src/utils/http', () => ({ requestStudyxJson }));

import { configuration, secrets } from '../../helpers/botpress-runtime-stub';
import postSaleTrigger from '../../../botpress-agent/src/triggers/postSale';

const notificationId = '8ebdc504-59cc-4b32-9b18-4bfb2b96f88a';
const claimToken = '15357952-de34-498c-a877-7e19a8c9d266';

describe('post-sale trigger', () => {
  beforeEach(() => {
    requestStudyxJson.mockReset();
    configuration.agentAAdvisorName = 'Emma';
    secrets.DEEPSEEK_API_KEY = 'test-only-key';
    requestStudyxJson
      .mockResolvedValueOnce({
        claimed: true, claim_token: claimToken, kind: 'access_ready',
        academy_name: 'StudyX', offering_name: 'Marketing Digital', customer_first_name: 'Thiago',
        existing_user: false, new_user: true, history: [],
      })
      .mockResolvedValueOnce({ outcome: 'sent' });
  });

  it('lets Agent A author the verified access message from personality and history', async () => {
    const modelFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        intro: 'Thiago, ya tienes habilitado Marketing Digital. Bienvenido a StudyX; me alegra acompañarte en este paso.',
        suggestion: 'Si quieres, puedes cambiar tu contraseña después de ingresar.',
      }),
    }), { status: 200 }));
    const handler = (postSaleTrigger as unknown as {
      definition: { handler: (input: Record<string, unknown>) => Promise<void> };
    }).definition.handler;

    await handler({ event: { payload: { notification_id: notificationId }, conversationId: 'botpress-conversation' } });

    expect(modelFetch).toHaveBeenCalledTimes(1);
    expect(requestStudyxJson).toHaveBeenCalledTimes(2);
    expect(requestStudyxJson.mock.calls[1]?.[0]).toMatchObject({
      path: `/api/agent/post-sale/${notificationId}/deliver`,
      body: {
        claim_token: claimToken,
        botpress_conversation_id: 'botpress-conversation',
        narrative: {
          intro: 'Thiago, ya tienes habilitado Marketing Digital. Bienvenido a StudyX; me alegra acompañarte en este paso.',
          suggestion: 'Si quieres, puedes cambiar tu contraseña después de ingresar.',
        },
      },
    });
    const request = JSON.parse(String(modelFetch.mock.calls[0]?.[1]?.body));
    expect(request.instructions).toContain('personalidad');
    expect(request.input).toContain('Marketing Digital');
  });

  it('delivers a bounded safe fallback when Agent A is temporarily unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('provider unavailable'));
    const handler = (postSaleTrigger as unknown as {
      definition: { handler: (input: Record<string, unknown>) => Promise<void> };
    }).definition.handler;

    await handler({ event: { payload: { notification_id: notificationId }, conversationId: 'botpress-conversation' } });

    expect(requestStudyxJson).toHaveBeenCalledTimes(2);
    expect(requestStudyxJson.mock.calls[1]?.[0]).toMatchObject({
      path: `/api/agent/post-sale/${notificationId}/deliver`,
      body: { narrative: {
        intro: expect.stringContaining('Marketing Digital'),
        suggestion: expect.stringContaining('puedes cambiar tu contraseña'),
      } },
    });
  });
});
