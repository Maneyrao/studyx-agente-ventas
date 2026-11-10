import { randomUUID } from 'node:crypto';
import { afterAll, describe, it, expect } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { claimNotification, deliverNotification, dispatchNotifications, releaseNotification } from '@/features/fulfillment/post-sale/service';
import { runEnrollmentWorker } from '@/features/fulfillment/central-carga/worker';
import { loadLatestPaymentVerificationV1 } from '@/features/payments/application/read-payment-verification';
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());
import { postSaleAccessTestConfig } from '../helpers/post-sale-config';
const config = { accessTemplate: postSaleAccessTestConfig, enabled: true, environment: 'test' as const, paidAfter: new Date('2026-10-09T00:00:00Z') };
async function fixture(environment = 'test', options: { bonus?: boolean } = {}) {
  const suffix = randomUUID();
  const [w] = await db!`INSERT INTO workspaces(slug,display_name) VALUES (${suffix}, 'StudyX') RETURNING id`;
  const [c] = await db!`INSERT INTO contacts(phone,status,channel_origin,name,email)
    VALUES (${`+54911${Math.floor(10000000 + Math.random()*89999999)}`},'prospecto','whatsapp','Ana Prueba','ana@example.com') RETURNING id`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id) VALUES (${w.id},${c.id})`;
  const [o] = await db!`INSERT INTO offerings(workspace_id,code,display_name,status,description,price_type,price_amount,currency,billing_interval) VALUES (${w.id},'TEST','Curso Prueba','active','Prueba','fixed',360,'USD','one_time') RETURNING id`;
  const [t] = await db!`INSERT INTO channel_threads(contact_id,provider,integration_id,channel,external_conversation_id,metadata)
    VALUES (${c.id},'botpress','whatsapp','whatsapp',${suffix},${db!.json({botpress_conversation_id: suffix})}) RETURNING id`;
  const [v] = await db!`INSERT INTO conversations(contact_id,channel,channel_thread_id) VALUES (${c.id},'whatsapp',${t.id}) RETURNING id`;
  let promotion: { id: string; promotion_code: string } | undefined;
  let bonus: { id: string; code: string; display_name: string } | undefined;
  if (options.bonus) {
    [bonus] = await db!`INSERT INTO offerings(workspace_id,code,display_name,status,description,price_type)
      VALUES (${w.id},${`BONUS-${suffix.slice(0,8)}`},'Inglés 2','active','Continuación','free') RETURNING id,code,display_name`;
    [promotion] = await db!`INSERT INTO promotions(workspace_id,promotion_code,paid_offering_id,channels,active)
      VALUES (${w.id},${`promo-${suffix.slice(0,8)}`},${o.id},ARRAY['text']::text[],true) RETURNING id,promotion_code`;
    if (!promotion || !bonus) throw new Error('bonus fixture creation failed');
    await db!`INSERT INTO promotion_bonus_offerings(promotion_id,workspace_id,offering_id,position)
      VALUES (${promotion.id},${w.id},${bonus.id},1)`;
  }
  const [p] = await db!`INSERT INTO payments(workspace_id,contact_id,offering_id,amount,currency,status,provider,environment,checkout_mode,
    idempotency_key,provider_session_id,plan_code,registration_email,registration_name,source_conversation_id)
    VALUES (${w.id},${c.id},${o.id},'360.00','USD',${options.bonus ? 'reserved' : 'pending'},'stripe',${environment},'payment',${suffix},${`cs_test_${suffix}`},
      'one_time','ana@example.com','Ana Prueba',${v.id}) RETURNING id`;
  if (bonus && promotion) {
    await db!`INSERT INTO payment_bonus_offerings(payment_id,promotion_id,offering_id,promotion_code_snapshot,
      offering_code_snapshot,offering_display_name_snapshot,position)
      VALUES (${p.id},${promotion.id},${bonus.id},${promotion.promotion_code},${bonus.code},${bonus.display_name},1)`;
    await db!`UPDATE payments SET status='creating_checkout' WHERE id=${p.id}`;
    await db!`UPDATE payments SET status='pending' WHERE id=${p.id}`;
  }
  await db!`UPDATE payments SET status='paid',paid_at=now() WHERE id=${p.id}`;
  await db!`INSERT INTO fulfillment_jobs(payment_id,workspace_id) VALUES (${p.id},${w.id})`;
  const [n] = await db!`SELECT id FROM post_sale_notifications WHERE payment_id=${p.id} AND kind='payment_received'`;
  return { paymentId: p.id as string, notificationId:n.id as string, botpressId:suffix,
    workspaceSlug:suffix,contactId:c.id as string,
    bonusCode: bonus?.code ?? null, bonusName: bonus?.display_name ?? null };
}
const eventFetch = (async () => new Response(JSON.stringify({event:{id:'event-confirmed'}}),{status:201})) as typeof fetch;
const deps = () => ({ db: db!, config, fetchImpl: eventFetch });
run('post-sale payment / central / Agent A pipeline', () => {
  it('dispatches access-delayed for a partial bonus despite an active paid enrollment', async () => {
    process.env.BOTPRESS_MANAGED_EGRESS_TOKEN='synthetic'; process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID='bot-test';
    const f=await fixture('test',{bonus:true});
    await db!`UPDATE fulfillment_jobs SET max_attempts=1 WHERE payment_id=${f.paymentId}`;
    const fetchImpl=(async () => new Response(JSON.stringify({payment_id:f.paymentId,enrollment_id:'partial-paid',
      student_id:'existing-student',enrollment_status:'already_enrolled',student_was_created:false,
      access:{login_email:'ana@example.com',welcome_sent:false},supports_partial_recovery:true,
      bonus_enrollments:[{offering_code:f.bonusCode,enrollment_status:'failed'}]}),{status:200})) as typeof fetch;
    expect(await runEnrollmentWorker({scoped:true,payment_id:f.paymentId,limit:1},{sql:db!,fetchImpl,
      config:{enabled:true,baseUrl:'https://central.test',signingSecret:'secret-synthetic-123456',
        environment:'test',paidAfter:config.paidAfter,allowSandboxContacts:true}})).toMatchObject({dead_lettered:1});
    expect(await db!`SELECT id FROM post_sale_notifications WHERE payment_id=${f.paymentId} AND kind='access_ready'`).toHaveLength(0);
    expect(await loadLatestPaymentVerificationV1({workspace_slug:f.workspaceSlug,contact_id:f.contactId},db!))
      .toMatchObject({status:'paid',fulfillment:null});
    expect(await dispatchNotifications(f.paymentId,deps())).toEqual({dispatched:1});
    const [delayed]=await db!`SELECT id FROM post_sale_notifications WHERE payment_id=${f.paymentId} AND kind='access_delayed'`;
    const claim=await claimNotification(delayed.id,f.botpressId,deps());
    expect(claim).toMatchObject({claimed:true,kind:'access_delayed'});
    if (!claim.claimed) throw new Error('delay claim');
    const messages:string[]=[];
    expect(await deliverNotification(delayed.id,{claim_token:claim.claim_token,botpress_conversation_id:f.botpressId,
      narrative:{intro:'Recibimos tu pago. Estamos revisando el alta de tus cursos.',suggestion:''}},
    {...deps(),sender:async (input:{text:string})=>{messages.push(input.text);return {
      outcome:'sent' as const,channel:'whatsapp' as const,providerMessageId:'delay-sent',deliveryId:null,reason:null,
    };}})).toEqual({outcome:'sent'});
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('CURSOS HABILITADOS\n📚 CURSO PRINCIPAL: Curso Prueba');
    expect(messages[0]).not.toContain('🎁 CURSO BONIFICADO:');
    expect(messages[0]).toContain(`El equipo está terminando de habilitar ${f.bonusName}; te avisamos por acá.`);
    expect(messages[0]).toContain('📌 Ingresá con tu usuario y contraseña de siempre: ana@example.com');
    expect(await db!`SELECT payment_id FROM bonus_fulfillment_cases WHERE payment_id=${f.paymentId}`).toHaveLength(1);
    // Recovery reserves a distinct final notice; the partial cannot consume it.
    await db!`INSERT INTO central_bonus_enrollment_items(central_enrollment_id,payment_id,offering_code,enrollment_status,position)
      SELECT id,payment_id,${f.bonusCode},'active',1 FROM central_enrollments WHERE payment_id=${f.paymentId}`;
    const [ready] = await db!`SELECT id FROM post_sale_notifications WHERE payment_id=${f.paymentId} AND kind='access_ready'`;
    expect(ready).toBeDefined();
    expect(await dispatchNotifications(f.paymentId,deps())).toEqual({dispatched:1});
    const recovered = await claimNotification(ready.id,f.botpressId,deps());
    if (!recovered.claimed) throw new Error('recovery claim');
    expect(recovered).toMatchObject({delivery_mode:'access_template',history:[]});
    const recoveryInput={claim_token:recovered.claim_token,botpress_conversation_id:f.botpressId};
    const sender=async(input:{text:string})=>{messages.push(input.text); return {
      outcome:'sent' as const,channel:'whatsapp' as const,providerMessageId:'recovered-sent',deliveryId:null,reason:null,
    };};
    const results=await Promise.all([deliverNotification(ready.id,recoveryInput,{...deps(),sender}),
      deliverNotification(ready.id,recoveryInput,{...deps(),sender})]);
    expect(results.filter(r=>r.outcome==='sent')).toHaveLength(1);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toContain(`🎁 CURSO BONIFICADO: ${f.bonusName}`);
    expect(messages[1]).not.toContain('El equipo está terminando');
    expect(await dispatchNotifications(f.paymentId,deps())).toEqual({dispatched:0});
    expect(await db!`SELECT id FROM bonus_fulfillment_cases WHERE payment_id=${f.paymentId}`).toHaveLength(1);

  });
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
    const auditRedactions:Array<readonly string[]|undefined>=[];
    const deliveryDeps={...deps(),sender:async(input:{text:string;auditRedactions?:readonly string[]})=>{
      messages.push(input.text);
      auditRedactions.push(input.auditRedactions);
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
      },deliveryDeps)).toEqual({outcome:'sent'});

    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(postSaleAccessTestConfig.campusUrl);
    expect(messages[0]).toContain('📌 USUARIO: ana@example.com\n\n📌 CONTRASEÑA: Efixture.123');
    expect(messages[0]).toContain('ADMINISTRACIÓN: admin@example.test');
    expect(auditRedactions).toEqual([[postSaleAccessTestConfig.initialPassword]]);
    const audits=await db!`SELECT payload FROM audit_log WHERE entity_id=${ready.id}::uuid`;
    expect(JSON.stringify(audits)).not.toContain(postSaleAccessTestConfig.initialPassword);
    expect(JSON.stringify(audits)).toContain('[REDACTED]');

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
  it('announces a bonus only after the complete Central v2 result and sends no invoice', async () => {
    process.env.BOTPRESS_MANAGED_EGRESS_TOKEN='synthetic'; process.env.BOTPRESS_MANAGED_EGRESS_BOT_ID='bot-test';
    const f=await fixture('test',{bonus:true});
    const messages:string[]=[];
    const centralFetch=(async (_url:unknown,init?:RequestInit)=>{
      const request=JSON.parse(String(init?.body));
      expect(request).toMatchObject({schema_version:2,bonus_offerings:[{code:f.bonusCode}]});
      return new Response(JSON.stringify({payment_id:f.paymentId,enrollment_id:'enr-v2',student_id:'stu-v2',
        enrollment_status:'active',student_was_created:true,access:{login_email:'ana@example.com',welcome_sent:true},
        bonus_enrollments:[{offering_code:f.bonusCode,enrollment_status:'active'}]}),{status:201});
    }) as typeof fetch;
    const workerConfig={enabled:true as const,baseUrl:'https://central.test',signingSecret:'secret-synthetic-123456',
      environment:'test' as const,paidAfter:config.paidAfter,allowSandboxContacts:true};
    expect(await runEnrollmentWorker({scoped:true,payment_id:f.paymentId,limit:1},
      {sql:db!,config:workerConfig,fetchImpl:centralFetch,bonusConfig:{enabled:false,fulfillmentPaused:false}}))
      .toMatchObject({completed:1});
    const [ready]=await db!`SELECT id FROM post_sale_notifications WHERE payment_id=${f.paymentId} AND kind='access_ready'`;
    expect(await dispatchNotifications(f.paymentId,deps())).toEqual({dispatched:1});
    const claim=await claimNotification(ready.id,f.botpressId,deps()); if(!claim.claimed) throw new Error('ready claim');
    expect(await deliverNotification(ready.id,{claim_token:claim.claim_token,botpress_conversation_id:f.botpressId,
      },
      {...deps(),sender:async(input:{text:string})=>{messages.push(input.text); return {outcome:'sent' as const,
        channel:'whatsapp' as const,providerMessageId:'sent-v2',deliveryId:null,reason:null};}})).toEqual({outcome:'sent'});
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('📚 CURSO PRINCIPAL: Curso Prueba');
    expect(messages[0]).toContain(`🎁 CURSO BONIFICADO: ${f.bonusName}`);
    expect(messages[0]).not.toMatch(/invoice|comprobante/iu);
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
