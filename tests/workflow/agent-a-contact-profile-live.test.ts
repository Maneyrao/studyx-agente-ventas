import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentAContextV1 } from '../../botpress-agent/src/schemas/agent-a-brain';
import type { StoredContactProfileV1 } from '../../src/lib/repositories/contact-profile.repository';
import { runWorkflowTurnV1, type WorkflowTurnEvidenceV1 } from '../helpers/agent-a-workflow-driver';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
import { openLocalTestDatabase } from '../helpers/db';

// Deliberate opt-in only. The root launches this using the existing cumulative
// ledger; the ordinary offline workflow command never contacts a paid provider.
const enabled = process.env.STUDYX_CONTACT_PROFILE_LIVE === 'true';
const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL!;
let db: ReturnType<typeof openLocalTestDatabase> | undefined;

function firstModelContext(evidence: WorkflowTurnEvidenceV1): AgentAContextV1 {
  const exchange = evidence.httpExchanges.find(item => item.boundary === 'deepseek');
  const body = exchange?.requestBody as { instructions?: string } | undefined;
  expect(body?.instructions).toBeTypeOf('string');
  return JSON.parse(body!.instructions!.split('<authorized_context>')[1]!.split('</authorized_context>')[0]!) as AgentAContextV1;
}

describe.skipIf(!enabled)('live Agent A contact-profile canary with one synthetic contact', () => {
  beforeAll(async () => {
    expect(secrets.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY_MISSING').toBeTruthy();
    expect(process.env.STUDYX_AGENT_A_BUDGET_FILE, 'EXISTING_CUMULATIVE_BUDGET_REQUIRED').toBeTruthy();
    const backend = new URL(apiBaseUrl);
    expect(backend.hostname).toBe('127.0.0.1');
    expect(backend.protocol).toBe('http:');
    expect(backend.port).toMatch(/^32\d\d$/u);
    configuration.apiBaseUrl = apiBaseUrl;
    configuration.agentAPlannerlessV2Enabled = true;
    db = openLocalTestDatabase();
    // Keep the installed budget wrapper on the actual DeepSeek request. The
    // canary is conversational: even a wrongly proposed call cannot dispatch.
    const budgetedFetch = globalThis.fetch;
    expect((await budgetedFetch(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) })).ok).toBe(true);
    vi.stubGlobal('fetch', async (request: RequestInfo | URL, init?: RequestInit) => {
      const target = new URL(request instanceof Request ? request.url : String(request));
      if (target.origin === backend.origin) {
        if (/\/calls\/[^/]+\/dispatch$/u.test(target.pathname)) throw new Error('LIVE_CONTACT_CANARY_FORBIDS_CALL_DISPATCH');
        return budgetedFetch(request, init);
      }
      if (target.href !== 'https://api.deepseek.com/responses') throw new Error('LIVE_CONTACT_CANARY_UNEXPECTED_PROVIDER');
      return budgetedFetch(request, init);
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await db?.end();
  });

  it('keeps self-owned compound identity through third-party data, correction, retraction and a requested bare answer', async () => {
    const runId = randomUUID();
    const email = `luz.maria.${runId}@example.test`;
    const id = { conversationId: `profile-live-${runId}`, userId: `profile-live-${runId}`,
      phoneE164: `+999${runId.replace(/\D/gu, '').slice(0, 10).padEnd(10, '0')}`,
      providerMode: 'live' as const };
    const turns: { customer: string; evidence: WorkflowTurnEvidenceV1; profile: StoredContactProfileV1 }[] = [];
    const cases = [
      { text: `Mi nombre es Luz María y mi apellido es van der Velde. Mi correo es ${email}. Quiero conocer opciones por chat.`,
        values: { nombre: 'Luz María', apellido: 'van der Velde', correo: email, telefono: null } },
      { text: 'Mi hermana se llama Clara y su correo es clara@example.test; ese es el contacto de ella, no el mío.',
        values: { nombre: 'Luz María', apellido: 'van der Velde', correo: email, telefono: null } },
      { text: 'Corrijo mi apellido: de la Croix.',
        values: { nombre: 'Luz María', apellido: 'de la Croix', correo: email, telefono: null } },
      { text: 'No uses más mi correo, retíralo de mis datos.',
        values: { nombre: 'Luz María', apellido: 'de la Croix', correo: null, telefono: null } },
      { text: 'Retira mi nombre anterior, no era el mío. Con lo anterior me refiero a ese dato; puedes preguntarme cómo me llamo?',
        values: { nombre: null, apellido: 'de la Croix', correo: null, telefono: null } },
      { text: 'Aïcha Noor',
        values: { nombre: 'Aïcha Noor', apellido: 'de la Croix', correo: null, telefono: null } },
    ] as const;
    let previous = { nombre: null as string | null, apellido: null as string | null,
      correo: null as string | null, telefono: null as string | null };
    try {
      for (const [index, scenario] of cases.entries()) {
        const evidence = await runWorkflowTurnV1({ ...id, text: scenario.text });
        expect(evidence.errorCode, JSON.stringify(evidence.workflowEvents.filter(event => event.event.includes('failed')))).toBeNull();
        expect(evidence.commitSucceeded).toBe(true);
        expect(evidence.legacyPlanRequests).toBe(0);
        expect(evidence.authorizedMessages.length).toBeGreaterThan(0);
        expect(evidence.httpExchanges.filter(exchange => exchange.boundary === 'deepseek').length).toBeLessThanOrEqual(2);
        expect(evidence.actions.some(action => action.name === 'dispatchCall')).toBe(false);
        const context = firstModelContext(evidence);
        expect(context.customer.contact_intake).toMatchObject(previous);
        if (index === 5) {
          expect(context.customer.contact_profile?.pending_requests).toEqual(expect.arrayContaining([
            expect.objectContaining({ fields: expect.arrayContaining(['nombre']) }),
          ]));
        }
        const [row] = await db!<Array<{ id: string; name: string | null; email: string | null;
          contact_profile_v1: StoredContactProfileV1 }>>`
          SELECT id, name, email, contact_profile_v1 FROM contacts WHERE phone = ${id.phoneE164}
        `;
        expect(row).toBeDefined();
        const profile = row!.contact_profile_v1;
        turns.push({ customer: scenario.text, evidence, profile });
        const actual = Object.fromEntries(Object.entries(profile.fields).map(([field, entry]) => [field, entry.value]));
        expect(actual).toEqual(scenario.values);
        if (index === 1) expect(profile).toEqual(turns[0]!.profile);
        expect(row!.email).toBe(scenario.values.correo);
        expect(row!.name).toBe(scenario.values.nombre
          ? [scenario.values.nombre, scenario.values.apellido].filter(Boolean).join(' ') : null);
        expect(await db!`SELECT id FROM call_sessions WHERE contact_id = ${row!.id}::uuid`).toHaveLength(0);
        expect(await db!`SELECT id FROM payments WHERE contact_id = ${row!.id}::uuid`).toHaveLength(0);
        for (const message of evidence.authorizedMessages) {
          expect(message.trim()).not.toMatch(/^[{[]/u);
          expect(message).not.toMatch(/profile_updates|profile_requests|turn_rejection|source_message_id/u);
        }
        previous = { ...scenario.values };
      }
    } finally {
      writeWorkflowReportV1('workflow-contact-profile-live-canary', { ...id,
        scenario_role: 'actual_model_contact_interpretation', max_customer_turns: 6,
        api_cost_source: 'existing_cumulative_budget_ledger', turns,
        transcript: turns.flatMap(turn => [{ role: 'user', text: turn.customer },
          ...turn.evidence.authorizedMessages.map(text => ({ role: 'assistant', text }))]),
      });
    }
    expect(turns).toHaveLength(6);
  }, 180_000);
});
