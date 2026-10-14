import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
import { openLocalTestDatabase } from '../helpers/db';

const enabled = process.env.STUDYX_VOICE_TRUTH_LIVE === 'true';
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL!;
let db: ReturnType<typeof openLocalTestDatabase> | undefined;
type LiveTurn = { customer: string; evidence: WorkflowTurnEvidenceV1 };
type LiveReport = { id: { conversationId: string; userId: string; phoneE164: string; providerMode: 'live' }; turns: LiveTurn[] };

describe.skipIf(!enabled)('live canonical voice and commercial truth', () => {
  beforeAll(async () => {
    expect(secrets.DEEPSEEK_API_KEY).toBeTruthy();
    expect(process.env.STUDYX_AGENT_A_BUDGET_FILE).toBeTruthy();
    const backend = new URL(apiBaseUrl);
    expect(backend.hostname).toBe('127.0.0.1');
    configuration.apiBaseUrl = apiBaseUrl;
    configuration.agentAPlannerlessV2Enabled = true;
    db = openLocalTestDatabase();
    const budgetedFetch = globalThis.fetch;
    expect((await budgetedFetch(`${apiBaseUrl}/api/ready`)).ok).toBe(true);
    vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(request instanceof Request ? request.url : String(request));
      if (target.origin === backend.origin) {
        if (/\/calls\/[^/]+\/dispatch$/u.test(target.pathname)) throw new Error('LIVE_CANARY_FORBIDS_CALL_DISPATCH');
        return budgetedFetch(request, init);
      }
      if (target.href !== 'https://api.deepseek.com/responses') throw new Error('LIVE_CANARY_UNEXPECTED_PROVIDER');
      return budgetedFetch(request, init);
    });
  });
  afterAll(async () => { vi.unstubAllGlobals(); await db?.end(); });

  it('keeps moderate style and actual payment alternatives across a complete chat', async () => {
    const runId = randomUUID();
    // A local failed-canary artifact may be resumed after a focused repair;
    // preserve its successful prefix and explicitly record that provenance.
    const resumePath = process.env.STUDYX_VOICE_TRUTH_RESUME_REPORT;
    const previous: LiveReport | null = resumePath ? JSON.parse(readFileSync(resumePath, 'utf8')) as LiveReport : null;
    const email = previous ? previous.turns[2]!.customer.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/u)![0] : `luz.${runId}@example.test`;
    const id = previous?.id ?? { conversationId: `voice-truth-${runId}`, userId: `voice-truth-${runId}`,
      phoneE164: `+999${runId.replace(/\D/gu, '').slice(0, 10).padEnd(10, '0')}`, providerMode: 'live' as const };
    const customers = [
      'Buenas, quiero información sobre Inglés 1.',
      'Quiero empezar de cero y prefiero seguir por chat.',
      `Me llamo Luz María, mi apellido es van der Velde y mi correo es ${email}.`,
      'Dos pagos, puede ser?',
      'Entonces explícame el de 12 pagos de 30, todavía no envíes ningún enlace.',
    ];
    const turns: LiveTurn[] = previous ? previous.turns.slice(0, customers.length).filter(turn => turn.evidence.authorizedMessages.length > 0) : [];
    try {
      for (const customer of customers.slice(turns.length)) {
        const evidence = await runWorkflowTurnV1({ ...id, text: customer });
        turns.push({ customer, evidence });
        expect(evidence.errorCode).toBeNull();
        expect(evidence.commitSucceeded).toBe(true);
        expect(evidence.authorizedMessages.length).toBeGreaterThan(0);
        expect(evidence.httpExchanges.filter(exchange => exchange.boundary === 'deepseek').length).toBeLessThanOrEqual(2);
        expect(evidence.actions.some(action => action.name === 'dispatchCall')).toBe(false);
        expect(evidence.authorizedMessages.join(' ')).not.toMatch(/https?:\/\//u);
      }
      const replies = turns.map(turn => turn.evidence.authorizedMessages.join(' '));
      for (const turn of turns) {
        expect(turn.evidence.workflowEvents.filter(event => event.brain_source === 'fallback')).toEqual([]);
      }
      // A qualitative regression threshold for this fixture, not a runtime
      // emoji quota or a replacement for the approved personality.
      const emojiTurns = replies.filter(reply => /\p{Extended_Pictographic}/u.test(reply)).length;
      expect(emojiTurns, JSON.stringify(replies)).toBeLessThanOrEqual(2);
      expect(new Set(replies).size).toBe(replies.length);
      const [row] = await db!`SELECT contact_profile_v1 FROM contacts WHERE phone=${id.phoneE164}`;
      expect(row?.contact_profile_v1.fields.nombre.value).toBe('Luz María');
      expect(row?.contact_profile_v1.fields.apellido.value).toBe('van der Velde');
      expect(row?.contact_profile_v1.fields.correo.value).toBe(email);
    } finally {
      writeWorkflowReportV1('voice-truth-live', { id, turns, provider: 'deepseek-direct',
        resumed_from: resumePath ?? null,
        no_real_calls: true, no_real_charges: true, existing_cumulative_budget: true });
    }
  }, 180_000);
});
