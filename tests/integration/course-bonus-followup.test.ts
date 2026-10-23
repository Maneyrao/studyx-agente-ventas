import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import {
  claimCommercialFollowupV1,
  commitCommercialActionV1,
  deliverCommercialFollowupV1,
  dispatchDueCommercialFollowupsV1,
  releaseCommercialFollowupV1,
} from '@/features/promotions/application/commercial-followup-service';
import { CommercialFollowupClaimSchema } from '../../botpress-agent/src/utils/commercial-followup-instructions';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
const priorBonusFlag = process.env.CENTRAL_CARGA_BONUS_ENABLED;
beforeEach(() => { process.env.CENTRAL_CARGA_BONUS_ENABLED = 'true'; });
afterEach(() => {
  if (priorBonusFlag === undefined) delete process.env.CENTRAL_CARGA_BONUS_ENABLED;
  else process.env.CENTRAL_CARGA_BONUS_ENABLED = priorBonusFlag;
});
afterAll(async () => db?.end());

async function fixture() {
  const suffix = randomUUID();
  const botpressId = `bp-${suffix}`;
  const [workspace] = await db!`INSERT INTO workspaces(slug,display_name)
    VALUES (${`bonus-followup-${suffix}`},'Studyx') RETURNING id`;
  const [contact] = await db!`INSERT INTO contacts(phone,status,channel_origin,name)
    VALUES (${`+54911${Math.floor(10000000 + Math.random()*89999999)}`},'prospecto','whatsapp','Ana Pérez') RETURNING id`;
  await db!`INSERT INTO contact_channel_permissions(contact_id,channel,consent_status)
    VALUES (${contact.id},'whatsapp','unknown')`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id,source_channel)
    VALUES (${workspace.id},${contact.id},'whatsapp')`;
  const [thread] = await db!`INSERT INTO channel_threads(contact_id,provider,integration_id,channel,external_conversation_id,metadata)
    VALUES (${contact.id},'botpress','whatsapp','whatsapp',${botpressId},${db!.json({botpress_conversation_id:botpressId})}) RETURNING id`;
  const [conversation] = await db!`INSERT INTO conversations(contact_id,channel,workspace_id,channel_thread_id)
    VALUES (${contact.id},'whatsapp',${workspace.id},${thread.id}) RETURNING id`;
  const offerings = await db!`INSERT INTO offerings(workspace_id,code,display_name,offering_type,status,description,price_type,price_amount,currency,billing_interval)
    VALUES (${workspace.id},${`ingles_1_${suffix.slice(0,8)}`},'Inglés 1','course','active','Base','fixed',360,'USD','annual'),
      (${workspace.id},${`ingles_2_${suffix.slice(0,8)}`},'Inglés 2','course','active','Continuación','free',NULL,NULL,NULL)
    RETURNING id,code`;
  const [paid, bonus] = offerings;
  const [promotion] = await db!`INSERT INTO promotions(workspace_id,promotion_code,paid_offering_id,channels,active)
    VALUES (${workspace.id},${`ingles-bonus-${suffix.slice(0,8)}`},${paid.id},ARRAY['text']::text[],true) RETURNING id,promotion_code`;
  await db!`INSERT INTO promotion_bonus_offerings(promotion_id,workspace_id,offering_id,position)
    VALUES (${promotion.id},${workspace.id},${bonus.id},1)`;
  const [inbound] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
    VALUES (${conversation.id},${contact.id},'inbound','Me sigue pareciendo caro') RETURNING id,conversation_seq`;
  const [outbound] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,in_reply_to)
    VALUES (${conversation.id},${contact.id},'outbound','Dame un momento y reviso qué alternativa puedo habilitarte.',${inbound.id})
    RETURNING id,conversation_seq`;
  await db!`INSERT INTO conversation_sales_context_states_v1(workspace_id,conversation_id,contact_id,selected_offering_code,source_turn_id)
    VALUES (${workspace.id},${conversation.id},${contact.id},${paid.code},${inbound.id})`;
  return { workspace, contact, conversation, paid, bonus, promotion, inbound, outbound, botpressId };
}

run('durable commercial course-bonus follow-up', () => {
  it('does not create reviews or offers while the feature flag is disabled', async () => {
    const f = await fixture();
    process.env.CENTRAL_CARGA_BONUS_ENABLED = 'false';
    expect(await commitCommercialActionV1(db!, {
      workspace_id: f.workspace.id as string,
      contact_id: f.contact.id as string,
      conversation_id: f.conversation.id as string,
      paid_offering_code: f.paid.code as string,
      source_turn_id: f.inbound.id as string,
      source_outbound_message_id: f.outbound.id as string,
      action: { type: 'request_promotion_review', reason: 'persistent_price_objection' },
    })).toEqual({ offer_id: null, followup: null });
  });

  it('commits one review, claims once and marks the authorized offer delivered once', async () => {
    const f = await fixture();
    const input = { workspace_id:f.workspace.id as string, contact_id:f.contact.id as string,
      conversation_id:f.conversation.id as string, paid_offering_code:f.paid.code as string,
      source_turn_id:f.inbound.id as string, source_outbound_message_id:f.outbound.id as string,
      action:{type:'request_promotion_review' as const,reason:'persistent_price_objection' as const},
      now:new Date('2026-10-23T12:00:00Z') };
    const first = await commitCommercialActionV1(db!, input);
    const replay = await commitCommercialActionV1(db!, input);
    expect(first.followup).toMatchObject({ kind:'promotion_review' });
    expect(replay.followup?.id).toBe(first.followup?.id);
    await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second' WHERE id=${first.followup!.id}`;

    const [a,b] = await Promise.all([
      claimCommercialFollowupV1(first.followup!.id,f.botpressId,`event-${randomUUID()}`,{db:db!}),
      claimCommercialFollowupV1(first.followup!.id,f.botpressId,`event-${randomUUID()}`,{db:db!}),
    ]);
    expect([a,b].filter(result=>result.claimed)).toHaveLength(1);
    const claim = [a,b].find(result=>result.claimed)!;
    if(!claim.claimed) throw new Error('claim expected');
    let sends=0;
    const result = await deliverCommercialFollowupV1(first.followup!.id,{
      claim_token:claim.claim_token,botpress_conversation_id:f.botpressId,
      narrative:{message:'Pude habilitarte Inglés 2 junto con Inglés 1, sin cambiar el precio de Inglés 1. Así puedes avanzar con una base y continuar con el siguiente nivel.'},
    },{db:db!,sender:async()=>{sends++; return {outcome:'sent' as const,channel:'whatsapp' as const,providerMessageId:'wamid.1',deliveryId:null,reason:null};}});
    expect(result).toEqual({outcome:'sent'});
    expect(sends).toBe(1);
    expect(await deliverCommercialFollowupV1(first.followup!.id,{
      claim_token:claim.claim_token,botpress_conversation_id:f.botpressId,
      narrative:{message:'Pude habilitarte Inglés 2 junto con Inglés 1, sin cambiar el precio de Inglés 1.'},
    },{db:db!,sender:async()=>{sends++; return {outcome:'sent' as const,channel:'whatsapp' as const,providerMessageId:'wamid.2',deliveryId:null,reason:null};}}))
      .toEqual({outcome:'claim_lost'});
    expect(sends).toBe(1);
    expect(await db!`SELECT status FROM promotion_offers WHERE id=${first.offer_id}`).toEqual([{status:'offered'}]);
  });

  it('uses the final bubble of the same agent turn as the follow-up activity boundary', async () => {
    const f = await fixture();
    const [lastBubble] = await db!`INSERT INTO messages(
        conversation_id,contact_id,direction,content,in_reply_to,part_index)
      VALUES (${f.conversation.id},${f.contact.id},'outbound',
        'Mientras tanto, te explico por qué puede servirte.',${f.inbound.id},1)
      RETURNING id,conversation_seq`;
    const committed = await commitCommercialActionV1(db!, {
      workspace_id:f.workspace.id as string, contact_id:f.contact.id as string,
      conversation_id:f.conversation.id as string, paid_offering_code:f.paid.code as string,
      source_turn_id:f.inbound.id as string, source_outbound_message_id:f.outbound.id as string,
      action:{type:'request_promotion_review',reason:'persistent_price_objection'}, now:new Date(),
    });
    expect(await db!`SELECT source_outbound_message_id,expected_conversation_seq
      FROM course_bonus_followups WHERE id=${committed.followup!.id}`).toEqual([{
        source_outbound_message_id:lastBubble.id,
        expected_conversation_seq:lastBubble.conversation_seq,
      }]);
    await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second'
      WHERE id=${committed.followup!.id}`;
    expect(await claimCommercialFollowupV1(
      committed.followup!.id, f.botpressId, `event-multibubble-${randomUUID()}`, {db:db!},
    )).toMatchObject({claimed:true});
  });

  it('cancels on newer customer input, course change, opt-out, purchase or inactive rule', async () => {
    for (const mutation of ['newer','course','optout','purchase','inactive'] as const) {
      const f = await fixture();
      const committed = await commitCommercialActionV1(db!, { workspace_id:f.workspace.id as string,
        contact_id:f.contact.id as string,conversation_id:f.conversation.id as string,
        paid_offering_code:f.paid.code as string,source_turn_id:f.inbound.id as string,
        source_outbound_message_id:f.outbound.id as string,
        action:{type:'request_promotion_review',reason:'persistent_price_objection'},now:new Date() });
      await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second' WHERE id=${committed.followup!.id}`;
      if(mutation==='newer') await db!`INSERT INTO messages(conversation_id,contact_id,direction,content) VALUES (${f.conversation.id},${f.contact.id},'inbound','Ahora quiero otra cosa')`;
      if(mutation==='course') await db!`UPDATE conversation_sales_context_states_v1 SET selected_offering_code=NULL,version=version+1 WHERE conversation_id=${f.conversation.id}`;
      if(mutation==='optout') await db!`UPDATE contact_channel_permissions SET consent_status='revoked'
        WHERE contact_id=${f.contact.id} AND channel='whatsapp'`;
      if(mutation==='purchase') {
        const key=`paid-${randomUUID()}`;
        await db!`INSERT INTO payments(workspace_id,contact_id,offering_id,amount,currency,status,provider,environment,checkout_mode,idempotency_key,plan_code,source_conversation_id)
          VALUES (${f.workspace.id},${f.contact.id},${f.paid.id},360,'USD','reserved','stripe','test','payment',${key},'one_time',${f.conversation.id})`;
        await db!`UPDATE payments SET status='creating_checkout' WHERE idempotency_key=${key}`;
        await db!`UPDATE payments SET status='pending',provider_session_id=${`cs_${randomUUID()}`} WHERE idempotency_key=${key}`;
        await db!`UPDATE payments SET status='paid',paid_at=now() WHERE idempotency_key=${key}`;
      }
      if(mutation==='inactive') await db!`UPDATE promotions SET active=false WHERE id=${f.promotion.id}`;
      expect(await claimCommercialFollowupV1(committed.followup!.id,f.botpressId,`event-${mutation}-${randomUUID()}`,{db:db!}))
        .toEqual({claimed:false});
    }
  });

  it('revalidates the feature flag and commercial facts after claim, immediately before delivery', async () => {
    for (const mutation of ['flag','newer','course','purchase','inactive'] as const) {
      process.env.CENTRAL_CARGA_BONUS_ENABLED = 'true';
      const f = await fixture();
      const committed = await commitCommercialActionV1(db!, {
        workspace_id:f.workspace.id as string, contact_id:f.contact.id as string,
        conversation_id:f.conversation.id as string, paid_offering_code:f.paid.code as string,
        source_turn_id:f.inbound.id as string, source_outbound_message_id:f.outbound.id as string,
        action:{type:'request_promotion_review',reason:'persistent_price_objection'}, now:new Date(),
      });
      await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second'
        WHERE id=${committed.followup!.id}`;
      const claim = await claimCommercialFollowupV1(
        committed.followup!.id,
        f.botpressId,
        `event-pre-send-${mutation}-${randomUUID()}`,
        {db:db!},
      );
      if (!claim.claimed) throw new Error('claim expected');

      if (mutation === 'flag') process.env.CENTRAL_CARGA_BONUS_ENABLED = 'false';
      if (mutation === 'newer') await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
        VALUES (${f.conversation.id},${f.contact.id},'inbound','Cambié de idea')`;
      if (mutation === 'course') await db!`UPDATE conversation_sales_context_states_v1
        SET selected_offering_code=NULL,version=version+1 WHERE conversation_id=${f.conversation.id}`;
      if (mutation === 'purchase') {
        const key=`paid-after-claim-${randomUUID()}`;
        await db!`INSERT INTO payments(workspace_id,contact_id,offering_id,amount,currency,status,provider,
          environment,checkout_mode,idempotency_key,plan_code,source_conversation_id)
          VALUES (${f.workspace.id},${f.contact.id},${f.paid.id},360,'USD','reserved','stripe','test','payment',
            ${key},'one_time',${f.conversation.id})`;
        await db!`UPDATE payments SET status='creating_checkout' WHERE idempotency_key=${key}`;
        await db!`UPDATE payments SET status='pending',provider_session_id=${`cs_${randomUUID()}`}
          WHERE idempotency_key=${key}`;
        await db!`UPDATE payments SET status='paid',paid_at=now() WHERE idempotency_key=${key}`;
      }
      if (mutation === 'inactive') await db!`UPDATE promotions SET active=false WHERE id=${f.promotion.id}`;

      let sends = 0;
      await expect(deliverCommercialFollowupV1(committed.followup!.id, {
        claim_token:claim.claim_token, botpress_conversation_id:f.botpressId,
        narrative:{message:'Pude habilitarte Inglés 2 junto con Inglés 1, sin cambiar el precio de Inglés 1.'},
      }, {db:db!,sender:async()=>{
        sends += 1;
        return {outcome:'sent' as const,channel:'whatsapp' as const,providerMessageId:'wamid.race',
          deliveryId:null,reason:null};
      }})).resolves.toEqual({outcome:'cancelled'});
      expect(sends).toBe(0);
      expect(await db!`SELECT status FROM promotion_offers WHERE id=${committed.offer_id}`)
        .toEqual([{status:'cancelled'}]);
    }
  });

  it('does not expose a selected memory that originated in another workspace', async () => {
    const f = await fixture();
    const [otherWorkspace] = await db!`INSERT INTO workspaces(slug,display_name)
      VALUES (${`other-memory-${randomUUID()}`},'Otra academia') RETURNING id`;
    await db!`INSERT INTO workspace_contacts(workspace_id,contact_id,source_channel)
      VALUES (${otherWorkspace.id},${f.contact.id},'whatsapp')`;
    const otherBotpressId = `other-memory-${randomUUID()}`;
    const [otherThread] = await db!`INSERT INTO channel_threads(
        contact_id,provider,integration_id,channel,external_conversation_id,metadata)
      VALUES (${f.contact.id},'botpress','whatsapp','whatsapp',${otherBotpressId},
        ${db!.json({botpress_conversation_id:otherBotpressId})}) RETURNING id`;
    const [otherConversation] = await db!`INSERT INTO conversations(
        contact_id,channel,workspace_id,channel_thread_id)
      VALUES (${f.contact.id},'whatsapp',${otherWorkspace.id},${otherThread.id}) RETURNING id`;
    const [otherInbound] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
      VALUES (${otherConversation.id},${f.contact.id},'inbound','Quiero cambiar de trabajo') RETURNING id`;
    await db!`INSERT INTO conversation_sales_context_states_v1(
        workspace_id,conversation_id,contact_id,source_turn_id)
      VALUES (${otherWorkspace.id},${otherConversation.id},${f.contact.id},${otherInbound.id})`;
    await db!`INSERT INTO selected_memories(
        contact_id,conversation_id,source_message_id,status,memory_type,memory_key,
        value_normalized,source_quote,confidence,dedupe_hash)
      VALUES (${f.contact.id},${otherConversation.id},${otherInbound.id},'active','study_goal',
        'other_academy_goal','dato privado de otra academia','Quiero cambiar de trabajo',0.9,
        ${'a'.repeat(64)})`;

    const committed = await commitCommercialActionV1(db!, {
      workspace_id:f.workspace.id as string, contact_id:f.contact.id as string,
      conversation_id:f.conversation.id as string, paid_offering_code:f.paid.code as string,
      source_turn_id:f.inbound.id as string, source_outbound_message_id:f.outbound.id as string,
      action:{type:'request_promotion_review',reason:'persistent_price_objection'}, now:new Date(),
    });
    await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second'
      WHERE id=${committed.followup!.id}`;
    const claim = await claimCommercialFollowupV1(
      committed.followup!.id,
      f.botpressId,
      `event-memory-${randomUUID()}`,
      {db:db!},
    );
    expect(claim).toMatchObject({claimed:true,customer_goal:null});
  });

  it('recovers a committed follow-up when the original Botpress scheduling step never ran', async () => {
    const f = await fixture();
    const committed = await commitCommercialActionV1(db!, {
      workspace_id:f.workspace.id as string, contact_id:f.contact.id as string,
      conversation_id:f.conversation.id as string, paid_offering_code:f.paid.code as string,
      source_turn_id:f.inbound.id as string, source_outbound_message_id:f.outbound.id as string,
      action:{type:'request_promotion_review',reason:'persistent_price_objection'}, now:new Date(),
    });
    await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second'
      WHERE id=${committed.followup!.id}`;
    const providerEventId = `event-recovered-${randomUUID()}`;
    expect(await dispatchDueCommercialFollowupsV1(
      {limit:10,lookahead_seconds:0,retry_after_seconds:0},
      {db:db!,schedule:async(id)=>({scheduled:id===committed.followup!.id,
        provider_event_id:providerEventId})},
    )).toEqual({reserved:1,scheduled:1,failed:0,ambiguous:0});
    expect(await db!`SELECT status,provider_event_id,schedule_attempt_count,terminal_reason
      FROM course_bonus_followups WHERE id=${committed.followup!.id}`).toEqual([{
        status:'pending',provider_event_id:providerEventId,schedule_attempt_count:1,terminal_reason:null,
      }]);
  });

  it('recovers an expired processing lease when Botpress dies after claiming the event', async () => {
    const f = await fixture();
    const committed = await commitCommercialActionV1(db!, {
      workspace_id:f.workspace.id as string, contact_id:f.contact.id as string,
      conversation_id:f.conversation.id as string, paid_offering_code:f.paid.code as string,
      source_turn_id:f.inbound.id as string, source_outbound_message_id:f.outbound.id as string,
      action:{type:'request_promotion_review',reason:'persistent_price_objection'}, now:new Date(),
    });
    await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second'
      WHERE id=${committed.followup!.id}`;
    const claim = await claimCommercialFollowupV1(
      committed.followup!.id, f.botpressId, `event-crashed-${randomUUID()}`, {db:db!},
    );
    if (!claim.claimed) throw new Error('claim expected');
    await db!`UPDATE course_bonus_followups SET lease_until=now()-interval '1 second'
      WHERE id=${committed.followup!.id}`;
    const recoveredEvent = `event-reclaimed-${randomUUID()}`;
    expect(await dispatchDueCommercialFollowupsV1(
      {limit:10,lookahead_seconds:0,retry_after_seconds:0},
      {db:db!,schedule:async()=>({scheduled:true,provider_event_id:recoveredEvent})},
    )).toEqual({reserved:1,scheduled:1,failed:0,ambiguous:0});
    expect(await db!`SELECT status,provider_event_id,claim_token,lease_until
      FROM course_bonus_followups WHERE id=${committed.followup!.id}`).toEqual([{
        status:'pending',provider_event_id:recoveredEvent,claim_token:null,lease_until:null,
      }]);
  });

  it('leaves repeated unconfirmed scheduling terminal and observable instead of silently orphaned', async () => {
    const f = await fixture();
    const committed = await commitCommercialActionV1(db!, {
      workspace_id:f.workspace.id as string, contact_id:f.contact.id as string,
      conversation_id:f.conversation.id as string, paid_offering_code:f.paid.code as string,
      source_turn_id:f.inbound.id as string, source_outbound_message_id:f.outbound.id as string,
      action:{type:'request_promotion_review',reason:'persistent_price_objection'}, now:new Date(),
    });
    await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second',max_schedule_attempts=1
      WHERE id=${committed.followup!.id}`;
    expect(await dispatchDueCommercialFollowupsV1(
      {limit:10,lookahead_seconds:0,retry_after_seconds:0},
      {db:db!,schedule:async()=>({scheduled:false,provider_event_id:null})},
    )).toEqual({reserved:1,scheduled:0,failed:1,ambiguous:1});
    expect(await db!`SELECT status,schedule_attempt_count,terminal_reason
      FROM course_bonus_followups WHERE id=${committed.followup!.id}`).toEqual([{
        status:'ambiguous',schedule_attempt_count:1,terminal_reason:'EVENT_SCHEDULE_UNCONFIRMED',
      }]);
  });

  it('terminalizes a scheduling reservation whose process died after spending the last attempt', async () => {
    const f = await fixture();
    const committed = await commitCommercialActionV1(db!, {
      workspace_id:f.workspace.id as string, contact_id:f.contact.id as string,
      conversation_id:f.conversation.id as string, paid_offering_code:f.paid.code as string,
      source_turn_id:f.inbound.id as string, source_outbound_message_id:f.outbound.id as string,
      action:{type:'request_promotion_review',reason:'persistent_price_objection'}, now:new Date(),
    });
    await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second',
      schedule_attempt_count=max_schedule_attempts,provider_event_id=NULL
      WHERE id=${committed.followup!.id}`;
    expect(await dispatchDueCommercialFollowupsV1(
      {limit:10,lookahead_seconds:0,retry_after_seconds:0},
      {db:db!,schedule:async()=>({scheduled:true,provider_event_id:`event-${randomUUID()}`})},
    )).toEqual({reserved:0,scheduled:0,failed:0,ambiguous:1});
    expect(await db!`SELECT status,terminal_reason FROM course_bonus_followups
      WHERE id=${committed.followup!.id}`).toEqual([{
        status:'ambiguous',terminal_reason:'EVENT_SCHEDULE_UNCONFIRMED',
      }]);
  });

  it('terminalizes an expired processing lease when the scheduling budget is exhausted', async () => {
    const f = await fixture();
    const committed = await commitCommercialActionV1(db!, {
      workspace_id:f.workspace.id as string, contact_id:f.contact.id as string,
      conversation_id:f.conversation.id as string, paid_offering_code:f.paid.code as string,
      source_turn_id:f.inbound.id as string, source_outbound_message_id:f.outbound.id as string,
      action:{type:'request_promotion_review',reason:'persistent_price_objection'}, now:new Date(),
    });
    await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second'
      WHERE id=${committed.followup!.id}`;
    const claim = await claimCommercialFollowupV1(
      committed.followup!.id, f.botpressId, `event-budget-${randomUUID()}`, {db:db!},
    );
    if (!claim.claimed) throw new Error('claim expected');
    await db!`UPDATE course_bonus_followups
      SET lease_until=now()-interval '1 second',schedule_attempt_count=max_schedule_attempts
      WHERE id=${committed.followup!.id}`;
    expect(await dispatchDueCommercialFollowupsV1(
      {limit:10,lookahead_seconds:0,retry_after_seconds:0},
      {db:db!,schedule:async()=>({scheduled:true,provider_event_id:`event-${randomUUID()}`})},
    )).toEqual({reserved:0,scheduled:0,failed:0,ambiguous:1});
    expect(await db!`SELECT status,provider_event_id,claim_token,lease_until,terminal_reason
      FROM course_bonus_followups WHERE id=${committed.followup!.id}`).toEqual([{
        status:'ambiguous',provider_event_id:null,claim_token:null,lease_until:null,
        terminal_reason:'EVENT_SCHEDULE_UNCONFIRMED',
      }]);
  });

  it('matches the backend check-in claim to the Botpress contract without exposing gifts', async () => {
    const f = await fixture();
    const committed = await commitCommercialActionV1(db!, {
      workspace_id:f.workspace.id as string, contact_id:f.contact.id as string,
      conversation_id:f.conversation.id as string, paid_offering_code:f.paid.code as string,
      source_turn_id:f.inbound.id as string, source_outbound_message_id:f.outbound.id as string,
      action:{type:'schedule_price_objection_checkin',reason:'price_objection'}, now:new Date(),
    });
    await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second'
      WHERE id=${committed.followup!.id}`;
    const claim = await claimCommercialFollowupV1(
      committed.followup!.id, f.botpressId, `event-checkin-${randomUUID()}`, {db:db!},
    );
    expect(CommercialFollowupClaimSchema.safeParse(claim).success).toBe(true);
    expect(claim).toMatchObject({claimed:true,kind:'price_objection_checkin',bonus_offerings:[]});
  });

  it('releases generation failures for a fenced retry', async () => {
    const f=await fixture();
    const committed=await commitCommercialActionV1(db!,{workspace_id:f.workspace.id as string,contact_id:f.contact.id as string,
      conversation_id:f.conversation.id as string,paid_offering_code:f.paid.code as string,
      source_turn_id:f.inbound.id as string,source_outbound_message_id:f.outbound.id as string,
      action:{type:'request_promotion_review',reason:'persistent_price_objection'},now:new Date()});
    await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second' WHERE id=${committed.followup!.id}`;
    const claim=await claimCommercialFollowupV1(committed.followup!.id,f.botpressId,`event-release-${randomUUID()}`,{db:db!});
    if(!claim.claimed) throw new Error('claim expected');
    expect(await releaseCommercialFollowupV1(committed.followup!.id,claim.claim_token,{db:db!}))
      .toEqual({outcome:'released'});
    expect(await db!`SELECT status,provider_event_id,terminal_reason FROM course_bonus_followups
      WHERE id=${committed.followup!.id}`).toEqual([{
        status:'pending',provider_event_id:null,terminal_reason:'NARRATIVE_GENERATION_FAILED',
      }]);
    const retryEvent = `event-release-retry-${randomUUID()}`;
    await db!`UPDATE course_bonus_followups SET due_at=now()-interval '1 second'
      WHERE id=${committed.followup!.id}`;
    expect(await dispatchDueCommercialFollowupsV1(
      {limit:10,lookahead_seconds:0,retry_after_seconds:0},
      {db:db!,schedule:async()=>({scheduled:true,provider_event_id:retryEvent})},
    )).toEqual({reserved:1,scheduled:1,failed:0,ambiguous:0});
  });
});
