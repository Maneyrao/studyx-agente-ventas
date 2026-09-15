import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  runWorkflowBurstV1,
  runWorkflowTurnV1,
} from '../helpers/agent-a-workflow-driver';
import { readWorkflowDbEvidenceV1 } from '../helpers/agent-a-workflow-db-evidence';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';

const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217';

function visibleText(messages: readonly string[]): string {
  return messages.join('\n').trim();
}

function restartsIdentity(text: string): boolean {
  return /\bsoy (?:el|la) (?:asistente|asesora)|\basistente virtual de StudyX\b/iu.test(text);
}

function asksFirstName(text: string): boolean {
  return /\b(?:primer nombre|tu nombre|c[oó]mo te llamas|me dices (?:tu )?nombre)\b/iu.test(text);
}

beforeAll(async () => {
  expect(secrets.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY_MISSING').toBeTruthy();
  expect(process.env.STUDYX_AGENT_A_BUDGET_FILE, 'CUMULATIVE_BUDGET_REQUIRED').toBeTruthy();
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  const response = await fetch(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) });
  expect(response.ok, 'LABORATORIO_NO_DISPONIBLE').toBe(true);
});

describe('Agent A v52 continuity through the production workflow', () => {
  it('does not restart after greeting, generic info and a later name answer', async () => {
    const identity = {
      conversationId: `continuity-v52-${randomUUID()}`,
      userId: `continuity-v52-user-${randomUUID()}`,
      phoneE164: `+999${String(Date.now()).slice(-10)}`,
      providerMode: 'live' as const,
    };

    const greeting = await runWorkflowTurnV1({ ...identity, text: 'Buenas' });
    const genericInfo = await runWorkflowTurnV1({ ...identity, text: 'info' });
    const nameAndGoal = await runWorkflowTurnV1({
      ...identity,
      text: 'Thiago. Busco algo de tecnología para conseguir trabajo',
    });

    for (const turn of [greeting, genericInfo, nameAndGoal]) {
      expect.soft(turn.errorCode).toBeNull();
      expect.soft(turn.commitSucceeded).toBe(true);
      expect.soft(turn.legacyPlanRequests).toBe(0);
      expect.soft(turn.authorizedMessages).toHaveLength(1);
      expect.soft(visibleText(turn.authorizedMessages).length).toBeLessThan(600);
    }

    const infoText = visibleText(genericInfo.authorizedMessages);
    const goalText = visibleText(nameAndGoal.authorizedMessages);
    expect.soft(restartsIdentity(infoText)).toBe(false);
    expect.soft(asksFirstName(infoText)).toBe(false);
    expect.soft(infoText).not.toMatch(/(?:gracias|un gusto|bienvenido),?\s+Info\b|\bInfo,/iu);
    expect.soft(infoText).not.toMatch(/para no llenarte de datos|qu[eé] (?:área|tema) te interesa y tu (?:primer )?nombre/iu);
    expect.soft(restartsIdentity(goalText)).toBe(false);
    expect.soft(asksFirstName(goalText)).toBe(false);
    expect.soft(goalText).toMatch(/tecnolog|redes|pc|celular|excel/iu);
    expect.soft(goalText).toMatch(/llamad|llamar|tel[eé]fono/iu);
    expect.soft(goalText).not.toMatch(/[¿¡]/u);

    const db = await readWorkflowDbEvidenceV1({
      databaseUrl: process.env.TEST_DATABASE_URL!,
      externalConversationId: identity.conversationId,
      adapterCaptures: [greeting, genericInfo, nameAndGoal].flatMap((turn) => turn.adapterCaptures),
    });
    expect.soft(db.contact?.name).toBe('Thiago');
    expect.soft(db.state?.callOfferCount).toBe(1);
    expect.soft(db.outboundCount).toBe(3);
  }, 150_000);

  it('combines three rapid fragments into one model turn and one visible answer', async () => {
    const evidence = await runWorkflowBurstV1({
      conversationId: `burst-v52-${randomUUID()}`,
      userId: `burst-v52-user-${randomUUID()}`,
      phoneE164: `+999${String(Date.now() + 1).slice(-10)}`,
      providerMode: 'live',
      messages: [
        { text: 'quiero info', delayMs: 0 },
        { text: 'de ingles', delayMs: 300 },
        { text: 'para conseguir trabajo', delayMs: 700 },
      ],
    });

    const text = visibleText(evidence.authorizedMessages);
    expect.soft(evidence.errorCode).toBeNull();
    expect.soft(evidence.commitSucceeded).toBe(true);
    expect.soft(evidence.burst.source_message_count).toBe(3);
    expect.soft(evidence.burst.claimed_message_count).toBe(3);
    expect.soft(evidence.burst.model_attempt_count).toBeGreaterThanOrEqual(1);
    expect.soft(evidence.burst.model_attempt_count).toBeLessThanOrEqual(2);
    expect.soft(evidence.authorizedMessages).toHaveLength(1);
    expect.soft(text).toMatch(/ingl[eé]s/iu);
    expect.soft(text).not.toMatch(/[¿¡]/u);
  }, 150_000);
});
