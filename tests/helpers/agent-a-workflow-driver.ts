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
export async function runWorkflowTurnV1(
  turn: WorkflowTurnInputV1,
): Promise<WorkflowTurnEvidenceV1> {
  resetRecordedActionInvocationsV1();
  const steps: string[] = [];
  const authorizedMessages: string[] = [];
  const adapterCaptures: WorkflowAdapterCaptureV1[] = [];
  const httpExchanges: WorkflowHttpExchangeV1[] = [];
  const workflowEvents: WorkflowEventV1[] = [];
  const state = freshWorkflowState();
  const startedAt = Date.now();
  const traceId = randomUUID();
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
  globalThis.fetch = observeWorkflowFetchV1(originalFetch, httpExchanges, apiUrl.origin);
  const originalConsoleInfo = console.info;
  console.info = observeWorkflowConsoleInfoV1(originalConsoleInfo, traceId, workflowEvents);

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
    globalThis.fetch = originalFetch;
    console.info = originalConsoleInfo;
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
  writeWorkflowReportV1('workflow-turn', { conversation_id: turn.conversationId, customer: turn.text, evidence });
  return evidence;
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
