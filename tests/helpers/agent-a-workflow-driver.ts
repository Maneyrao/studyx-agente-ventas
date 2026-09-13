/**
 * Maneja `processInboundTurn` — el workflow que corre en producción — en vez de
 * reimplementar la orquestación en un script.
 *
 * El evaluador anterior (`scripts/run-agent-a-conversations.ts`) llama al
 * cerebro, liga el move, resuelve la propuesta y arma la decisión por su
 * cuenta. Mide su propia copia del turno, y por eso sus reportes se declaran
 * `execution_harness: 'runner_reimplementation'`. Acá el arnés no decide nada:
 * invoca el handler real y observa.
 *
 * Lo único sustituido son las fronteras de plataforma —`step`, el cliente de
 * entrega, `execute` del modelo gestionado— más, en modo determinístico, la
 * llamada HTTP al proveedor. Validación, composición, resolvers, política del
 * backend, guard de egress, commit y persistencia son los reales, contra un
 * backend y un PostgreSQL locales aislados.
 *
 * Límites, dichos de frente: esto NO reproduce el scheduler durable de
 * Botpress Cloud, su integración de Telegram, su cuota ni el bundle
 * desplegado. No es un e2e de Telegram y llamarlo así sería mentir.
 */
import { randomUUID } from 'node:crypto';
import type { WorkflowAdapterCaptureV1 } from './agent-a-workflow-measurement';
import { observeWorkflowFetchV1, workflowCommitSucceededV1, type WorkflowHttpExchangeV1 } from './agent-a-workflow-http-evidence';
import { writeWorkflowReportV1 } from './agent-a-workflow-report';
import { observeWorkflowConsoleInfoV1, type WorkflowEventV1 } from './agent-a-workflow-events';

import { processInboundTurn } from '../../botpress-agent/src/workflows/processInboundTurn';
import {
  configuration,
  recordedActionInvocationsV1,
  resetRecordedActionInvocationsV1,
} from './botpress-workflow-runtime';

export interface WorkflowTurnInputV1 {
  readonly text: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly phoneE164: string;
  /** Permite replay del mismo evento sin crear un turno nuevo. */
  readonly externalMessageId?: string;
  readonly occurredAt?: string;
  readonly providerMode?: 'live' | 'fixture';
}

export interface WorkflowTurnEvidenceV1 {
  readonly execution_harness: 'processInboundTurn';
  readonly evaluated_route: 'plannerless-v2' | 'planner-v1';
  /** Cuántas veces se pidió un plan. En plannerless tiene que ser 0. */
  readonly legacyPlanRequests: number;
  readonly commitSucceeded: boolean;
  readonly turnId: string | null;
  readonly outboundId: string | null;
  readonly traceId: string;
  readonly externalMessageId: string;
  readonly occurredAt: string;
  readonly deliveryStatus: string | null;
  readonly adapterCaptures: readonly WorkflowAdapterCaptureV1[];
  /** Contexto, propuestas, usage, rechazos y respuesta efectiva; nunca headers. */
  readonly httpExchanges: readonly WorkflowHttpExchangeV1[];
  readonly workflowEvents: readonly WorkflowEventV1[];
  readonly providerMode: 'live' | 'fixture';
  readonly runtimeConfiguration: {
    readonly requestTimeoutMs: number;
    readonly retryBaseDelayMs: number;
    readonly retryMaxDelayMs: number;
    readonly advisorName: unknown;
  };
  /** Texto que quedó autorizado y salió por el cliente de entrega. */
  readonly authorizedMessages: readonly string[];
  readonly steps: readonly string[];
  readonly actions: readonly { readonly name: string; readonly ok: boolean }[];
  readonly status: string | null;
  readonly errorCode: string | null;
  readonly elapsedMs: number;
}

export interface WorkflowBurstEvidenceV1 extends WorkflowTurnEvidenceV1 {
  readonly burst: {
    readonly source_message_count: number;
    readonly source_invocation_count: number;
    readonly claimed_message_count: number | null;
    readonly model_attempt_count: number;
    readonly invocation_results: readonly {
      readonly trace_id: string;
      readonly external_message_id: string;
      readonly status: string | null;
      readonly error_code: string | null;
      readonly became_batch_owner: boolean;
      readonly delivered_message_count: number;
    }[];
  };
}

interface SharedWorkflowObservationV1 {
  readonly httpExchanges: WorkflowHttpExchangeV1[];
  readonly workflowEvents: WorkflowEventV1[];
}

/**
 * Estado del workflow con los defaults del esquema.
 *
 * Se pasa un objeto mutable: el handler escribe `state.phase` y compañía
 * directamente, igual que en Cloud.
 */
function freshWorkflowState(): Record<string, unknown> {
  return {
    phase: 'received',
    turnId: null,
    batchId: null,
    decisionId: null,
    outboundId: null,
    deliveryStatus: null,
    errorCode: null,
  };
}

/**
 * Ejecuta un turno completo por el workflow real.
 *
 * `execute` lanza a propósito: es la vía del modelo gestionado de Botpress, y
 * que el cerebro autoritativo la toque sería un hallazgo, no un detalle del
 * arnés. Lo mismo vale para `adk.zai` en el runtime.
 */
async function executeWorkflowTurnV1(
  turn: WorkflowTurnInputV1,
  shared?: SharedWorkflowObservationV1,
  fixedTraceId?: string,
): Promise<WorkflowTurnEvidenceV1> {
  if (!shared) resetRecordedActionInvocationsV1();
  const steps: string[] = [];
  const authorizedMessages: string[] = [];
  const adapterCaptures: WorkflowAdapterCaptureV1[] = [];
  const httpExchanges = shared?.httpExchanges ?? [];
  const workflowEvents = shared?.workflowEvents ?? [];
  const state = freshWorkflowState();
  const startedAt = Date.now();
  const traceId = fixedTraceId ?? randomUUID();
  const externalMessageId = turn.externalMessageId ?? randomUUID();
  const occurredAt = turn.occurredAt ?? new Date().toISOString();

  const apiUrl = new URL(configuration.apiBaseUrl);
  if (apiUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(apiUrl.hostname)
      || !/^32\d\d$/u.test(apiUrl.port)) {
    throw new Error('REFUSING_NON_LOCAL_WORKFLOW_BACKEND');
  }
  if (!turn.phoneE164.startsWith('+999')) throw new Error('REFUSING_NON_SYNTHETIC_WORKFLOW_CONTACT');
  // Suites secuenciales: sólo se observan las fronteras del turno actual.
  const originalFetch = globalThis.fetch;
  const originalConsoleInfo = console.info;
  if (!shared) {
    globalThis.fetch = observeWorkflowFetchV1(originalFetch, httpExchanges, apiUrl.origin);
    console.info = observeWorkflowConsoleInfoV1(originalConsoleInfo, traceId, workflowEvents);
  }

  const handler = (processInboundTurn as unknown as {
    definition: { handler: (args: Record<string, unknown>) => Promise<unknown> };
  }).definition.handler;

  let status: string | null = null;
  try {
    const result = await handler({
      input: {
        schema_version: 1,
        source: 'botpress',
        channel: 'emulator',
        integration_id: 'workflow-harness',
        external_message_id: externalMessageId,
        external_conversation_id: turn.conversationId,
        external_user_id: turn.userId,
        phone_e164: turn.phoneE164,
        trace_id: traceId,
        message: {
          type: 'text',
          text: turn.text,
          occurred_at: occurredAt,
          reply_to_external_message_id: null,
          audio_reference: null,
          metadata: {},
        },
        sandbox_provider: null,
        botpress_conversation_id: turn.conversationId,
        botpress_user_id: turn.userId,
      },
      state,
      // En Cloud `step` es durable y puede reanudar. Acá sólo ejecuta y
      // registra: la reanudación es justamente uno de los límites declarados.
      //
      // `step.sleep` espera de verdad: la ventana de lote es lo que hace que
      // dos mensajes seguidos se agrupen en un turno, y saltearla mediría un
      // batching que producción no tiene.
      step: Object.assign(
        async (name: string, fn: () => Promise<unknown>) => {
          steps.push(name);
          return fn();
        },
        {
          async sleep(name: string, ms: number) {
            steps.push(`sleep:${name}`);
            if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
          },
          async sleepUntil(name: string, at: string | number | Date) {
            steps.push(`sleepUntil:${name}`);
            const target = new Date(at).getTime() - Date.now();
            if (target > 0) await new Promise((resolve) => setTimeout(resolve, target));
          },
        },
      ),
      execute: async () => {
        throw new Error('MANAGED_MODEL_MUST_NOT_RUN_IN_WORKFLOW_HARNESS');
      },
      client: {
        async createMessage(message: {
          conversationId?: string;
          payload?: { text?: string };
          tags?: { studyxOutboundId?: string; studyxTraceId?: string };
        }) {
          // Se captura DESPUÉS de autorización y commit: es el texto que el
          // cliente habría recibido, no la propuesta del modelo.
          const providerMessageId = randomUUID();
          if (message.payload?.text) {
            authorizedMessages.push(message.payload.text);
            adapterCaptures.push({
              turnId: (state.turnId as string | null) ?? null,
              outboundId: message.tags?.studyxOutboundId ?? null,
              traceId: message.tags?.studyxTraceId ?? null,
              conversationId: message.conversationId ?? null,
              providerMessageId,
              content: message.payload.text,
            });
          }
          return { message: { id: providerMessageId } };
        },
      },
      signal: new AbortController().signal,
      workflow: { id: 'workflow-harness' },
    });
    status = (result as { status?: string } | null)?.status ?? null;
  } catch (error) {
    status = 'threw';
    state.errorCode = error instanceof Error ? error.message.slice(0, 128) : 'UNKNOWN';
  } finally {
    if (!shared) {
      globalThis.fetch = originalFetch;
      console.info = originalConsoleInfo;
    }
  }

  const actions = recordedActionInvocationsV1();
  const evidence: WorkflowTurnEvidenceV1 = {
    execution_harness: 'processInboundTurn',
    evaluated_route: configuration.agentAPlannerlessV2Enabled ? 'plannerless-v2' : 'planner-v1',
    legacyPlanRequests: actions.filter((a) => a.name === 'planConversation').length,
    commitSucceeded: workflowCommitSucceededV1(
      actions.some((a) => a.name === 'commitDecision' && a.ok),
      (state.turnId as string | null) ?? null,
      httpExchanges,
    ),
    turnId: (state.turnId as string | null) ?? null,
    outboundId: (state.outboundId as string | null) ?? null,
    traceId, externalMessageId, occurredAt,
    deliveryStatus: (state.deliveryStatus as string | null) ?? null,
    adapterCaptures, httpExchanges, workflowEvents,
    providerMode: turn.providerMode ?? 'live',
    runtimeConfiguration: {
      requestTimeoutMs: configuration.requestTimeoutMs,
      retryBaseDelayMs: configuration.retryBaseDelayMs,
      retryMaxDelayMs: configuration.retryMaxDelayMs,
      advisorName: configuration.agentAAdvisorName,
    },
    authorizedMessages,
    steps,
    actions,
    status,
    errorCode: (state.errorCode as string | null) ?? null,
    elapsedMs: Date.now() - startedAt,
  };
  if (!shared) {
    writeWorkflowReportV1('workflow-turn', { conversation_id: turn.conversationId, customer: turn.text, evidence });
  }
  return evidence;
}

export async function runWorkflowTurnV1(
  turn: WorkflowTurnInputV1,
): Promise<WorkflowTurnEvidenceV1> {
  return executeWorkflowTurnV1(turn);
}

/**
 * Runs every source event through the production workflow concurrently.
 * Only the workflow that wins the sliding batch claim may call the model and
 * deliver; the other invocations must terminate as absorbed/completed.
 */
export async function runWorkflowBurstV1(input: {
  readonly conversationId: string;
  readonly userId: string;
  readonly phoneE164: string;
  readonly messages: readonly { readonly text: string; readonly delayMs: number }[];
  readonly providerMode?: 'live' | 'fixture';
}): Promise<WorkflowBurstEvidenceV1> {
  if (input.messages.length < 2 || input.messages.some((message) => (
    !message.text.trim() || !Number.isSafeInteger(message.delayMs) || message.delayMs < 0
  ))) throw new Error('INVALID_WORKFLOW_BURST');

  const apiUrl = new URL(configuration.apiBaseUrl);
  const shared: SharedWorkflowObservationV1 = { httpExchanges: [], workflowEvents: [] };
  const traceIds = input.messages.map(() => randomUUID());
  const originalFetch = globalThis.fetch;
  const originalConsoleInfo = console.info;
  resetRecordedActionInvocationsV1();
  globalThis.fetch = observeWorkflowFetchV1(originalFetch, shared.httpExchanges, apiUrl.origin);
  // Nesting the existing observer once per trace keeps its exact filtering
  // behavior while allowing all concurrent workflow logs into one capture.
  console.info = traceIds.reduce<Console['info']>(
    (observer, traceId) => observeWorkflowConsoleInfoV1(observer, traceId, shared.workflowEvents),
    originalConsoleInfo,
  );
  const startedAt = Date.now();
  let invocations: WorkflowTurnEvidenceV1[];
  try {
    invocations = await Promise.all(input.messages.map(async (message, index) => {
      if (message.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, message.delayMs));
      }
      return executeWorkflowTurnV1({
        conversationId: input.conversationId,
        userId: input.userId,
        phoneE164: input.phoneE164,
        text: message.text,
        providerMode: input.providerMode,
      }, shared, traceIds[index]);
    }));
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalConsoleInfo;
  }

  const actions = recordedActionInvocationsV1();
  const owner = invocations.find((invocation) => invocation.authorizedMessages.length > 0)
    ?? invocations.find((invocation) => shared.workflowEvents.some((event) => (
      event.trace_id === invocation.traceId && event.event === 'studyx.turn.claimed'
    )))
    ?? invocations.at(-1);
  if (!owner) throw new Error('WORKFLOW_BURST_EMPTY');
  const claimedEvent = shared.workflowEvents.find((event) => (
    event.trace_id === owner.traceId && event.event === 'studyx.turn.claimed'
  ));
  const modelAttempts = shared.httpExchanges.filter((exchange) => exchange.boundary === 'deepseek').length;
  const combined: WorkflowBurstEvidenceV1 = {
    ...owner,
    legacyPlanRequests: actions.filter((action) => action.name === 'planConversation').length,
    commitSucceeded: workflowCommitSucceededV1(
      actions.some((action) => action.name === 'commitDecision' && action.ok),
      owner.turnId,
      shared.httpExchanges,
    ),
    adapterCaptures: invocations.flatMap((invocation) => invocation.adapterCaptures),
    httpExchanges: shared.httpExchanges,
    workflowEvents: shared.workflowEvents,
    authorizedMessages: invocations.flatMap((invocation) => invocation.authorizedMessages),
    steps: invocations.flatMap((invocation) => invocation.steps),
    actions,
    elapsedMs: Date.now() - startedAt,
    burst: {
      source_message_count: input.messages.length,
      source_invocation_count: invocations.length,
      claimed_message_count: typeof claimedEvent?.message_count === 'number'
        ? claimedEvent.message_count : null,
      model_attempt_count: modelAttempts,
      invocation_results: invocations.map((invocation) => ({
        trace_id: invocation.traceId,
        external_message_id: invocation.externalMessageId,
        status: invocation.status,
        error_code: invocation.errorCode,
        became_batch_owner: shared.workflowEvents.some((event) => (
          event.trace_id === invocation.traceId && event.event === 'studyx.turn.claimed'
        )),
        delivered_message_count: invocation.authorizedMessages.length,
      })),
    },
  };
  writeWorkflowReportV1('workflow-burst', {
    conversation_id: input.conversationId,
    customer_messages: input.messages,
    evidence: combined,
  });
  return combined;
}

export interface WorkflowConversationEvidenceV1 {
  readonly conversationId: string;
  readonly turns: readonly {
    readonly customer: string;
    readonly evidence: WorkflowTurnEvidenceV1;
  }[];
  readonly transcript: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[];
  readonly totalPlanRequests: number;
  readonly deliveredTurns: number;
  readonly silentTurns: number;
}

/**
 * Una conversación completa por el workflow real.
 *
 * Los turnos comparten `conversationId`, `userId` y teléfono, así que el estado
 * durable, la memoria y el ledger de llamadas se acumulan igual que en un chat
 * de verdad. Ejecutar cinco casos sobre una misma conversación arrastraría
 * memoria entre ellos, así que cada caso trae su identidad propia.
 */
export async function runWorkflowConversationV1(input: {
  readonly conversationId: string;
  readonly userId: string;
  readonly phoneE164: string;
  readonly customerTurns: readonly string[];
}): Promise<WorkflowConversationEvidenceV1> {
  const turns: { customer: string; evidence: WorkflowTurnEvidenceV1 }[] = [];
  const transcript: { role: 'user' | 'assistant'; text: string }[] = [];

  for (const customer of input.customerTurns) {
    const evidence = await runWorkflowTurnV1({
      text: customer,
      conversationId: input.conversationId,
      userId: input.userId,
      phoneE164: input.phoneE164,
    });
    turns.push({ customer, evidence });
    transcript.push({ role: 'user', text: customer });
    for (const message of evidence.authorizedMessages) {
      transcript.push({ role: 'assistant', text: message });
    }
  }

  return {
    conversationId: input.conversationId,
    turns,
    transcript,
    totalPlanRequests: turns.reduce((sum, t) => sum + t.evidence.legacyPlanRequests, 0),
    deliveredTurns: turns.filter((t) => t.evidence.authorizedMessages.length > 0).length,
    // Cero mensajes visibles. Que el turno "termine bien" no es que alguien
    // haya contestado: un silencio es un fallo conversacional, no un éxito.
    silentTurns: turns.filter((t) => t.evidence.authorizedMessages.length === 0).length,
  };
}
