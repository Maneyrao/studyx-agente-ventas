import type { ConversationCase } from './agent-a-conversation-runner';

export type SheetEvidence = {
  plan: string;
  courseInterest: string;
  state: string;
  nombre: string;
  apellido: string;
  email: string;
};

export type PersistenceEvidence = {
  contactId: string | null;
  phone: string | null;
  contactName: string | null;
  contactEmail: string | null;
  sandboxRegistered: boolean;
  inboundMessages: number;
  outboundMessages: number;
  decisions: number;
  decisionsWithTrace: number;
  activeMemoryValues: string[];
  readyMemoryEmbeddings: number;
  sheetRows: SheetEvidence[];
  promptVersions: string[];
  technicalFallbacks: number;
  /** Values read back from durable, run-correlated rows. The sandbox identity
   * is created as `eval:<runId>:<caseId>` by the local evaluator. */
  runScope?: {
    sandboxExternalUserId: string | null;
    externalConversationId: string;
    conversationId: string;
  };
  /** One row per inbound turn, projected from the authoritative
   * messages/agent_decisions relation rather than inferred from transcript
   * ordering. */
  turnEvidence?: Array<{
    turnNumber: number;
    turnId: string;
    decisionId: string;
    traceId: string | null;
    outboundMessageId: string | null;
  }>;
};

function normalized(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es').trim();
}

function expandRunId(value: string, runId: string): string {
  return value.replaceAll('{{run_id}}', runId);
}

export function evaluatePersistenceEvidence(
  testCase: ConversationCase,
  evidence: PersistenceEvidence,
  options: { runId?: string } = {},
): { checks: Record<string, unknown>; failures: string[] } {
  const failures: string[] = [];
  const expected = testCase.ideal_result;
  const runId = options.runId ?? '';
  const contactRegistered = evidence.contactId !== null && /^\+999\d{12}$/.test(evidence.phone ?? '');
  const expectedInterest = typeof expected.expected_interest === 'string'
    ? expected.expected_interest
    : null;
  const expectedSheetInterest = typeof expected.expected_sheet_interest === 'string'
    ? expected.expected_sheet_interest
    : expectedInterest;
  const interestPersisted = expectedInterest === null || evidence.activeMemoryValues.some((value) =>
    normalized(value).includes(normalized(expectedInterest)),
  );
  const minimumMemories = typeof expected.min_active_memories === 'number'
    ? expected.min_active_memories
    : 0;
  const minimumReadyEmbeddings = typeof expected.min_ready_memory_embeddings === 'number'
    ? expected.min_ready_memory_embeddings
    : 0;
  const expectedSheetRows = typeof expected.sheet_rows === 'number' ? expected.sheet_rows : null;
  const expectedResponseCounts = expected.expected_response_count_by_turn
    ?? testCase.turns.map(() => 1 as const);
  const expectedOutboundMessages = expectedResponseCounts.reduce<number>(
    (total, count) => total + count,
    0,
  );
  const forbiddenPersistenceValues = Array.isArray(expected.forbidden_persistence_values)
    ? expected.forbidden_persistence_values.filter((value): value is string => typeof value === 'string')
    : [];

  // Identity is expected as durable evidence only when the customer actually
  // volunteered it in a scripted turn (P0, informe 2026-08-23: the bot
  // claimed "registramos tu información" while contacts stayed empty).
  const customer = testCase.customer ?? null;
  const identityVolunteered = customer !== null
    && testCase.turns.some((turn) => turn.includes(customer.email));
  const expectedEmail = customer ? expandRunId(customer.email, runId) : null;
  const expectedSandboxExternalUserId = `eval:${runId}:${testCase.id}`;
  const runScopeVerified = runId !== ''
    && evidence.runScope?.sandboxExternalUserId === expectedSandboxExternalUserId
    && evidence.runScope.externalConversationId.startsWith(`local-eval-${runId}-`)
    && evidence.runScope.conversationId.trim() !== '';
  if (runId !== '' && !runScopeVerified) failures.push('persistence_evidence_not_run_scoped');

  const turnOutboundCounts: Array<number | null> = [];
  if (runId !== '' && !evidence.turnEvidence) {
    failures.push('turn_scoped_persistence_evidence_missing');
  } else if (evidence.turnEvidence) {
    if (evidence.turnEvidence.length !== testCase.turns.length) {
      failures.push(
        `expected_turn_evidence_${testCase.turns.length}_got_${evidence.turnEvidence.length}`,
      );
    }
    const uniqueTurnIds = new Set(evidence.turnEvidence.map((turn) => turn.turnId));
    const uniqueDecisionIds = new Set(evidence.turnEvidence.map((turn) => turn.decisionId));
    const traceIds = evidence.turnEvidence
      .map((turn) => turn.traceId)
      .filter((traceId): traceId is string => typeof traceId === 'string' && traceId !== '');
    if (uniqueTurnIds.size !== evidence.turnEvidence.length) failures.push('duplicate_turn_evidence');
    if (uniqueDecisionIds.size !== evidence.turnEvidence.length) {
      failures.push('duplicate_decision_evidence');
    }
    if (new Set(traceIds).size !== traceIds.length) failures.push('duplicate_turn_trace_id');

    for (const [index, expectedOutboundCount] of expectedResponseCounts.entries()) {
      const turnNumber = index + 1;
      const matchingTurns = evidence.turnEvidence.filter((turn) => turn.turnNumber === turnNumber);
      if (matchingTurns.length !== 1) {
        failures.push(`turn_${turnNumber}_expected_one_decision_evidence_got_${matchingTurns.length}`);
        turnOutboundCounts[index] = null;
        continue;
      }
      const turn = matchingTurns[0]!;
      if (turn.decisionId.trim() === '') failures.push(`turn_${turnNumber}_decision_id_missing`);
      if (!turn.traceId?.trim()) failures.push(`turn_${turnNumber}_trace_id_missing`);
      const actualOutboundCount = turn.outboundMessageId === null ? 0 : 1;
      turnOutboundCounts[index] = actualOutboundCount;
      if (actualOutboundCount !== expectedOutboundCount) {
        failures.push(
          `turn_${turnNumber}_expected_outbound_${expectedOutboundCount}_got_${actualOutboundCount}`,
        );
      }
    }
  }
  let contactIdentityPersisted: boolean | null = null;
  if (identityVolunteered && customer && expectedEmail) {
    const nameNormalized = normalized(evidence.contactName ?? '');
    const namePersisted = nameNormalized.includes(normalized(customer.first_name))
      && nameNormalized.includes(normalized(customer.last_name));
    const emailPersisted = (evidence.contactEmail ?? '').toLowerCase() === expectedEmail.toLowerCase();
    if (!namePersisted) failures.push('contact_name_not_persisted');
    if (!emailPersisted) failures.push('contact_email_not_persisted');
    contactIdentityPersisted = namePersisted && emailPersisted;
  }

  if (expected.registered_contact && !contactRegistered) failures.push('contact_not_registered');
  if (expected.registered_contact && !evidence.sandboxRegistered) {
    failures.push('sandbox_identity_not_registered');
  }
  if (evidence.inboundMessages !== testCase.turns.length) {
    failures.push(`expected_inbound_messages_${testCase.turns.length}_got_${evidence.inboundMessages}`);
  }
  if (evidence.outboundMessages !== expectedOutboundMessages) {
    failures.push(`expected_outbound_messages_${expectedOutboundMessages}_got_${evidence.outboundMessages}`);
  }
  if (evidence.decisions !== testCase.turns.length) {
    failures.push(`expected_decisions_${testCase.turns.length}_got_${evidence.decisions}`);
  }
  if (evidence.decisionsWithTrace !== evidence.decisions) {
    failures.push('decision_trace_ids_missing');
  }
  if (!interestPersisted) failures.push('expected_interest_not_persisted');
  if (evidence.activeMemoryValues.length < minimumMemories) {
    failures.push(
      `expected_active_memories_at_least_${minimumMemories}_got_${evidence.activeMemoryValues.length}`,
    );
  }
  if (evidence.readyMemoryEmbeddings < minimumReadyEmbeddings) {
    failures.push(
      `expected_ready_memory_embeddings_at_least_${minimumReadyEmbeddings}_got_${evidence.readyMemoryEmbeddings}`,
    );
  }
  if (expectedSheetRows !== null && evidence.sheetRows.length !== expectedSheetRows) {
    failures.push(`expected_sheet_rows_${expectedSheetRows}_got_${evidence.sheetRows.length}`);
  }
  if (expected.plan_code && evidence.sheetRows.length > 0) {
    const planMatches = evidence.sheetRows.every((row) => row.plan === expected.plan_code);
    if (!planMatches) failures.push('sheet_plan_mismatch');
  }

  // The operator sheet is the deliverable: a buyer row must carry the
  // customer identity (when volunteered) and the canonical course interest.
  let sheetIdentityProjected: boolean | null = null;
  if (evidence.sheetRows.length > 0 && identityVolunteered && customer && expectedEmail) {
    sheetIdentityProjected = evidence.sheetRows.every((row) =>
      normalized(row.nombre) === normalized(customer.first_name)
      && normalized(row.apellido) === normalized(customer.last_name)
      && row.email.toLowerCase() === expectedEmail.toLowerCase(),
    );
    if (!sheetIdentityProjected) failures.push('sheet_identity_missing');
  }
  if (evidence.sheetRows.length > 0 && expectedSheetInterest !== null) {
    const courseProjected = evidence.sheetRows.every((row) =>
      normalized(row.courseInterest).includes(normalized(expectedSheetInterest)),
    );
    if (!courseProjected) failures.push('sheet_course_interest_missing');
  }
  if (evidence.technicalFallbacks > 0) failures.push('technical_fallback_persisted');

  const durableSearchSpace = [
    ...evidence.activeMemoryValues,
    ...evidence.sheetRows.flatMap((row) => [
      row.plan,
      row.courseInterest,
      row.state,
      row.nombre,
      row.apellido,
      row.email,
    ]),
  ].join('\n').toLocaleLowerCase('es');
  const forbiddenValuesFound = forbiddenPersistenceValues.filter((value) =>
    durableSearchSpace.includes(expandRunId(value, runId).toLocaleLowerCase('es')),
  );
  for (const value of forbiddenValuesFound) {
    failures.push(`forbidden_persistence_value_found:${value}`);
  }

  return {
    checks: {
      contact_registered: contactRegistered,
      contact_id: evidence.contactId,
      synthetic_phone: evidence.phone,
      contact_name: evidence.contactName,
      contact_email_present: evidence.contactEmail !== null && evidence.contactEmail !== '',
      contact_identity_persisted: contactIdentityPersisted,
      sandbox_registered: evidence.sandboxRegistered,
      run_scope_verified: runScopeVerified,
      run_scope: evidence.runScope ?? null,
      inbound_messages: evidence.inboundMessages,
      outbound_messages: evidence.outboundMessages,
      expected_outbound_messages: expectedOutboundMessages,
      turn_outbound_counts: turnOutboundCounts,
      turn_persistence_evidence: evidence.turnEvidence ?? [],
      decisions: evidence.decisions,
      decisions_with_trace: evidence.decisionsWithTrace,
      active_memories: evidence.activeMemoryValues.length,
      ready_memory_embeddings: evidence.readyMemoryEmbeddings,
      expected_interest_persisted: interestPersisted,
      sheet_rows: evidence.sheetRows.length,
      sheet_evidence: evidence.sheetRows,
      sheet_identity_projected: sheetIdentityProjected,
      prompt_versions: evidence.promptVersions,
      technical_fallbacks: evidence.technicalFallbacks,
      forbidden_persistence_values_found: forbiddenValuesFound,
    },
    failures,
  };
}
