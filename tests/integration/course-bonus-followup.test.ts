import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import {
  claimCommercialFollowupV1,
  commitCommercialActionV1,
  deliverCommercialFollowupV1,
  releaseCommercialFollowupV1,
} from '@/features/promotions/application/commercial-followup-service';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
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
  });
});
