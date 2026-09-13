import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { solicitsACallV1 } from '../../botpress-agent/src/lib/conversation/agent-a-brain';
import { AGENT_A_BRAIN_PROMPT_VERSION } from '../../botpress-agent/src/prompts/agent-a-brain-v1';
import {
  runWorkflowBurstV1,
  runWorkflowTurnV1,
  type WorkflowTurnEvidenceV1,
} from '../helpers/agent-a-workflow-driver';
import {
  readWorkflowDbEvidenceV1,
  type WorkflowDbEvidenceV1,
} from '../helpers/agent-a-workflow-db-evidence';
import { writeWorkflowReportV1 } from '../helpers/agent-a-workflow-report';
import { configuration, secrets } from '../helpers/botpress-workflow-runtime';
import { expectedOfferForTurnV1 } from '../helpers/call-offer-workflow-oracle';

type TurnGroup = {
  readonly messages: readonly string[];
  readonly burst_ms?: readonly number[];
};

type CallOfferExpectation = {
  readonly course?: string;
  readonly plan?: string;
  readonly name?: string;
  readonly email?: string;
  readonly offer_turns?: readonly number[];
  readonly offer_reasons?: readonly string[];
  readonly final_call_offer_count?: number;
  readonly chat_preference_turns?: readonly number[];
  readonly final_call_preference?: string;
  readonly links?: number;
  readonly must_include?: readonly string[];
  // Frozen historical oracle fields.
  readonly courses?: readonly string[];
  readonly does_not_offer_courses?: readonly string[];
  readonly two_physical_outbounds?: boolean;
  readonly call_offer_count?: number;
  readonly call_offer_status?: string;
  readonly no_call_reoffer?: boolean;
  readonly does_not_renew_call_offer?: boolean;
  readonly one_batch?: boolean;
  readonly answers_duration?: boolean;
  readonly answers_price?: boolean;
  readonly answers_duration_and_price?: boolean;
  readonly answers_duration_and_modality?: boolean;
  readonly max_options?: number;
};

type EvaluationCase = {
  readonly id: string;
  readonly category?: string;
  readonly setup?: {
    readonly contact_name?: string | null;
    readonly prior_course?: string;
    readonly prior_call_offer?: 'offered';
  };
  readonly turns: readonly (string | TurnGroup)[];
  readonly burst_ms?: readonly number[];
  readonly expect: CallOfferExpectation;
};

type CaseFile = {
  readonly suite: string;
  readonly prompt_version?: string;
  readonly cases: readonly EvaluationCase[];
};

type TurnObservation = {
  readonly ordinal: number;
  readonly customer_messages: readonly string[];
  readonly evidence: WorkflowTurnEvidenceV1;
  readonly db: WorkflowDbEvidenceV1;
};

type CaseObservation = {
  readonly case_id: string;
  readonly category: string | null;
  readonly passed: boolean;
  readonly failures: readonly string[];
  readonly conversation_id: string;
  readonly user_id: string;
  readonly turns: readonly TurnObservation[];
  readonly transcript: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[];
  readonly db: WorkflowDbEvidenceV1;
};

const apiBaseUrl = process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217';
const databaseUrl = process.env.TEST_DATABASE_URL
  ?? 'postgresql://postgres@127.0.0.1:55435/studyx_test';
const fileNames = (process.env.STUDYX_CALL_OFFER_CASE_FILES
  ?? process.env.STUDYX_CALL_OFFER_CASE_FILE
  ?? '').split(path.delimiter).filter(Boolean).map((filename) => path.resolve(filename));
if (fileNames.length === 0) throw new Error('CALL_OFFER_CASE_FILE_REQUIRED');
const loadedFiles = fileNames.map((filename) => ({
  filename,
  sha256: createHash('sha256').update(readFileSync(filename)).digest('hex'),
  suite: JSON.parse(readFileSync(filename, 'utf8')) as CaseFile,
}));
const selectedIds = new Set((process.env.STUDYX_CALL_OFFER_CASE_IDS ?? '')
  .split(',').map((value) => value.trim()).filter(Boolean));
const allCases = loadedFiles.flatMap((item) => item.suite.cases);
const cases = selectedIds.size === 0
  ? allCases
  : allCases.filter((item) => selectedIds.has(item.id));
if (cases.length === 0 || (selectedIds.size > 0 && cases.length !== selectedIds.size)) {
  throw new Error('CALL_OFFER_CASE_SELECTION_INVALID');
}
if (new Set(allCases.map((item) => item.id)).size !== allCases.length) {
  throw new Error('CALL_OFFER_CASE_IDS_NOT_UNIQUE');
}

const productSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const productWorktreeHash = createHash('sha256').update(
  execFileSync('git', ['diff', '--binary'], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }),
);
const productUntrackedFiles = execFileSync(
  'git',
  ['ls-files', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
).split('\0').filter(Boolean).sort();
for (const filename of productUntrackedFiles) {
  productWorktreeHash.update('\0untracked\0').update(filename).update('\0');
  productWorktreeHash.update(readFileSync(filename));
}
const productDiffSha256 = productWorktreeHash.digest('hex');
const labRoot = process.env.STUDYX_LAB_ROOT ? path.resolve(process.env.STUDYX_LAB_ROOT) : null;
const labSha = labRoot
  ? execFileSync('git', ['-C', labRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  : null;
const results: CaseObservation[] = [];

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
}

function turnGroups(testCase: EvaluationCase): readonly TurnGroup[] {
  if (testCase.burst_ms) {
    const messages = testCase.turns.filter((turn): turn is string => typeof turn === 'string');
    if (messages.length !== testCase.turns.length) throw new Error(`${testCase.id}:INVALID_HISTORICAL_BURST`);
    return [{ messages, burst_ms: testCase.burst_ms }];
  }
  return testCase.turns.map((turn) => typeof turn === 'string' ? { messages: [turn] } : turn);
}

function callAudit(evidence: WorkflowTurnEvidenceV1): Record<string, unknown> | null {
  return evidence.workflowEvents.find((event) => event.event === 'studyx.turn.call_offer_policy_v1') ?? null;
}

function deepseekUsage(evidence: WorkflowTurnEvidenceV1): readonly Record<string, unknown>[] {
  return evidence.httpExchanges
    .filter((exchange) => exchange.boundary === 'deepseek')
    .map((exchange) => {
      const body = exchange.responseBody && typeof exchange.responseBody === 'object'
        ? exchange.responseBody as Record<string, unknown> : {};
      return body.usage && typeof body.usage === 'object'
        ? body.usage as Record<string, unknown> : {};
    });
}

async function seedContactName(phoneE164: string, name: string): Promise<void> {
  const db = postgres(databaseUrl, { max: 1 });
  try {
    await db`
      INSERT INTO contacts (phone, status, channel_origin, name)
      VALUES (${phoneE164}, 'prospecto', 'whatsapp', ${name})
      ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
      WHERE contacts.phone LIKE '+999%' AND contacts.deleted_at IS NULL
    `;
  } finally {
    await db.end({ timeout: 5 });
  }
}

async function executeCase(testCase: EvaluationCase): Promise<CaseObservation> {
  const suffix = randomUUID().replace(/\D/gu, '').padEnd(12, '7').slice(0, 12);
  const identity = {
    conversationId: `call-offer-${testCase.id}-${randomUUID()}`,
    userId: `call-offer-user-${testCase.id}-${randomUUID()}`,
    phoneE164: `+999${suffix}`,
  };
  if (testCase.setup?.contact_name) {
    await seedContactName(identity.phoneE164, testCase.setup.contact_name);
  }

  const observations: TurnObservation[] = [];
  const transcript: { role: 'user' | 'assistant'; text: string }[] = [];
  const adapterCaptures = [] as NonNullable<Parameters<typeof readWorkflowDbEvidenceV1>[0]['adapterCaptures']>[number][];

  async function runGroup(group: TurnGroup, ordinal: number): Promise<void> {
    const delays = group.burst_ms ?? group.messages.map(() => 0);
    if (delays.length !== group.messages.length) throw new Error(`${testCase.id}:BURST_DELAYS_MISMATCH`);
    const evidence = group.messages.length === 1
      ? await runWorkflowTurnV1({ ...identity, text: group.messages[0]!, providerMode: 'live' })
      : await runWorkflowBurstV1({
          ...identity,
          providerMode: 'live',
          messages: group.messages.map((text, index) => ({ text, delayMs: delays[index] ?? 0 })),
        });
    adapterCaptures.push(...evidence.adapterCaptures);
    const db = await readWorkflowDbEvidenceV1({
      databaseUrl,
      externalConversationId: identity.conversationId,
      adapterCaptures,
    });
    observations.push({ ordinal, customer_messages: group.messages, evidence, db });
    for (const message of group.messages) transcript.push({ role: 'user', text: message });
    for (const message of evidence.authorizedMessages) transcript.push({ role: 'assistant', text: message });
  }

  let ordinal = 0;
  if (testCase.setup?.prior_course) {
    ordinal += 1;
    const prelude = testCase.setup.prior_call_offer === 'offered'
      ? `Me interesa ${testCase.setup.prior_course}.`
      : `Me interesa ${testCase.setup.prior_course}, pero prefiero seguir por chat.`;
    await runGroup({ messages: [prelude] }, ordinal);
  }
  for (const group of turnGroups(testCase)) {
    ordinal += 1;
    await runGroup(group, ordinal);
  }

  const failures: string[] = [];
  const expected = testCase.expect;
  const evaluatedTurns = observations.slice(testCase.setup?.prior_course ? 1 : 0);
  const finalDb = observations.at(-1)?.db;
  if (!finalDb) throw new Error(`${testCase.id}:MISSING_FINAL_DB`);
  const assistantText = normalize(transcript.filter((message) => message.role === 'assistant').map((message) => message.text).join('\n'));

  for (const turn of evaluatedTurns) {
    const evidence = turn.evidence;
    const audit = callAudit(evidence);
    const expectedTurn = turn.ordinal - (testCase.setup?.prior_course ? 1 : 0);
    const shouldOffer = expectedOfferForTurnV1(expected, expectedTurn);
    if (evidence.execution_harness !== 'processInboundTurn') failures.push(`TURN_${expectedTurn}:WRONG_HARNESS`);
    if (evidence.evaluated_route !== 'plannerless-v2' || evidence.legacyPlanRequests !== 0) failures.push(`TURN_${expectedTurn}:NOT_PLANNERLESS`);
    if (!evidence.commitSucceeded || evidence.errorCode !== null || evidence.authorizedMessages.length === 0) failures.push(`TURN_${expectedTurn}:UNAVAILABLE`);
    if (shouldOffer !== null && audit?.offered_call !== shouldOffer) failures.push(`TURN_${expectedTurn}:OFFER_EXPECTED_${shouldOffer}`);
    const expectedReasonIndex = expected.offer_turns?.indexOf(expectedTurn) ?? -1;
    if (expectedReasonIndex >= 0 && audit?.reason !== expected.offer_reasons?.[expectedReasonIndex]) {
      failures.push(`TURN_${expectedTurn}:OFFER_REASON:${String(audit?.reason)}`);
    }
    if (expected.chat_preference_turns?.includes(expectedTurn) && audit?.chat_preference !== true) {
      failures.push(`TURN_${expectedTurn}:CHAT_PREFERENCE_NOT_RECORDED`);
    }
    const calls = evidence.httpExchanges.filter((exchange) => exchange.boundary === 'deepseek');
    if (calls.length > 2) failures.push(`TURN_${expectedTurn}:MODEL_ATTEMPTS_GT_2`);
    if (calls.some((exchange) => exchange.status === 429 || exchange.status === null) && calls.length > 1) {
      failures.push(`TURN_${expectedTurn}:RETRIED_RATE_LIMIT_OR_TIMEOUT`);
    }
    if (calls.some((exchange) => exchange.status !== 200 || exchange.error !== null)) failures.push(`TURN_${expectedTurn}:DEEPSEEK_FAILURE`);
    for (const usage of deepseekUsage(evidence)) {
      if (!Number.isSafeInteger(usage.input_tokens) || !Number.isSafeInteger(usage.output_tokens)) {
        failures.push(`TURN_${expectedTurn}:TOKEN_USAGE_MISSING`);
      }
      const details = usage.input_tokens_details;
      if (!details || typeof details !== 'object'
          || !Number.isSafeInteger((details as Record<string, unknown>).cached_tokens)) {
        failures.push(`TURN_${expectedTurn}:CACHE_USAGE_MISSING`);
      }
    }
    const normalizedMessages = evidence.authorizedMessages.map(normalize);
    if (new Set(normalizedMessages).size !== normalizedMessages.length) failures.push(`TURN_${expectedTurn}:REPEATED_OUTBOUND`);
    if (evidence.authorizedMessages.some((message) => message.length > 700)) failures.push(`TURN_${expectedTurn}:OVERLONG_OUTBOUND`);
    if (shouldOffer === true || (expected.two_physical_outbounds === true && audit?.offered_call === true)) {
      const callMessages = evidence.authorizedMessages.filter((message) => solicitsACallV1(message, true));
      if (callMessages.length !== 1 || evidence.authorizedMessages.length < 2) failures.push(`TURN_${expectedTurn}:CALL_NOT_SEPARATE`);
    }
    if ('burst' in evidence) {
      const burst = evidence as WorkflowTurnEvidenceV1 & { burst: { claimed_message_count: number | null; source_message_count: number; model_attempt_count: number } };
      if (burst.burst.claimed_message_count !== burst.burst.source_message_count) failures.push(`TURN_${expectedTurn}:BURST_NOT_BATCHED`);
      if (burst.burst.model_attempt_count < 1 || burst.burst.model_attempt_count > 2) failures.push(`TURN_${expectedTurn}:BURST_MODEL_ATTEMPTS`);
    }
  }

  if (expected.course && finalDb.state?.selectedOfferingCode !== expected.course) failures.push('FINAL_COURSE');
  if (expected.plan && finalDb.state?.selectedPaymentPlan !== expected.plan) failures.push('FINAL_PLAN');
  if (expected.name && normalize(finalDb.contact?.name ?? '') !== normalize(expected.name)) failures.push('FINAL_NAME');
  if (expected.email && normalize(finalDb.contact?.email ?? '') !== normalize(expected.email)) failures.push('FINAL_EMAIL');
  const expectedCallCount = expected.final_call_offer_count ?? expected.call_offer_count;
  if (expectedCallCount !== undefined && finalDb.state?.callOfferCount !== expectedCallCount) failures.push('FINAL_CALL_OFFER_COUNT');
  if ((finalDb.state?.callOfferCount ?? 0) > 2) failures.push('THIRD_CALL_OFFER');
  if (expected.final_call_preference && finalDb.state?.callPreference !== expected.final_call_preference) failures.push('FINAL_CALL_PREFERENCE');
  if (expected.call_offer_status && finalDb.state?.callOfferStatus !== expected.call_offer_status) failures.push('FINAL_CALL_OFFER_STATUS');
  if (expected.links !== undefined && finalDb.deliveredLinks.length !== expected.links) failures.push('FINAL_LINK_COUNT');
  if (expected.links === 0 && finalDb.recordedLinks.length > 0) failures.push('PREMATURE_LINK');
  for (const phrase of expected.must_include ?? expected.courses ?? []) {
    if (!assistantText.includes(normalize(phrase))) failures.push(`MISSING_TEXT:${phrase}`);
  }
  for (const phrase of expected.does_not_offer_courses ?? []) {
    const value = normalize(phrase);
    if (assistantText.includes(value) && !assistantText.match(new RegExp(`no .{0,50}${value}`, 'u'))) failures.push(`FORBIDDEN_COURSE:${phrase}`);
  }
  if ((expected.answers_duration || expected.answers_duration_and_price || expected.answers_duration_and_modality)
      && !/\b\d+\s+clases\b/u.test(assistantText)) failures.push('MISSING_DURATION');
  if ((expected.answers_price || expected.answers_duration_and_price) && !/(?:usd|u\$s|\$)\s*\d+/u.test(assistantText)) failures.push('MISSING_PRICE');
  if (expected.answers_duration_and_modality && !assistantText.includes('online')) failures.push('MISSING_MODALITY');
  if (expected.max_options !== undefined && (observations.at(-1)?.evidence.authorizedMessages.length ?? 0) > expected.max_options) failures.push('MAX_OPTIONS');

  const observation: CaseObservation = {
    case_id: testCase.id,
    category: testCase.category ?? null,
    passed: failures.length === 0,
    failures,
    conversation_id: identity.conversationId,
    user_id: identity.userId,
    turns: observations,
    transcript,
    db: finalDb,
  };
  results.push(observation);
  writeWorkflowReportV1('call-offer-case', {
    product_git_sha: productSha,
    product_diff_sha256: productDiffSha256,
    lab_git_sha: labSha,
    prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
    case_files: loadedFiles.map((item) => ({ filename: item.filename, sha256: item.sha256, suite: item.suite.suite })),
    ...observation,
  });
  return observation;
}

beforeAll(async () => {
  expect(secrets.DEEPSEEK_API_KEY?.trim(), 'DEEPSEEK_API_KEY_MISSING').toBeTruthy();
  expect(process.env.STUDYX_AGENT_A_BUDGET_FILE, 'CUMULATIVE_BUDGET_REQUIRED').toBeTruthy();
  expect(new URL(apiBaseUrl).hostname).toBe('127.0.0.1');
  expect(new URL(databaseUrl).hostname).toBe('127.0.0.1');
  for (const loaded of loadedFiles) {
    if (loaded.suite.prompt_version) expect(loaded.suite.prompt_version).toBe(AGENT_A_BRAIN_PROMPT_VERSION);
  }
  configuration.apiBaseUrl = apiBaseUrl;
  configuration.agentAPlannerlessV2Enabled = true;
  const ready = await fetch(`${apiBaseUrl}/api/ready`, { signal: AbortSignal.timeout(4_000) });
  expect(ready.ok, 'LABORATORIO_NO_DISPONIBLE').toBe(true);
});

for (const testCase of cases) {
  it(`${testCase.id}: ${testCase.category ?? 'historical'}`, async () => {
    const observation = await executeCase(testCase);
    expect(observation.failures, `${testCase.id}\n${JSON.stringify(observation.transcript, null, 2)}`).toEqual([]);
  }, 300_000);
}

afterAll(() => {
  writeWorkflowReportV1('call-offer-block-summary', {
    product_git_sha: productSha,
    product_diff_sha256: productDiffSha256,
    lab_git_sha: labSha,
    prompt_version: AGENT_A_BRAIN_PROMPT_VERSION,
    model: 'deepseek-v4-flash',
    provider: 'deepseek-direct',
    case_files: loadedFiles.map((item) => ({ filename: item.filename, sha256: item.sha256, suite: item.suite.suite })),
    selected_case_ids: cases.map((item) => item.id),
    passed: results.length === cases.length && results.every((result) => result.passed),
    cases: results,
  });
});
