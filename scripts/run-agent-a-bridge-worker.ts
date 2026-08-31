import { createInterface } from 'node:readline';

import postgres from 'postgres';

import { createLocalTurnSender } from './run-agent-a-conversations';
import { formatBridgeWorkerError } from './lib/bridge-worker-error';
import { createLocalEvalClaimCleanup } from './lib/local-eval-claim-cleanup';

type WorkerRequest = {
  readonly id: string;
  readonly message: string;
  readonly conversationId: string | null;
  readonly configuration?: { readonly replayCommitOnTurn?: number };
};

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`LOCAL_TRANSPORT_CREDENTIAL_MISSING:${name}`);
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function parseRequest(line: string): WorkerRequest {
  const value = JSON.parse(line) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('INVALID_WORKER_REQUEST');
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.id !== 'string'
    || !/^[A-Za-z0-9._-]{1,128}$/u.test(input.id)
    || typeof input.message !== 'string'
    || !input.message.trim()
    || (input.conversationId !== null && typeof input.conversationId !== 'string')
  ) throw new Error('INVALID_WORKER_REQUEST');
  return input as WorkerRequest;
}

async function main(): Promise<void> {
  const databaseUrl = required('TEST_DATABASE_URL');
  const database = new URL(databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol)
    || database.hostname !== '127.0.0.1'
    || !['55432', '55433', '55434', '55435'].includes(database.port)
    || database.pathname !== '/studyx_test'
  ) throw new Error('REFUSING_NON_LOCAL_TEST_DATABASE_URL');
  const sql = postgres(databaseUrl, { max: 1, connection: { application_name: 'studyx_eval_claim_cleanup' } });
  const send = createLocalTurnSender({
    apiBaseUrl: required('STUDYX_LOCAL_API_BASE_URL'),
    orchestratorKey: optional('STUDYX_ORCHESTRATOR_KEY')
      ?? required('ORCHESTRATOR_API_KEY'),
    orchestratorKeyId: optional('ORCHESTRATOR_KEY_ID') ?? 'botpress-dev',
    signingSecret: required('STUDYX_SIGNING_SECRET'),
    cronSecret: optional('CRON_SECRET') ?? null,
    geminiApiKey: optional('GEMINI_API_KEY'),
    geminiModel: optional('GEMINI_MODEL') ?? 'gemini-3.6-flash',
    groqApiKey: optional('GROQ_API_KEY'),
    groqModel: optional('GROQ_MODEL') ?? 'openai/gpt-oss-120b',
    deepseekApiKey: required('DEEPSEEK_API_KEY'),
    deepseekModel: optional('DEEPSEEK_MODEL') ?? 'deepseek-v4-flash',
  }, required('STUDYX_WORKER_RUN_ID'), 'groq', 0, true, 'deepseek',
  createLocalEvalClaimCleanup(sql));
  const completedTurns = new Map<string, number>();
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  process.stdout.write(`${JSON.stringify({ type: 'ready' })}\n`);

  try {
    for await (const line of input) {
      let requestId = 'invalid';
      try {
        const request = parseRequest(line);
        requestId = request.id;
        const turnNumber = request.conversationId === null
          ? 1
          : (completedTurns.get(request.conversationId) ?? 0) + 1;
        const result = await send(request.message, request.conversationId, {
          forceProviderFailure: false,
          replayCommit: request.configuration?.replayCommitOnTurn === turnNumber,
        });
        completedTurns.set(result.conversationId, turnNumber);
        process.stdout.write(`${JSON.stringify({
          type: 'response',
          id: request.id,
          ok: true,
          result,
        })}\n`);
      } catch (error) {
        process.stdout.write(`${JSON.stringify({
          type: 'response',
          id: requestId,
          ok: false,
          error: formatBridgeWorkerError(error),
        })}\n`);
      }
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'WORKER_STARTUP_ERROR'}\n`);
  process.exitCode = 1;
});
