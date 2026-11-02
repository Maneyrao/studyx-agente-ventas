import { createHash } from 'node:crypto';

export const OWNER_RESET_SCOPE = Object.freeze({
  phone: '+5491169004497', contactId: 'ac0e21f1-4dbe-46ed-ac8a-acbf4187317c',
  workspaceId: 'b0000000-0000-4000-8000-000000000001',
  conversationId: 'a9db399d-0a52-4644-a96e-3c15cbdd0453',
  botpressConversationId: 'conv_01M5QRRX93Z50DJE80XZR7289E',
  botId: '0d7c9ecb-4781-4c65-913d-f7e947fa14d4',
  botpressWorkspaceId: 'wkspace_01M4XEBZNC10HX2KDHKY36T6R0',
  botPhoneNumberId: '1300545066485709', profile: 'studyx-detmaneyro', databaseRef: 'eqspozrpzgzvtpowwprg',
});
export const stable = value => Array.isArray(value) ? value.map(stable)
  : value && typeof value === 'object' && !(value instanceof Date)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
export const resetFingerprint = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function canonicalOwnerPhone(value) {
  const digits = String(value ?? '').replace(/\D/gu, '');
  return ['5491169004497', '541169004497'].includes(digits) ? OWNER_RESET_SCOPE.phone : null;
}
const ensure = (ok, code) => { if (!ok) throw new Error(code); };
const uuid = value => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value ?? '');

/** This is an operational reset of one owner test lead, never a generic delete. */
export function classifyOwnerReset(snapshot, botpress) {
  const { contact, memberships, related, indirect } = snapshot;
  const s = OWNER_RESET_SCOPE;
  ensure(contact?.id === s.contactId && contact.phone === s.phone && !contact.deleted_at, 'RESET_CONTACT_SCOPE_MISMATCH');
  ensure(memberships.length === 1 && memberships[0].workspace_id === s.workspaceId, 'RESET_MULTIPLE_OR_WRONG_MEMBERSHIPS');
  ensure(related.conversations.length === 1 && related.conversations[0].id === s.conversationId, 'RESET_CONVERSATION_SCOPE_MISMATCH');
  ensure(related.channel_threads.length === 1 && related.channel_threads[0].external_conversation_id === s.botpressConversationId
    && related.channel_threads[0].provider === 'botpress' && related.channel_threads[0].integration_id === 'whatsapp'
    && related.channel_threads[0].channel === 'whatsapp', 'RESET_THREAD_SCOPE_MISMATCH');
  ensure(botpress.conversation.id === s.botpressConversationId && botpress.conversation.integration === 'whatsapp' && botpress.conversation.channel === 'channel', 'RESET_BOTPRESS_SCOPE_MISMATCH');
  ensure(!botpress.participants.nextToken && !botpress.workflows.nextToken, 'RESET_PAGINATION_INCOMPLETE');
  const participants = botpress.participants.participants.filter(person => canonicalOwnerPhone(person.tags?.['whatsapp:number']) === s.phone);
  ensure(participants.length === 1 && botpress.participants.participants.length === 1, 'RESET_END_USER_IDENTITY_MISMATCH');
  ensure(botpress.workflows.workflows.length === 0, 'RESET_ACTIVE_BOTPRESS_WORKFLOW');
  ensure(related.inbound_batches.every(row => ['completed', 'abandoned'].includes(row.state)), 'RESET_ACTIVE_BATCH');
  ensure(related.outbound_deliveries.every(row => ['submitted', 'delivered', 'cancelled', 'dead_letter'].includes(row.state)
    && !row.lease_until && (['submitted', 'delivered'].includes(row.state) ? !!row.provider_message_id : true)), 'RESET_ACTIVE_OR_AMBIGUOUS_DELIVERY');
  ensure(related.call_sessions.every(row => ['completed', 'failed', 'cancelled'].includes(row.status)), 'RESET_ACTIVE_CALL');
  ensure(related.payments.every(row => ['paid', 'failed', 'cancelled', 'expired'].includes(row.status)), 'RESET_PENDING_PAYMENT');
  ensure(indirect.fulfillment_jobs.every(row => ['completed', 'cancelled', 'failed', 'dead_letter'].includes(row.status)), 'RESET_ACTIVE_FULFILLMENT');
  ensure(indirect.post_sale_notifications.every(row => ['sent', 'cancelled', 'dead_letter', 'failed'].includes(row.status)), 'RESET_ACTIVE_POST_SALE');
  ensure(indirect.course_bonus_followups.every(row => ['sent', 'cancelled', 'expired', 'dead_letter'].includes(row.status)), 'RESET_ACTIVE_COMMERCIAL_FOLLOWUP');
  ensure(related.retell_followup_requests.length === 0 && related.retell_handoff_requests.length === 0
    && related.conversation_history_recovery_links.length === 0, 'RESET_VOICE_OR_RECOVERY_LINK_EXISTS');
  ensure(indirect.agent_a_memory_projection_jobs.every(row => row.status === 'completed'), 'RESET_ACTIVE_MEMORY_PROJECTION');
  ensure(indirect.sheet_projection_rows.every(row => ['projected', 'superseded', 'cancelled'].includes(row.state) && !row.lease_until), 'RESET_ACTIVE_SHEET_PROJECTION');
  const pendingOutboxes = indirect.outbox_events.filter(row => row.state === 'pending');
  ensure(indirect.outbox_events.every(row => ['published', 'pending', 'cancelled', 'dead_letter'].includes(row.state) && !row.lease_until), 'RESET_ACTIVE_OUTBOX_LEASE');
  for (const row of pendingOutboxes) {
    const ledger = related.outbound_deliveries.find(item => item.id === row.aggregate_id);
    ensure(row.topic === 'outbound.delivery.requested' && ledger
      && ['submitted', 'delivered'].includes(ledger.state) && ledger.provider_message_id
      && !ledger.lease_until && row.payload?.purpose === ledger.purpose, 'RESET_UNCLASSIFIED_PENDING_OUTBOX');
  }
  ensure(related.payment_projection_jobs.every(row => ['pending', 'projected', 'superseded'].includes(row.state)), 'RESET_UNKNOWN_PAYMENT_PROJECTION_STATE');
  return { participantId: participants[0].id,
    cancelOutboxIds: pendingOutboxes.map(row => row.id).sort(),
    supersedePaymentProjectionIds: related.payment_projection_jobs.filter(row => row.state === 'pending').map(row => row.decision_id).sort(),
    outboxClassification: pendingOutboxes.map(row => { const delivery = related.outbound_deliveries.find(item => item.id === row.aggregate_id);
      return { id: row.id, deliveryId: delivery.id, purpose: delivery.purpose, state: delivery.state, providerAccepted: true }; }),
  };
}

/** A retry after the DB commit must only finish the old Botpress phase. */
export function resetResumePhase(receipt) {
  if (!receipt) return 'prepare';
  if (receipt.phase === 'db_committed' && receipt.oldContactId === OWNER_RESET_SCOPE.contactId && receipt.newContactId) return 'finish_botpress';
  if (['completed', 'ready_for_first_inbound'].includes(receipt.phase) && receipt.oldContactId === OWNER_RESET_SCOPE.contactId && receipt.newContactId) return 'verify_only';
  throw new Error('RESET_RECEIPT_INVALID');
}

export function ownerResetBarrier(resetId) {
  ensure(uuid(resetId), 'RESET_ID_INVALID');
  return `OWNER_TEST_RESET:${resetId}`;
}
export function assertFreshLeadBarrier(contact, counts, receipt) {
  ensure(receipt.oldContactId === OWNER_RESET_SCOPE.contactId && receipt.workspaceId === OWNER_RESET_SCOPE.workspaceId
    && typeof receipt.newContactId === 'string', 'RESET_RECEIPT_SCOPE_MISMATCH');
  ensure(contact?.id === receipt.newContactId && contact.phone === OWNER_RESET_SCOPE.phone
    && contact.lifecycle_status === 'blocked' && contact.blocked_at
    && contact.blocked_reason === ownerResetBarrier(receipt.resetId) && !contact.deleted_at, 'RESET_FRESH_BARRIER_MISMATCH');
  ensure(Object.values(counts).every(count => count === 0) && contact.name === null && contact.email === null
    && contact.summary === null && contact.contact_profile_v1 === null && contact.sales_stage === 'new', 'RESET_NEW_ACTIVITY_DETECTED');
}
export function ownerResetRoutingTags(backupConversation) {
  const tags = backupConversation?.tags ?? {};
  const picked = Object.fromEntries(['whatsapp:userPhone', 'whatsapp:userId', 'whatsapp:botPhoneNumberId'].map(key => [key, tags[key]]));
  ensure(Object.values(picked).every(value => typeof value === 'string' && value.length > 0)
    && canonicalOwnerPhone(picked['whatsapp:userPhone']) === OWNER_RESET_SCOPE.phone
    && picked['whatsapp:botPhoneNumberId'] === OWNER_RESET_SCOPE.botPhoneNumberId, 'RESET_ROUTE_PROOF_MISMATCH');
  return picked;
}
export function validateResetDbReceipt(receipt, resetId) {
  ensure(receipt?.phase === 'db_committed' && receipt.resetId === resetId
    && receipt.oldContactId === OWNER_RESET_SCOPE.contactId && receipt.workspaceId === OWNER_RESET_SCOPE.workspaceId
    && receipt.oldBotpressConversationId === OWNER_RESET_SCOPE.botpressConversationId
    && uuid(receipt.newContactId) && receipt.newContactId !== receipt.oldContactId,
  'RESET_RECEIPT_SCOPE_MISMATCH');
  return receipt;
}

const workflowIdentity = (workflow, receipt) => {
  const input = workflow?.input && typeof workflow.input === 'object' ? workflow.input : {};
  const conversationIds = [workflow?.conversationId, input.conversation_id, input.botpress_conversation_id];
  const userIds = [workflow?.userId, input.botpress_user_id];
  const phones = [input.phone_e164, input.phone, input.phoneE164, input.userPhone, input.user_phone];
  const contactIds = [input.contact_id, input.contactId];
  const ownerConversations = [OWNER_RESET_SCOPE.botpressConversationId, OWNER_RESET_SCOPE.conversationId, receipt.newBotpressConversationId].filter(Boolean);
  const ownerContacts = [OWNER_RESET_SCOPE.contactId, receipt.newContactId].filter(Boolean);
  if (conversationIds.some(value => ownerConversations.includes(value))
    || userIds.some(value => value === receipt.participantId)
    || phones.some(value => canonicalOwnerPhone(value) === OWNER_RESET_SCOPE.phone)
    || contactIds.some(value => ownerContacts.includes(value))) return 'owner';
  const hasBoundConversation = conversationIds.some(value => typeof value === 'string' && (/^conv_[a-zA-Z0-9_-]+$/u.test(value) || uuid(value)));
  const hasBoundUser = userIds.some(value => typeof value === 'string' && /^user_[a-zA-Z0-9_-]+$/u.test(value));
  const hasBoundContact = contactIds.some(uuid);
  const hasOtherPhone = phones.some(value => typeof value === 'string' && /^\+?[1-9]\d{6,14}$/u.test(value.replace(/[ ()-]/gu, '')));
  return hasBoundConversation || hasBoundUser || hasBoundContact || hasOtherPhone ? 'other' : 'unknown';
};

/** Deleted conversation IDs are invalid workflow filters; enumerate and classify instead. */
export async function inspectActiveOwnerWorkflows(client, receipt) {
  const seenTokens = new Set(); let nextToken; let pages = 0; let checked = 0;
  do {
    ensure(pages < 100, 'RESET_WORKFLOW_PAGINATION_LIMIT');
    const response = await client.listWorkflows({ pageSize: 100,
      statuses: ['pending', 'in_progress', 'listening', 'paused'], ...(nextToken ? { nextToken } : {}) });
    ensure(Array.isArray(response.workflows), 'RESET_WORKFLOW_RESPONSE_INVALID');
    pages++;
    for (const listed of response.workflows) {
      checked++;
      let identity = workflowIdentity(listed, receipt);
      if (identity === 'unknown') {
        ensure(typeof listed.id === 'string' && listed.id.length > 0, 'RESET_WORKFLOW_IDENTITY_UNKNOWN');
        const detail = await client.getWorkflow({ id: listed.id });
        ensure(detail.workflow?.id === listed.id, 'RESET_WORKFLOW_DETAIL_SCOPE_MISMATCH');
        identity = workflowIdentity(detail.workflow, receipt);
      }
      ensure(identity !== 'owner', 'RESET_ACTIVE_BOTPRESS_WORKFLOW');
      ensure(identity === 'other', 'RESET_WORKFLOW_IDENTITY_UNKNOWN');
    }
    nextToken = response.nextToken;
    if (nextToken) {
      ensure(typeof nextToken === 'string' && !seenTokens.has(nextToken), 'RESET_WORKFLOW_PAGINATION_INCOMPLETE');
      seenTokens.add(nextToken);
    }
  } while (nextToken);
  return { activeOwnerWorkflows: 0, checkedActiveBotWorkflows: checked, workflowPages: pages };
}

/** Only integration-native inbound may create the next chat. This probe has no write path. */
export async function inspectNativeInboundReadiness(client, receipt, routingTags) {
  const isMissing = error => Number(error?.code ?? error?.status ?? error?.statusCode) === 404 || error?.type === 'ResourceNotFound';
  ensure(receipt.oldContactId === OWNER_RESET_SCOPE.contactId
    && receipt.oldBotpressConversationId === OWNER_RESET_SCOPE.botpressConversationId, 'RESET_RECEIPT_SCOPE_MISMATCH');
  let oldExists = false;
  try { await client.getConversation({ id: OWNER_RESET_SCOPE.botpressConversationId }); oldExists = true; }
  catch (error) { if (!isMissing(error)) throw error; }
  ensure(!oldExists, 'RESET_OLD_CONVERSATION_STILL_EXISTS');
  const { user } = await client.getUser({ id: receipt.participantId });
  ensure(user.id === receipt.participantId && canonicalOwnerPhone(user.tags?.['whatsapp:number']) === OWNER_RESET_SCOPE.phone, 'RESET_END_USER_IDENTITY_MISMATCH');
  const conversations = await client.listConversations({ integrationName: 'whatsapp', channel: 'channel', tags: routingTags, pageSize: 100 });
  ensure(!conversations.nextToken && conversations.conversations.length === 0, 'RESET_NATIVE_CONVERSATION_ALREADY_EXISTS');
  const workflowProof = await inspectActiveOwnerWorkflows(client, receipt);
  return { oldConversationDeleted: true, newBotpressConversationId: null,
    matchingConversationCount: 0, activeWorkflows: 0, ...workflowProof, routingValidation: 'pending_first_real_inbound' };
}
