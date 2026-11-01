import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestStudyxJson = vi.hoisted(() => vi.fn());

vi.mock('../../../botpress-agent/src/utils/http', () => ({ requestStudyxJson }));

import { configuration, secrets } from '../../helpers/botpress-runtime-stub';
import postSaleTrigger from '../../../botpress-agent/src/triggers/postSale';
import { processPostSale } from '../../../botpress-agent/src/workflows/processPostSale';
import * as evidencePersistence from '../../../botpress-agent/src/lib/observability/persist-turn-evidence';
import { fallbackPostSaleNarrative } from '../../../botpress-agent/src/utils/post-sale-instructions';

const notificationId = '8ebdc504-59cc-4b32-9b18-4bfb2b96f88a';
const claimToken = '15357952-de34-498c-a877-7e19a8c9d266';

describe('post-sale trigger', () => {
  it('asks Agent A to repair a factual rejection and preserves the repaired narrative', async () => {
    const repaired = { intro: 'Tu acceso quedó habilitado, qué bueno que sigas aprendiendo.',
      suggestion: 'Si querés, cambiá la contraseña cuando entres.' };
    const fetchModel = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify({
        intro: 'Community Manager ya está habilitado.', suggestion: '',
      }) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify(repaired) }), { status: 200 }));
    requestStudyxJson.mockReset()
      .mockResolvedValueOnce({ claimed: true, claim_token: claimToken, kind: 'access_ready', academy_name: 'Studyx',
        offering_name: 'Marketing Digital', customer_first_name: 'Ana', new_user: true, existing_user: false, history: [] })
      .mockResolvedValueOnce({ outcome: 'invalid_content', reason: 'POST_SALE_ACCESS_NOT_VERIFIED' })
      .mockResolvedValueOnce({ outcome: 'sent' });
    const handler = (processPostSale as unknown as { definition: { handler: (input: Record<string, unknown>) => Promise<unknown> } }).definition.handler;
    await handler({ input: { notification_id: notificationId, conversation_id: 'botpress-conversation' },
      state: {}, step: async (_name: string, run: () => Promise<unknown>) => run(), workflow: { id: 'post-sale-repair' } });
    expect(fetchModel).toHaveBeenCalledTimes(2);
    expect(String(fetchModel.mock.calls[1]?.[1]?.body)).toContain('POST_SALE_ACCESS_NOT_VERIFIED');
    expect(JSON.parse(String(fetchModel.mock.calls[1]?.[1]?.body)).instructions).toContain(JSON.stringify({ intro: 'Community Manager ya está habilitado.', suggestion: '' }));
    expect(requestStudyxJson.mock.calls[2]?.[0].body.narrative).toEqual(repaired);
  });
  it('resumes durable raw evidence without releasing the claim or generating again', async () => {
    const fetchModel = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ intro: 'Qué bueno que sigas aprendiendo con Studyx.', suggestion: '' }),
    }), { status: 200 }));
    let available = false;
    vi.spyOn(evidencePersistence, 'persistTurnEvidence').mockImplementation(async (_subject, event) => {
      if (event.kind === 'model_raw' && !available) throw new Error('DB_UNAVAILABLE');
    });
    const cache = new Map<string, unknown>();
    const step = async (key: string, run: () => Promise<unknown>) => {
      if (!cache.has(key)) cache.set(key, await run());
      return cache.get(key);
    };
    const handler = (processPostSale as unknown as {
      definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
    }).definition.handler;
    const args = { input: { notification_id: notificationId, conversation_id: 'botpress-conversation' },
      state: { trace_id: null }, step, workflow: { id: 'retained-post-sale', tags: {} } };
    await expect(handler(args)).resolves.toMatchObject({ outcome: 'evidence_review_required', workflow_id: 'retained-post-sale' });
    expect(args.workflow.tags).toMatchObject({ studyxEvidenceReview: 'true' });
    expect(requestStudyxJson).toHaveBeenCalledTimes(1);
    expect(fetchModel).toHaveBeenCalledTimes(1);
    available = true;
    await handler(args);
    expect(fetchModel).toHaveBeenCalledTimes(1);
    expect(requestStudyxJson).toHaveBeenCalledTimes(2);
    expect(requestStudyxJson.mock.calls.some(([args]) => args.path.endsWith('/release'))).toBe(false);
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.spyOn(processPostSale, 'getOrCreate').mockImplementation(async (args: unknown) => {
      const input = (args as { input: unknown }).input;
      const handler = (processPostSale as unknown as { definition: { handler: (args: Record<string, unknown>) => Promise<unknown> } }).definition.handler;
      await handler({ input, state: { trace_id: null }, step: async (_name: string, run: () => Promise<unknown>) => run(),
        workflow: { id: 'post-sale-test', tags: {} } });
      return { id: 'post-sale-workflow' } as never;
    });
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
    expect(request.instructions).toContain('No nombres cursos bonificados');
    expect(request.input).toContain('Marketing Digital');
  });

  it('uses a safe transactional fallback when Agent A is temporarily unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('provider unavailable'));
    requestStudyxJson.mockReset()
      .mockResolvedValueOnce({
        claimed: true, claim_token: claimToken, kind: 'access_ready',
        academy_name: 'StudyX', offering_name: 'Marketing Digital', customer_first_name: 'Thiago',
        existing_user: false, new_user: true, history: [],
      })
      .mockResolvedValueOnce({ outcome: 'sent' });
    const handler = (postSaleTrigger as unknown as {
      definition: { handler: (input: Record<string, unknown>) => Promise<void> };
    }).definition.handler;

    await handler({ event: { payload: { notification_id: notificationId }, conversationId: 'botpress-conversation' } });

    expect(requestStudyxJson).toHaveBeenCalledTimes(2);
    expect(requestStudyxJson.mock.calls[1]?.[0]).toMatchObject({
      path: `/api/agent/post-sale/${notificationId}/deliver`,
      body: {
        claim_token: claimToken,
        botpress_conversation_id: 'botpress-conversation',
        narrative: fallbackPostSaleNarrative({ kind: 'access_ready', new_user: true, existing_user: false }),
      },
    });
  });

  it('replaces rejected model prose with the safe fallback on the same durable claim', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({
        intro: 'Ana, entra en https://inventado.example con usuario inventado@example.com',
        suggestion: '',
      }),
    }), { status: 200 }));
    requestStudyxJson.mockReset()
      .mockResolvedValueOnce({
        claimed: true, claim_token: claimToken, kind: 'access_ready',
        academy_name: 'StudyX', offering_name: 'Marketing Digital', customer_first_name: 'Thiago',
        existing_user: false, new_user: true, history: [],
      })
      .mockResolvedValueOnce({ outcome: 'invalid_content', reason: 'POST_SALE_UNAUTHORIZED_PROSE' })
      .mockResolvedValueOnce({ outcome: 'sent' });
    const handler = (postSaleTrigger as unknown as {
      definition: { handler: (input: Record<string, unknown>) => Promise<void> };
    }).definition.handler;

    await handler({ event: { payload: { notification_id: notificationId }, conversationId: 'botpress-conversation' } });

    expect(requestStudyxJson).toHaveBeenCalledTimes(3);
    expect(requestStudyxJson.mock.calls[2]?.[0]).toMatchObject({
      path: `/api/agent/post-sale/${notificationId}/deliver`,
      idempotencyKey: `post-sale-deliver:${notificationId}:${claimToken}`,
      body: { narrative: fallbackPostSaleNarrative({ kind: 'access_ready', new_user: true, existing_user: false }) },
    });
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('POST_SALE_UNAUTHORIZED_PROSE'));
    expect(warning).not.toHaveBeenCalledWith(expect.stringContaining('inventado.example'));
    warning.mockRestore();
  });

  it('logs the typed reason when even the safe fallback is rejected', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('provider unavailable'));
    requestStudyxJson.mockReset()
      .mockResolvedValueOnce({
        claimed: true, claim_token: claimToken, kind: 'access_ready',
        academy_name: 'StudyX', offering_name: 'Marketing Digital', customer_first_name: 'Thiago',
        existing_user: false, new_user: true, history: [],
      })
      .mockResolvedValueOnce({ outcome: 'invalid_content', reason: 'POST_SALE_EGRESS_INVALID' })
      .mockResolvedValueOnce({ outcome: 'released' });
    const handler = (postSaleTrigger as unknown as {
      definition: { handler: (input: Record<string, unknown>) => Promise<void> };
    }).definition.handler;

    await handler({ event: { payload: { notification_id: notificationId }, conversationId: 'botpress-conversation' } });

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('POST_SALE_EGRESS_INVALID'));
    expect(requestStudyxJson.mock.calls[2]?.[0]).toMatchObject({
      path: `/api/agent/post-sale/${notificationId}/release`,
    });
    warning.mockRestore();
  });
});
