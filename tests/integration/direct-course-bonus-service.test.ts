import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { acceptDirectCourseBonusV1, offerDirectCourseBonusV1 } from '@/features/promotions/application/direct-course-bonus-service';
import { cancelOpenCourseBonusOffersForCourseChangeV1 } from '@/features/promotions/application/commercial-followup-service';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());
beforeEach(() => {
  vi.stubEnv('COURSE_BONUS_FLOW_MODE', 'direct');
  vi.stubEnv('COURSE_BONUS_MAX_COURSES', '2');
  vi.stubEnv('CENTRAL_CARGA_BONUS_ENABLED', 'true');
});
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const key = randomUUID();
  const [w] = await db!`INSERT INTO workspaces(slug,display_name) VALUES (${key},'Service') RETURNING id`;
  const [c] = await db!`INSERT INTO contacts(phone,channel_origin,status) VALUES
    (${'+' + String(Math.floor(100000000000 + Math.random()*800000000000))},'whatsapp','prospecto') RETURNING id`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id,source_channel) VALUES (${w.id},${c.id},'whatsapp')`;
  const [v] = await db!`INSERT INTO conversations(contact_id,channel) VALUES (${c.id},'whatsapp') RETURNING id`;
  const courses = await db!`INSERT INTO offerings(workspace_id,code,display_name,offering_type,status,description,price_type,price_amount,currency,billing_interval)
    SELECT ${w.id}, ${key} || n,'Course ' || n,'course','active','Course','fixed',360,'USD','annual' FROM generate_series(0,4) n RETURNING id,code`;
  await db!`INSERT INTO conversation_sales_context_states_v1(workspace_id,conversation_id,contact_id,selected_offering_code)
    VALUES (${w.id},${v.id},${c.id},${courses[0].code})`;
  await db!`INSERT INTO promotions(workspace_id,promotion_code,paid_offering_id,channels,active)
    VALUES (${w.id},${key},${courses[0].id},ARRAY['text'],true)`;
  async function inbound(offset: number) {
    const [m] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,created_at)
      VALUES (${v.id},${c.id},'inbound','Customer',now() + ${Math.min(0,offset)} * interval '1 second') RETURNING id`;
    return m.id as string;
  }
  const prior = await inbound(-10);
  await db!`INSERT INTO selected_memories(contact_id,conversation_id,source_message_id,status,memory_type,memory_key,value_normalized,source_quote,confidence,dedupe_hash)
    VALUES (${c.id},${v.id},${prior},'active','objection','price_objection','expensive','Customer',0.9,${'a'.repeat(64)})`;
  const source = await inbound(0);
  const identity = {workspace_id:w.id as string,contact_id:c.id as string,conversation_id:v.id as string,
    paid_offering_code:courses[0].code as string,promotion_code:key,promotion_cycle_id:randomUUID()};
  function input(turn=source, course=1, version=0) {
    const id=randomUUID();
    return {...identity,source_turn_id:turn,expected_offer_version:version,bonus_offering_codes:[courses[course].code as string],
      outbound:{id,content:'Bonus',provider:'test',integration_id:'test',channel:'whatsapp',destination:'test',idempotency_key:id}};
  }
  async function deliver(id: string) {
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=now() WHERE message_id=${id}`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=now() WHERE message_id=${id}`;
  }
  return {w,c,v,courses,identity,source,inbound,input,deliver};
}

run('atomic direct bonus service', () => {
  it('runs inside the production-role turn transaction and rolls back a refused append to its savepoint',async()=>{
    const f=await fixture();const first={...f.input(),promotion_code:undefined,promotion_cycle_id:undefined};
    const turn=await f.inbound(2);
    await db!.begin(async tx=>{
      await tx`SET LOCAL ROLE orchestrator_role`;
      const result=await offerDirectCourseBonusV1(tx,first);
      expect(result).toMatchObject({ok:true,offer_version:1});if(!result.ok) throw new Error('missing result');
      const second={...f.input(turn,2,1),promotion_code:result.promotion_code,promotion_cycle_id:result.promotion_cycle_id};
      expect(await offerDirectCourseBonusV1(tx,second)).toEqual({ok:false,reason:'bonus_without_reply'});
      expect((await tx`SELECT count(*)::int AS n FROM messages WHERE id=${second.outbound.id}`)[0].n).toBe(0);
      expect((await tx`SELECT count(*)::int AS n FROM promotion_offer_bonus_offerings WHERE offer_id=${result.offer_id}`)[0].n).toBe(1);
    });
  });

  it('rejects an empty reply without persisting an offer',async()=>{
    const f=await fixture();const input=f.input();input.outbound.content=' ';
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual({ok:false,reason:'bonus_without_reply'});
  });

  it('returns the original durable result after catalog deactivation and sanitizes a conflicting delivery key',async()=>{
    const f=await fixture();const input=f.input();const result=await offerDirectCourseBonusV1(db!,input);
    await db!`UPDATE offerings SET status='inactive' WHERE id=${f.courses[0].id}`;
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual(result);
    const other=await fixture();const conflict=other.input();conflict.outbound.idempotency_key=input.outbound.idempotency_key;
    expect(await offerDirectCourseBonusV1(db!,conflict)).toEqual({ok:false,reason:'stale_offer_version'});
    expect((await db!`SELECT count(*)::int AS n FROM messages WHERE id=${conflict.outbound.id}`)[0].n).toBe(0);
  });

  it('creates an internal promotion and cycle without commercial identifiers and replays after cancellation',async()=>{
    const f=await fixture();const input={...f.input(),promotion_code:undefined,promotion_cycle_id:undefined};
    await db!`DELETE FROM promotions WHERE promotion_code=${f.identity.promotion_code}`;
    const result=await offerDirectCourseBonusV1(db!,input);
    expect(result).toMatchObject({ok:true,offer_version:1});if(!result.ok) throw new Error('missing result');
    expect(result.promotion_code).toMatch(/^any_bonus_/u);
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual(result);
    await db!`UPDATE promotion_offers SET status='cancelled',cancel_reason='COURSE_CHANGED' WHERE id=${result.offer_id}`;
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual(result);
  });

  it('requires committed prior evidence rather than the current objection or another conversation',async()=>{
    const f=await fixture();
    await db!`UPDATE selected_memories SET source_message_id=${f.source} WHERE conversation_id=${f.v.id}`;
    expect(await offerDirectCourseBonusV1(db!,f.input())).toEqual({ok:false,reason:'no_price_objection'});
    await db!`UPDATE selected_memories SET source_message_id=${f.source},status='proposed' WHERE conversation_id=${f.v.id}`;
    expect(await offerDirectCourseBonusV1(db!,f.input())).toEqual({ok:false,reason:'no_price_objection'});
  });

  it('revalidates workspace, selected course, cycle and promotion identities',async()=>{
    const f=await fixture();const first=f.input();await offerDirectCourseBonusV1(db!,first);await f.deliver(first.outbound.id);
    const next=f.input(await f.inbound(2),2,1);
    for(const mutation of [{promotion_cycle_id:randomUUID()},{promotion_code:'wrong'}]) {
      expect(await offerDirectCourseBonusV1(db!,{...next,...mutation})).toEqual({ok:false,reason:'stale_offer_version'});
      expect(await acceptDirectCourseBonusV1(db!,{...f.identity,source_turn_id:next.source_turn_id,expected_offer_version:1,...mutation}))
        .toEqual({ok:false,reason:'stale_offer_version'});
    }
    expect(await offerDirectCourseBonusV1(db!,{...next,workspace_id:randomUUID()})).toEqual({ok:false,reason:'invalid_offering'});
    await db!`UPDATE conversation_sales_context_states_v1 SET selected_offering_code=${f.courses[4].code} WHERE conversation_id=${f.v.id}`;
    expect(await offerDirectCourseBonusV1(db!,next)).toEqual({ok:false,reason:'invalid_offering'});
  });

  it('enforces max one and allows three only with explicit authorization; stale acceptance does not seal an extended package',async()=>{
    const f=await fixture();const first=f.input();await offerDirectCourseBonusV1(db!,first);await f.deliver(first.outbound.id);
    vi.stubEnv('COURSE_BONUS_MAX_COURSES','1');const second=f.input(await f.inbound(2),2,1);
    expect(await offerDirectCourseBonusV1(db!,second)).toEqual({ok:false,reason:'bonus_limit_reached'});
    vi.stubEnv('COURSE_BONUS_MAX_COURSES','3');
    const result=await offerDirectCourseBonusV1(db!,second);expect(result).toMatchObject({ok:true,offer_version:2});
    await f.deliver(second.outbound.id);
    const third=f.input(await f.inbound(3),3,2);
    expect(await offerDirectCourseBonusV1(db!,third)).toMatchObject({ok:true,offer_version:3});
    await f.deliver(third.outbound.id);
    const accept={...f.identity,source_turn_id:await f.inbound(4),expected_offer_version:2};
    expect(await acceptDirectCourseBonusV1(db!,accept)).toEqual({ok:false,reason:'stale_offer_version'});
    expect(await acceptDirectCourseBonusV1(db!,{...accept,expected_offer_version:3})).toMatchObject({ok:true,offer_version:3});
    expect(await offerDirectCourseBonusV1(db!,first)).toMatchObject({ok:true,offer_version:1,outbound_message_id:first.outbound.id});
  });

  it('persists one durable result, replays exactly, seals delivered current version and preserves accepted obligations', async () => {
    const f=await fixture();const input=f.input();
    const result=await offerDirectCourseBonusV1(db!,input);
    expect(result).toMatchObject({ok:true,offer_version:1,outbound_message_id:input.outbound.id});
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual(result);
    expect(await offerDirectCourseBonusV1(db!,{...input,outbound:{...input.outbound,content:'Different'}}))
      .toMatchObject({ok:false,reason:'multiple_bonus_in_turn'});
    await f.deliver(input.outbound.id);
    const turn=await f.inbound(2);const accept={...f.identity,source_turn_id:turn,expected_offer_version:1};
    expect(await acceptDirectCourseBonusV1(db!,{...accept,expected_offer_version:0})).toEqual({ok:false,reason:'stale_offer_version'});
    const accepted=await acceptDirectCourseBonusV1(db!,accept);
    expect(accepted).toMatchObject({ok:true,offer_version:1});
    expect(await acceptDirectCourseBonusV1(db!,accept)).toEqual(accepted);
    expect(await acceptDirectCourseBonusV1(db!,{...accept,source_turn_id:await f.inbound(3)}))
      .toEqual({ok:false,reason:'sale_already_closed'});
    const [row]=await db!`SELECT status,bonus_snapshot_sealed_at FROM promotion_offers WHERE promotion_cycle_id=${f.identity.promotion_cycle_id}`;
    expect(row.status).toBe('accepted');expect(row.bonus_snapshot_sealed_at).toBeInstanceOf(Date);
    expect(await cancelOpenCourseBonusOffersForCourseChangeV1(db!,{...f.identity,selected_offering_code:f.courses[4].code})).toBe(0);
    expect((await db!`SELECT count(*)::int AS count FROM messages WHERE id=${input.outbound.id}`)[0].count).toBe(1);
  });

  it.each(['no_price_objection','invalid_offering','same_as_paid_course','multiple_bonus_in_turn','sale_already_closed','stale_offer_version'] as const)
  ('rejects %s before writing a cycle or outbound', async reason => {
    const f=await fixture();const input=f.input();
    if(reason==='no_price_objection') await db!`DELETE FROM selected_memories WHERE conversation_id=${f.v.id}`;
    if(reason==='invalid_offering') input.bonus_offering_codes=['missing'];
    if(reason==='same_as_paid_course') input.bonus_offering_codes=[f.courses[0].code];
    if(reason==='multiple_bonus_in_turn') input.bonus_offering_codes.push(f.courses[2].code);
    if(reason==='sale_already_closed') await db!`UPDATE conversation_sales_context_states_v1 SET stage='closed' WHERE conversation_id=${f.v.id}`;
    if(reason==='stale_offer_version') input.expected_offer_version=1;
    expect(await offerDirectCourseBonusV1(db!,input)).toEqual({ok:false,reason});
    expect((await db!`SELECT count(*)::int AS n FROM promotion_offers WHERE promotion_cycle_id=${f.identity.promotion_cycle_id}`)[0].n).toBe(0);
    expect((await db!`SELECT count(*)::int AS n FROM messages WHERE id=${input.outbound.id}`)[0].n).toBe(0);
  });

  it.each(['pending','submitted','failed_retryable','dead_letter','early'] as const)('refuses append and acceptance with %s delivery evidence',async state=>{
    const f=await fixture();const first=f.input();await offerDirectCourseBonusV1(db!,first);
    const turn=await f.inbound(2);
    if(state==='submitted') {
      await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${first.outbound.id}`;
      await db!`UPDATE outbound_deliveries SET state='submitted' WHERE message_id=${first.outbound.id}`;
    }
    if(state==='dead_letter') await db!`UPDATE outbound_deliveries SET state='dead_letter' WHERE message_id=${first.outbound.id}`;
    if(state==='failed_retryable') {
      await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${first.outbound.id}`;
      await db!`UPDATE outbound_deliveries SET state='failed_retryable' WHERE message_id=${first.outbound.id}`;
    }
    if(state==='early') {
      await db!`UPDATE messages SET metadata=${db!.json({occurred_at_trusted:true,occurred_at:new Date(Date.now()-5000).toISOString()})} WHERE id=${turn}`;
      await f.deliver(first.outbound.id);
    }
    const next=f.input(turn,2,1);
    expect(await offerDirectCourseBonusV1(db!,next)).toEqual({ok:false,reason:'bonus_without_reply'});
    expect(await acceptDirectCourseBonusV1(db!,{...f.identity,source_turn_id:turn,expected_offer_version:1}))
      .toEqual({ok:false,reason:'bonus_without_reply'});
    expect((await db!`SELECT count(*)::int AS n FROM messages WHERE id=${next.outbound.id}`)[0].n).toBe(0);
  });

  it('rejects duplicate gifts and serializes independent contenders at the runtime limit',async()=>{
    const f=await fixture();const first=f.input();await offerDirectCourseBonusV1(db!,first);await f.deliver(first.outbound.id);
    const turn=await f.inbound(2);
    expect(await offerDirectCourseBonusV1(db!,f.input(turn,1,1))).toEqual({ok:false,reason:'duplicate_bonus'});
    const independent=openLocalTestDatabase();
    try {
      const results=await Promise.all([offerDirectCourseBonusV1(db!,f.input(turn,2,1)),offerDirectCourseBonusV1(independent,f.input(turn,3,1))]);
      expect(results.filter(r=>r.ok), JSON.stringify(results)).toHaveLength(1);
      expect(results.filter(r=>!r.ok)).toEqual([{ok:false,reason:'stale_offer_version'}]);
      const success=results.find(r=>r.ok)!;if(!success.ok) throw new Error('missing result');
      await f.deliver(success.outbound_message_id);
      expect(await offerDirectCourseBonusV1(db!,f.input(await f.inbound(3),4,2))).toEqual({ok:false,reason:'bonus_limit_reached'});
      expect((await db!`SELECT count(*)::int AS n FROM promotion_offer_bonus_offerings WHERE offer_id=${success.offer_id}`)[0].n).toBe(2);
    } finally {await independent.end();}
  });
});
