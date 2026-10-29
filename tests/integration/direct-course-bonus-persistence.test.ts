import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

async function fixture() {
  const key = randomUUID();
  const [w] = await db!`INSERT INTO workspaces(slug,display_name) VALUES (${key},'Direct bonus') RETURNING id`;
  const phone = `+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const [c] = await db!`INSERT INTO contacts(phone,channel_origin,status) VALUES (${phone},'whatsapp','prospecto') RETURNING id`;
  await db!`INSERT INTO workspace_contacts(workspace_id,contact_id,source_channel) VALUES (${w.id},${c.id},'whatsapp')`;
  const [v] = await db!`INSERT INTO conversations(contact_id,channel) VALUES (${c.id},'whatsapp') RETURNING id`;
  const courses = await db!`INSERT INTO offerings(workspace_id,code,display_name,offering_type,status,description,price_type,price_amount,currency,billing_interval)
    SELECT ${w.id}, ${key} || n, 'Course ' || n,'course','active','Course','fixed',360,'USD','annual' FROM generate_series(0,4) n RETURNING id,code`;
  await db!`INSERT INTO conversation_sales_context_states_v1(workspace_id,conversation_id,contact_id,selected_offering_code)
    VALUES (${w.id},${v.id},${c.id},${courses[0].code})`;
  const [p] = await db!`INSERT INTO promotions(workspace_id,promotion_code,paid_offering_id,channels,active)
    VALUES (${w.id},${key},${courses[0].id},ARRAY['text'],true) RETURNING id`;
  // Direct selections are workspace-local catalog courses; legacy configured slots do not limit selection order.
  async function offer() {
    const [o] = await db!`INSERT INTO promotion_offers(workspace_id,contact_id,conversation_id,promotion_id,paid_offering_id,package_mode)
      VALUES (${w.id},${c.id},${v.id},${p.id},${courses[0].id},'direct') RETURNING *`;
    return o;
  }
  async function inbound(at: string) {
    const [m] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,created_at)
      VALUES (${v.id},${c.id},'inbound','Customer',${at}) RETURNING id`;
    return m.id as string;
  }
  async function outbound(source: string, partIndex=0) {
    const [m] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,in_reply_to,created_at,part_index)
      SELECT ${v.id},${c.id},'outbound','Bonus',${source},created_at + interval '100 milliseconds',${partIndex} FROM messages WHERE id=${source} RETURNING id`;
    await db!`INSERT INTO outbound_deliveries(message_id,conversation_id,contact_id,provider,integration_id,channel,destination,idempotency_key)
      VALUES (${m.id},${v.id},${c.id},'test','test','whatsapp','test',${m.id})`;
    return m.id as string;
  }
  async function append(id: string, course: number, source: string, out: string, version: number) {
    return db!`SELECT append_direct_course_bonus(${id}::uuid,${courses[course].id}::uuid,${source}::uuid,${out}::uuid,${version}::integer)`;
  }
  async function deliver(out: string, at = '2026-10-28T12:00:01Z') {
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${out}`;
    await db!`UPDATE outbound_deliveries SET state='submitted',submitted_at=${at} WHERE message_id=${out}`;
    await db!`UPDATE outbound_deliveries SET state='delivered',delivered_at=${at} WHERE message_id=${out}`;
  }
  return { w,c,v,p,courses,offer,inbound,outbound,append,deliver };
}

run('direct append-only bonus persistence', () => {
  it('appends three ordered versions after confirmed delivery and later distinct customer turns, then seals acceptance', async () => {
    const f = await fixture(); const o = await f.offer();
    const t1 = await f.inbound('2026-10-28T12:00:00Z'); const m1 = await f.outbound(t1);
    await f.append(o.id,1,t1,m1,0);
    const [first] = await db!`SELECT offer_version,bonus_snapshot_sealed_at FROM promotion_offers WHERE id=${o.id}`;
    expect(first).toMatchObject({offer_version:1,bonus_snapshot_sealed_at:null});
    await f.deliver(m1);
    const t2 = await f.inbound('2026-10-28T12:00:02Z'); const m2 = await f.outbound(t2);
    await f.append(o.id,2,t2,m2,1); await f.deliver(m2,'2026-10-28T12:00:03Z');
    const t3 = await f.inbound('2026-10-28T12:00:04Z'); const m3 = await f.outbound(t3);
    await f.append(o.id,3,t3,m3,2); await f.deliver(m3,'2026-10-28T12:00:05Z');
    const rows = await db!`SELECT position,offer_version,source_turn_id,delivered_at FROM promotion_offer_bonus_offerings WHERE offer_id=${o.id} ORDER BY position`;
    expect(rows.map(r=>r.position)).toEqual([1,2,3]);
    expect(rows.map(r=>r.offer_version)).toEqual([1,2,3]);
    expect(rows.map(r=>r.source_turn_id)).toEqual([t1,t2,t3]);
    expect(rows.every(r=>r.delivered_at instanceof Date)).toBe(true);
    const t4 = await f.inbound('2026-10-28T12:00:06Z'); const m4 = await f.outbound(t4);
    await expect(f.append(o.id,4,t4,m4,3)).rejects.toThrow(/limit/i);
    await expect(db!`SELECT accept_direct_course_bonus(${o.id}::uuid,${t4}::uuid,2)`).rejects.toThrow(/version/i);
    await db!`SELECT accept_direct_course_bonus(${o.id}::uuid,${t4}::uuid,3)`;
    const [sealed] = await db!`SELECT status,bonus_snapshot_sealed_at FROM promotion_offers WHERE id=${o.id}`;
    expect(sealed.status).toBe('accepted'); expect(sealed.bonus_snapshot_sealed_at).toBeInstanceOf(Date);
    await expect(f.append(o.id,4,t4,m4,3)).rejects.toThrow(/sealed/i);
    await expect(db!`UPDATE promotion_offer_bonus_offerings SET position=1 WHERE offer_id=${o.id}`).rejects.toThrow(/immutable/i);
    await expect(db!`UPDATE promotion_offers SET status='cancelled' WHERE id=${o.id}`).rejects.toThrow(/immutable/i);
  });

  it.each(['pending','submitted','dead_letter'])('refuses extension and acceptance when delivery is %s', async state => {
    const f=await fixture(); const o=await f.offer(); const t=await f.inbound('2026-10-28T12:00:00Z'); const m=await f.outbound(t);
    await f.append(o.id,1,t,m,0);
    if (state==='submitted') await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${m}`;
    await db!`UPDATE outbound_deliveries SET state=${state},submitted_at=now() WHERE message_id=${m}`;
    const next=await f.inbound('2026-10-28T12:01:00Z'); const out=await f.outbound(next);
    await expect(f.append(o.id,2,next,out,1)).rejects.toThrow(/delivery/i);
    await expect(db!`SELECT accept_direct_course_bonus(${o.id}::uuid,${next}::uuid,1)`).rejects.toThrow(/delivery/i);
    await expect(db!`UPDATE promotion_offers SET status='accepted',accepted_at=now() WHERE id=${o.id}`).rejects.toThrow();
  });

  it('rejects duplicate courses, repeated source turns, stale versions and inbound turns preceding delivery', async()=>{
    const f=await fixture(); const o=await f.offer(); const t=await f.inbound('2026-10-28T12:00:00Z'); const m=await f.outbound(t);
    await f.append(o.id,1,t,m,0); await f.deliver(m);
    await expect(f.append(o.id,2,t,m,1)).rejects.toThrow(/turn/i);
    const early=await f.inbound('2026-10-28T12:00:00.500Z'); const earlyOut=await f.outbound(early);
    await expect(f.append(o.id,2,early,earlyOut,1)).rejects.toThrow(/later/i);
    await expect(db!`SELECT accept_direct_course_bonus(${o.id}::uuid,${early}::uuid,1)`).rejects.toThrow(/later/i);
    const next=await f.inbound('2026-10-28T12:00:02Z'); const out=await f.outbound(next);
    await expect(f.append(o.id,1,next,out,1)).rejects.toThrow(/duplicate/i);
    await expect(f.append(o.id,2,next,out,0)).rejects.toThrow(/version/i);
    await expect(db!`DELETE FROM promotion_offer_bonus_offerings WHERE offer_id=${o.id}`).rejects.toThrow(/immutable/i);
  });

  it.each(['extension','acceptance'])('rejects %s from a customer message occurring before delivery but ingested afterward',async action=>{
    const f=await fixture();const o=await f.offer();const first=await f.inbound('2026-10-28T12:00:00Z');const offered=await f.outbound(first);
    await f.append(o.id,1,first,offered,0);await f.deliver(offered);
    const delayed=await f.inbound('2026-10-28T12:00:02Z');
    await db!`UPDATE messages SET metadata=${db!.json({occurred_at_trusted:true,occurred_at:'2026-10-28T12:00:00.500Z'})} WHERE id=${delayed}`;
    if(action==='extension') {
      const reply=await f.outbound(delayed);
      await expect(f.append(o.id,2,delayed,reply,1)).rejects.toThrow(/later/i);
    } else {
      await expect(db!`SELECT accept_direct_course_bonus(${o.id}::uuid,${delayed}::uuid,1)`).rejects.toThrow(/later/i);
    }
    const [unchanged]=await db!`SELECT status,offer_version,bonus_snapshot_sealed_at FROM promotion_offers WHERE id=${o.id}`;
    expect(unchanged).toMatchObject({status:'offered',offer_version:1,bonus_snapshot_sealed_at:null});
  });

  it('retains cancelled history and creates a distinct cycle after switching away and back',async()=>{
    const f=await fixture();const o=await f.offer();const t=await f.inbound('2026-10-28T12:00:00Z');const m=await f.outbound(t);
    await f.append(o.id,1,t,m,0);
    await db!`UPDATE promotion_offers SET status='cancelled',cancel_reason='INTEREST_CHANGED' WHERE id=${o.id}`;
    await expect(f.append(o.id,2,t,m,1)).rejects.toThrow(/closed/i);
    const fresh=await f.offer();expect(fresh.promotion_cycle_id).not.toBe(o.promotion_cycle_id);
    expect(fresh.offer_version).toBe(0);
    expect((await db!`SELECT id FROM promotion_offer_bonus_offerings WHERE offer_id=${o.id}`).length).toBe(1);
    const replayOut=await f.outbound(t,1);
    await expect(f.append(fresh.id,2,t,replayOut,0)).rejects.toThrow(/turn/i);
    const later=await f.inbound('2026-10-28T12:00:02Z');const laterOut=await f.outbound(later);
    await f.append(fresh.id,1,later,laterOut,0);
  });

  it('rejects unrelated customer/outbound evidence and fabricated receipt or version updates',async()=>{
    const f=await fixture();const other=await fixture();const o=await f.offer();
    const t=await f.inbound('2026-10-28T12:00:00Z');const m=await f.outbound(t);
    const foreign=await other.inbound('2026-10-28T12:00:02Z');const foreignOut=await other.outbound(foreign);
    await expect(f.append(o.id,1,foreign,foreignOut,0)).rejects.toThrow(/identity/i);
    await f.append(o.id,1,t,m,0);
    await expect(db!`UPDATE promotion_offer_bonus_offerings SET delivered_at=now() WHERE offer_id=${o.id}`).rejects.toThrow(/immutable/i);
    await expect(db!`UPDATE promotion_offers SET offer_version=2 WHERE id=${o.id}`).rejects.toThrow(/version/i);
    await f.deliver(m);
    await expect(db!`SELECT accept_direct_course_bonus(${o.id}::uuid,${foreign}::uuid,1)`).rejects.toThrow(/correlated/i);
    await expect(db!`UPDATE promotion_offer_bonus_offerings SET delivered_at=now() WHERE offer_id=${o.id}`).rejects.toThrow(/immutable/i);
  });

  it('allows only one contender for an expected version under concurrent append attempts',async()=>{
    const f=await fixture();const o=await f.offer();const t=await f.inbound('2026-10-28T12:00:00Z');const m=await f.outbound(t);
    await f.append(o.id,1,t,m,0);await f.deliver(m);
    const next=await f.inbound('2026-10-28T12:00:02Z');const out=await f.outbound(next);
    const independent=openLocalTestDatabase();
    try {
      const outcomes=await Promise.allSettled([
        f.append(o.id,2,next,out,1),
        independent`SELECT append_direct_course_bonus(${o.id}::uuid,${f.courses[3].id}::uuid,${next}::uuid,${out}::uuid,1)`,
      ]);
      expect(outcomes.filter(r=>r.status==='fulfilled')).toHaveLength(1);
      expect(outcomes.filter(r=>r.status==='rejected')).toHaveLength(1);
      expect((await db!`SELECT offer_version FROM promotion_offers WHERE id=${o.id}`)[0].offer_version).toBe(2);
    } finally { await independent.end(); }
  });

  it('retains a delivery receipt arriving concurrently with the first append',async()=>{
    const f=await fixture();const o=await f.offer();const t=await f.inbound('2026-10-28T12:00:00Z');const m=await f.outbound(t);
    await db!`UPDATE outbound_deliveries SET state='leased' WHERE message_id=${m}`;
    await db!`UPDATE outbound_deliveries SET state='submitted' WHERE message_id=${m}`;
    const independent=openLocalTestDatabase();
    let ready!:()=>void;let release!:()=>void;
    const started=new Promise<void>(r=>{ready=r;});const finish=new Promise<void>(r=>{release=r;});
    const receipt=independent.begin(async tx=>{
      await tx`UPDATE outbound_deliveries SET state='delivered',delivered_at='2026-10-28T12:00:01Z' WHERE message_id=${m}`;
      ready();await finish;
    });
    try {
      await started;
      const append=f.append(o.id,1,t,m,0);
      const timer=setTimeout(release,100);
      try { await Promise.all([append,receipt]); } finally { clearTimeout(timer);release(); }
      const [row]=await db!`SELECT delivered_at FROM promotion_offer_bonus_offerings WHERE offer_id=${o.id}`;
      expect(row.delivered_at).toEqual(new Date('2026-10-28T12:00:01Z'));
    } finally { release();await independent.end(); }
  });

  it('executes through the production orchestrator role while preserving receipt and acceptance guards',async()=>{
    const f=await fixture();const o=await f.offer();const t=await f.inbound('2026-10-28T12:00:00Z');const m=await f.outbound(t);
    const acls=await db!`SELECT p.proname,
      EXISTS(SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) acl
        WHERE acl.grantee=0 AND acl.privilege_type='EXECUTE') AS public_execute,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
      has_function_privilege('orchestrator_role',p.oid,'EXECUTE') AS orchestrator_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('append_direct_course_bonus','accept_direct_course_bonus','guard_direct_bonus_offer','advance_direct_bonus_version')`;
    expect(acls).toHaveLength(4);
    for(const acl of acls) {
      expect(acl).toMatchObject({public_execute:false,anon_execute:false,authenticated_execute:false,
        orchestrator_execute:['append_direct_course_bonus','accept_direct_course_bonus'].includes(acl.proname)});
    }
    for(const role of ['anon','authenticated']) {
      await expect(db!.begin(async tx=>{
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`SELECT append_direct_course_bonus(${o.id}::uuid,${f.courses[1].id}::uuid,${t}::uuid,${m}::uuid,0)`;
      })).rejects.toThrow(/permission denied for function/i);
      await expect(db!.begin(async tx=>{
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        await tx`SELECT accept_direct_course_bonus(${o.id}::uuid,${t}::uuid,0)`;
      })).rejects.toThrow(/permission denied for function/i);
    }
    await db!.begin(async tx=>{
      await tx`SET LOCAL ROLE orchestrator_role`;
      const [result]=await tx`SELECT append_direct_course_bonus(${o.id}::uuid,${f.courses[1].id}::uuid,${t}::uuid,${m}::uuid,0) AS version`;
      expect(result.version).toBe(1);
    });
    await f.deliver(m);
    const next=await f.inbound('2026-10-28T12:00:02Z');
    await db!.begin(async tx=>{
      await tx`SET LOCAL ROLE orchestrator_role`;
      const [result]=await tx`SELECT accept_direct_course_bonus(${o.id}::uuid,${next}::uuid,1) AS version`;
      expect(result.version).toBe(1);
    });
  });

  it('requires a durable channel delivery ledger row before persisting the first promise',async()=>{
    const f=await fixture();const o=await f.offer();const t=await f.inbound('2026-10-28T12:00:00Z');const m=await f.outbound(t);
    await db!`DELETE FROM outbound_deliveries WHERE message_id=${m}`;
    await expect(f.append(o.id,1,t,m,0)).rejects.toThrow(/delivery/i);
    expect((await db!`SELECT offer_version FROM promotion_offers WHERE id=${o.id}`)[0].offer_version).toBe(0);
  });
});
