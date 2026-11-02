#!/usr/bin/env node
// Scoped, resumable owner-test reset. Mutations require an explicit apply phase.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import postgres from '../node_modules/postgres/src/index.js';
import { Client } from '../botpress-agent/node_modules/@botpress/client/dist/index.cjs';
import { OWNER_RESET_SCOPE as scope, classifyOwnerReset, resetFingerprint, ownerResetBarrier, assertFreshLeadBarrier, ownerResetRoutingTags, validateResetDbReceipt, inspectNativeInboundReadiness, inspectActiveOwnerWorkflows } from './lib/owner-test-lead-reset.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const stateDir = process.argv[3];
const command = process.argv[2];
if (!['discover', 'dry-run', 'apply-db', 'finish-botpress', 'verify'].includes(command) || !stateDir || !path.isAbsolute(stateDir)) throw new Error('EXPECTED_RESET_PHASE_AND_PRIVATE_DIRECTORY');
if (['apply-db','finish-botpress'].includes(command) && !process.argv.includes('--apply')) throw new Error('RESET_EXPLICIT_APPLY_REQUIRED');
if (stateDir === root || stateDir.startsWith(`${root}${path.sep}`)) throw new Error('RESET_BACKUP_MUST_BE_OUTSIDE_REPOSITORY');
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const save = (name, value) => { const file=path.join(stateDir,name); fs.writeFileSync(file,JSON.stringify(value,null,2),{mode:0o600}); fs.chmodSync(file,0o600); };
const env = parseEnv(fs.readFileSync('/Users/tmaneyro22/Documents/AGENTE IA/studyx-agente-ventas/.env.local', 'utf8'));
const databaseUrl = new URL(env.DATABASE_URL);
if (decodeURIComponent(databaseUrl.username).split('.').at(-1) !== scope.databaseRef) throw new Error('RESET_DATABASE_SCOPE_MISMATCH');
const profiles = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.adk/credentials'), 'utf8'));
const profile = profiles.profiles[scope.profile];
if (!profile || profile.workspaceId !== scope.botpressWorkspaceId) throw new Error('RESET_PROFILE_SCOPE_MISMATCH');
const client = new Client({ token: profile.token, apiUrl: profile.apiUrl, workspaceId: scope.botpressWorkspaceId, botId: scope.botId });
const db = postgres(env.DATABASE_URL, { max: 1, connect_timeout: 12, idle_timeout: 2,
  connection: { statement_timeout: 30000, lock_timeout: 5000 } });
const sorted = rows => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const ensure = (ok, message) => { if (!ok) throw new Error(message); };

async function readSnapshot(tx, lock = false) {
  const contacts = lock
    ? await tx`SELECT * FROM contacts WHERE id=${scope.contactId}::uuid FOR UPDATE`
    : await tx`SELECT * FROM contacts WHERE id=${scope.contactId}::uuid`;
  ensure(contacts.length === 1, 'RESET_CONTACT_MISSING');
  const memberships = await tx`SELECT * FROM workspace_contacts WHERE contact_id=${scope.contactId}::uuid ORDER BY id`;
  const tableRows = await tx`SELECT DISTINCT x.table_name FROM information_schema.columns x
    JOIN information_schema.tables t ON t.table_schema=x.table_schema AND t.table_name=x.table_name
    WHERE x.table_schema='public' AND x.column_name='contact_id' AND t.table_type='BASE TABLE' ORDER BY x.table_name`;
  const related = {};
  for (const { table_name: table } of tableRows) related[table] = sorted(await tx`SELECT * FROM ${tx(table)} WHERE contact_id=${scope.contactId}::uuid`);
  ensure(memberships.length === 1, 'RESET_MULTIPLE_OR_WRONG_MEMBERSHIPS');
  const indirect = {};
  for (const table of ['central_enrollments', 'central_bonus_enrollment_items', 'payment_bonus_offerings', 'fulfillment_jobs', 'post_sale_notifications', 'bonus_fulfillment_cases']) {
    indirect[table] = sorted(await tx`SELECT t.* FROM ${tx(table)} t JOIN payments p ON p.id=t.payment_id WHERE p.contact_id=${scope.contactId}::uuid`);
  }
  indirect.course_bonus_followups = sorted(await tx`SELECT f.* FROM course_bonus_followups f JOIN promotion_offers p ON p.id=f.offer_id WHERE p.contact_id=${scope.contactId}::uuid`);
  indirect.outbox_events = sorted(await tx`SELECT * FROM outbox_events WHERE payload->>'contact_id'=${scope.contactId}
    OR aggregate_id IN (SELECT id FROM outbound_deliveries WHERE contact_id=${scope.contactId}::uuid)`);
  indirect.memory_items = sorted(await tx`SELECT * FROM memory_items WHERE workspace_contact_id=${memberships[0].id}::uuid`);
  indirect.memory_embeddings = sorted(await tx`SELECT x.* FROM memory_embeddings x JOIN memory_items m ON m.id=x.memory_item_id WHERE m.workspace_contact_id=${memberships[0].id}::uuid`);
  for (const table of ['qualification_answers', 'opportunities', 'contact_consents']) indirect[table] = sorted(await tx`SELECT * FROM ${tx(table)} WHERE workspace_contact_id=${memberships[0].id}::uuid`);
  indirect.agent_a_memory_projection_jobs = sorted(await tx`SELECT * FROM agent_a_memory_projection_jobs WHERE turn_id IN (SELECT id FROM messages WHERE contact_id=${scope.contactId}::uuid)`);
  indirect.sheet_projection_rows = sorted(await tx`SELECT * FROM sheet_projection_rows WHERE payload->>'contact_id'=${scope.contactId}
    OR source_key LIKE ${`%${scope.contactId}%`} OR projection_key LIKE ${`%${scope.contactId}%`}`);
  const [others] = await tx`SELECT count(*)::int AS count, md5(COALESCE(string_agg(md5(row_to_json(c)::text), '' ORDER BY id),'')) AS digest
    FROM contacts c WHERE id<>${scope.contactId}::uuid`;
  return { contact: contacts[0], memberships: sorted(memberships), related, indirect, otherContacts: others };
}
async function readBotpress() {
  const { conversation } = await client.getConversation({ id: scope.botpressConversationId });
  return { conversation, participants: await client.listParticipants({ id: scope.botpressConversationId, pageSize: 100 }),
    workflows: await client.listWorkflows({ conversationId: scope.botpressConversationId, pageSize: 100,
      statuses: ['pending', 'in_progress', 'listening', 'paused'] }) };
}
const financial = s => ({ payments: s.related.payments, enrollments: s.indirect.central_enrollments,
  bonusEnrollments: s.indirect.central_bonus_enrollment_items, paymentBonuses: s.indirect.payment_bonus_offerings,
  fulfillment: s.indirect.fulfillment_jobs, notifications: s.indirect.post_sale_notifications });
const continuity = s => ({ messages: s.related.messages, conversations: s.related.conversations,
  threads: s.related.channel_threads, aliases: s.related.channel_thread_aliases,
  bindings: s.related.channel_account_thread_bindings, deliveries: s.related.outbound_deliveries,
  calls: s.related.call_sessions });

/** Caller must hold the original contact lock and review the preparation first. */
async function swapInsideTransaction(tx, before, plan, resetId) {
  const barrier = ownerResetBarrier(resetId);
  await tx`UPDATE contacts SET lifecycle_status='blocked',blocked_at=now(),blocked_reason=${barrier},updated_at=now() WHERE id=${scope.contactId}::uuid`;
  const changed = {};
  const count = async (key, operation) => { changed[key] = (await operation).length; };
  // Supersede only the exact derived Sheets jobs. Payment/enrollment rows stay immutable.
  await count('paymentProjectionJobs', tx`UPDATE payment_projection_jobs SET state='superseded'
    WHERE contact_id=${scope.contactId}::uuid AND decision_id=ANY(${tx.array(plan.supersedePaymentProjectionIds)}::uuid[])
      AND state='pending' RETURNING decision_id`);
  await count('outboxEvents', tx`UPDATE outbox_events SET state='cancelled',lease_until=NULL,leased_by=NULL,last_error_code='OWNER_TEST_LEAD_RESET'
    WHERE id=ANY(${tx.array(plan.cancelOutboxIds)}::uuid[]) AND state='pending' RETURNING id`);
  for (const table of ['conversation_promotion_context_v1', 'selected_memories', 'lead_course_interests',
    'conversation_sales_context_state_events_v1', 'conversation_sales_context_states_v1', 'sales_context_state_events',
    'sales_context_states', 'contact_channel_permissions']) await count(table, tx`DELETE FROM ${tx(table)} WHERE contact_id=${scope.contactId}::uuid RETURNING *`);
  const membershipId = before.memberships[0].id;
  await count('memoryEmbeddings', tx`DELETE FROM memory_embeddings WHERE memory_item_id IN (SELECT id FROM memory_items WHERE workspace_contact_id=${membershipId}::uuid) RETURNING memory_item_id`);
  for (const table of ['memory_items', 'qualification_answers', 'opportunities', 'contact_consents']) await count(table, tx`DELETE FROM ${tx(table)} WHERE workspace_contact_id=${membershipId}::uuid RETURNING *`);
  const sheetIds = before.indirect.sheet_projection_rows.map(row => row.id);
  await count('sheetProjectionRows', tx`DELETE FROM sheet_projection_rows WHERE id=ANY(${tx.array(sheetIds)}::uuid[]) RETURNING id`);
  await tx`UPDATE workspace_contacts SET lifecycle_status='archived',updated_at=now() WHERE id=${membershipId}::uuid AND contact_id=${scope.contactId}::uuid`;
  const archivedPhone = `+999${randomInt(10_000_000_000, 99_999_999_999)}`;
  await tx`UPDATE contacts SET phone=${archivedPhone},name=NULL,email=NULL,declared_phone=NULL,summary=NULL,summary_updated_at=NULL,
    summary_version=0,pending_turns=0,contact_profile_v1=NULL,status='inactivo',lifecycle_status='deleted',deleted_at=now(),
    sales_stage='new',updated_at=now() WHERE id=${scope.contactId}::uuid AND phone=${scope.phone}`;
  const [fresh] = await tx`INSERT INTO contacts(phone,channel_origin,lifecycle_status,blocked_at,blocked_reason) VALUES(${scope.phone},'whatsapp','blocked',now(),${barrier}) RETURNING *`;
  // Do not pre-create memberships or chat identity: the next real ingress owns them.
  const after = await readSnapshot(tx);
  ensure(resetFingerprint(financial(before)) === resetFingerprint(financial(after)), 'RESET_FINANCIAL_ROWS_CHANGED');
  ensure(resetFingerprint(continuity(before)) === resetFingerprint(continuity(after)), 'RESET_CONTINUITY_ROWS_CHANGED');
  const [othersAfter] = await tx`SELECT count(*)::int AS count,md5(COALESCE(string_agg(md5(row_to_json(c)::text),'' ORDER BY id),'')) AS digest
    FROM contacts c WHERE id<>${scope.contactId}::uuid AND id<>${fresh.id}::uuid`;
  ensure(resetFingerprint(before.otherContacts) === resetFingerprint(othersAfter), 'RESET_UNRELATED_CONTACT_CHANGED');
  const [clean] = await tx`SELECT (SELECT count(*) FROM messages WHERE contact_id=${fresh.id}::uuid)::int AS messages,
    (SELECT count(*) FROM selected_memories WHERE contact_id=${fresh.id}::uuid)::int AS memories,
    (SELECT count(*) FROM conversations WHERE contact_id=${fresh.id}::uuid)::int AS conversations,
    (SELECT count(*) FROM workspace_contacts WHERE contact_id=${fresh.id}::uuid)::int AS memberships`;
  ensure(Object.values(clean).every(value => value === 0) && fresh.name===null && fresh.email===null && fresh.summary===null
    && fresh.contact_profile_v1===null && fresh.deleted_at===null && fresh.sales_stage==='new'
    && fresh.lifecycle_status==='blocked' && fresh.blocked_reason===barrier, 'RESET_FRESH_LEAD_NOT_CLEAN');
  return { changed, oldContactId: scope.contactId, newContactId: fresh.id, clean,
    financialRowsPreserved: true, continuityRowsPreserved: true, unrelatedContactsPreserved: true };
}
const eventKey = (resetId, phase) => `owner-test-reset:${resetId}:${phase}`;
async function getPhase(tx, resetId, phase) {
  const [row] = await tx`SELECT payload FROM audit_log WHERE event_key=${eventKey(resetId,phase)} LIMIT 1`;
  return row?.payload ?? null;
}
async function appendPhase(tx, resetId, phase, data) {
  const existing = await getPhase(tx,resetId,phase);
  if (existing) return existing;
  const payload = { operation_version:'owner-test-lead-reset-v1', resetId,phase,
    oldContactId:scope.contactId,workspaceId:scope.workspaceId,
    phone_sha256:createHash('sha256').update(scope.phone).digest('hex'),...data };
  await tx`SELECT append_audit_event_atomic('orchestrator','owner.test_lead.reset','contact',
    ${scope.contactId}::uuid,${tx.json(payload)}::jsonb,${eventKey(resetId,phase)},NULL::uuid,NULL::uuid,NULL::uuid)`;
  return payload;
}
const isMissing = error => Number(error?.code ?? error?.status ?? error?.statusCode)===404 || error?.type==='ResourceNotFound';
function preparation() { return JSON.parse(fs.readFileSync(path.join(stateDir,'preparation.private.json'),'utf8')); }
const requestedResetId = () => { const i=process.argv.indexOf('--reset-id'); return i>=0?process.argv[i+1]:preparation().resetId; };
async function requiredReceipt(resetId) { return validateResetDbReceipt(await getPhase(db,resetId,'db_committed'),resetId); }
async function freshActivity(tx, newId) {
  const tables=await tx`SELECT DISTINCT x.table_name FROM information_schema.columns x
    JOIN information_schema.tables t ON t.table_schema=x.table_schema AND t.table_name=x.table_name
    WHERE x.table_schema='public' AND x.column_name='contact_id' AND t.table_type='BASE TABLE' ORDER BY x.table_name`;
  const counts={};
  for (const {table_name:table} of tables) {
    const [row]=await tx`SELECT count(*)::int AS count FROM ${tx(table)} WHERE contact_id=${newId}::uuid`;
    counts[table]=row.count;
  }
  return counts;
}
async function verifyBarrier(tx, receipt) {
  const [fresh]=await tx`SELECT * FROM contacts WHERE id=${receipt.newContactId}::uuid FOR UPDATE`;
  const counts=await freshActivity(tx,receipt.newContactId);
  assertFreshLeadBarrier(fresh,counts,receipt);
  const old=await readSnapshot(tx,true);
  ensure(old.contact.lifecycle_status==='deleted' && old.contact.blocked_at && old.contact.blocked_reason===ownerResetBarrier(receipt.resetId), 'RESET_OLD_BARRIER_CHANGED');
  ensure(resetFingerprint(financial(old))===receipt.financialDigest && resetFingerprint(continuity(old))===receipt.continuityDigest, 'RESET_OLD_ACTIVITY_OR_FINANCIAL_CHANGE');
  return {fresh,counts};
}
async function safeNewConversationProof(conversationId, participantId, routingDigest) {
  ensure(conversationId && conversationId!==scope.botpressConversationId,'RESET_NEW_CONVERSATION_ID_INVALID');
  const {conversation}=await client.getConversation({id:conversationId});
  const participants=await client.listParticipants({id:conversationId,pageSize:100});
  const messages=await client.listMessages({conversationId,pageSize:1});
  const workflows=await client.listWorkflows({conversationId,pageSize:100,statuses:['pending','in_progress','listening','paused']});
  await inspectActiveOwnerWorkflows(client,{participantId,newBotpressConversationId:conversationId});
  ensure(resetFingerprint(ownerResetRoutingTags(conversation))===routingDigest,'RESET_NEW_ROUTE_CHANGED');
  ensure(conversation.integration==='whatsapp' && conversation.channel==='channel' && !participants.nextToken && participants.participants.length===1
    && participants.participants[0].id===participantId,'RESET_NEW_CONVERSATION_IDENTITY_INVALID');
  ensure(messages.messages.length===0 && !messages.nextToken && workflows.workflows.length===0 && !workflows.nextToken,'RESET_NEW_BOTPRESS_ACTIVITY_DETECTED');
  const number=participants.participants[0].tags?.['whatsapp:number'];
  ensure(number && classifyPhone(number),'RESET_NEW_PARTICIPANT_PHONE_MISMATCH');
  return {id:conversationId,participantId,messageCount:0,activeWorkflows:0};
}
const classifyPhone = value => ['5491169004497','541169004497'].includes(String(value??'').replace(/\D/gu,''));
async function awaitNativeInbound(receipt) {
  const resetId=receipt.resetId;
  ensure(await getPhase(db,resetId,'bp_deleted'),'RESET_OLD_DELETE_CHECKPOINT_REQUIRED');
  const backup=JSON.parse(fs.readFileSync(path.join(stateDir,'backup.private.json'),'utf8'));
  const routingTags=ownerResetRoutingTags(backup.botpress.conversation);
  ensure(resetFingerprint(routingTags)===receipt.routingDigest,'RESET_PRIVATE_ROUTE_PROOF_CHANGED');
  await inspectNativeInboundReadiness(client,receipt,routingTags);
  const result=await db.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext('studyx:owner-test-reset:1169004497'))`;
    const ready=await getPhase(tx,resetId,'ready_for_first_inbound');if(ready)return ready;
    await verifyBarrier(tx,receipt);
    const proof=await inspectNativeInboundReadiness(client,receipt,routingTags);
    const rows=await tx`UPDATE contacts SET lifecycle_status='active',status='prospecto',blocked_at=NULL,blocked_reason=NULL,updated_at=now()
      WHERE id=${receipt.newContactId}::uuid AND phone=${scope.phone} AND lifecycle_status='blocked'
        AND blocked_reason=${ownerResetBarrier(resetId)} AND deleted_at IS NULL RETURNING id`;
    ensure(rows.length===1,'RESET_FINAL_UNBLOCK_LOST');
    return appendPhase(tx,resetId,'ready_for_first_inbound',{newContactId:receipt.newContactId,
      newBotpressConversationId:null,oldConversationDeleted:true,proof,
      freshLeadClean:true,financialRowsPreserved:true,continuityRowsPreserved:true,
      routingValidation:'pending_first_real_inbound',creationMode:'whatsapp_native_first_inbound'});
  });
  save('receipt.json',result);return result;
}
async function finishBotpress(resetId) {
  const receipt=await requiredReceipt(resetId);
  const completed=await getPhase(db,resetId,'completed');
  if (completed) return {phase:'complete',resetId,newContactId:receipt.newContactId,newBotpressConversationId:completed.newBotpressConversationId,resumed:true};
  const nativeReady=await getPhase(db,resetId,'ready_for_first_inbound');
  if(nativeReady)return {...nativeReady,resumed:true};
  if(process.argv.includes('--await-native-inbound'))return awaitNativeInbound(receipt);
  await db.begin(async tx=>{await tx`SELECT pg_advisory_xact_lock(hashtext('studyx:owner-test-reset:1169004497'))`; await verifyBarrier(tx,receipt);});
  const backup=JSON.parse(fs.readFileSync(path.join(stateDir,'backup.private.json'),'utf8'));
  const routingTags=ownerResetRoutingTags(backup.botpress.conversation);
  ensure(resetFingerprint(routingTags)===receipt.routingDigest,'RESET_PRIVATE_ROUTE_PROOF_CHANGED');
  const {user}=await client.getUser({id:receipt.participantId});
  ensure(classifyPhone(user.tags?.['whatsapp:number']),'RESET_END_USER_IDENTITY_MISMATCH');
  if (!(await getPhase(db,resetId,'bp_deleted'))) {
    let existing;
    try { existing=await readBotpress(); } catch(error) { if(!isMissing(error))throw error; }
    if(existing) {
      ensure(existing.conversation.id===scope.botpressConversationId
        && resetFingerprint(ownerResetRoutingTags(existing.conversation))===receipt.routingDigest,'RESET_OLD_CONVERSATION_CHANGED');
      ensure(!existing.participants.nextToken && existing.participants.participants.length===1
        && existing.participants.participants[0].id===receipt.participantId
        && classifyPhone(existing.participants.participants[0].tags?.['whatsapp:number']),'RESET_OLD_PARTICIPANT_CHANGED');
      ensure(existing.workflows.workflows.length===0 && !existing.workflows.nextToken,'RESET_ACTIVE_BOTPRESS_WORKFLOW');
      await appendPhase(db,resetId,'bp_delete_requested',{newContactId:receipt.newContactId,oldBotpressConversationId:scope.botpressConversationId});
      try { await client.deleteConversation({id:scope.botpressConversationId}); }
      catch(error) { if(!isMissing(error))throw error; }
    }
    try { await client.getConversation({id:scope.botpressConversationId}); throw new Error('RESET_OLD_CONVERSATION_STILL_EXISTS'); }
    catch(error) { if(!isMissing(error))throw error; }
    await appendPhase(db,resetId,'bp_deleted',{newContactId:receipt.newContactId,oldBotpressConversationId:scope.botpressConversationId});
  }
  let created=await getPhase(db,resetId,'bp_conversation_created');
  if(!created) {
    // Resolve an ambiguous previous create by its exact routing tags before retrying.
    const listed=await client.listConversations({integrationName:'whatsapp',channel:'channel',tags:routingTags,pageSize:100});
    ensure(!listed.nextToken,'RESET_CONVERSATION_LOOKUP_INCOMPLETE');
    const candidates=listed.conversations.filter(x=>x.id!==scope.botpressConversationId);
    ensure(candidates.length<=1,'RESET_MULTIPLE_NEW_CONVERSATIONS');
    let conversation=candidates[0];
    if(!conversation) {
      ensure(!(await getPhase(db,resetId,'bp_create_requested')),'RESET_CREATE_RETRY_REQUIRES_EXPLICIT_REVIEW');
      await appendPhase(db,resetId,'bp_create_requested',{newContactId:receipt.newContactId,routingDigest:receipt.routingDigest});
      const result=await client.getOrCreateConversation({channel:'channel',integrationName:'whatsapp',tags:routingTags,discriminateByTags:Object.keys(routingTags)});
      conversation=result.conversation;
    }
    ensure(conversation.id!==scope.botpressConversationId && conversation.integration==='whatsapp','RESET_NEW_CONVERSATION_ID_INVALID');
    created=await appendPhase(db,resetId,'bp_conversation_created',{newContactId:receipt.newContactId,newBotpressConversationId:conversation.id,routingDigest:receipt.routingDigest});
  }
  const newId=created.newBotpressConversationId;
  const participants=await client.listParticipants({id:newId,pageSize:100});
  ensure(!participants.nextToken && participants.participants.every(x=>x.id===receipt.participantId),'RESET_UNEXPECTED_NEW_PARTICIPANT');
  if(!participants.participants.some(x=>x.id===receipt.participantId)) await client.addParticipant({id:newId,userId:receipt.participantId});
  const proof=await safeNewConversationProof(newId,receipt.participantId,receipt.routingDigest);
  await appendPhase(db,resetId,'bp_ready',{newContactId:receipt.newContactId,newBotpressConversationId:newId,proof});
  const result=await db.begin(async tx=>{
    await tx`SELECT pg_advisory_xact_lock(hashtext('studyx:owner-test-reset:1169004497'))`;
    const done=await getPhase(tx,resetId,'completed');if(done)return done;
    await verifyBarrier(tx,receipt);
    await safeNewConversationProof(newId,receipt.participantId,receipt.routingDigest);
    const rows=await tx`UPDATE contacts SET lifecycle_status='active',status='prospecto',blocked_at=NULL,blocked_reason=NULL,updated_at=now()
      WHERE id=${receipt.newContactId}::uuid AND phone=${scope.phone} AND lifecycle_status='blocked'
        AND blocked_reason=${ownerResetBarrier(resetId)} AND deleted_at IS NULL RETURNING id`;
    ensure(rows.length===1,'RESET_FINAL_UNBLOCK_LOST');
    return appendPhase(tx,resetId,'completed',{newContactId:receipt.newContactId,newBotpressConversationId:newId,
      freshLeadClean:true,financialRowsPreserved:true,continuityRowsPreserved:true});
  });
  save('receipt.json',result);return result;
}
let outcome;
try {
  if(command==='finish-botpress') {
    outcome=await finishBotpress(requestedResetId());
  } else if(command==='verify') {
    const resetId=requestedResetId(),receipt=await requiredReceipt(resetId),completed=await getPhase(db,resetId,'completed');
    const nativeReady=await getPhase(db,resetId,'ready_for_first_inbound');
    ensure(completed||nativeReady,'RESET_NOT_COMPLETED');
    const [contact]=await db`SELECT id,phone,lifecycle_status,status,blocked_at,blocked_reason,name,email,summary,contact_profile_v1,deleted_at FROM contacts WHERE id=${receipt.newContactId}::uuid`;
    const counts=await freshActivity(db,receipt.newContactId);
    ensure(contact?.phone===scope.phone && contact.lifecycle_status==='active' && contact.status==='prospecto'
      && contact.blocked_at===null && contact.blocked_reason===null && Object.values(counts).every(x=>x===0),'RESET_POSTCONDITION_FAILED');
    let proof;
    if(nativeReady){
      const backup=JSON.parse(fs.readFileSync(path.join(stateDir,'backup.private.json'),'utf8'));
      const routingTags=ownerResetRoutingTags(backup.botpress.conversation);
      ensure(resetFingerprint(routingTags)===receipt.routingDigest,'RESET_PRIVATE_ROUTE_PROOF_CHANGED');
      proof=await inspectNativeInboundReadiness(client,receipt,routingTags);
    }else proof=await safeNewConversationProof(completed.newBotpressConversationId,receipt.participantId,receipt.routingDigest);
    const old=await readSnapshot(db);
    ensure(resetFingerprint(financial(old))===receipt.financialDigest && resetFingerprint(continuity(old))===receipt.continuityDigest,'RESET_OLD_ACTIVITY_OR_FINANCIAL_CHANGE');
    outcome={verified:true,phase:nativeReady?'ready_for_first_inbound':'completed',resetId,newContactId:receipt.newContactId,
      newBotpressConversationId:proof.id??null,routingValidation:nativeReady?'pending_first_real_inbound':'validated_empty_conversation',cleanCounts:counts};save('verification.json',outcome);
  } else {
    if(command==='discover') {
      const botpress=await readBotpress();
      const before=await readSnapshot(db),plan=classifyOwnerReset(before,botpress),resetId=randomUUID();
      const last=before.related.messages.map(row=>Date.parse(row.created_at)).sort((a,b)=>a-b).at(-1);
      ensure(!last || Date.now()-last>60_000,'RESET_RECENT_USER_ACTIVITY');
      save('backup.private.json',{observedAt:new Date().toISOString(),before,botpress});
      save('preparation.private.json',{resetId,observedAt:new Date().toISOString(),fingerprint:resetFingerprint(before),plan});
      outcome={prepared:true,resetId,contactId:scope.contactId,plan,remoteMutations:0};save('preparation.json',outcome);
    } else {
      const prep=preparation(),resetId=prep.resetId;
      ownerResetBarrier(resetId);
      const prior=await getPhase(db,resetId,'db_committed');
      if(prior) {
        validateResetDbReceipt(prior,resetId);outcome={...prior,resumed:true};save('receipt.json',outcome);
      } else {
        ensure(Date.now()-Date.parse(prep.observedAt)<10*60_000,'RESET_PREPARATION_EXPIRED');
        const rollback=new Error('EXPECTED_OWNER_RESET_DRY_RUN_ROLLBACK');
        try {
          await db.begin('isolation level serializable',async tx=>{
            await tx`SELECT pg_advisory_xact_lock(hashtext('studyx:owner-test-reset:1169004497'))`;
            const already=await getPhase(tx,resetId,'db_committed');
            if(already){outcome=validateResetDbReceipt(already,resetId);return;}
            const before=await readSnapshot(tx,true);
            ensure(resetFingerprint(before)===prep.fingerprint,'RESET_TARGET_CHANGED_SINCE_PREPARATION');
            const freshBotpress=await readBotpress(),plan=classifyOwnerReset(before,freshBotpress);
            const swap=await swapInsideTransaction(tx,before,plan,resetId);
            const data={...swap,oldBotpressConversationId:scope.botpressConversationId,participantId:plan.participantId,
              financialDigest:resetFingerprint(financial(before)),continuityDigest:resetFingerprint(continuity(before)),
              snapshotDigest:prep.fingerprint,routingDigest:resetFingerprint(ownerResetRoutingTags(freshBotpress.conversation)),
              observedAt:new Date().toISOString()};
            const audit=await appendPhase(tx,resetId,'db_committed',data);
            ensure((await getPhase(tx,resetId,'db_committed'))?.newContactId===swap.newContactId,'RESET_ATOMIC_RECEIPT_MISSING');
            outcome={...audit,dryRun:command==='dry-run',committed:command==='apply-db',botpressMutated:false};
            if(command==='dry-run')throw rollback;
          });
        } catch(error){if(error!==rollback)throw error;}
        if(command==='dry-run') {
          ensure(!(await getPhase(db,resetId,'db_committed')),'RESET_DRY_RUN_AUDIT_NOT_ROLLED_BACK');
          ensure(resetFingerprint(await readSnapshot(db))===prep.fingerprint,'RESET_DRY_RUN_NOT_ROLLED_BACK');save('dry-run.json',outcome);
        } else save('receipt.json',outcome);
      }
    }
  }
  console.log(JSON.stringify(outcome));
} catch(error) {
  console.error(JSON.stringify({prepared:false,reason:error instanceof Error?error.message:'UNKNOWN_RESET_ERROR'}));process.exitCode=1;
} finally { await db.end(); }
