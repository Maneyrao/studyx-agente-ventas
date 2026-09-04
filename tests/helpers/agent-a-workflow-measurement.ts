/** Observaciones del laboratorio, independientes de red y PostgreSQL. */
export interface WorkflowAdapterCaptureV1 {
  readonly turnId: string | null;
  readonly outboundId: string | null;
  readonly traceId: string | null;
  readonly conversationId: string | null;
  readonly providerMessageId: string;
  readonly content: string;
}

export interface WorkflowOutboundObservationV1 {
  readonly id: string;
  readonly externalConversationId: string;
  readonly turnId: string;
  readonly traceId: string | null;
  readonly authorizedOutboundId: string | null;
  readonly content: string;
  readonly deliveryState: string | null;
  readonly providerMessageId: string | null;
}

export interface WorkflowDecisionObservationV1 {
  readonly turnId: string;
  readonly outboundId: string | null;
  readonly createdAt: string;
  readonly reasonCode: string | null;
  readonly responseType: string | null;
  readonly hasResponse: boolean;
  readonly businessActionType: string | null;
  readonly promptVersion: string | null;
  readonly modelName: string | null;
}

export interface WorkflowBlockingEvidenceV1 {
  readonly contact: { readonly lifecycleStatus: string | null; readonly blockedAt: string | null } | null;
  readonly permission: {
    readonly consentStatus: string;
    readonly evidenceEventId: string | null;
    readonly revokedAt: string | null;
    readonly revokedTurnId: string | null;
  } | null;
  readonly decisions: readonly WorkflowDecisionObservationV1[];
}

export interface WorkflowAvailabilityTurnV1 {
  readonly turnId: string | null;
  readonly authorizedMessages: readonly string[];
  readonly commitSucceeded: boolean;
  readonly errorCode: string | null;
}

export function countWorkflowAvailabilityFailuresV1(input: {
  readonly turns: readonly { readonly evidence: WorkflowAvailabilityTurnV1 }[];
  readonly db: WorkflowBlockingEvidenceV1;
}): number {
  return input.turns.filter(({ evidence }) => {
    if (evidence.errorCode || !evidence.commitSucceeded) return true;
    const decision = input.db.decisions.find((item) => item.turnId === evidence.turnId);
    if (decision?.responseType === 'technical_fallback'
        || decision?.reasonCode === 'EGRESS_UNAUTHORIZED_PROTECTED_FACT_SUPPRESSED'
        || decision?.reasonCode?.startsWith('BRAIN_UNAVAILABLE')) return true;
    if (evidence.authorizedMessages.length > 0) return false;
    if (!decision || decision.hasResponse || decision.businessActionType) return true;
    if (!['OPT_OUT_ACK', 'CONTACT_BLOCKED', 'CONSENT_REVOKED'].includes(decision.reasonCode ?? '')) return true;

    // La foto final no puede justificar retroactivamente un silencio anterior.
    const committedAt = Date.parse(decision.createdAt);
    const permission = input.db.permission;
    const revoked = permission?.consentStatus === 'revoked'
      && permission.evidenceEventId !== null
      && permission.revokedTurnId !== null
      && permission.revokedAt !== null
      && Date.parse(permission.revokedAt) <= committedAt;
    const contact = input.db.contact;
    const blocked = contact?.lifecycleStatus === 'blocked'
      && contact.blockedAt !== null && Date.parse(contact.blockedAt) <= committedAt;
    return !(revoked || blocked);
  }).length;
}

/** "Entregado" aquí significa captura del adaptador local + submission durable. */
export function workflowDeliveredLinksV1(input: {
  readonly outbound: readonly WorkflowOutboundObservationV1[];
  readonly adapterCaptures: readonly WorkflowAdapterCaptureV1[];
}): string[] {
  return input.outbound
    .filter((message) => message.authorizedOutboundId === message.id
      && ['submitted', 'delivered'].includes(message.deliveryState ?? '')
      && message.providerMessageId !== null
      && input.adapterCaptures.some((capture) => capture.outboundId === message.id
        && capture.conversationId === message.externalConversationId
        && capture.turnId === message.turnId
        && capture.traceId === message.traceId
        && capture.providerMessageId === message.providerMessageId
        && capture.content === message.content))
    .flatMap((message) => message.content.match(/https?:\/\/\S+/gu) ?? []);
}
