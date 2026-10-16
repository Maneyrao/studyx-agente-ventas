import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestStudyxJson = vi.hoisted(() => vi.fn());

vi.mock('../../../botpress-agent/src/utils/http', () => ({ requestStudyxJson }));

import { configuration, secrets } from '../../helpers/botpress-runtime-stub';
import postSaleTrigger from '../../../botpress-agent/src/triggers/postSale';

const notificationId = '8ebdc504-59cc-4b32-9b18-4bfb2b96f88a';
const claimToken = '15357952-de34-498c-a877-7e19a8c9d266';

describe('post-sale trigger', () => {
  beforeEach(() => {
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

  it('delivers verified access with deterministic copy and no optional model dependency', async () => {
    const modelFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ intro: 'Model copy.', suggestion: '' }),
    }), { status: 200 }));
    const handler = (postSaleTrigger as unknown as {
      definition: { handler: (input: Record<string, unknown>) => Promise<void> };
    }).definition.handler;

    await handler({ event: { payload: { notification_id: notificationId }, conversationId: 'botpress-conversation' } });

    expect(modelFetch).not.toHaveBeenCalled();
    expect(requestStudyxJson).toHaveBeenCalledTimes(2);
    expect(requestStudyxJson.mock.calls[1]?.[0]).toMatchObject({
      path: `/api/agent/post-sale/${notificationId}/deliver`,
      body: {
        claim_token: claimToken,
        botpress_conversation_id: 'botpress-conversation',
        narrative: {
          intro: 'Tu acceso a Marketing Digital ya está habilitado.',
          suggestion: 'Si quieres, puedes cambiar tu contraseña cuando ingreses.',
        },
      },
    });
  });
});
