import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { runWorkflowTurnV1, runWorkflowBurstV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { openLocalTestDatabase } from '../helpers/db';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
import type { AgentATurnProposalV1 } from '../../botpress-agent/src/schemas/agent-a-brain';

// Historical before-proof: run only against the source SHA in an isolated checkout.
// No implementation boundary is replaced; only recorded DeepSeek transport and
// physical delivery. Seeding reproduces the preexisting contact-scoped selection.
it.skipIf(process.env.STUDYX_RECORDED_BASELINE !== '1')('replays all twelve production turns through their deployed workflow and commit', async () => {
  const fixture = JSON.parse(gunzipSync(readFileSync('tests/fixtures/agent-a/production-20260923.json.gz')).toString());
  configuration.agentAPlannerlessV2Enabled = true;
  secrets.DEEPSEEK_API_KEY = 'recorded-provider-no-cost';
  const db = openLocalTestDatabase();
  const original = globalThis.fetch;
  let turn: typeof fixture.turns[number];
  let seeded = false;
  const captures: unknown[] = [];
  vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    if (url.origin === configuration.apiBaseUrl) {
      const response = await original(request, init);
      if (!seeded && url.pathname.endsWith('/ingest') && response.ok) {
        const ingest = await response.clone().json();
        const [message] = await db`SELECT m.contact_id, wc.workspace_id FROM messages m
          JOIN workspace_contacts wc ON wc.contact_id=m.contact_id WHERE m.id=${ingest.turn_id}::uuid`;
        const [previous] = await db`INSERT INTO conversations (contact_id,channel,status)
          VALUES (${message!.contact_id}::uuid,'whatsapp','closed') RETURNING id`;
        await db`INSERT INTO sales_context_states(workspace_id,contact_id,conversation_id,selected_offering_code,stage)
          VALUES (${message!.workspace_id}::uuid,${message!.contact_id}::uuid,${previous!.id}::uuid,'community_manager','course_selected')
          ON CONFLICT (workspace_id,contact_id) DO UPDATE SET conversation_id=excluded.conversation_id,
            selected_offering_code=excluded.selected_offering_code,stage=excluded.stage`;
        seeded = true;
      }
      return response;
    }
    if (url.href !== 'https://api.deepseek.com/responses') throw new Error('UNEXPECTED_EXTERNAL_REQUEST');
    const body = JSON.parse(String(init?.body));
    const context = JSON.parse(body.instructions.split('<authorized_context>')[1].split('</authorized_context>')[0]);
    const recorded = (context.turn_rejection ? turn.repair : turn.initial)?.proposal;
    if (!recorded) throw new Error('UNRECORDED_MODEL_REPAIR');
    const proposal: AgentATurnProposalV1 = { ...recorded, repair_of: context.turn_rejection
      ? { rejection_id: context.turn_rejection.rejection_id, attempt: 1 } : null };
    captures.push({ context, proposal });
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }] }),
      { headers: { 'content-type': 'application/json' } });
  });
  const identity = { conversationId: `recorded-${randomUUID()}`, userId: randomUUID(),
    phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'fixture' as const };
  const turns: {customer: string; evidence: WorkflowTurnEvidenceV1}[] = [];
  try {
    for (turn of fixture.turns) {
      const texts = turn.claimed.context.batch_messages.map((m: {content: string}) => m.content);
      const evidence = texts.length === 1
        ? await runWorkflowTurnV1({ ...identity, text: texts[0] })
        : (await runWorkflowBurstV1({ ...identity, messages: texts.map((text: string, i: number) => ({ text, delayMs: i * 150 })) }));
      turns.push({ customer: texts.join('\n'), evidence });
      const persisted = await readWorkflowDbEvidenceV1({ databaseUrl: process.env.TEST_DATABASE_URL!, externalConversationId: identity.conversationId,
        adapterCaptures: turns.flatMap(t => t.evidence.adapterCaptures) });
      writeWorkflowReportV1('recorded-production-before', { identity, turns, captures, persisted, source_sha: fixture.source_sha, cost_usd: 0 });
      expect.soft(evidence.commitSucceeded, texts.join('\n')).toBe(true);
    }
    const final = await readWorkflowDbEvidenceV1({ databaseUrl: process.env.TEST_DATABASE_URL!, externalConversationId: identity.conversationId });
    expect(final.contact?.name).toBe('Si Ludmi Medina');
    expect(final.contact?.declaredPhone).toBe('1155550101');
    expect(final.state?.callPreference).toBe('unknown');
    expect(final.state?.stage).toBe('plan_selected');
    expect(final.recordedLinks).toEqual([]);
  } finally { vi.unstubAllGlobals(); await db.end(); }
}, 180_000);
