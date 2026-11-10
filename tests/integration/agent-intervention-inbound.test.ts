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
  const intervention = async (turn: string) => (await db!`
    SELECT content FROM agent_intervention_inbound_v1(${turn}::uuid)`).map(row => row.content);
  return { say, intervention };
}

run('agent_intervention_inbound_v1 (owner 2026-11-10)', () => {
  it('«dale, sí» + «cuáles me quedarían bonificados?» are one intervention', async () => {
    const { say, intervention } = await conversation();
    await say('inbound', 'quiero fotografía');
    await say('outbound', '¿Te sirve más Plomería?');
    const yes = await say('inbound', 'dale, sí');
    const question = await say('inbound', 'cuáles me quedarían bonificados?');
    expect(await intervention(question)).toEqual(['dale, sí', 'cuáles me quedarían bonificados?']);
    // The earlier turn never sees the later message.
    expect(await intervention(yes)).toEqual(['dale, sí']);
  });

  it('a motive sent seconds earlier counts as evidence of the current intervention', async () => {
    const { say, intervention } = await conversation();
    await say('outbound', 'Plomería cuesta 360 USD.');
    await say('inbound', 'uh, es mucho para mí ahora');
    const ask = await say('inbound', 'me hacés algún descuento?');
    expect(await intervention(ask)).toEqual(['uh, es mucho para mí ahora', 'me hacés algún descuento?']);
  });

  it('never reaches messages answered before the last agent reply', async () => {
    const { say, intervention } = await conversation();
    await say('inbound', 'es caro');
    await say('outbound', 'Entiendo.');
    const now = await say('inbound', 'ok');
    expect(await intervention(now)).toEqual(['ok']);
  });
});
