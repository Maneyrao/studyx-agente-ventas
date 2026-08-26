import { execFile, execFileSync } from 'node:child_process';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

import {
  assertSuitePromptVersion,
  buildAdkChatArgs,
  composeAgentARegressionSuite,
  runConversationSuite,
  validateSuiteCaseInvariants,
  type AgentChatResult,
  type AgentTurnDiagnostic,
  type ConversationSuite,
} from './lib/agent-a-conversation-runner';
import {
  evaluatePersistenceEvidence,
  type PersistenceEvidence,
} from './lib/agent-a-persistence-verifier';
import { AGENT_A_PROMPT_VERSION } from '../botpress-agent/src/prompts/agent-a-sales-bridge';
import { buildAgentASalesBridgeCompactInstructions } from '../botpress-agent/src/prompts/agent-a-sales-bridge';
import {
  ClaimResponseSchema,
  CommitDecisionResponseSchema,
  DeliveryReportResponseSchema,
  IngestResponseSchema,
  type ClaimedTurn,
  type Decision,
} from '../botpress-agent/src/schemas/contracts';
import {
  DEFAULT_DEVELOPMENT_EMULATOR_PHONE_E164,
  buildEmulatorEnvelope,
} from '../botpress-agent/src/channels/shared/emulator-envelope';
import {
  DEFAULT_GROQ_MODEL,
  generateGroqDecision,
} from '../botpress-agent/src/lib/decision/groq-direct';
import {
  DEFAULT_GEMINI_MODEL,
  generateGeminiDecision,
  MAX_GEMINI_DECISION_TIMEOUT_MS,
} from '../botpress-agent/src/lib/decision/gemini-direct';
import { applyDecisionPolicy, technicalFallback } from '../botpress-agent/src/utils/decision-policy';
import { routeCommercialTurn } from '../botpress-agent/src/utils/commercial-router';
import { deliverAuthorizedLocalOutbound } from './lib/local-authorized-delivery';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const botpressDir = path.join(projectRoot, 'botpress-agent');
const defaultSuitePath = path.join(
  botpressDir,
  'evals/personas/studyx-happy-path-cases-v6.json',
);

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function makeRunId(): string {
  return new Date().toISOString().replace(/\D/g, '').slice(0, 14);
}

function nonNegativeIntegerArgument(name: string): number {
  const raw = argument(name);
  if (raw === null) return 0;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
    throw new Error(`INVALID_${name.replace(/^--/u, '').replaceAll('-', '_').toUpperCase()}`);
  }
  return value;
}

function localDatabaseUrl(): string {
  const raw = argument('--database-url') ?? process.env.TEST_DATABASE_URL ?? '';
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('INVALID_TEST_DATABASE_URL');
  }
  const allowedPorts = new Set(['55432', '55433', '55434', '55435']);
  if (
    parsed.hostname !== '127.0.0.1' ||
    !allowedPorts.has(parsed.port) ||
    parsed.pathname !== '/studyx_test'
  ) {
    throw new Error('REFUSING_NON_LOCAL_TEST_DATABASE_URL');
  }
  return raw;
}

async function sendAdkTurn(
  message: string,
  conversationId: string | null,
): Promise<AgentChatResult> {
  const { stdout } = await execFileAsync(
    'adk',
    buildAdkChatArgs(message, conversationId, argument('--timeout') ?? '1m'),
    { cwd: botpressDir, timeout: 75_000, maxBuffer: 2 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as AgentChatResult & { error?: string };
  if (parsed.error) throw new Error(parsed.error);
  if (!parsed.conversationId || !Array.isArray(parsed.responses)) {
    throw new Error('INVALID_ADK_CHAT_RESPONSE');
  }
  return parsed;
}

type LocalCredentials = {
  apiBaseUrl: string;
  orchestratorKey: string;
  orchestratorKeyId: string;
  signingSecret: string;
  cronSecret: string | null;
  geminiApiKey: string;
  geminiModel: string;
  groqApiKey: string;
  groqModel: string;
};

function parseDotEnv(contents: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/u)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/u);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value.replaceAll('\\n', '\n');
  }
  return values;
}

async function loadLocalCredentials(primaryProvider: 'groq' | 'gemini'): Promise<LocalCredentials> {
  const envFile = parseDotEnv(await readFile(path.join(projectRoot, '.env.local'), 'utf8'));
  const adkSecrets = JSON.parse(
    await readFile(path.join(botpressDir, '.adk/secrets.json'), 'utf8'),
  ) as { dev?: Record<string, string> };
  const value = (name: string, aliases: string[] = []) => {
    for (const key of [name, ...aliases]) {
      const candidate = process.env[key] ?? envFile[key] ?? adkSecrets.dev?.[key];
      if (candidate) return candidate;
    }
    throw new Error(`LOCAL_TRANSPORT_CREDENTIAL_MISSING:${name}`);
  };

  return {
    apiBaseUrl: localApiBaseUrl(),
    orchestratorKey: value('STUDYX_ORCHESTRATOR_KEY', ['ORCHESTRATOR_API_KEY']),
    orchestratorKeyId: process.env.ORCHESTRATOR_KEY_ID ?? envFile.ORCHESTRATOR_KEY_ID ?? 'botpress-dev',
    signingSecret: value('STUDYX_SIGNING_SECRET'),
    cronSecret: process.env.CRON_SECRET ?? envFile.CRON_SECRET ?? adkSecrets.dev?.CRON_SECRET ?? null,
    geminiApiKey: value('GEMINI_API_KEY'),
    geminiModel: argument('--gemini-model')
      ?? (primaryProvider === 'gemini' ? argument('--model') : null)
      ?? process.env.GEMINI_MODEL
      ?? envFile.GEMINI_MODEL
      ?? DEFAULT_GEMINI_MODEL,
    groqApiKey: value('GROQ_API_KEY'),
    groqModel: argument('--groq-model')
      ?? (primaryProvider === 'groq' ? argument('--model') : null)
      ?? DEFAULT_GROQ_MODEL,
  };
}

/** A local evaluator must never be pointed at a deployed API by accident. */
function localApiBaseUrl(): string {
  const raw = argument('--api-base-url') ?? 'http://127.0.0.1:3000';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('INVALID_LOCAL_API_BASE_URL');
  }
  if (
    url.protocol !== 'http:'
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || !url.port
    || url.pathname !== '/'
  ) {
    throw new Error('REFUSING_NON_LOCAL_API_BASE_URL');
  }
  return url.toString();
}

async function localSignedJson<T>(input: {
  credentials: LocalCredentials;
  path: string;
  body: unknown;
  idempotencyKey: string;
  traceId: string;
  acceptedStatuses?: number[];
  parse: (value: unknown) => T;
}): Promise<T> {
  const method = 'POST';
  const url = new URL(input.path, input.credentials.apiBaseUrl);
  const body = JSON.stringify(input.body);
  const timestamp = Date.now().toString();
  const canonical = [timestamp, method, url.pathname, body].join('\n');
  const signature = createHmac('sha256', input.credentials.signingSecret)
    .update(canonical)
    .digest('hex');
  const response = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-orchestrator-key-id': input.credentials.orchestratorKeyId,
      'x-orchestrator-key': input.credentials.orchestratorKey,
      'x-request-timestamp': timestamp,
      'x-signature': `v1=${signature}`,
      'x-request-id': `${input.traceId}:${input.idempotencyKey}`.slice(0, 512),
      'x-trace-id': input.traceId,
      'idempotency-key': input.idempotencyKey,
    },
    body,
  });
  const payload = await response.json().catch(() => null) as {
    error?: unknown;
    reason?: unknown;
  } | null;
  const accepted = response.ok || input.acceptedStatuses?.includes(response.status);
  if (!accepted) {
    const safeCode = typeof payload?.error === 'string' ? payload.error : `HTTP_${response.status}`;
    const reason = typeof payload?.reason === 'string' ? payload.reason : null;
    throw new LocalStudyxHttpError(response.status, safeCode, reason);
  }
  return input.parse(payload);
}

class LocalStudyxHttpError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly reason: string | null,
  ) {
    super(`LOCAL_STUDYX_${error}`);
    this.name = 'LocalStudyxHttpError';
  }
}

function withTurnDiagnostic(error: unknown, turnDiagnostic: AgentTurnDiagnostic): Error & {
  turnDiagnostic: AgentTurnDiagnostic;
} {
  const diagnosticError = error instanceof Error
    ? error
    : new Error(String(error));
  return Object.assign(diagnosticError, { turnDiagnostic });
}

async function flushLocalPostTurn(credentials: LocalCredentials, traceId: string): Promise<void> {
  if (!credentials.cronSecret) return;
  await Promise.all([
    '/api/cron/flush-projections',
    '/api/cron/memory-maintenance',
  ].map(async (route) => {
    try {
      await fetch(new URL(route, credentials.apiBaseUrl), {
        method: 'GET',
        headers: {
          authorization: `Bearer ${credentials.cronSecret}`,
          'x-trace-id': traceId,
        },
      });
    } catch {
      // These queues are durable and best-effort, exactly like the ADK action.
    }
  }));
}

export function createLocalTurnSender(
  credentials: LocalCredentials,
  runId: string,
  modelProvider: 'groq' | 'gemini',
  minimumModelIntervalMs: number,
  skipPostTurnCrons = false,
) {
  const gitSha = process.env.GIT_COMMIT_SHA
    ?? process.env.VERCEL_GIT_COMMIT_SHA
    ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const turnCounters = new Map<string, number>();
  let previousModelStartedAt: number | null = minimumModelIntervalMs > 0 ? Date.now() : null;

  const paceModelProvider = async (): Promise<number> => {
    if (minimumModelIntervalMs === 0) return 0;
    let waitedMs = 0;
    if (previousModelStartedAt !== null) {
      const remainingMs = minimumModelIntervalMs - (Date.now() - previousModelStartedAt);
      if (remainingMs > 0) {
        console.error(`  esperando cuota de modelo ${remainingMs}ms`);
        const waitStartedAt = Date.now();
        await new Promise((resolve) => setTimeout(resolve, remainingMs));
        waitedMs = Date.now() - waitStartedAt;
      }
    }
    previousModelStartedAt = Date.now();
    return waitedMs;
  };

  return async (message: string, existingConversationId: string | null): Promise<AgentChatResult> => {
    const turnStartedAt = Date.now();
    const latenciesMs: Record<string, number> = {};
    const conversationId = existingConversationId ?? `local-eval-${runId}-${randomUUID()}`;
    const turnNumber = (turnCounters.get(conversationId) ?? 0) + 1;
    turnCounters.set(conversationId, turnNumber);
    const traceId = randomUUID();
    let evaluationPacingMs = 0;
    const externalMessageId = `local-eval:${runId}:${turnNumber}:${randomUUID()}`;
    const envelope = buildEmulatorEnvelope({
      emulatorPhoneE164: DEFAULT_DEVELOPMENT_EMULATOR_PHONE_E164,
      integrationId: 'local-agent-a-eval',
      externalMessageId,
      externalConversationId: conversationId,
      externalUserId: conversationId,
      traceId,
      text: message,
      occurredAt: new Date().toISOString(),
      botpressConversationId: conversationId,
      botpressUserId: conversationId,
    });
    const ingestStartedAt = Date.now();
    const ingested = await localSignedJson({
      credentials,
      path: '/api/agent/ingest',
      body: envelope,
      idempotencyKey: `inbound:${envelope.source}:${envelope.integration_id}:${externalMessageId}`,
      traceId,
      parse: (value) => IngestResponseSchema.parse(value),
    });
    latenciesMs.ingest_ms = Date.now() - ingestStartedAt;

    let claimed: ClaimedTurn | null = null;
    const claimStartedAt = Date.now();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const claim = await localSignedJson({
        credentials,
        path: `/api/agent/batches/${ingested.batch.id}/claim`,
        body: { trace_id: traceId, claimed_by: `local-eval:${runId}`.slice(0, 128) },
        idempotencyKey: `claim:${ingested.batch.id}`,
        traceId,
        acceptedStatuses: [202, 404, 409, 410],
        parse: (value) => ClaimResponseSchema.parse(value),
      });
      if (claim.outcome === 'claimed') {
        claimed = claim;
        break;
      }
      if (claim.outcome !== 'waiting') {
        throw new Error(`LOCAL_CLAIM_${claim.outcome.toUpperCase()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.max(10, claim.retry_after_ms)));
    }
    latenciesMs.claim_ms = Date.now() - claimStartedAt;
    if (!claimed) throw new Error('LOCAL_CLAIM_RETRY_EXHAUSTED');

    const commercialRoute = routeCommercialTurn({
      automationEnabled: true,
      claimed,
    });
    let decision: Decision;
    let provider: 'botpress' | 'groq-direct' | 'google-ai-direct';
    let decisionModel: string;
    let fallbackReason: string | null = null;
    if (commercialRoute.kind !== 'model_required') {
      decision = commercialRoute.decision;
      provider = 'botpress';
      decisionModel = commercialRoute.model;
    } else {
      const modelStartedAt = Date.now();
      try {
        evaluationPacingMs += await paceModelProvider();
        const commonInput = {
          instructions: buildAgentASalesBridgeCompactInstructions(claimed),
          signal: new AbortController().signal,
          timeoutMs: MAX_GEMINI_DECISION_TIMEOUT_MS,
        };
        const generated = modelProvider === 'gemini'
          ? await generateGeminiDecision({
              ...commonInput,
              apiKey: credentials.geminiApiKey,
              model: credentials.geminiModel,
            })
          : await generateGroqDecision({
              ...commonInput,
              apiKey: credentials.groqApiKey,
              model: credentials.groqModel,
            });
        decision = generated.decision;
        provider = generated.provider;
        decisionModel = generated.model;
      } catch (error) {
        const errorCode = error instanceof Error ? error.message.slice(0, 128) : 'UNKNOWN';
        fallbackReason = errorCode;
        console.error(`  proveedor local falló: ${errorCode}`);
        decision = technicalFallback();
        provider = modelProvider === 'gemini' ? 'google-ai-direct' : 'groq-direct';
        decisionModel = 'policy:model-unavailable';
      }
      latenciesMs.model_ms = Date.now() - modelStartedAt;
    }
    decision = applyDecisionPolicy(decision, claimed);

    const claimTimeDiagnostic: AgentTurnDiagnostic = {
      catalogResolution: claimed.catalog_resolution,
      selectedOfferingCode: claimed.sales_context.offering_code,
      decisionBusinessAction: decision.business_action
        ? { ...decision.business_action }
        : null,
      authorizedProtectedFacts: [],
      authorizedUrls: [],
      commitError: null,
    };

    let committed;
    const commitStartedAt = Date.now();
    try {
      committed = await localSignedJson({
        credentials,
        path: `/api/agent/turns/${claimed.turn_id}/decision`,
        body: {
          turn_id: claimed.turn_id,
          trace_id: traceId,
          authorized_offering_code: claimed.sales_context.offering_code,
          decision,
          model: {
            provider,
            model: decisionModel,
            prompt_version: AGENT_A_PROMPT_VERSION,
          },
          batch_id: claimed.batch.id,
          claim_token: claimed.batch.claim_token,
        },
        idempotencyKey: `decision:${claimed.turn_id}`,
        traceId,
        parse: (value) => CommitDecisionResponseSchema.parse(value),
      });
    } catch (error) {
      const commitError = error instanceof LocalStudyxHttpError
        ? { status: error.status, error: error.error, reason: error.reason }
        : null;
      throw withTurnDiagnostic(error, { ...claimTimeDiagnostic, commitError });
    }
    latenciesMs.commit_ms = Date.now() - commitStartedAt;
    const turnDiagnostic: AgentTurnDiagnostic = {
      ...claimTimeDiagnostic,
      authorizedProtectedFacts:
        committed.outbound?.authorized_egress.protected_facts ?? [],
      authorizedUrls: committed.outbound?.authorized_egress.authorized_urls ?? [],
    };
    const runtimeBase = {
      git_sha: gitSha,
      transport: 'local' as const,
      provider,
      model: decisionModel,
      prompt_version: AGENT_A_PROMPT_VERSION,
      route_origin: commercialRoute.origin,
      route_reason: commercialRoute.reason,
      raw_response_hash: decision.response === null
        ? null
        : createHash('sha256').update(decision.response).digest('hex'),
      fallback_reason: fallbackReason,
      latencies_ms: latenciesMs,
    };
    const commercialEvidence: NonNullable<AgentChatResult['commercialEvidence']> = {
      catalogResolution: claimed.catalog_resolution,
      snapshotOfferings: (claimed.business_context?.offerings ?? []).map((offering) => ({
        code: offering.code,
        displayName: offering.display_name,
      })),
      offeringsTruncated: claimed.business_context
        ? claimed.business_context.offerings_truncated
        : null,
      selectedOfferingCode: turnDiagnostic.selectedOfferingCode,
      decisionBusinessAction: decision.business_action
        ? { ...decision.business_action }
        : null,
      authorizedProtectedFacts: turnDiagnostic.authorizedProtectedFacts,
      authorizedUrls: turnDiagnostic.authorizedUrls,
    };
    if (!committed.outbound) {
      return {
        conversationId,
        responses: [],
        commercialEvidence,
        turnDiagnostic,
        runtime: { ...runtimeBase, committed_response_hash: null },
        evaluationPacingMs,
      };
    }

    let localDelivery;
    const deliveryStartedAt = Date.now();
    try {
      localDelivery = await deliverAuthorizedLocalOutbound({
        trace_id: traceId,
        outbound: committed.outbound,
        createMessageId: () => `local-eval-${randomUUID()}`,
        reportDelivery: async (report) => {
          const reportIdentity = report.botpress_message_id ?? report.error_code ?? 'egress-blocked';
          await localSignedJson({
            credentials,
            path: `/api/agent/outbounds/${committed.outbound!.id}/delivery`,
            body: report,
            idempotencyKey:
              `delivery:${committed.outbound!.id}:${reportIdentity}:${report.status}`,
            traceId,
            parse: (value) => DeliveryReportResponseSchema.parse(value),
          });
        },
        // Evals must opt in to queue drains: payment projection could otherwise
        // reach a real Sheets destination while validating a local database.
        afterSubmitted: skipPostTurnCrons
          ? async () => undefined
          : () => flushLocalPostTurn(credentials, traceId),
      });
    } catch (error) {
      throw withTurnDiagnostic(error, turnDiagnostic);
    }
    latenciesMs.delivery_ms = Date.now() - deliveryStartedAt;
    latenciesMs.total_turn_ms = Date.now() - turnStartedAt;
    if (localDelivery.kind === 'blocked') {
      return {
        conversationId,
        responses: [],
        commercialEvidence,
        turnDiagnostic,
        runtime: { ...runtimeBase, committed_response_hash: null },
        evaluationPacingMs,
      };
    }
    return {
      conversationId,
      responses: [{ type: 'text', text: localDelivery.content }],
      authorizedUrls: [...committed.outbound.authorized_egress.authorized_urls],
      commercialEvidence,
      turnDiagnostic,
      runtime: {
        ...runtimeBase,
        committed_response_hash: createHash('sha256').update(committed.outbound.content).digest('hex'),
      },
      evaluationPacingMs,
    };
  };
}

async function main() {
  const suitePath = path.resolve(argument('--file') ?? defaultSuitePath);
  const extensionSource = await readFile(suitePath);
  const extensionSuite = JSON.parse(extensionSource.toString('utf8')) as ConversationSuite;
  let suite = extensionSuite;
  if (extensionSuite.base_suite) {
    const basePath = path.resolve(path.dirname(suitePath), extensionSuite.base_suite);
    const baseSource = await readFile(basePath);
    const baseSuite = JSON.parse(baseSource.toString('utf8')) as ConversationSuite;
    suite = composeAgentARegressionSuite({
      baseSuite,
      extensionSuite,
      baseSha256: createHash('sha256').update(baseSource).digest('hex'),
      extensionSha256: createHash('sha256').update(extensionSource).digest('hex'),
    });
  }
  const requestedCase = argument('--case');
  const startAtCase = argument('--start-at');
  const requestedCases = argument('--cases')
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
  if ([Boolean(requestedCase), requestedCases.length > 0, Boolean(startAtCase)].filter(Boolean).length > 1) {
    throw new Error('CASE_SELECTORS_CONFLICT');
  }
  const requestedCaseSet = new Set(requestedCases);
  const startAtIndex = startAtCase ? suite.cases.findIndex((item) => item.id === startAtCase) : -1;
  if (startAtCase && startAtIndex < 0) throw new Error('UNKNOWN_START_AT_CASE');
  const selectedSuite: ConversationSuite = {
    ...suite,
    cases: requestedCase
      ? suite.cases.filter((item) => item.id === requestedCase)
      : requestedCaseSet.size > 0
        ? suite.cases.filter((item) => requestedCaseSet.has(item.id))
        : startAtIndex >= 0
          ? suite.cases.slice(startAtIndex)
          : suite.cases,
  };
  if (requestedCaseSet.size > 0 && selectedSuite.cases.length !== requestedCaseSet.size) {
    throw new Error('UNKNOWN_CASE_IN_SELECTOR');
  }
  if (selectedSuite.cases.length === 0) throw new Error('NO_MATCHING_CASES');
  const invariantViolations = validateSuiteCaseInvariants(selectedSuite);
  if (invariantViolations.length > 0) {
    throw new Error(`INVALID_CONVERSATION_SUITE:${invariantViolations.join(',')}`);
  }
  // Abort before opening any DB connection or spending an adk chat call on a
  // suite frozen against a stale version of the Agent A prompt contract.
  assertSuitePromptVersion(selectedSuite.prompt_version, AGENT_A_PROMPT_VERSION);

  const runId = argument('--run-id') ?? makeRunId();
  const transport = argument('--transport') ?? 'adk';
  if (transport !== 'adk' && transport !== 'local') {
    throw new Error('INVALID_AGENT_A_TRANSPORT');
  }
  const minimumTurnIntervalMs = nonNegativeIntegerArgument('--min-turn-interval-ms');
  const localModelProvider = argument('--provider') ?? 'groq';
  if (localModelProvider !== 'groq' && localModelProvider !== 'gemini') {
    throw new Error('INVALID_LOCAL_MODEL_PROVIDER');
  }
  const selectedSendTurn = transport === 'local'
    ? createLocalTurnSender(
        await loadLocalCredentials(localModelProvider),
        runId,
        localModelProvider,
        minimumTurnIntervalMs,
        process.argv.includes('--skip-post-turn-crons'),
      )
    : sendAdkTurn;
  const verifyDatabase = process.argv.includes('--verify-db');
  const db = verifyDatabase ? postgres(localDatabaseUrl(), { max: 2 }) : null;
  let previousTurnStartedAt: number | null = null;

  const paceExternalProvider = async () => {
    if (minimumTurnIntervalMs === 0) return;
    if (previousTurnStartedAt !== null) {
      const remainingMs = minimumTurnIntervalMs - (Date.now() - previousTurnStartedAt);
      if (remainingMs > 0) {
        console.error(`  esperando cuota externa ${remainingMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, remainingMs));
      }
    }
    previousTurnStartedAt = Date.now();
  };

  const findConversation = async (externalConversationId: string) => {
    if (!db) throw new Error('DATABASE_VERIFICATION_DISABLED');
    const rows = await db<Array<{
      contact_id: string;
      phone: string;
      name: string | null;
      email: string | null;
      conversation_id: string;
    }>>`
      SELECT c.id AS contact_id, c.phone, c.name, c.email, conv.id AS conversation_id
      FROM channel_threads AS ct
      JOIN contacts AS c ON c.id = ct.contact_id
      JOIN conversations AS conv ON conv.channel_thread_id = ct.id
      WHERE ct.provider = 'botpress_emulator'
        AND ct.external_conversation_id = ${externalConversationId}
      ORDER BY conv.created_at DESC
      LIMIT 1
    `;
    return rows[0] ?? null;
  };

  const ensureSandbox = async (externalConversationId: string, caseId: string) => {
    if (!db) return;
    const identity = await findConversation(externalConversationId);
    if (!identity) throw new Error('EMULATOR_CONTACT_NOT_FOUND');
    await db`
      INSERT INTO sandbox_identities (provider, external_user_id, contact_id, synthetic_phone)
      VALUES (
        'telegram_sandbox',
        ${`eval:${runId}:${caseId}`},
        ${identity.contact_id}::uuid,
        ${identity.phone}
      )
      ON CONFLICT DO NOTHING
    `;
  };

  const verifyPersistence = async (
    testCase: ConversationSuite['cases'][number],
    externalConversationId: string,
  ) => {
    if (!db) throw new Error('DATABASE_VERIFICATION_DISABLED');
    const identity = await findConversation(externalConversationId);
    if (!identity) {
      return evaluatePersistenceEvidence(testCase, {
        contactId: null,
        phone: null,
        contactName: null,
        contactEmail: null,
        sandboxRegistered: false,
        inboundMessages: 0,
        outboundMessages: 0,
        decisions: 0,
        decisionsWithTrace: 0,
        activeMemoryValues: [],
        readyMemoryEmbeddings: 0,
        sheetRows: [],
        promptVersions: [],
        technicalFallbacks: 0,
        salesContext: null,
      }, { runId });
    }

    const [counts, memories, sheetRows, versions, salesContexts] = await Promise.all([
      db<Array<{
        inbound: number;
        outbound: number;
        decisions: number;
        decisions_with_trace: number;
        technical_fallbacks: number;
      }>>`
        SELECT
          count(*) FILTER (WHERE m.direction = 'inbound')::int AS inbound,
          count(*) FILTER (WHERE m.direction = 'outbound')::int AS outbound,
          count(ad.id)::int AS decisions,
          count(ad.id) FILTER (WHERE ad.trace_id IS NOT NULL)::int AS decisions_with_trace,
          count(ad.id) FILTER (WHERE ad.response_type = 'technical_fallback')::int AS technical_fallbacks
        FROM messages AS m
        LEFT JOIN agent_decisions AS ad ON ad.turn_id = m.id
        WHERE m.conversation_id = ${identity.conversation_id}::uuid
      `,
      db<Array<{ value_normalized: string; embedding_state: string }>>`
        SELECT value_normalized, embedding_state
        FROM selected_memories
        WHERE contact_id = ${identity.contact_id}::uuid AND status = 'active'
        ORDER BY created_at ASC
      `,
      db<Array<{
        plan: string;
        course_interest: string;
        state: string;
        nombre: string | null;
        apellido: string | null;
        email: string | null;
      }>>`
        SELECT
          payload->>'plan' AS plan,
          payload->>'curso_interes' AS course_interest,
          state,
          payload->>'nombre' AS nombre,
          payload->>'apellido' AS apellido,
          payload->>'email' AS email
        FROM sheet_projection_rows
        WHERE projection_key LIKE ${`%:${identity.contact_id}`}
        ORDER BY created_at ASC
      `,
      db<Array<{ prompt_version: string }>>`
        SELECT DISTINCT ad.prompt_version
        FROM agent_decisions AS ad
        JOIN messages AS m ON m.id = ad.turn_id
        WHERE m.conversation_id = ${identity.conversation_id}::uuid
        ORDER BY ad.prompt_version
      `,
      db<Array<{
        offering_code: string | null;
        offering_name: string | null;
        payment_plan: string | null;
        stage: string;
      }>>`
        SELECT
          sc.selected_offering_code AS offering_code,
          o.display_name AS offering_name,
          sc.selected_payment_plan AS payment_plan,
          sc.stage
        FROM sales_context_states AS sc
        LEFT JOIN offerings AS o
          ON o.workspace_id = sc.workspace_id
         AND o.code = sc.selected_offering_code
        WHERE sc.contact_id = ${identity.contact_id}::uuid
        LIMIT 1
      `,
    ]);
    const [sandboxRows, turnEvidence] = await Promise.all([
      db<Array<{ external_user_id: string }>>`
        SELECT external_user_id
        FROM sandbox_identities
        WHERE provider = 'telegram_sandbox'
          AND contact_id = ${identity.contact_id}::uuid
          AND external_user_id = ${`eval:${runId}:${testCase.id}`}
        LIMIT 1
      `,
      db<Array<{
        turn_number: number;
        turn_id: string;
        decision_id: string;
        trace_id: string | null;
        outbound_message_id: string | null;
      }>>`
        SELECT
          row_number() OVER (
            ORDER BY m.conversation_seq ASC, m.created_at ASC, m.id ASC
          )::integer AS turn_number,
          m.id AS turn_id,
          ad.id AS decision_id,
          ad.trace_id::text AS trace_id,
          ad.outbound_message_id::text AS outbound_message_id
        FROM messages AS m
        JOIN agent_decisions AS ad ON ad.turn_id = m.id
        WHERE m.conversation_id = ${identity.conversation_id}::uuid
          AND m.direction = 'inbound'
        ORDER BY m.conversation_seq ASC, m.created_at ASC, m.id ASC
      `,
    ]);
    const count = counts[0] ?? {
      inbound: 0,
      outbound: 0,
      decisions: 0,
      decisions_with_trace: 0,
      technical_fallbacks: 0,
    };
    const evidence: PersistenceEvidence = {
      contactId: identity.contact_id,
      phone: identity.phone,
      contactName: identity.name,
      contactEmail: identity.email,
      sandboxRegistered: sandboxRows.length === 1,
      inboundMessages: count.inbound,
      outboundMessages: count.outbound,
      decisions: count.decisions,
      decisionsWithTrace: count.decisions_with_trace,
      technicalFallbacks: count.technical_fallbacks,
      salesContext: salesContexts[0] ? {
        offeringCode: salesContexts[0].offering_code,
        offeringName: salesContexts[0].offering_name,
        paymentPlan: salesContexts[0].payment_plan,
        stage: salesContexts[0].stage,
      } : null,
      activeMemoryValues: memories.map((item) => item.value_normalized),
      readyMemoryEmbeddings: memories.filter((item) => item.embedding_state === 'ready').length,
      sheetRows: sheetRows.map((row) => ({
        plan: row.plan ?? '',
        courseInterest: row.course_interest ?? '',
        state: row.state,
        nombre: row.nombre ?? '',
        apellido: row.apellido ?? '',
        email: row.email ?? '',
      })),
      promptVersions: versions.map((item) => item.prompt_version),
      runScope: {
        sandboxExternalUserId: sandboxRows[0]?.external_user_id ?? null,
        externalConversationId,
        conversationId: identity.conversation_id,
      },
      turnEvidence: turnEvidence.map((turn) => ({
        turnNumber: Number(turn.turn_number),
        turnId: turn.turn_id,
        decisionId: turn.decision_id,
        traceId: turn.trace_id,
        outboundMessageId: turn.outbound_message_id,
      })),
    };
    return evaluatePersistenceEvidence(testCase, evidence, { runId });
  };

  const outputDir = path.join(botpressDir, 'evals/results');
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `happy-path-${runId}.json`);
  const writeCheckpoint = async (results: readonly import('./lib/agent-a-conversation-runner').ConversationCaseResult[]) => {
    const passed = results.filter((result) => result.status === 'passed').length;
    const executedCaseIds = results.map((result) => result.id);
    const regressionGateComplete = selectedSuite.composition
      ? executedCaseIds.length === selectedSuite.composition.effective_cases
        && selectedSuite.composition.effective_case_ids.every(
          (id) => executedCaseIds.includes(id),
        )
      : false;
    await writeFile(outputPath, `${JSON.stringify({
      run_id: runId,
      suite: selectedSuite.suite,
      prompt_version: selectedSuite.prompt_version,
      ...(selectedSuite.composition ?? {}),
      executed_cases: executedCaseIds.length,
      executed_case_ids: executedCaseIds,
      regression_gate_complete: regressionGateComplete,
      checkpoint: true,
      summary: { total: results.length, passed, failed: results.length - passed },
      results,
    }, null, 2)}\n`, 'utf8');
  };

  let report;
  try {
    report = await runConversationSuite(selectedSuite, {
      runId,
      sendTurn: selectedSendTurn,
      beforeTurn: transport === 'adk' ? paceExternalProvider : undefined,
      onCase: (current, total, id) => console.error(`[${current}/${total}] ${id}`),
      onTurn: (current, total) => console.error(`  turno ${current}/${total}`),
      onCaseComplete: async (_result, completedResults) => writeCheckpoint(completedResults),
      afterTurn: verifyDatabase
        ? async ({ testCase, conversationId, turnNumber }) => {
            if (turnNumber === 1) await ensureSandbox(conversationId, testCase.id);
          }
        : undefined,
      verifyPersistence: verifyDatabase ? verifyPersistence : undefined,
    });
  } finally {
    await db?.end({ timeout: 5 });
  }

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify({ ...report.summary, output: outputPath }, null, 2));
  if (report.summary.failed > 0) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
