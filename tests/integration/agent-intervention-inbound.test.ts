import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

async function conversation() {
  const [c] = await db!`INSERT INTO contacts(phone,channel_origin,status) VALUES
    (${'+' + String(Math.floor(100000000000 + Math.random() * 800000000000))},'whatsapp','prospecto') RETURNING id`;
  const [v] = await db!`INSERT INTO conversations(contact_id,channel) VALUES (${c.id},'whatsapp') RETURNING id`;
  let second = 0;
  async function say(direction: 'inbound' | 'outbound', content: string) {
    second += 1;
    const [m] = await db!`INSERT INTO messages(conversation_id,contact_id,direction,content,created_at)
      VALUES (${v.id},${c.id},${direction},${content},now() - interval '1 hour' + ${second} * interval '1 second') RETURNING id`;
    return m.id as string;
  }
  // The agent answered this inbound turn: a durable decision, not a clock.
  async function answer(turn: string, kind: 'reply' | 'suppress' = 'reply', reason = 'TEST_REPLY') {
    await db!`INSERT INTO agent_decisions(turn_id,trace_id,schema_version,intent,decision_kind,response,response_type,
        business_action,memory_candidates,missing_information,next_state,reason_code,confidence,
        model_provider,model_name,prompt_version,payload_hash)
      VALUES (${turn},${randomUUID()},4,'commercial',${kind},${kind === 'reply' ? 'Respuesta' : null},
        ${kind === 'reply' ? 'commercial_reply' : null},NULL,'[]'::jsonb,ARRAY[]::text[],'waiting_user',${reason},
        1,'test','test-model','test',decode(repeat('00',32),'hex'))`;
  }
  const intervention = async (turn: string) => (await db!`
    SELECT content FROM agent_intervention_inbound_v1(${turn}::uuid)`).map(row => row.content);
  return { say, answer, intervention };
}

run('agent_intervention_inbound_v1 (owner 2026-11-10)', () => {
  it('«dale, sí» + «cuáles me quedarían bonificados?» are one intervention', async () => {
    const { say, answer, intervention } = await conversation();
    await answer(await say('inbound', 'quiero fotografía'));
    await say('outbound', '¿Te sirve más Plomería?');
    const yes = await say('inbound', 'dale, sí');
    const question = await say('inbound', 'cuáles me quedarían bonificados?');
    expect(await intervention(question)).toEqual(['dale, sí', 'cuáles me quedarían bonificados?']);
    expect(await intervention(yes)).toEqual(['dale, sí']);
    // The first turn superseded by the second still belongs to the intervention.
    await answer(yes, 'suppress', 'SUPERSEDED_BY_NEWER_INBOUND');
    expect(await intervention(question)).toEqual(['dale, sí', 'cuáles me quedarían bonificados?']);
  });

  it('a motive sent seconds earlier counts as evidence of the current intervention', async () => {
    const { say, intervention } = await conversation();
    await say('outbound', 'Plomería cuesta 360 USD.');
    await say('inbound', 'uh, es mucho para mí ahora');
    const ask = await say('inbound', 'me hacés algún descuento?');
    expect(await intervention(ask)).toEqual(['uh, es mucho para mí ahora', 'me hacés algún descuento?']);
  });

  it('never reaches a message the agent already answered, whatever the clocks say', async () => {
    const { say, answer, intervention } = await conversation();
    await answer(await say('inbound', 'es caro'));
    const now = await say('inbound', 'ok');
    expect(await intervention(now)).toEqual(['ok']);
  });

  it('a deliberate suppression (not a supersession) also closes the intervention', async () => {
    const { say, answer, intervention } = await conversation();
    await answer(await say('inbound', 'jaja'), 'suppress', 'TRIVIAL_NO_REPLY');
    const now = await say('inbound', 'una pregunta');
    expect(await intervention(now)).toEqual(['una pregunta']);
  });

  it('never reaches messages older than 30 minutes', async () => {
    const { say, intervention } = await conversation();
    const [old] = await db!`SELECT conversation_id, contact_id FROM messages WHERE id=${await say('inbound', 'hola')}`;
    await db!`UPDATE messages SET created_at = created_at - interval '2 hours'
      WHERE conversation_id=${old.conversation_id} AND content='hola'`;
    const now = await say('inbound', 'sigo acá');
    expect(await intervention(now)).toEqual(['sigo acá']);
  });
});
