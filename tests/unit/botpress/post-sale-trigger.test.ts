import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestStudyxJson = vi.hoisted(() => vi.fn());
vi.mock('../../../botpress-agent/src/utils/http', () => ({ requestStudyxJson }));
import { configuration, secrets, client } from '../../helpers/botpress-runtime-stub';
import postSaleTrigger from '../../../botpress-agent/src/triggers/postSale';
import { processPostSale } from '../../../botpress-agent/src/workflows/processPostSale';
import * as evidencePersistence from '../../../botpress-agent/src/lib/observability/persist-turn-evidence';

const notificationId = '8ebdc504-59cc-4b32-9b18-4bfb2b96f88a';
const claimToken = '15357952-de34-498c-a877-7e19a8c9d266';
const claim = { claimed: true, claim_token: claimToken, kind: 'access_ready', academy_name: 'Studyx',
  offering_name: 'Marketing Digital', customer_first_name: 'Ana', new_user: true, existing_user: false, history: [] };
const handler = (processPostSale as unknown as { definition: {
  handler: (args: Record<string, unknown>) => Promise<unknown>;
} }).definition.handler;
const args = () => ({ input: { notification_id: notificationId, conversation_id: 'botpress-conversation' },
  state: { trace_id: null }, step: async (_key: string, run: () => Promise<unknown>) => run(),
  client: { updateWorkflow: vi.fn(async () => ({})) },
  workflow: { id: 'post-sale-test', tags: {} } });

beforeEach(() => {
  requestStudyxJson.mockReset();
  configuration.agentAAdvisorName = 'Emma';
  secrets.DEEPSEEK_API_KEY = 'test-only-key';
  vi.spyOn(evidencePersistence, 'persistTurnEvidence').mockResolvedValue(undefined);
});

describe('post-sale deterministic access delivery — owner exception 2026-11-01', () => {
  it.each([
    { kind: 'access_ready', new_user: true, existing_user: false },
    { kind: 'access_ready', new_user: false, existing_user: true },
    { kind: 'access_ready', delivery_mode: 'access_template', new_user: true, existing_user: false },
    { kind: 'access_delayed', delivery_mode: 'access_template', new_user: true, existing_user: false },
  ])('sends $kind / $delivery_mode directly without any model or narrative', async (variant) => {
    const modelFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('MODEL_MUST_NOT_BE_CALLED'));
    secrets.DEEPSEEK_API_KEY = '';
    requestStudyxJson.mockResolvedValueOnce({ ...claim, ...variant }).mockResolvedValueOnce({ outcome: 'sent' });
    const run = args();
    await expect(handler(run)).resolves.toEqual({ outcome: 'sent' });
    expect(modelFetch).not.toHaveBeenCalled();
    expect(requestStudyxJson).toHaveBeenCalledTimes(2);
    expect(requestStudyxJson.mock.calls[1]?.[0]).toMatchObject({
      path: `/api/agent/post-sale/${notificationId}/deliver`,
      idempotencyKey: `post-sale-deliver:${notificationId}:${claimToken}`,
      body: { claim_token: claimToken, botpress_conversation_id: 'botpress-conversation' },
    });
    expect(requestStudyxJson.mock.calls[1]?.[0].body).not.toHaveProperty('narrative');
    expect(evidencePersistence.persistTurnEvidence).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      kind: 'post_sale_template_receipt', data: { delivery_mode: 'access_template', receipt: { outcome: 'sent' } },
    }));
    expect(evidencePersistence.persistTurnEvidence).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'generation_started' }));
  });

  it('retains trigger workflow idempotency and dispatches the deterministic access path', async () => {
    const modelFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_MODEL'));
    const getWorkflow = vi.fn(async (input) => {
      await handler({ ...args(), input: (input as { input: unknown }).input });
      return { workflow: { id: 'post-sale-workflow', status: 'pending' as const, tags: {} } };
    });
    vi.spyOn(client, 'getOrCreateWorkflow').mockImplementation(getWorkflow);
    requestStudyxJson.mockResolvedValueOnce(claim).mockResolvedValueOnce({ outcome: 'sent' });
    const triggerHandler = (postSaleTrigger as unknown as { definition: { handler: (args: unknown) => Promise<void> } }).definition.handler;
    await triggerHandler({ event: { payload: { notification_id: notificationId }, conversationId: 'botpress-conversation' },
      client: { getOrCreateWorkflow: getWorkflow, deleteWorkflow: vi.fn() } });
    expect(getWorkflow).toHaveBeenCalledWith(expect.objectContaining({ tags: { key: `studyx-post-sale:${notificationId}` },
      discriminateByTags: ['key'], conversationId: 'botpress-conversation', name: 'processPostSale' }));
    expect(modelFetch).not.toHaveBeenCalled();
  });

  it('releases a failed delivery lease without trying a model or substituting a fallback', async () => {
    const modelFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_MODEL'));
    requestStudyxJson.mockResolvedValueOnce(claim).mockRejectedValueOnce(new Error('BACKEND_UNAVAILABLE'))
      .mockResolvedValueOnce({ outcome: 'released' });
    await expect(handler(args())).resolves.toEqual({ outcome: 'released' });
    expect(requestStudyxJson.mock.calls[2]?.[0].path).toBe(`/api/agent/post-sale/${notificationId}/release`);
    expect(modelFetch).not.toHaveBeenCalled();
  });

  it('does not repair an invalid deterministic template with model prose', async () => {
    const modelFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_MODEL'));
    requestStudyxJson.mockResolvedValueOnce(claim).mockResolvedValueOnce({ outcome: 'invalid_content', reason: 'POST_SALE_EGRESS_INVALID' })
      .mockResolvedValueOnce({ outcome: 'released' });
    await expect(handler(args())).resolves.toEqual({ outcome: 'released' });
    expect(requestStudyxJson.mock.calls[2]?.[0].path).toBe(`/api/agent/post-sale/${notificationId}/release`);
    expect(modelFetch).not.toHaveBeenCalled();
  });

  it('resumes receipt persistence from durable cached output without sending or generating again', async () => {
    const modelFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('NO_MODEL'));
    let available = false;
    vi.mocked(evidencePersistence.persistTurnEvidence).mockImplementation(async () => {
      if (!available) throw new Error('DB_UNAVAILABLE');
    });
    requestStudyxJson.mockResolvedValueOnce(claim).mockResolvedValueOnce({ outcome: 'sent' });
    const cache = new Map<string, unknown>();
    const run = { ...args(), step: async (key: string, callback: () => Promise<unknown>) => {
      if (!cache.has(key)) cache.set(key, await callback());
      return cache.get(key);
    } };
    await expect(handler(run)).resolves.toMatchObject({ outcome: 'evidence_review_required' });
    const originalEvent = vi.mocked(evidencePersistence.persistTurnEvidence).mock.calls[0]?.[1];
    available = true;
    await expect(handler(run)).resolves.toEqual({ outcome: 'sent' });
    expect(requestStudyxJson).toHaveBeenCalledTimes(2);
    expect(evidencePersistence.persistTurnEvidence).toHaveBeenLastCalledWith(expect.anything(), originalEvent);
    expect(modelFetch).not.toHaveBeenCalled();
  });
});

describe('Agent A still writes non-access post-sale notices', () => {
  it('repairs a rejected payment notice without changing its durable claim', async () => {
    const rejected = { intro: 'Community Manager ya está habilitado.', suggestion: '' };
    const repaired = { intro: 'Recibimos tu pago. Estamos preparando tu acceso.', suggestion: '' };
    const fetchModel = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify(rejected) }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: JSON.stringify(repaired) }), { status: 200 }));
    requestStudyxJson.mockResolvedValueOnce({ ...claim, kind: 'payment_received', delivery_mode: 'agent_narrative' })
      .mockResolvedValueOnce({ outcome: 'invalid_content', reason: 'POST_SALE_ACCESS_NOT_VERIFIED' })
      .mockResolvedValueOnce({ outcome: 'sent' });
    await expect(handler(args())).resolves.toEqual({ outcome: 'sent' });
    expect(fetchModel).toHaveBeenCalledTimes(2);
    const repairRequest = JSON.parse(String(fetchModel.mock.calls[1]?.[1]?.body));
    expect(repairRequest.instructions).toContain('POST_SALE_ACCESS_NOT_VERIFIED');
    expect(repairRequest.instructions).toContain(JSON.stringify(rejected));
    expect(requestStudyxJson.mock.calls[2]?.[0].body.narrative).toEqual(repaired);
  });

  it('retains a safe delay notice when the model is unavailable', async () => {
    const modelFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('PROVIDER_UNAVAILABLE'));
    requestStudyxJson.mockResolvedValueOnce({ ...claim, kind: 'access_delayed', delivery_mode: 'agent_narrative' })
      .mockResolvedValueOnce({ outcome: 'sent' });
    await expect(handler(args())).resolves.toEqual({ outcome: 'sent' });
    expect(modelFetch).toHaveBeenCalledOnce();
    expect(requestStudyxJson.mock.calls[1]?.[0].body.narrative).toEqual({
      intro: 'Recibimos tu pago. Todavía estoy terminando de preparar tu acceso.', suggestion: '',
    });
  });

  it('resumes raw model evidence without releasing the claim or generating again', async () => {
    const modelFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_text: JSON.stringify({ intro: 'Recibimos tu pago.', suggestion: '' }),
    }), { status: 200 }));
    requestStudyxJson.mockResolvedValueOnce({ ...claim, kind: 'payment_received' }).mockResolvedValueOnce({ outcome: 'sent' });
    let available = false;
    vi.mocked(evidencePersistence.persistTurnEvidence).mockImplementation(async (_subject, event) => {
      if (event.kind === 'model_raw' && !available) throw new Error('DB_UNAVAILABLE');
    });
    const cache = new Map<string, unknown>();
    const run = { ...args(), step: async (key: string, callback: () => Promise<unknown>) => {
      if (!cache.has(key)) cache.set(key, await callback());
      return cache.get(key);
    } };
    await expect(handler(run)).resolves.toMatchObject({ outcome: 'evidence_review_required' });
    expect(requestStudyxJson).toHaveBeenCalledTimes(1);
    available = true;
    await expect(handler(run)).resolves.toEqual({ outcome: 'sent' });
    expect(modelFetch).toHaveBeenCalledOnce();
    expect(requestStudyxJson).toHaveBeenCalledTimes(2);
  });
});
