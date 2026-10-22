import { randomUUID } from 'node:crypto';
import { afterAll, describe, it, expect } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { claimNotification, deliverNotification, dispatchNotifications, releaseNotification } from '@/features/fulfillment/post-sale/service';
import { runEnrollmentWorker } from '@/features/fulfillment/central-carga/worker';
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());
const config = { enabled: true, environment: 'test' as const, paidAfter: new Date('2026-10-09T00:00:00Z') };
async function fixture(environment = 'test') {
  const suffix = randomUUID();
  const [w] = await db!`INSERT INTO workspaces(slug,display_name) VALUES (${suffix}, 'StudyX') RETURNING id`;
  const [c] = await db!`INSERT INTO contacts(phone,status,channel_origin,name,email)
    VALUES (${`+54911${Math.floor(10000000 + Math.random()*89999999)}`},'prospecto','whatsapp','Ana Prueba','ana@example.com') RETURNING id`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id) VALUES (${w.id},${c.id})`;
  const [o] = await db!`INSERT INTO offerings(workspace_id,code,display_name,status,description,price_type,price_amount,currency,billing_interval) VALUES (${w.id},'TEST','Curso Prueba','active','Prueba','fixed',360,'USD','one_time') RETURNING id`;
  const [t] = await db!`INSERT INTO channel_threads(contact_id,provider,integration_id,channel,external_conversation_id,metadata)
    VALUES (${c.id},'botpress','whatsapp','whatsapp',${suffix},${db!.json({botpress_conversation_id: suffix})}) RETURNING id`;
  const [v] = await db!`INSERT INTO conversations(contact_id,channel,channel_thread_id) VALUES (${c.id},'whatsapp',${t.id}) RETURNING id`;
  const [p] = await db!`INSERT INTO payments(workspace_id,contact_id,offering_id,amount,currency,status,provider,environment,checkout_mode,
    idempotency_key,provider_session_id,plan_code,registration_email,registration_name,source_conversation_id)
    VALUES (${w.id},${c.id},${o.id},'360.00','USD','pending','stripe',${environment},'payment',${suffix},${`cs_test_${suffix}`},
      'one_time','ana@example.com','Ana Prueba',${v.id}) RETURNING id`;
  await db!`UPDATE payments SET status='paid',paid_at=now() WHERE id=${p.id}`;
  await db!`INSERT INTO fulfillment_jobs(payment_id,workspace_id) VALUES (${p.id},${w.id})`;
  const [n] = await db!`SELECT id FROM post_sale_notifications WHERE payment_id=${p.id} AND kind='payment_received'`;
  return { paymentId: p.id as string, notificationId:n.id as string, botpressId:suffix };
}
const eventFetch = (async () => new Response(JSON.stringify({event:{id:'event-confirmed'}}),{status:201})) as typeof fetch;
const deps = () => ({ db: db!, config, fetchImpl: eventFetch });
run('post-sale payment / central / Agent A pipeline', () => {
  it('does not dispatch another environment; concurrent events have one claimant and one send', async () => {
    process.env.BOTPRESS_MANAGED_EGRESS_TOKEN='synthetic'; process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID='bot-test';
    const live=await fixture('live');
    expect(await dispatchNotifications(live.paymentId,deps())).toEqual({dispatched:0});
    const f=await fixture();
    const results=await Promise.all([dispatchNotifications(f.paymentId,deps()),dispatchNotifications(f.paymentId,deps())]);
    expect(results.reduce((n,x)=>n+x.dispatched,0)).toBe(1);
    expect(await claimNotification(f.notificationId,'wrong-conversation',deps())).toEqual({claimed:false});
    const claims=await Promise.all([claimNotification(f.notificationId,f.botpressId,deps()),claimNotification(f.notificationId,f.botpressId,deps())]);
    expect(claims.filter(x=>x.claimed)).toHaveLength(1);
    const claimed=claims.find(x=>x.claimed)!; if(!claimed.claimed) throw new Error('claim');
    let sends=0;
    const deliveryDeps={...deps(),sender:async()=>{ sends++; return {outcome:'sent' as const,channel:'whatsapp' as const,providerMessageId:'sent',deliveryId:null,reason:null}; }};
    const input={claim_token:claimed.claim_token,botpress_conversation_id:f.botpressId,narrative:{intro:'Recibimos tu pago, estamos preparando tu acceso.',suggestion:''}};
    const sent=await Promise.all([deliverNotification(f.notificationId,input,deliveryDeps),deliverNotification(f.notificationId,input,deliveryDeps)]);
    expect(sends).toBe(1); expect(sent.some(x=>x.outcome==='sent')).toBe(true);
    await db!`UPDATE payments SET status='paid' WHERE id=${f.paymentId}`;
    expect(await db!`SELECT id FROM post_sale_notifications WHERE payment_id=${f.paymentId}`).toHaveLength(1);
  });
  it('coalesces immediate payment and enrollment into one access message', async () => {
    process.env.BOTPRESS_MANAGED_EGRESS_TOKEN='synthetic'; process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID='bot-test';
    const f=await fixture();
    const messages:string[]=[];
    const deliveryDeps={...deps(),sender:async(input:{text:string})=>{
      messages.push(input.text);
      return {outcome:'sent' as const,channel:'whatsapp' as const,providerMessageId:`sent-${messages.length}`,deliveryId:null,reason:null};
    }};
    const centralFetch=(async (_url:unknown,init?:RequestInit)=>{
      const body=JSON.parse(String(init?.body));
      expect(body.student.email).toBe('ana@example.com'); expect(body.environment).toBe('test');
      return new Response(JSON.stringify({payment_id:f.paymentId,enrollment_id:'enr-test',student_id:'stu-test',enrollment_status:'active',student_was_created:true,
        access:{login_email:'ana@example.com',welcome_sent:false}}),{status:201});
    }) as typeof fetch;
    const workerConfig={enabled:true as const,baseUrl:'https://central.test',signingSecret:'secret-synthetic-123456',environment:'test' as const,paidAfter:config.paidAfter,allowSandboxContacts:true};
    expect(await runEnrollmentWorker({scoped:true,payment_id:f.paymentId,limit:1},{sql:db!,config:workerConfig,fetchImpl:centralFetch})).toMatchObject({completed:1});
    const [ready]=await db!`SELECT id,status FROM post_sale_notifications WHERE payment_id=${f.paymentId} AND kind='access_ready'`;
    expect(ready.status).toBe('pending');
    expect(await dispatchNotifications(f.paymentId,deps())).toEqual({dispatched:1});
    const claim=await claimNotification(ready.id,f.botpressId,deps()); if(!claim.claimed) throw new Error('ready claim');
    expect(await deliverNotification(ready.id,{claim_token:claim.claim_token,botpress_conversation_id:f.botpressId,
      narrative:{intro:'Ya tienes acceso a tu curso.',suggestion:'Si quieres, puedes cambiar tu contraseña.'}},deliveryDeps)).toEqual({outcome:'sent'});

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('LINK DIRECTO AL CAMPUS VIRTUAL 👇🏻\n\nhttps://mystudyx.com/campus-virtual');
    expect(messages[0]).toContain('📌 USUARIO: ana@example.com\n\n📌 CONTRASEÑA: Escuela.123');
    expect(messages[0]).toContain('ADMINISTRACIÓN: info@mystudyx.com');
    expect(await db!`SELECT kind,status FROM post_sale_notifications WHERE payment_id=${f.paymentId} ORDER BY kind`).toEqual([
      {kind:'access_ready',status:'sent'},
      {kind:'payment_received',status:'cancelled'},
    ]);
    expect(await db!`SELECT id FROM central_enrollments WHERE payment_id=${f.paymentId}`).toHaveLength(1);

    expect(await runEnrollmentWorker({scoped:true,payment_id:f.paymentId,limit:1},{sql:db!,config:workerConfig,fetchImpl:centralFetch})).toMatchObject({claimed:0,completed:0});
    expect(await dispatchNotifications(f.paymentId,deps())).toEqual({dispatched:0});
    expect(messages).toHaveLength(1);
    expect(await db!`SELECT id FROM central_enrollments WHERE payment_id=${f.paymentId}`).toHaveLength(1);
  });
  it('reuses the same claim after invalid model prose and sends the safe fallback once', async () => {
    const f=await fixture(); await dispatchNotifications(f.paymentId,deps());
    const claim=await claimNotification(f.notificationId,f.botpressId,deps()); if(!claim.claimed) throw new Error('claim');
    let sends=0;
    const deliveryDeps={...deps(),sender:async()=>{ sends++; return {outcome:'sent' as const,channel:'whatsapp' as const,providerMessageId:'sent-safe',deliveryId:null,reason:null}; }};
    expect(await deliverNotification(f.notificationId,{claim_token:claim.claim_token,botpress_conversation_id:f.botpressId,
      narrative:{intro:'Tu contraseña es ClaveInventada99',suggestion:''}},deliveryDeps))
      .toEqual({outcome:'invalid_content',reason:'POST_SALE_UNAUTHORIZED_PROSE'});
    expect(await deliverNotification(f.notificationId,{claim_token:claim.claim_token,botpress_conversation_id:f.botpressId,
      narrative:{intro:'El curso sale USD 47.',suggestion:''}},deliveryDeps))
      .toEqual({outcome:'invalid_content',reason:'POST_SALE_EGRESS_INVALID'});
    expect(await deliverNotification(f.notificationId,{claim_token:claim.claim_token,botpress_conversation_id:f.botpressId,
      narrative:{intro:'Recibimos tu pago. Estoy preparando tu acceso.',suggestion:''}},deliveryDeps))
      .toEqual({outcome:'sent'});
    expect(sends).toBe(1);
  });
  it('releases failed generation but holds ambiguous delivery without resending', async () => {
    const f=await fixture(); await dispatchNotifications(f.paymentId,deps());
    const first=await claimNotification(f.notificationId,f.botpressId,deps()); if(!first.claimed) throw new Error('claim');
    await releaseNotification(f.notificationId,first.claim_token,deps());
    await db!`UPDATE post_sale_notifications SET available_at=now() WHERE id=${f.notificationId}`;
    await dispatchNotifications(f.paymentId,deps());
    const claim=await claimNotification(f.notificationId,f.botpressId,deps()); if(!claim.claimed) throw new Error('claim');
    expect(await deliverNotification(f.notificationId,{claim_token:claim.claim_token,botpress_conversation_id:f.botpressId,narrative:{intro:'Recibimos tu pago.',suggestion:''}},
      {...deps(),sender:async()=>{throw new Error('connection lost');}})).toEqual({outcome:'ambiguous'});
    expect(await dispatchNotifications(f.paymentId,deps())).toEqual({dispatched:0});
  });
});
