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
  if (evidence.outboundMessages !== testCase.turns.length) {
    failures.push(`expected_outbound_messages_${testCase.turns.length}_got_${evidence.outboundMessages}`);
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
      inbound_messages: evidence.inboundMessages,
      outbound_messages: evidence.outboundMessages,
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
