import { describe, expect, it, vi } from 'vitest';
import { canonicalOwnerPhone, classifyOwnerReset, OWNER_RESET_SCOPE as s, resetResumePhase, ownerResetBarrier, assertFreshLeadBarrier, ownerResetRoutingTags, validateResetDbReceipt, inspectNativeInboundReadiness, inspectActiveOwnerWorkflows } from '../../../scripts/lib/owner-test-lead-reset.mjs';
const fixture = () => ({ contact: { id: s.contactId, phone: s.phone, deleted_at: null }, memberships: [{ workspace_id: s.workspaceId }], related: {
  conversations: [{ id: s.conversationId }], channel_threads: [{ external_conversation_id: s.botpressConversationId, provider: 'botpress', integration_id: 'whatsapp', channel: 'whatsapp' }],
  inbound_batches: [{ state: 'completed' }], outbound_deliveries: [{ id: 'delivery', state: 'submitted', purpose: 'transactional', provider_message_id: 'accepted', lease_until: null }],
  call_sessions: [], payments: [{ status: 'paid' }], retell_followup_requests: [], retell_handoff_requests: [], conversation_history_recovery_links: [],
  payment_projection_jobs: [{ state: 'pending', decision_id: 'decision' }],
}, indirect: { fulfillment_jobs: [{ status: 'completed' }], post_sale_notifications: [{ status: 'sent' }], course_bonus_followups: [{ status: 'sent' }],
  agent_a_memory_projection_jobs: [{ status: 'completed' }], sheet_projection_rows: [{ state: 'projected', lease_until: null }],
  outbox_events: [{ id: 'outbox', state: 'pending', topic: 'outbound.delivery.requested', aggregate_id: 'delivery', payload: { purpose: 'transactional' }, lease_until: null }],
} });
const bot = () => ({ conversation: { id: s.botpressConversationId, integration: 'whatsapp', channel: 'channel' }, participants: { participants: [{ id: 'owner', tags: { 'whatsapp:number': '5491169004497' } }] }, workflows: { workflows: [] } });
describe('scoped owner test lead reset', () => {
  it('requires exact country-aware identity, not an arbitrary matching suffix', () => {
    expect(canonicalOwnerPhone('54 9 11 6900-4497')).toBe(s.phone);
    expect(canonicalOwnerPhone('541169004497')).toBe(s.phone);
    expect(canonicalOwnerPhone('+1 1169004497')).toBeNull();
    const b = bot(); b.participants.participants[0].tags['whatsapp:number'] = '11169004497';
    expect(() => classifyOwnerReset(fixture(), b)).toThrow('RESET_END_USER_IDENTITY_MISMATCH');
  });
  it('classifies only accepted duplicate delivery work and derived Sheets projection', () => {
    expect(classifyOwnerReset(fixture(), bot())).toMatchObject({ cancelOutboxIds: ['outbox'], supersedePaymentProjectionIds: ['decision'],
      outboxClassification: [{ purpose: 'transactional', providerAccepted: true }] });
  });
  it.each(['membership', 'financial', 'provider', 'workflow', 'outbox'] as const)('refuses unsafe %s state', condition => {
    const x = fixture(), b = bot();
    if (condition === 'membership') x.memberships.push({ ...x.memberships[0] });
    if (condition === 'financial') x.indirect.fulfillment_jobs[0].status = 'leased';
    if (condition === 'provider') x.related.outbound_deliveries[0].provider_message_id = '';
    if (condition === 'workflow') (b.workflows.workflows as object[]).push({ id: 'active' });
    if (condition === 'outbox') x.indirect.outbox_events[0].topic = 'payment.execute';
    expect(() => classifyOwnerReset(x, b)).toThrow();
  });
  it('2026-11-10: a superseded, never-opened link reservation does not block; a live one does', () => {
    const x = fixture() as ReturnType<typeof fixture> & { related: Record<string, unknown> };
    (x.related.payments as object[]).push({ id: 'old', status: 'reserved', provider_session_id: null });
    expect(() => classifyOwnerReset(x, bot())).toThrow('RESET_PENDING_PAYMENT');
    x.related.payment_intent_supersessions = [{ payment_id: 'old' }];
    expect(() => classifyOwnerReset(x, bot())).not.toThrow();
    (x.related.payments as Array<Record<string, unknown>>)[1]!.provider_session_id = 'cs_test_open';
    expect(() => classifyOwnerReset(x, bot())).toThrow('RESET_PENDING_PAYMENT');
  });
  it('never reruns the contact swap when resuming the nontransactional Botpress phase', () => {
    expect(resetResumePhase({ phase: 'db_committed', oldContactId: s.contactId, newContactId: 'new' })).toBe('finish_botpress');
    expect(resetResumePhase({ phase: 'completed', oldContactId: s.contactId, newContactId: 'new' })).toBe('verify_only');
    expect(resetResumePhase({ phase: 'ready_for_first_inbound', oldContactId: s.contactId, newContactId: 'new' })).toBe('verify_only');
    expect(() => resetResumePhase({ phase: 'db_committed', oldContactId: 'different', newContactId: 'new' })).toThrow();
  });
});

describe('resumable reset barrier', () => {
  const resetId = '12345678-1234-4234-8234-123456789abc';
  const receipt = { phase: 'db_committed', resetId, oldContactId: s.contactId, workspaceId: s.workspaceId,
    oldBotpressConversationId: s.botpressConversationId, newContactId: '22345678-1234-4234-8234-123456789abc' };
  it('accepts only the exact committed old/new/reset identities when recovering from a lost file checkpoint', () => {
    expect(validateResetDbReceipt(receipt, resetId)).toBe(receipt);
    expect(() => validateResetDbReceipt({ ...receipt, newContactId: s.contactId }, resetId)).toThrow();
    expect(() => validateResetDbReceipt({ ...receipt, workspaceId: 'other' }, resetId)).toThrow();
  });
  it('does not unblock a fresh contact with a wrong barrier or incoming work', () => {
    const fresh = { id: receipt.newContactId, phone: s.phone, lifecycle_status: 'blocked', blocked_at: 'now',
      blocked_reason: ownerResetBarrier(resetId), deleted_at: null, name: null, email: null,
      summary: null, contact_profile_v1: null, sales_stage: 'new' };
    expect(() => assertFreshLeadBarrier(fresh, { messages: 0, inbound_batches: 0 }, receipt)).not.toThrow();
    expect(() => assertFreshLeadBarrier(fresh, { messages: 1 }, receipt)).toThrow('RESET_NEW_ACTIVITY_DETECTED');
    expect(() => assertFreshLeadBarrier({ ...fresh, blocked_reason: 'other' }, { messages: 0 }, receipt)).toThrow();
  });
  it('copies only verified routing identity, never old conversation insights or summary', () => {
    const tags = ownerResetRoutingTags({ tags: { 'whatsapp:userPhone': '5491169004497', 'whatsapp:userId': 'wa-owner',
      'whatsapp:botPhoneNumberId': s.botPhoneNumberId, 'conversation-insights#summary': 'old context' } });
    expect(Object.keys(tags)).toEqual(['whatsapp:userPhone', 'whatsapp:userId', 'whatsapp:botPhoneNumberId']);
    expect(JSON.stringify(tags)).not.toContain('old context');
    expect(() => ownerResetRoutingTags({ tags: { ...tags, 'whatsapp:botPhoneNumberId': 'different-academy' } })).toThrow();
    expect(() => ownerResetRoutingTags({ tags: { ...tags, 'whatsapp:userPhone': '+1 1169004497' } })).toThrow();
  });
});

describe('native inbound bootstrap after the admin create API denies access', () => {
  const receipt = { oldContactId: s.contactId, oldBotpressConversationId: s.botpressConversationId, participantId: 'owner' };
  const routing = { 'whatsapp:userPhone': '5491169004497', 'whatsapp:userId': 'wa-owner', 'whatsapp:botPhoneNumberId': s.botPhoneNumberId };
  const api = () => ({
    getConversation: vi.fn().mockRejectedValue({ code: 404 }),
    getUser: vi.fn().mockResolvedValue({ user: { id: 'owner', tags: { 'whatsapp:number': '5491169004497' } } }),
    listConversations: vi.fn().mockResolvedValue({ conversations: [] }),
    listWorkflows: vi.fn().mockResolvedValue({ workflows: [] }),
    createConversation: vi.fn(), getOrCreateConversation: vi.fn(), createMessage: vi.fn(), callAction: vi.fn(),
  });
  it('proves a clean waiting state through reads only, and can be replayed without creating a chat or message', async () => {
    const client = api();
    await expect(inspectNativeInboundReadiness(client, receipt, routing)).resolves.toMatchObject({
      oldConversationDeleted: true, newBotpressConversationId: null, routingValidation: 'pending_first_real_inbound',
    });
    await inspectNativeInboundReadiness(client, receipt, routing);
    expect(client.listWorkflows).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 100 }));
    expect(client.listWorkflows.mock.calls.every(([input]) => !input.conversationId && !input.userId)).toBe(true);
    expect(client.createConversation).not.toHaveBeenCalled();
    expect(client.getOrCreateConversation).not.toHaveBeenCalled();
    expect(client.createMessage).not.toHaveBeenCalled();
    expect(client.callAction).not.toHaveBeenCalled();
  });
  it.each(['old_exists', 'candidate_exists', 'workflow', 'pagination'] as const)('refuses to unblock when %s', async condition => {
    const client = api();
    if (condition === 'old_exists') client.getConversation.mockResolvedValue({ conversation: { id: s.botpressConversationId } });
    if (condition === 'candidate_exists') client.listConversations.mockResolvedValue({ conversations: [{ id: 'incoming' }] });
    if (condition === 'workflow') client.listWorkflows.mockResolvedValue({ workflows: [{ id: 'active', userId: 'owner' }] });
    if (condition === 'pagination') client.listConversations.mockResolvedValue({ conversations: [], nextToken: 'more' });
    await expect(inspectNativeInboundReadiness(client, receipt, routing)).rejects.toThrow();
    expect(client.createMessage).not.toHaveBeenCalled();
    expect(client.getOrCreateConversation).not.toHaveBeenCalled();
  });
});

describe('global workflow enumeration after the conversation is deleted', () => {
  const receipt = { participantId: 'user_owner', newContactId: '22345678-1234-4234-8234-123456789abc' };
  it('does not query the deleted foreign key, whose real API error is 400 ReferenceNotFound', async () => {
    const referenceNotFound = Object.assign(new Error('Conversation does not exist for bot'), { code: 400, type: 'ReferenceNotFound' });
    const client = { listWorkflows: vi.fn(async (input: { conversationId?: string }) => {
      if (input.conversationId) throw referenceNotFound;
      return { workflows: [{ id: 'wrk_other', conversationId: 'conv_other', userId: 'user_other' }] };
    }) };
    await expect(inspectActiveOwnerWorkflows(client, receipt)).resolves.toMatchObject({ activeOwnerWorkflows: 0, checkedActiveBotWorkflows: 1 });
    expect(client.listWorkflows).toHaveBeenCalledTimes(1);
  });
  it('exhausts mixed pages and blocks a target appearing after unrelated users', async () => {
    const client = { listWorkflows: vi.fn()
      .mockResolvedValueOnce({ workflows: [{ id: 'wrk_other', userId: 'user_other' }], nextToken: 'second' })
      .mockResolvedValueOnce({ workflows: [{ id: 'wrk_owner', input: { botpress_conversation_id: s.botpressConversationId } }] }) };
    await expect(inspectActiveOwnerWorkflows(client, receipt)).rejects.toThrow('RESET_ACTIVE_BOTPRESS_WORKFLOW');
    expect(client.listWorkflows.mock.calls[1][0].nextToken).toBe('second');
  });
  it('resolves insufficient list identities through detail and fails closed for orphans', async () => {
    const client = { listWorkflows: vi.fn().mockResolvedValue({ workflows: [{ id: 'wrk_unknown' }] }),
      getWorkflow: vi.fn().mockResolvedValue({ workflow: { id: 'wrk_unknown', input: {} } }) };
    await expect(inspectActiveOwnerWorkflows(client, receipt)).rejects.toThrow('RESET_WORKFLOW_IDENTITY_UNKNOWN');
    client.getWorkflow.mockResolvedValue({ workflow: { id: 'wrk_unknown', userId: 'user_other' } });
    await expect(inspectActiveOwnerWorkflows(client, receipt)).resolves.toMatchObject({ activeOwnerWorkflows: 0 });
  });
  it('rejects an owner identified in detail or by the exact phone even with other metadata', async () => {
    const client = { listWorkflows: vi.fn().mockResolvedValue({ workflows: [{ id: 'wrk_unknown' }] }),
      getWorkflow: vi.fn().mockResolvedValue({ workflow: { id: 'wrk_unknown', input: { phone_e164: s.phone }, conversationId: 'conv_other' } }) };
    await expect(inspectActiveOwnerWorkflows(client, receipt)).rejects.toThrow('RESET_ACTIVE_BOTPRESS_WORKFLOW');
  });
  it('never converts API failure or repeated pagination into an empty proof', async () => {
    const failure = Object.assign(new Error('reference error'), { code: 400, type: 'ReferenceNotFound' });
    await expect(inspectActiveOwnerWorkflows({ listWorkflows: vi.fn().mockRejectedValue(failure) }, receipt)).rejects.toBe(failure);
    const client = { listWorkflows: vi.fn().mockResolvedValue({ workflows: [{ id: 'wrk_other', userId: 'user_other' }], nextToken: 'same' }) };
    await expect(inspectActiveOwnerWorkflows(client, receipt)).rejects.toThrow('RESET_WORKFLOW_PAGINATION_INCOMPLETE');
  });
});
