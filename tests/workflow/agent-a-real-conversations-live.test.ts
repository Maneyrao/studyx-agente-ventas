import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { openLocalTestDatabase } from '../helpers/db';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';

// An explicitly invoked, one-turn-at-a-time vertical evaluation. The durable
// manifest fixes the three permitted identities; retries resume those identities.
// It never chooses the next customer message or replaces a production boundary.
it.skipIf(!process.env.STUDYX_REAL_CASE)('runs one authorized turn in one of the three real-provider conversations', async () => {
  const name = process.env.STUDYX_REAL_CASE!;
  expect(['opening', 'call', 'payment']).toContain(name);
  expect(secrets.DEEPSEEK_API_KEY).toBeTruthy();
  const root = process.env.STUDYX_WORKFLOW_REPORT_DIR!;
  const filename = resolve(root, `live-${name}.json`);
  const report: {
    identity: { conversationId: string; userId: string; phoneE164: string; providerMode: 'live' };
    turns: { customer: string; evidence: WorkflowTurnEvidenceV1; persisted: unknown; calls: unknown }[];
  } = existsSync(filename) ? JSON.parse(readFileSync(filename, 'utf8')) : {
    identity: { conversationId: `real-20260923-${name}-${randomUUID()}`, userId: randomUUID(),
      phoneE164: `+999${String(Date.now()).slice(-10)}`, providerMode: 'live' }, turns: [],
  };
  expect(report.turns.length, 'bounded evaluation, not an open-ended campaign').toBeLessThan(10);
  configuration.agentAPlannerlessV2Enabled = true;
  writeFileSync(filename, JSON.stringify(report, null, 2));
  const text = process.env.STUDYX_REAL_TEXT!;
  expect(text).toBeTruthy();
  const evidence = await runWorkflowTurnV1({ ...report.identity, text });
  const db = openLocalTestDatabase();
  try {
    const persisted = await readWorkflowDbEvidenceV1({ databaseUrl: process.env.TEST_DATABASE_URL!,
      externalConversationId: report.identity.conversationId,
      adapterCaptures: [...report.turns.flatMap(t => t.evidence.adapterCaptures), ...evidence.adapterCaptures] });
    const calls = await db`SELECT cs.id, cs.status, cs.created_at FROM call_sessions cs
      JOIN conversations c ON c.id=cs.conversation_id JOIN channel_threads ct ON ct.id=c.channel_thread_id
      WHERE ct.external_conversation_id=${report.identity.conversationId}`;
    report.turns.push({ customer: text, evidence, persisted, calls });
    writeFileSync(filename, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ case: name, customer: text, response: evidence.authorizedMessages,
      contact: persisted.contact, state: persisted.state, calls, links: persisted.deliveredLinks }));
    expect(evidence.workflowEvents.filter(e => e.brain_source === 'fallback')).toEqual([]);
    expect(evidence.httpExchanges.filter(e => e.boundary === 'deepseek').every(e => e.status === 200)).toBe(true);
    expect(evidence.errorCode).toBeNull();
    expect(evidence.commitSucceeded).toBe(true);
    expect(evidence.legacyPlanRequests).toBe(0);
    expect(evidence.authorizedMessages.length).toBeGreaterThan(0);
    expect(evidence.authorizedMessages.length).toBeLessThanOrEqual(3);
  } finally { await db.end(); }
}, 120_000);
