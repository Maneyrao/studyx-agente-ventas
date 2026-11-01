import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => db?.end());

async function fixture(options: { withCommercialState?: boolean } = {}) {
  const suffix = randomUUID().slice(0, 8);
  const [workspace] = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name)
    VALUES (${`bonus-${suffix}`}, 'Bonus invariants')
    RETURNING id
  `;
  const [otherWorkspace] = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name)
    VALUES (${`bonus-other-${suffix}`}, 'Other workspace')
    RETURNING id
  `;
  const [contact] = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin, status)
    VALUES (${`+54911${Math.floor(10_000_000 + Math.random() * 89_999_999)}`}, 'whatsapp', 'prospecto')
    RETURNING id
  `;
  await db!`
    INSERT INTO workspace_contacts (workspace_id, contact_id, source_channel)
    VALUES (${workspace.id}::uuid, ${contact.id}::uuid, 'whatsapp')
  `;
  const [conversation] = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel)
    VALUES (${contact.id}::uuid, 'whatsapp')
    RETURNING id
  `;
  const offerings = await db!<Array<{ id: string; code: string }>>`
    INSERT INTO offerings (
      workspace_id, code, display_name, offering_type, status, description,
      price_type, price_amount, currency, billing_interval
    ) VALUES
      (${workspace.id}::uuid, ${`paid-${suffix}`}, 'Paid course', 'course', 'active', 'Paid', 'fixed', 360, 'USD', 'annual'),
      (${workspace.id}::uuid, ${`gift-a-${suffix}`}, 'Gift A', 'course', 'active', 'Gift A', 'free', NULL, NULL, NULL),
      (${workspace.id}::uuid, ${`gift-b-${suffix}`}, 'Gift B', 'course', 'active', 'Gift B', 'free', NULL, NULL, NULL),
      (${workspace.id}::uuid, ${`gift-c-${suffix}`}, 'Gift C', 'course', 'active', 'Gift C', 'free', NULL, NULL, NULL),
      (${workspace.id}::uuid, ${`gift-d-${suffix}`}, 'Gift D', 'course', 'active', 'Gift D', 'free', NULL, NULL, NULL),
      (${otherWorkspace.id}::uuid, ${`other-${suffix}`}, 'Other gift', 'course', 'active', 'Other', 'free', NULL, NULL, NULL)
    RETURNING id, code
  `;
  const [paid, giftA, giftB, giftC, giftD, other] = offerings;
  if (options.withCommercialState !== false) {
    await db!`
      INSERT INTO conversation_sales_context_states_v1 (
        workspace_id, conversation_id, contact_id, selected_offering_code
      ) VALUES (
        ${workspace.id}::uuid, ${conversation.id}::uuid, ${contact.id}::uuid,
        ${paid.code}
      )
    `;
  }
  return { workspace, otherWorkspace, contact, conversation, paid, giftA, giftB, giftC, giftD, other, suffix };
}

async function createPromotion(f: Awaited<ReturnType<typeof fixture>>, code = `promo-${randomUUID().slice(0, 8)}`) {
  const [promotion] = await db!<Array<{ id: string; promotion_code: string }>>`
    INSERT INTO promotions (workspace_id, promotion_code, paid_offering_id, channels, active)
    VALUES (${f.workspace.id}::uuid, ${code}, ${f.paid.id}::uuid, ARRAY['text','voice']::text[], false)
    RETURNING id, promotion_code
  `;
  return promotion;
}

run('authorized course bonus database invariants', () => {
  it('backfills legacy packages as sealed version one and quarantines ambiguous delivery without rewriting obligations', async () => {
    const fixtures = [await fixture(), await fixture()];
    const ids: string[] = [];
    for (const [index, f] of fixtures.entries()) {
      const p = await createPromotion(f);
      await db!`INSERT INTO promotion_bonus_offerings(promotion_id,workspace_id,offering_id,position)
        VALUES (${p.id},${f.workspace.id},${f.giftA.id},1),(${p.id},${f.workspace.id},${f.giftB.id},2)`;
      const [source]=await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
        VALUES (${f.conversation.id},${f.contact.id},'inbound','Legacy customer turn') RETURNING id`;
      const [m] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content)
        VALUES (${f.conversation.id},${f.contact.id},'outbound','Legacy promise') RETURNING id`;
      await db!`INSERT INTO outbound_deliveries(message_id,conversation_id,contact_id,provider,integration_id,channel,destination,idempotency_key,state,delivered_at,submitted_at)
        VALUES (${m.id},${f.conversation.id},${f.contact.id},'test','test','whatsapp','test',${m.id},${index===0?'delivered':'submitted'},${index===0?new Date():null},now())`;
      const [o] = await db!`INSERT INTO promotion_offers(workspace_id,contact_id,conversation_id,promotion_id,paid_offering_id)
        VALUES (${f.workspace.id},${f.contact.id},${f.conversation.id},${p.id},${f.paid.id}) RETURNING id`;
      await db!`INSERT INTO promotion_offer_bonus_offerings(offer_id,promotion_id,offering_id,promotion_code_snapshot,offering_code_snapshot,offering_display_name_snapshot,position)
        VALUES (${o.id},${p.id},${f.giftA.id},${p.promotion_code},${f.giftA.code},'Gift A',1),
          (${o.id},${p.id},${f.giftB.id},${p.promotion_code},${f.giftB.code},'Gift B',2)`;
      await db!`UPDATE promotion_offers SET status=${index===0?'offered':'accepted'},offered_at=now(),offered_outbound_message_id=${m.id},
        accepted_at=${index===0?null:new Date()},bonus_snapshot_sealed_at=now(),source_turn_id=${source.id} WHERE id=${o.id}`;
      ids.push(o.id);
    }
    const migration=readFileSync(resolve(process.cwd(),'supabase/migrations/20261028010001_direct_multi_course_bonus.sql'),'utf8');
    const rollback=new Error('rollback migration rehearsal');
    try {
      await db!.begin(async tx=>{
        await tx.unsafe(`
          DROP TRIGGER promotion_offers_direct_guard ON promotion_offers;
          DROP TRIGGER promotion_offer_bonus_advance_version ON promotion_offer_bonus_offerings;
          DROP TRIGGER outbound_delivery_confirm_bonus ON outbound_deliveries;
          ALTER TABLE payments DROP CONSTRAINT payments_promotion_cycle_id_fkey;
          ALTER TABLE promotion_offers DROP COLUMN package_mode,DROP COLUMN promotion_cycle_id,DROP COLUMN offer_version,
            DROP COLUMN accepted_source_turn_id,DROP COLUMN delivery_reconciliation_required;
          ALTER TABLE promotion_offer_bonus_offerings DROP COLUMN source_turn_id,DROP COLUMN offered_at,
            DROP COLUMN offered_outbound_message_id,DROP COLUMN delivered_at,DROP COLUMN offer_version;
        `);
        await tx.unsafe(migration);
        const offers=await tx`SELECT id,status,offer_version,bonus_snapshot_sealed_at,delivery_reconciliation_required FROM promotion_offers WHERE id IN (${ids[0]},${ids[1]})`;
        expect(offers.find(o=>o.id===ids[0])).toMatchObject({status:'offered',offer_version:1,delivery_reconciliation_required:false});
        expect(offers.find(o=>o.id===ids[1])).toMatchObject({status:'accepted',offer_version:1,delivery_reconciliation_required:true});
        expect(offers.every(o=>o.bonus_snapshot_sealed_at instanceof Date)).toBe(true);
        const gifts=await tx`SELECT offer_id,offering_code_snapshot,offer_version,delivered_at FROM promotion_offer_bonus_offerings WHERE offer_id IN (${ids[0]},${ids[1]})`;
        expect(gifts).toHaveLength(4);
        expect(gifts.find(g=>g.offer_id===ids[0])).toMatchObject({offering_code_snapshot:fixtures[0].giftA.code,offer_version:1});
        expect(gifts.find(g=>g.offer_id===ids[0])?.delivered_at).toBeInstanceOf(Date);
        expect(gifts.find(g=>g.offer_id===ids[1])?.delivered_at).toBeNull();
        throw rollback;
      });
    } catch(error) { if(error!==rollback) throw error; }
    const [restoredFk]=await db!<Array<{ definition:string }>>`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid='payments'::regclass
        AND conname='payments_promotion_cycle_id_fkey'`;
    expect(restoredFk.definition).toContain(
      'FOREIGN KEY (promotion_cycle_id) REFERENCES promotion_offers(promotion_cycle_id)',
    );
  });

  it('migration cleanup preserves an accepted live package over a newer pending review', async () => {
    const f = await fixture();
    const acceptedPromotion = await createPromotion(f, `accepted-${f.suffix}`);
    const pendingPromotion = await createPromotion(f, `pending-${f.suffix}`);
    const migration = readFileSync(resolve(
      process.cwd(),
      'supabase/migrations/20261024143000_one_live_course_bonus_offer.sql',
    ), 'utf8');

    await db!.begin(async tx => {
      await tx.unsafe('DROP INDEX public.promotion_offers_one_live_paid_course_uq');
      const [accepted] = await tx<Array<{ id:string }>>`
        INSERT INTO promotion_offers(
          workspace_id,contact_id,conversation_id,promotion_id,paid_offering_id,status,
          offered_at,accepted_at,created_at,expires_at)
        VALUES (${f.workspace.id},${f.contact.id},${f.conversation.id},${acceptedPromotion.id},
          ${f.paid.id},'accepted',now()-interval '2 hours',now()-interval '2 hours',
          now()-interval '2 hours',now()+interval '24 hours') RETURNING id`;
      const [pending] = await tx<Array<{ id:string }>>`
        INSERT INTO promotion_offers(
          workspace_id,contact_id,conversation_id,promotion_id,paid_offering_id,status,created_at,
          expires_at)
        VALUES (${f.workspace.id},${f.contact.id},${f.conversation.id},${pendingPromotion.id},
          ${f.paid.id},'pending_review',now(),now()+interval '48 hours') RETURNING id`;

      await tx.unsafe(migration);
      const rows = await tx<Array<{ id:string; status:string }>>`
        SELECT id,status FROM promotion_offers WHERE id IN (${accepted.id},${pending.id})`;
      expect(rows.find(row => row.id === accepted.id)?.status).toBe('accepted');
      expect(rows.find(row => row.id === pending.id)?.status).toBe('cancelled');
    });
  });

  it('keeps promotion codes unique per workspace and bonus offerings bounded, distinct and workspace-local', async () => {
    const f = await fixture();
    const promotion = await createPromotion(f, `bounded-${f.suffix}`);

    await db!`
      INSERT INTO promotion_bonus_offerings (promotion_id, workspace_id, offering_id, position)
      VALUES
        (${promotion.id}::uuid, ${f.workspace.id}::uuid, ${f.giftA.id}::uuid, 1),
        (${promotion.id}::uuid, ${f.workspace.id}::uuid, ${f.giftB.id}::uuid, 2),
        (${promotion.id}::uuid, ${f.workspace.id}::uuid, ${f.giftC.id}::uuid, 3)
    `;

    await expect(db!`
      INSERT INTO promotion_bonus_offerings (promotion_id, workspace_id, offering_id, position)
      VALUES (${promotion.id}::uuid, ${f.workspace.id}::uuid, ${f.giftD.id}::uuid, 4)
    `).rejects.toThrow();
    await expect(db!`
      INSERT INTO promotion_bonus_offerings (promotion_id, workspace_id, offering_id, position)
      VALUES (${promotion.id}::uuid, ${f.workspace.id}::uuid, ${f.paid.id}::uuid, 1)
    `).rejects.toThrow(/different from the paid offering/i);
    await expect(db!`
      INSERT INTO promotion_bonus_offerings (promotion_id, workspace_id, offering_id, position)
      VALUES (${promotion.id}::uuid, ${f.workspace.id}::uuid, ${f.other.id}::uuid, 1)
    `).rejects.toThrow(/same workspace/i);
    await expect(db!`
      INSERT INTO promotions (workspace_id, promotion_code, paid_offering_id, channels)
      VALUES (${f.workspace.id}::uuid, ${`bounded-${f.suffix}`}, ${f.paid.id}::uuid, ARRAY['text']::text[])
    `).rejects.toThrow();
  });

  it('rejects invalid channels, empty channel sets and inverted validity windows', async () => {
    const f = await fixture();
    await expect(db!`
      INSERT INTO promotions (workspace_id, promotion_code, paid_offering_id, channels)
      VALUES (${f.workspace.id}::uuid, ${`empty-${f.suffix}`}, ${f.paid.id}::uuid, ARRAY[]::text[])
    `).rejects.toThrow();
    await expect(db!`
      INSERT INTO promotions (workspace_id, promotion_code, paid_offering_id, channels)
      VALUES (${f.workspace.id}::uuid, ${`bad-channel-${f.suffix}`}, ${f.paid.id}::uuid, ARRAY['email']::text[])
    `).rejects.toThrow();
    await expect(db!`
      INSERT INTO promotions (workspace_id, promotion_code, paid_offering_id, channels, valid_from, valid_until)
      VALUES (${f.workspace.id}::uuid, ${`window-${f.suffix}`}, ${f.paid.id}::uuid,
        ARRAY['text']::text[], '2026-11-02T00:00:00Z', '2026-11-01T00:00:00Z')
    `).rejects.toThrow();
  });

  it('binds offers to the canonical workspace, contact, conversation and paid course', async () => {
    const f = await fixture();
    const promotion = await createPromotion(f);
    await db!`
      INSERT INTO promotion_bonus_offerings (promotion_id, workspace_id, offering_id, position)
      VALUES (${promotion.id}::uuid, ${f.workspace.id}::uuid, ${f.giftA.id}::uuid, 1)
    `;
    const [offer] = await db!<Array<{ id: string }>>`
      INSERT INTO promotion_offers (
        workspace_id, contact_id, conversation_id, promotion_id, paid_offering_id, status
      ) VALUES (
        ${f.workspace.id}::uuid, ${f.contact.id}::uuid, ${f.conversation.id}::uuid,
        ${promotion.id}::uuid, ${f.paid.id}::uuid, 'pending_review'
      ) RETURNING id
    `;
    expect(offer.id).toBeTruthy();

    await expect(db!`
      INSERT INTO promotion_offers (
        workspace_id, contact_id, conversation_id, promotion_id, paid_offering_id
      ) VALUES (
        ${f.otherWorkspace.id}::uuid, ${f.contact.id}::uuid, ${f.conversation.id}::uuid,
        ${promotion.id}::uuid, ${f.paid.id}::uuid
      )
    `).rejects.toThrow(/identity mismatch/i);
  });

  it('accepts a legacy unscoped conversation only through its canonical commercial state', async () => {
    const f = await fixture({ withCommercialState:false });
    const promotion = await createPromotion(f);
    await db!`
      INSERT INTO promotion_bonus_offerings (promotion_id, workspace_id, offering_id, position)
      VALUES (${promotion.id}::uuid, ${f.workspace.id}::uuid, ${f.giftA.id}::uuid, 1)
    `;
    await expect(db!`
      INSERT INTO promotion_offers (
        workspace_id, contact_id, conversation_id, promotion_id, paid_offering_id, status
      ) VALUES (
        ${f.workspace.id}::uuid, ${f.contact.id}::uuid, ${f.conversation.id}::uuid,
        ${promotion.id}::uuid, ${f.paid.id}::uuid, 'pending_review'
      )
    `).rejects.toThrow(/identity mismatch/i);

    await db!`
      INSERT INTO conversation_sales_context_states_v1 (
        workspace_id, conversation_id, contact_id, selected_offering_code
      ) VALUES (
        ${f.workspace.id}::uuid, ${f.conversation.id}::uuid, ${f.contact.id}::uuid,
        ${f.paid.code}
      )
    `;
    const [offer] = await db!<Array<{ id:string }>>`
      INSERT INTO promotion_offers (
        workspace_id, contact_id, conversation_id, promotion_id, paid_offering_id, status
      ) VALUES (
        ${f.workspace.id}::uuid, ${f.contact.id}::uuid, ${f.conversation.id}::uuid,
        ${promotion.id}::uuid, ${f.paid.id}::uuid, 'pending_review'
      )
      RETURNING id
    `;
    expect(offer.id).toBeTruthy();
  });

  it('provides idempotent durable follow-ups with expiring leases', async () => {
    const f = await fixture();
    const promotion = await createPromotion(f);
    const [offer] = await db!<Array<{ id: string }>>`
      INSERT INTO promotion_offers (
        workspace_id, contact_id, conversation_id, promotion_id, paid_offering_id
      ) VALUES (
        ${f.workspace.id}::uuid, ${f.contact.id}::uuid, ${f.conversation.id}::uuid,
        ${promotion.id}::uuid, ${f.paid.id}::uuid
      ) RETURNING id
    `;
    const key = `followup:${offer.id}:review`;
    const [followup] = await db!<Array<{ id: string }>>`
      INSERT INTO course_bonus_followups (offer_id, kind, due_at, idempotency_key)
      VALUES (${offer.id}::uuid, 'promotion_review', now() - interval '1 second', ${key})
      RETURNING id
    `;
    await expect(db!`
      INSERT INTO course_bonus_followups (offer_id, kind, due_at, idempotency_key)
      VALUES (${offer.id}::uuid, 'promotion_review', now(), ${key})
    `).rejects.toThrow();

    const first = await db!<Array<{ id: string; status: string; claim_token: string }>>`
      SELECT id, status, claim_token FROM claim_course_bonus_followups('worker-a', 100, 60)
    `;
    expect(first.find((candidate) => candidate.id === followup.id)).toMatchObject({ status: 'processing' });
    const second = await db!<Array<{ id: string }>>`
      SELECT id FROM claim_course_bonus_followups('worker-b', 100, 60)
    `;
    expect(second.some((candidate) => candidate.id === followup.id)).toBe(false);
    await db!`
      UPDATE course_bonus_followups SET lease_until = now() - interval '1 second'
      WHERE offer_id = ${offer.id}::uuid
    `;
    const reclaimed = await db!<Array<{ id: string; claimed_by: string; attempt_count: number }>>`
      SELECT id, claimed_by, attempt_count FROM claim_course_bonus_followups('worker-b', 100, 60)
    `;
    expect(reclaimed.find((candidate) => candidate.id === followup.id))
      .toMatchObject({ claimed_by: 'worker-b', attempt_count: 2 });
  });

  it('freezes a payment bonus only while reserved and refuses snapshot mutation', async () => {
    const f = await fixture();
    const promotion = await createPromotion(f);
    await db!`
      INSERT INTO promotion_bonus_offerings (promotion_id, workspace_id, offering_id, position)
      VALUES (${promotion.id}::uuid, ${f.workspace.id}::uuid, ${f.giftA.id}::uuid, 1)
    `;
    const [payment] = await db!<Array<{ id: string }>>`
      INSERT INTO payments (
        workspace_id, contact_id, offering_id, amount, currency, status, provider,
        environment, checkout_mode, idempotency_key, plan_code
      ) VALUES (
        ${f.workspace.id}::uuid, ${f.contact.id}::uuid, ${f.paid.id}::uuid, 360, 'USD',
        'reserved', 'stripe', 'test', 'payment', ${`bonus:${randomUUID()}`}, 'one_time'
      ) RETURNING id
    `;
    const [snapshot] = await db!<Array<{ id: string }>>`
      INSERT INTO payment_bonus_offerings (
        payment_id, promotion_id, offering_id, promotion_code_snapshot,
        offering_code_snapshot, offering_display_name_snapshot, position
      ) VALUES (
        ${payment.id}::uuid, ${promotion.id}::uuid, ${f.giftA.id}::uuid, ${promotion.promotion_code},
        ${f.giftA.code}, 'Gift A', 1
      ) RETURNING id
    `;
    await expect(db!`
      UPDATE payment_bonus_offerings SET offering_display_name_snapshot = 'Changed'
      WHERE id = ${snapshot.id}::uuid
    `).rejects.toThrow(/append-only/i);
    await expect(db!`
      DELETE FROM payment_bonus_offerings WHERE id = ${snapshot.id}::uuid
    `).rejects.toThrow(/append-only/i);

    await db!`UPDATE payments SET status = 'creating_checkout' WHERE id = ${payment.id}::uuid`;
    await expect(db!`
      INSERT INTO payment_bonus_offerings (
        payment_id, promotion_id, offering_id, promotion_code_snapshot,
        offering_code_snapshot, offering_display_name_snapshot, position
      ) VALUES (
        ${payment.id}::uuid, ${promotion.id}::uuid, ${f.giftB.id}::uuid, 'snapshot-promo',
        ${f.giftB.code}, 'Gift B', 2
      )
    `).rejects.toThrow(/snapshot is sealed|payment must be reserved/i);
  });

  it('records each Central bonus enrollment exactly once and append-only', async () => {
    const f = await fixture();
    const promotion = await createPromotion(f);
    const [payment] = await db!<Array<{ id: string }>>`
      INSERT INTO payments (
        workspace_id, contact_id, offering_id, amount, currency, status, provider,
        environment, checkout_mode, idempotency_key, plan_code
      ) VALUES (
        ${f.workspace.id}::uuid, ${f.contact.id}::uuid, ${f.paid.id}::uuid, 360, 'USD',
        'reserved', 'stripe', 'test', 'payment', ${`paid:${randomUUID()}`}, 'one_time'
      ) RETURNING id
    `;
    await db!`
      INSERT INTO promotion_bonus_offerings (promotion_id, workspace_id, offering_id, position)
      VALUES (${promotion.id}::uuid, ${f.workspace.id}::uuid, ${f.giftA.id}::uuid, 1)
    `;
    await db!`
      INSERT INTO payment_bonus_offerings (
        payment_id, promotion_id, offering_id, promotion_code_snapshot,
        offering_code_snapshot, offering_display_name_snapshot, position
      ) VALUES (
        ${payment.id}::uuid, ${promotion.id}::uuid, ${f.giftA.id}::uuid,
        ${promotion.promotion_code}, ${f.giftA.code}, 'Gift A', 1
      )
    `;
    await db!`UPDATE payments SET status = 'creating_checkout' WHERE id = ${payment.id}::uuid`;
    await db!`
      UPDATE payments SET status = 'pending', provider_session_id = ${`cs_${randomUUID()}`}
      WHERE id = ${payment.id}::uuid
    `;
    await db!`UPDATE payments SET status = 'paid', paid_at = now() WHERE id = ${payment.id}::uuid`;
    const [enrollment] = await db!<Array<{ id: string }>>`
      INSERT INTO central_enrollments (
        payment_id, workspace_id, enrollment_id, student_id, enrollment_status,
        student_was_created, welcome_sent, login_email
      ) VALUES (
        ${payment.id}::uuid, ${f.workspace.id}::uuid, 'primary-enr', 'student-1', 'active',
        true, true, 'student@example.com'
      ) RETURNING id
    `;
    await db!`
      INSERT INTO central_bonus_enrollment_items (
        central_enrollment_id, payment_id, offering_code, enrollment_id, enrollment_status, position
      ) VALUES (${enrollment.id}::uuid, ${payment.id}::uuid, ${f.giftA.code}, 'bonus-enr', 'active', 1)
    `;
    await expect(db!`
      INSERT INTO central_bonus_enrollment_items (
        central_enrollment_id, payment_id, offering_code, enrollment_id, enrollment_status, position
      ) VALUES (${enrollment.id}::uuid, ${payment.id}::uuid, ${f.giftA.code}, 'bonus-enr-2', 'active', 2)
    `).rejects.toThrow();
    await expect(db!`
      UPDATE central_bonus_enrollment_items SET enrollment_status = 'already_enrolled'
      WHERE payment_id = ${payment.id}::uuid
    `).rejects.toThrow(/append-only/i);
    expect(promotion.id).toBeTruthy();
  });

  it('seeds the English 1 plus English 2 rule disabled by default', async () => {
    const rows = await db!<Array<{
      promotion_code: string;
      active: boolean;
      paid_code: string;
      bonus_code: string;
    }>>`
      SELECT p.promotion_code, p.active, paid.code AS paid_code, bonus.code AS bonus_code
      FROM promotions p
      JOIN offerings paid ON paid.id = p.paid_offering_id
      JOIN promotion_bonus_offerings pbo ON pbo.promotion_id = p.id
      JOIN offerings bonus ON bonus.id = pbo.offering_id
      JOIN workspaces w ON w.id = p.workspace_id
      WHERE w.slug = 'studyx' AND p.promotion_code = 'ingles_1_mas_ingles_2'
    `;
    expect(rows).toEqual([{
      promotion_code: 'ingles_1_mas_ingles_2',
      active: false,
      paid_code: 'ingles_1',
      bonus_code: 'ingles_2',
    }]);
  });
});
