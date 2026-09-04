import { describe, expect, it } from 'vitest';
import {
  countWorkflowAvailabilityFailuresV1,
  workflowDeliveredLinksV1,
  type WorkflowAdapterCaptureV1,
  type WorkflowBlockingEvidenceV1,
  type WorkflowDecisionObservationV1,
  type WorkflowOutboundObservationV1,
} from '../helpers/agent-a-workflow-measurement';

const decision: WorkflowDecisionObservationV1 = {
  turnId: 'turn-1', outboundId: null, createdAt: '2026-09-04T12:00:01Z',
  reasonCode: 'BRAIN_UNAVAILABLE_NO_CANNED_FALLBACK', responseType: null,
  hasResponse: false, businessActionType: null, promptVersion: 'brain-v13', modelName: 'deepseek-v4-flash',
};
const turn = {
  evidence: { turnId: 'turn-1', authorizedMessages: [], commitSucceeded: true, errorCode: null },
};
const active: WorkflowBlockingEvidenceV1 = {
  contact: { lifecycleStatus: 'active', blockedAt: null },
  permission: { consentStatus: 'unknown', evidenceEventId: null, revokedAt: null, revokedTurnId: null },
  decisions: [decision],
};
const optedOut: WorkflowBlockingEvidenceV1 = {
  ...active,
  permission: { consentStatus: 'revoked', evidenceEventId: 'consent-1', revokedAt: '2026-09-04T12:00:00Z', revokedTurnId: 'turn-1' },
  decisions: [{ ...decision, reasonCode: 'CONSENT_REVOKED' }],
};

describe('disponibilidad de cada turno del workflow', () => {
  it('cuenta caída del modelo con commit silencioso como fallo de disponibilidad', () => {
    expect(countWorkflowAvailabilityFailuresV1({ turns: [turn], db: active })).toBe(1);
  });

  it('un texto técnico entregado sigue siendo fallo de disponibilidad', () => {
    const visible = { evidence: { ...turn.evidence, authorizedMessages: ['Hubo un problema técnico.'] } };
    expect(countWorkflowAvailabilityFailuresV1({ turns: [visible], db: {
      ...active, decisions: [{ ...decision, hasResponse: true, responseType: 'technical_fallback', reasonCode: 'MODEL_PROVIDER_ERROR' }],
    } })).toBe(1);
    expect(countWorkflowAvailabilityFailuresV1({ turns: [visible], db: {
      ...active, decisions: [{ ...decision, hasResponse: true }],
    } })).toBe(1);
  });

  it('un acuse real de baja con texto no es un fallback técnico', () => {
    const visible = { evidence: { ...turn.evidence, authorizedMessages: ['Entendido, no vamos a escribirte más.'] } };
    expect(countWorkflowAvailabilityFailuresV1({ turns: [visible], db: {
      ...optedOut, decisions: [{ ...decision, hasResponse: true, responseType: 'opt_out_ack', reasonCode: 'OPT_OUT_ACK' }],
    } })).toBe(0);
  });

  it('el fallback real de egress con responseType clarification se cuenta aun si el siguiente turno entrega link', () => {
    const first = { evidence: { ...turn.evidence, authorizedMessages: ['Tuve un problema al procesar tu consulta.'] } };
    const second = { evidence: { ...turn.evidence, turnId: 'turn-2', authorizedMessages: ['https://example.invalid/eval/6m'] } };
    const db = { ...active, decisions: [
      { ...decision, hasResponse: true, responseType: 'clarification', reasonCode: 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED' },
      { ...decision, turnId: 'turn-2', hasResponse: true, responseType: 'commercial_reply', reasonCode: 'AGENT_A_PLANNERLESS_V2' },
    ] };
    expect(countWorkflowAvailabilityFailuresV1({ turns: [first, second], db })).toBe(1);
  });

  it('no descuenta la decisión silenciosa de otro turno', () => {
    const db = { ...optedOut, decisions: [{ ...decision, turnId: 'otro-turno', reasonCode: 'OPT_OUT_ACK' }] };
    expect(countWorkflowAvailabilityFailuresV1({ turns: [turn], db })).toBe(1);
  });

  it('rechaza un opt-out sin revocación durable', () => {
    const db = { ...active, decisions: [{ ...decision, reasonCode: 'OPT_OUT_ACK' }] };
    expect(countWorkflowAvailabilityFailuresV1({ turns: [turn], db })).toBe(1);
  });

  it('permite silencio por consentimiento revocado persistido antes de la decisión del mismo turno', () => {
    expect(countWorkflowAvailabilityFailuresV1({ turns: [turn], db: optedOut })).toBe(0);
  });

  it('una baja posterior no justifica el silencio previo', () => {
    const db = { ...optedOut, permission: { ...optedOut.permission!, revokedAt: '2026-09-04T12:10:00Z' }, decisions: [{ ...decision, reasonCode: 'OPT_OUT_ACK' }] };
    expect(countWorkflowAvailabilityFailuresV1({ turns: [turn], db })).toBe(1);
  });

  it('no acepta silencio de opt-out con acción comercial ni error del workflow', () => {
    const db = { ...optedOut, decisions: [{ ...decision, reasonCode: 'OPT_OUT_ACK', businessActionType: 'send_payment_link' }] };
    expect(countWorkflowAvailabilityFailuresV1({ turns: [turn], db })).toBe(1);
    expect(countWorkflowAvailabilityFailuresV1({ turns: [{ evidence: { ...turn.evidence, errorCode: 'HTTP_503' } }], db: optedOut })).toBe(1);
  });

  it('no permite que decisiones duplicadas reduzcan fallos a valores negativos', () => {
    expect(countWorkflowAvailabilityFailuresV1({ turns: [], db: { ...optedOut, decisions: [decision, decision] } })).toBe(0);
  });
});

const outbound: WorkflowOutboundObservationV1 = {
  externalConversationId: 'conversation-1',
  id: 'outbound-1', turnId: 'turn-1', traceId: 'trace-1', authorizedOutboundId: 'outbound-1',
  content: '6 pagos: https://example.invalid/eval/6m', deliveryState: 'submitted', providerMessageId: 'adapter-message-1',
};
const capture: WorkflowAdapterCaptureV1 = {
  turnId: 'turn-1', outboundId: 'outbound-1', traceId: 'trace-1', conversationId: 'conversation-1',
  providerMessageId: 'adapter-message-1', content: '6 pagos: https://example.invalid/eval/6m',
};

describe('entrega local correlacionada del workflow', () => {
  it('un link guardado en la base sin captura del adaptador no fue entregado', () => {
    expect(workflowDeliveredLinksV1({ outbound: [outbound], adapterCaptures: [] })).toEqual([]);
  });

  it.each(['pending', 'leased', 'failed_retryable', 'dead_letter', 'cancelled'])('no declara entrega con estado %s', (deliveryState) => {
    expect(workflowDeliveredLinksV1({ outbound: [{ ...outbound, deliveryState }], adapterCaptures: [capture] })).toEqual([]);
  });

  it.each([
    { outboundId: 'otro-outbound' }, { turnId: 'otro-turno' }, { providerMessageId: 'otro-id' },
    { traceId: 'otro-trace' }, { content: 'Texto diferente' },
    { conversationId: 'otro-cliente' },
  ])('no mezcla captura ajena o alterada %j', (change) => {
    expect(workflowDeliveredLinksV1({ outbound: [outbound], adapterCaptures: [{ ...capture, ...change }] })).toEqual([]);
  });

  it('exige decisión que autorice exactamente ese outbound', () => {
    expect(workflowDeliveredLinksV1({ outbound: [{ ...outbound, authorizedOutboundId: null }], adapterCaptures: [capture] })).toEqual([]);
  });

  it('reconoce sólo el link con el mismo turno, autorización, entrega y captura', () => {
    expect(workflowDeliveredLinksV1({ outbound: [outbound], adapterCaptures: [capture] })).toEqual(['https://example.invalid/eval/6m']);
  });
});
