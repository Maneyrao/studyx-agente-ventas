import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { withAgentAApiBudget, resolveAuthorizedLimitUsd, resolveMaxOutputTokensCeilingV1 } from '../../../scripts/agent-a-api-budget.mjs';

const dirs: string[] = [];
function ledger(priorSpendUsd = 0.38) {
  const dir = mkdtempSync(path.join(tmpdir(), 'studyx-budget-'));
  dirs.push(dir);
  const file = path.join(dir, 'budget.json');
  writeFileSync(file, JSON.stringify({ priorSpendUsd, limitUsd: resolveAuthorizedLimitUsd({}), calls: [] }));
  return file;
}
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true })));
const request = {
  method: 'POST',
  body: JSON.stringify({ model: 'deepseek-v4-flash', reasoning: { effort: 'none' }, max_output_tokens: 800, instructions: 'Synthetic lab input' }),
};
function requestWithMaxOutputTokens(maxOutputTokens: number) {
  return {
    method: 'POST',
    body: JSON.stringify({ model: 'deepseek-v4-flash', reasoning: { effort: 'none' }, max_output_tokens: maxOutputTokens, instructions: 'Synthetic lab input' }),
  };
}

describe('cumulative Agent A paid-call budget', () => {
  it.each([0, 0.37])('rejects a ledger resetting prior spend to %s', async (prior) => {
    let sent = 0;
    const budgeted = withAgentAApiBudget(async () => { sent++; return new Response('{}'); }, ledger(prior));
    await expect(budgeted('https://api.deepseek.com/responses', request)).rejects.toThrow('AGENT_A_BUDGET_INVALID');
    expect(sent).toBe(0);
  });
  it.each([null, -1])('rejects an invalid accounted cost %s before another request', async (cost) => {
    const file = ledger();
    writeFileSync(file, JSON.stringify({ priorSpendUsd: 0.38, limitUsd: resolveAuthorizedLimitUsd({}), calls: [{ accountedUsd: cost, reservedUsd: 0.01 }] }));
    let sent = 0;
    const budgeted = withAgentAApiBudget(async () => { sent++; return new Response('{}'); }, file);
    await expect(budgeted('https://api.deepseek.com/responses', request)).rejects.toThrow('AGENT_A_BUDGET_INVALID');
    expect(sent).toBe(0);
  });
  it('keeps its reservation when the provider reports malformed cached usage', async () => {
    const file = ledger();
    const budgeted = withAgentAApiBudget(async () => Response.json({ usage: {
      input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 'malformed' },
    } }), file);
    await budgeted('https://api.deepseek.com/responses', request);
    const result = JSON.parse(readFileSync(file, 'utf8'));
    expect(result.calls[0].accountedUsd).toBeGreaterThan(0);
    expect(result.calls[0].accountedUsd).toBe(result.calls[0].reservedUsd);
  });
  it('refuses a request before sending when its reservation exceeds the remaining campaign cap', async () => {
    let sent = 0;
    const budgeted = withAgentAApiBudget(
      async () => { sent++; return new Response('{}'); },
      ledger(resolveAuthorizedLimitUsd({}) - 0.001),
    );
    await expect(budgeted('https://api.deepseek.com/responses', request)).rejects.toThrow('AGENT_A_BUDGET_EXHAUSTED');
    expect(sent).toBe(0);
  });
  it('keeps the reservation for a failed call and records the retry separately without resetting prior spend', async () => {
    const file = ledger();
    let sent = 0;
    const budgeted = withAgentAApiBudget(async () => {
      if (++sent === 1) throw new Error('timeout');
      return Response.json({ usage: { input_tokens: 1000, input_tokens_details: { cached_tokens: 500 }, output_tokens: 100 } });
    }, file);
    await expect(budgeted('https://api.deepseek.com/responses', request)).rejects.toThrow('timeout');
    await budgeted('https://api.deepseek.com/responses', request);
    const result = JSON.parse(readFileSync(file, 'utf8'));
    expect(result.priorSpendUsd).toBe(0.38);
    expect(result.calls).toHaveLength(2);
    expect(result.calls[0].usage).toBeNull();
    expect(result.calls[0].reservedUsd).toBeGreaterThan(0);
    expect(result.calls[1].accountedUsd).toBeCloseTo(0.000359, 8);
  });
});

describe('max output tokens ceiling', () => {
  it('accepts a request at the 1600-token default ceiling', async () => {
    let sent = 0;
    const budgeted = withAgentAApiBudget(async () => { sent++; return new Response('{}'); }, ledger());
    await budgeted('https://api.deepseek.com/responses', requestWithMaxOutputTokens(1600));
    expect(sent).toBe(1);
  });

  it('rejects a request above the ceiling before sending', async () => {
    let sent = 0;
    const budgeted = withAgentAApiBudget(async () => { sent++; return new Response('{}'); }, ledger());
    await expect(budgeted('https://api.deepseek.com/responses', requestWithMaxOutputTokens(1601)))
      .rejects.toThrow('AGENT_A_BUDGET_UNSUPPORTED_MODEL_PARAMETERS');
    expect(sent).toBe(0);
  });

  it('scales the reservation with the requested token count instead of pinning it to 800', async () => {
    const file800 = ledger();
    const budgeted800 = withAgentAApiBudget(async () => new Response('{}'), file800);
    await budgeted800('https://api.deepseek.com/responses', requestWithMaxOutputTokens(800));
    const reserved800 = JSON.parse(readFileSync(file800, 'utf8')).calls[0].reservedUsd;

    const file1600 = ledger();
    const budgeted1600 = withAgentAApiBudget(async () => new Response('{}'), file1600);
    await budgeted1600('https://api.deepseek.com/responses', requestWithMaxOutputTokens(1600));
    const reserved1600 = JSON.parse(readFileSync(file1600, 'utf8')).calls[0].reservedUsd;

    expect(reserved1600).toBeGreaterThan(reserved800);
  });

  it('rejects every request when the configured ceiling itself is invalid', async () => {
    const previous = process.env.STUDYX_AGENT_A_BUDGET_MAX_OUTPUT_TOKENS;
    process.env.STUDYX_AGENT_A_BUDGET_MAX_OUTPUT_TOKENS = 'abc';
    try {
      let sent = 0;
      const budgeted = withAgentAApiBudget(async () => { sent++; return new Response('{}'); }, ledger());
      await expect(budgeted('https://api.deepseek.com/responses', requestWithMaxOutputTokens(800)))
        .rejects.toThrow('AGENT_A_BUDGET_MAX_OUTPUT_TOKENS_INVALID');
      expect(sent).toBe(0);
    } finally {
      if (previous === undefined) delete process.env.STUDYX_AGENT_A_BUDGET_MAX_OUTPUT_TOKENS;
      else process.env.STUDYX_AGENT_A_BUDGET_MAX_OUTPUT_TOKENS = previous;
    }
  });
});

describe('max output tokens ceiling resolution', () => {
  it('defaults to 1600 when the environment does not set a ceiling', () => {
    expect(resolveMaxOutputTokensCeilingV1({})).toBe(1600);
  });

  it('takes the ceiling from configuration when present', () => {
    expect(resolveMaxOutputTokensCeilingV1({ STUDYX_AGENT_A_BUDGET_MAX_OUTPUT_TOKENS: '2000' })).toBe(2000);
  });

  it.each(['0', '-1', 'abc', '', '1.5'])('rejects the invalid configured ceiling %s', (value) => {
    expect(() => resolveMaxOutputTokensCeilingV1({ STUDYX_AGENT_A_BUDGET_MAX_OUTPUT_TOKENS: value }))
      .toThrow('AGENT_A_BUDGET_MAX_OUTPUT_TOKENS_INVALID');
  });
});

describe('authorized limit resolution', () => {
  it('defaults to the currently authorized 1.14 limit when the environment does not set one', () => {
    expect(resolveAuthorizedLimitUsd({})).toBe(1.14);
  });

  it('takes the limit from configuration when present', () => {
    expect(resolveAuthorizedLimitUsd({ STUDYX_AGENT_A_BUDGET_LIMIT_USD: '2.5' })).toBe(2.5);
  });

  it.each(['0', '-1', 'abc', ''])('rejects the invalid configured limit %s', (value) => {
    expect(() => resolveAuthorizedLimitUsd({ STUDYX_AGENT_A_BUDGET_LIMIT_USD: value }))
      .toThrow('AGENT_A_BUDGET_LIMIT_INVALID');
  });
});
