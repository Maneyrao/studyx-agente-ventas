import { randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';

// Test/lab boundary only. Reservations use peak prices and byte-counted input
// plus overhead, so missing provider usage is never silently charged as zero.
const INPUT_RATE = 0.44 / 1_000_000;
const CACHED_RATE = 0.014 / 1_000_000;
const OUTPUT_RATE = 1.32 / 1_000_000;
const DEFAULT_AUTHORIZED_LIMIT_USD = 1.08;

export function resolveAuthorizedLimitUsd(environment = process.env) {
  const raw = environment.STUDYX_AGENT_A_BUDGET_LIMIT_USD;
  if (raw === undefined) return DEFAULT_AUTHORIZED_LIMIT_USD;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('AGENT_A_BUDGET_LIMIT_INVALID');
  return parsed;
}

function mutateLedger(filename, change) {
  const lock = `${filename}.lock`;
  const fd = openSync(lock, 'wx', 0o600);
  try {
    const ledger = JSON.parse(readFileSync(filename, 'utf8'));
    if (!Number.isFinite(ledger.priorSpendUsd) || ledger.priorSpendUsd < 0.38
      || ledger.limitUsd !== resolveAuthorizedLimitUsd() || !Array.isArray(ledger.calls)
      || !ledger.calls.every((call) => Number.isFinite(call.accountedUsd) && call.accountedUsd >= 0
        && Number.isFinite(call.reservedUsd) && call.reservedUsd >= 0)) throw new Error('AGENT_A_BUDGET_INVALID');
    change(ledger);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, filename);
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

/** @param {typeof fetch} fetchImplementation @param {string} ledgerPath */
export function withAgentAApiBudget(fetchImplementation, ledgerPath) {
  return async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    if (url.origin !== 'https://api.deepseek.com') return fetchImplementation(request, init);
    if (url.pathname !== '/responses' || typeof init?.body !== 'string') throw new Error('AGENT_A_BUDGET_UNSUPPORTED_REQUEST');
    const body = JSON.parse(init.body);
    if (body.model !== 'deepseek-v4-flash' || body.reasoning?.effort !== 'none'
      || body.max_output_tokens !== 800 || body.stream === true) throw new Error('AGENT_A_BUDGET_UNSUPPORTED_MODEL_PARAMETERS');
    const reservedUsd = (Buffer.byteLength(init.body, 'utf8') + 4096) * INPUT_RATE + 800 * OUTPUT_RATE;
    const call = { id: randomUUID(), at: new Date().toISOString(), reservedUsd, accountedUsd: reservedUsd, usage: null, status: 'reserved' };
    mutateLedger(ledgerPath, (ledger) => {
      const used = ledger.priorSpendUsd + ledger.calls.reduce((sum, previous) => sum + previous.accountedUsd, 0);
      if (!Number.isFinite(used) || used + reservedUsd > ledger.limitUsd) throw new Error('AGENT_A_BUDGET_EXHAUSTED');
      ledger.calls.push(call);
    });
    const response = await fetchImplementation(request, init);
    // A network/body failure keeps the complete reservation, including any
    // eventual bill for a response the client could not observe.
    let payload;
    try { payload = await response.clone().json(); } catch { return response; }
    const usage = payload?.usage;
    const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
    if (Number.isInteger(usage?.input_tokens) && usage.input_tokens >= 0
      && Number.isInteger(usage?.output_tokens) && usage.output_tokens >= 0
      && Number.isInteger(cached) && cached >= 0 && cached <= usage.input_tokens) {
      const accountedUsd = (usage.input_tokens - cached) * INPUT_RATE + cached * CACHED_RATE + usage.output_tokens * OUTPUT_RATE;
      mutateLedger(ledgerPath, (ledger) => {
        const record = ledger.calls.find((item) => item.id === call.id);
        Object.assign(record, { usage, accountedUsd, status: response.status });
      });
    }
    return response;
  };
}

if (process.env.STUDYX_AGENT_A_BUDGET_FILE) {
  globalThis.fetch = withAgentAApiBudget(globalThis.fetch, process.env.STUDYX_AGENT_A_BUDGET_FILE);
}
