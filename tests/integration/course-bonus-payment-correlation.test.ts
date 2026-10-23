import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { reservePaymentLink } from '@/features/payments/application/reserve-payment-link';
import { processStripeWebhook } from '@/features/payments/application/process-stripe-webhook';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());
const priorFlag = process.env.CENTRAL_CARGA_BONUS_ENABLED;
beforeEach(() => { process.env.CENTRAL_CARGA_BONUS_ENABLED = 'true'; });
afterEach(() => {
  if (priorFlag === undefined) delete process.env.CENTRAL_CARGA_BONUS_ENABLED;
  else process.env.CENTRAL_CARGA_BONUS_ENABLED = priorFlag;
});

async function fixture() {
  const suffix = randomUUID();
  const [workspace] = await db!`INSERT INTO workspaces(slug,display_name) VALUES (${`payment-bonus-${suffix}`},'Studyx') RETURNING id`;
  const [contact] = await db!`INSERT INTO contacts(phone,status,channel_origin,name,email)
    VALUES (${`+54911${Math.floor(10000000 + Math.random()*89999999)}`},'prospecto','whatsapp','Ana Pérez','ana@example.com') RETURNING id`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id,source_channel) VALUES (${workspace.id},${contact.id},'whatsapp')`;
  const [thread] = await db!`INSERT INTO channel_threads(contact_id,provider,integration_id,channel,external_conversation_id,metadata)
    VALUES (${contact.id},'botpress','whatsapp','whatsapp',${suffix},${db!.json({botpress_conversation_id:suffix})}) RETURNING id`;
  const [conversation] = await db!`INSERT INTO conversations(contact_id,channel,workspace_id,channel_thread_id)
    VALUES (${contact.id},'whatsapp',${workspace.id},${thread.id}) RETURNING id`;
  const offerings = await db!`INSERT INTO offerings(workspace_id,code,display_name,offering_type,status,description,price_type,price_amount,currency,billing_interval)
    VALUES (${workspace.id},${`paid-${suffix.slice(0,8)}`},'Inglés 1','course','active','Base','fixed',360,'USD','annual'),
      (${workspace.id},${`bonus-${suffix.slice(0,8)}`},'Inglés 2','course','active','Continuación','free',NULL,NULL,NULL)
    RETURNING id,code,display_name`;
  const [paid,bonus]=offerings;
  const [promotion]=await db!`INSERT INTO promotions(workspace_id,promotion_code,paid_offering_id,channels,active)
    VALUES (${workspace.id},${`promo-${suffix.slice(0,8)}`},${paid.id},ARRAY['text']::text[],true) RETURNING id,promotion_code`;
  await db!`INSERT INTO promotion_bonus_offerings(promotion_id,workspace_id,offering_id,position)
    VALUES (${promotion.id},${workspace.id},${bonus.id},1)`;
  const [offer]=await db!`INSERT INTO promotion_offers(workspace_id,contact_id,conversation_id,promotion_id,paid_offering_id,status,offered_at,accepted_at)
    VALUES (${workspace.id},${contact.id},${conversation.id},${promotion.id},${paid.id},'accepted',now(),now()) RETURNING id`;
  await db!`INSERT INTO promotion_offer_bonus_offerings(
      offer_id,promotion_id,offering_id,promotion_code_snapshot,offering_code_snapshot,
      offering_display_name_snapshot,position)
    VALUES (${offer.id},${promotion.id},${bonus.id},${promotion.promotion_code},${bonus.code},${bonus.display_name},1)`;
  await db!`UPDATE promotion_offers SET bonus_snapshot_sealed_at=now() WHERE id=${offer.id}`;
  return {workspace,contact,conversation,paid,bonus,promotion,offer};
}

run('course bonus payment correlation', () => {
  it('seals the complete promised gift set before payment authorization', async () => {
    const f=await fixture();
    const [lateBonus]=await db!`INSERT INTO offerings(
        workspace_id,code,display_name,offering_type,status,description,price_type)
      VALUES (${f.workspace.id},${`late-${randomUUID().slice(0,8)}`},'Inglés 3','course','active','Continuación','free')
      RETURNING id,code,display_name`;
    await db!`INSERT INTO promotion_bonus_offerings(promotion_id,workspace_id,offering_id,position)
      VALUES (${f.promotion.id},${f.workspace.id},${lateBonus.id},2)`;
    await expect(db!`INSERT INTO promotion_offer_bonus_offerings(
        offer_id,promotion_id,offering_id,promotion_code_snapshot,offering_code_snapshot,
        offering_display_name_snapshot,position)
      VALUES (${f.offer.id},${f.promotion.id},${lateBonus.id},${f.promotion.promotion_code},
        ${lateBonus.code},${lateBonus.display_name},2)`)
      .rejects.toThrow(/offer bonus snapshot is sealed/i);
    expect(await db!`SELECT offering_code_snapshot,position
      FROM promotion_offer_bonus_offerings WHERE offer_id=${f.offer.id} ORDER BY position`)
      .toEqual([{offering_code_snapshot:f.bonus.code,position:1}]);
  });

  it('freezes the accepted offer into the correlated static Payment Link and replays identically', async () => {
    const f=await fixture();
    const input={workspace_id:f.workspace.id as string,contact_id:f.contact.id as string,
      offering_id:f.paid.id as string,conversation_id:f.conversation.id as string,
      plan_code:'one_time' as const,idempotency_key:`promoted:${randomUUID()}`,
      payment_link_url:'https://buy.stripe.com/test_bonus',promotion_code:f.promotion.promotion_code as string};
    const reserved=await reservePaymentLink(db!,input);
    expect(new URL(reserved.url).searchParams.get('client_reference_id')).toBe(reserved.payment_id);
    expect(await reservePaymentLink(db!,input)).toEqual(reserved);
    expect(await db!`SELECT promotion_code_snapshot,offering_code_snapshot,offering_display_name_snapshot,position
      FROM payment_bonus_offerings WHERE payment_id=${reserved.payment_id} ORDER BY position`).toEqual([{
        promotion_code_snapshot:f.promotion.promotion_code,offering_code_snapshot:f.bonus.code,
        offering_display_name_snapshot:'Inglés 2',position:1,
      }]);
    expect(await db!`SELECT status,payment_id FROM promotion_offers WHERE id=${f.offer.id}`)
      .toEqual([{status:'attached',payment_id:reserved.payment_id}]);
    const [event]=await db!`SELECT payload FROM payment_events WHERE payment_id=${reserved.payment_id} AND event_type='reserved'`;
    expect(event.payload).toMatchObject({promotion_code:f.promotion.promotion_code});
    const [lateBonus]=await db!`INSERT INTO offerings(
        workspace_id,code,display_name,offering_type,status,description,price_type)
      VALUES (${f.workspace.id},${`late-${randomUUID().slice(0,8)}`},'Regalo tardío','course','active','Tardío','free')
      RETURNING id,code`;
    await expect(db!`INSERT INTO payment_bonus_offerings(
        payment_id,promotion_id,offering_id,promotion_code_snapshot,offering_code_snapshot,
        offering_display_name_snapshot,position)
      VALUES (${reserved.payment_id},${f.promotion.id},${lateBonus.id},${f.promotion.promotion_code},
        ${lateBonus.code},'Regalo tardío',2)`)
      .rejects.toThrow(/snapshot is sealed/i);
    await expect(reservePaymentLink(db!,{...input,promotion_code:'another-promotion'}))
      .rejects.toMatchObject({code:'IDEMPOTENCY_KEY_CONFLICT'});
    await expect(reservePaymentLink(db!,{...input,promotion_code:undefined}))
      .rejects.toMatchObject({code:'IDEMPOTENCY_KEY_CONFLICT'});
  });

  it('uses the immutable offered gift even if the live promotion is edited before payment', async () => {
    const f=await fixture();
    const [replacement]=await db!`INSERT INTO offerings(
        workspace_id,code,display_name,offering_type,status,description,price_type)
      VALUES (${f.workspace.id},${`replacement-${randomUUID().slice(0,8)}`},'Marketing','course','active','Otro','free')
      RETURNING id`;
    await db!`DELETE FROM promotion_bonus_offerings WHERE promotion_id=${f.promotion.id}`;
    await db!`INSERT INTO promotion_bonus_offerings(promotion_id,workspace_id,offering_id,position)
      VALUES (${f.promotion.id},${f.workspace.id},${replacement.id},1)`;
    const reserved=await reservePaymentLink(db!,{workspace_id:f.workspace.id,contact_id:f.contact.id,
      offering_id:f.paid.id,conversation_id:f.conversation.id,plan_code:'one_time',
      idempotency_key:`offered-snapshot:${randomUUID()}`,payment_link_url:'https://buy.stripe.com/test_bonus',
      promotion_code:f.promotion.promotion_code});
    expect(await db!`SELECT offering_code_snapshot FROM payment_bonus_offerings
      WHERE payment_id=${reserved.payment_id}`).toEqual([{offering_code_snapshot:f.bonus.code}]);
  });

  it('fails closed for a wrong conversation, course, contact, inactive offer or disabled v2', async () => {
    const cases=['conversation','course','contact','inactive','disabled'] as const;
    for(const candidate of cases){
      const f=await fixture();
      if(candidate==='inactive') await db!`UPDATE promotion_offers SET status='cancelled',cancel_reason='test' WHERE id=${f.offer.id}`;
      if(candidate==='disabled') process.env.CENTRAL_CARGA_BONUS_ENABLED='false';
      const input={workspace_id:f.workspace.id as string,contact_id:candidate==='contact'?randomUUID():f.contact.id as string,
        offering_id:candidate==='course'?f.bonus.id as string:f.paid.id as string,
        conversation_id:candidate==='conversation'?randomUUID():f.conversation.id as string,
        plan_code:'one_time' as const,idempotency_key:`promoted-invalid:${randomUUID()}`,
        payment_link_url:'https://buy.stripe.com/test_bonus',promotion_code:f.promotion.promotion_code as string};
      await expect(reservePaymentLink(db!,input)).rejects.toMatchObject({
        code:candidate==='disabled'?'COURSE_BONUS_DISABLED':'PROMOTION_NOT_AUTHORIZED',
      });
      process.env.CENTRAL_CARGA_BONUS_ENABLED='true';
    }
  });

  it('keeps the frozen gift attached when Stripe pays by client_reference_id', async () => {
    const f=await fixture();
    const reserved=await reservePaymentLink(db!,{workspace_id:f.workspace.id,contact_id:f.contact.id,offering_id:f.paid.id,
      conversation_id:f.conversation.id,plan_code:'one_time',idempotency_key:`webhook-bonus:${randomUUID()}`,
      payment_link_url:'https://buy.stripe.com/test_bonus',promotion_code:f.promotion.promotion_code});
    const stripe=new Stripe('sk_test_never_network');
    const secret='whsec_course_bonus_test';
    const payload=JSON.stringify({id:`evt_${randomUUID().replaceAll('-','')}`,object:'event',livemode:false,
      type:'checkout.session.completed',created:Math.floor(Date.now()/1000),data:{object:{object:'checkout.session',
        id:`cs_test_${randomUUID().replaceAll('-','')}`,client_reference_id:reserved.payment_id,mode:'payment',
        payment_status:'paid',amount_total:36000,currency:'usd',metadata:{}}}});
    const signature=stripe.webhooks.generateTestHeaderString({payload,secret});
    expect(await processStripeWebhook(payload,signature,{db:db!,stripe,webhookSecret:secret,expectedEnvironment:'test'}))
      .toMatchObject({status:200,body:{outcome:'applied',status:'paid'},verifiedPaymentId:reserved.payment_id});
    expect(await db!`SELECT offering_code_snapshot FROM payment_bonus_offerings WHERE payment_id=${reserved.payment_id}`)
      .toEqual([{offering_code_snapshot:f.bonus.code}]);
  });
});
