import { AGENT_A_PROMPT_VERSION } from '../../botpress-agent/src/prompts/agent-a-sales-bridge';

export type AgentCatalogResolutionEvidence =
  | { readonly kind: 'no_catalog_intent' }
  | {
      readonly kind: 'exact';
      readonly offeringCode: string;
      readonly displayName: string;
    }
  | {
      readonly kind: 'ambiguous';
      readonly requestedText: string;
      readonly candidateCodes: readonly string[];
    }
  | {
      readonly kind: 'not_found';
      readonly requestedText: string;
      readonly requestedArea: string | null;
      readonly alternativeCodes: readonly string[];
    }
  | {
      readonly kind: 'unavailable';
      readonly reason: 'snapshot_missing' | 'snapshot_truncated' | 'snapshot_invalid';
    };

/** Plain evidence DTO emitted by the local transport boundary. The oracle
 * remains independent from Botpress, PostgreSQL and the HTTP wire schema. */
export type AgentCommercialEvidence = {
  readonly catalogResolution: AgentCatalogResolutionEvidence;
  readonly snapshotOfferings: readonly {
    readonly code: string;
    readonly displayName: string;
  }[];
  /** Null means that the authoritative snapshot was unavailable. */
  readonly offeringsTruncated: number | null;
  readonly selectedOfferingCode: string | null;
  readonly decisionBusinessAction: ({ readonly type: string } & Record<string, unknown>) | null;
  readonly authorizedProtectedFacts: readonly {
    readonly kind: string;
    readonly value: string;
  }[];
  readonly authorizedUrls: readonly string[];
};

export type ProtectedFactRef = {
  readonly kind: 'price' | 'duration' | 'modality' | 'certification' | 'offering' | 'promise';
  readonly value: string;
};

/** Claim-to-commit evidence captured locally for every executed turn. */
export type AgentTurnDiagnostic = {
  catalogResolution: AgentCatalogResolutionEvidence;
  selectedOfferingCode: string | null;
  decisionBusinessAction: Record<string, unknown> | null;
  authorizedProtectedFacts: readonly ProtectedFactRef[];
  authorizedUrls: readonly string[];
  commitError: { status: number; error: string; reason: string | null } | null;
};

export type AgentChatResult = {
  conversationId: string;
  responses: Array<{ type: string; text?: string }>;
  /** Exact URL allowlist issued from the authoritative snapshot for this
   * turn. Required whenever a visible response contains a URL. */
  authorizedUrls?: readonly string[];
  /** Structured claim/snapshot/action evidence used by hard-fail commercial
   * oracles. It is never derived from the assistant prose. */
  commercialEvidence?: AgentCommercialEvidence;
  /** Local authority-chain evidence captured before and after commit. */
  turnDiagnostic?: AgentTurnDiagnostic;
  /** Delay inserted only by the evaluator to respect shared provider quota. */
  evaluationPacingMs?: number;
};

export type TurnQualityAssertion = {
  max_chars?: number;
  max_questions?: number;
  max_lines?: number;
  must_include?: string[];
  /** At least one semantically acceptable phrase must be present. */
  must_include_any?: string[];
  must_not_include?: string[];
};

export type CatalogAbsenceOracle = {
  /** Offering families that this case proves are absent. */
  requested_terms: string[];
  /** Snapshot codes that may be proposed as alternatives in this case. */
  allowed_alternative_codes: string[];
  /** A missing or truncated snapshot invalidates the case instead of proving absence. */
  require_complete_snapshot: boolean;
};

export type ConversationCase = {
  id: string;
  name: string;
  course: string;
  /** Descriptive scenario metadata; not read by the runner beyond uniqueness checks. */
  persona?: unknown;
  /** Synthetic customer identity; `email` may contain the {{run_id}} macro. */
  customer?: {
    first_name: string;
    last_name: string;
    email: string;
  };
  turns: string[];
  ideal_result: {
    plan_code?: 'monthly_12' | 'monthly_6' | 'one_time';
    payment_link_count?: number;
    course_fact?: string;
    /** The final reply must acknowledge this course after an intent change. */
    current_course?: string;
    /** A customer can decline a call without abandoning the sale. */
    no_call_after_turn?: number;
    /** No checkout URL may be offered before the customer picked a plan. */
    no_payment_link_before_turn?: number;
    /** Never repeat the test customer's email in a reply. */
    must_not_echo?: string;
    /** A successful commercial evaluation cannot be satisfied by the generic error reply. */
    no_technical_fallback?: boolean;
    /** Require durable evidence that this emulator conversation created its own contact. */
    registered_contact?: boolean;
    /** Commercial interest that must survive as active structured memory. */
    expected_interest?: string;
    /** Canonical catalog label required specifically in the operator sheet. */
    expected_sheet_interest?: string;
    min_active_memories?: number;
    min_ready_memory_embeddings?: number;
    /** Expected durable lead rows in the local Sheets outbox. */
    sheet_rows?: number;
    /** Sensitive values that must not survive in memories or operator rows. */
    forbidden_persistence_values?: string[];
    /** Objective copy constraints evaluated against each assistant turn, not
     * against the aggregated transcript. Array index 0 corresponds to turn 1. */
    turn_assertions?: TurnQualityAssertion[];
    /** Visible text cardinality for each inbound turn. The default is one;
     * explicit zeroes model durable silence after opt-out. */
    expected_response_count_by_turn?: Array<0 | 1>;
    /** Hard-fail oracle for a requested offering that must not exist in the
     * authoritative snapshot. */
    catalog_absence_oracle?: CatalogAbsenceOracle;
    /** End-to-end wall-clock budget for every visible turn. */
    max_turn_latency_ms?: number;
    /** Case-wide median latency budget, useful for detecting systematic drag. */
    max_median_latency_ms?: number;
  } & Record<string, unknown>;
};

export type TranscriptEntry = { role: 'user' | 'assistant'; text: string };

export type ConversationCaseResult = {
  id: string;
  name: string;
  status: 'passed' | 'failed';
  conversation_id: string | null;
  transcript: TranscriptEntry[];
  turn_diagnostics: Array<AgentTurnDiagnostic | null>;
  checks: Record<string, unknown>;
  failures: string[];
};

function diagnosticFromError(error: unknown): AgentTurnDiagnostic | null {
  if (!error || typeof error !== 'object' || !('turnDiagnostic' in error)) return null;
  const diagnostic = error.turnDiagnostic;
  return diagnostic && typeof diagnostic === 'object'
    ? diagnostic as AgentTurnDiagnostic
    : null;
}

type RunOptions = {
  runId: string;
  sendTurn: (message: string, conversationId: string | null) => Promise<AgentChatResult>;
  /** Optional external-provider pacing. The file runner uses this to respect
   * token-per-minute limits without coupling behavioral grading to Groq. */
  beforeTurn?: (input: {
    testCase: ConversationCase;
    turnNumber: number;
  }) => Promise<void>;
  onTurn?: (current: number, total: number, message: string) => void;
  afterTurn?: (input: {
    testCase: ConversationCase;
    conversationId: string;
    turnNumber: number;
  }) => Promise<void>;
  verifyPersistence?: (
    testCase: ConversationCase,
    conversationId: string,
  ) => Promise<{ checks: Record<string, unknown>; failures: string[] }>;
  /** Durable checkpoint hook invoked after every completed customer case. */
  onCaseComplete?: (
    result: ConversationCaseResult,
    completedResults: readonly ConversationCaseResult[],
  ) => Promise<void> | void;
};

export type ConversationSuite = {
  schema_version: string;
  prompt_version: string;
  suite: string;
  /** Optional relative path used by the file runner to extend a reviewed base
   * suite without duplicating hundreds of fixture lines. */
  base_suite?: string;
  composition?: {
    base_cases: number;
    extension_cases: number;
    effective_cases: number;
    base_sha256: string;
    extension_sha256: string;
    effective_case_ids: string[];
  };
  cases: ConversationCase[];
};

const REGRESSION_BASE_CASES = 35;
const REGRESSION_EXTENSION_CASES = 15;
const REGRESSION_EFFECTIVE_CASES = 50;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/**
 * Composes the reviewed 35-case base and 15-case extension without losing
 * the evidence needed to distinguish a real 50-case gate from a raw 15-case
 * execution. File IO stays at the CLI boundary; this pure function receives
 * the hashes computed from the exact source bytes that were parsed.
 */
export function composeAgentARegressionSuite(input: {
  baseSuite: ConversationSuite;
  extensionSuite: ConversationSuite;
  baseSha256: string;
  extensionSha256: string;
}): ConversationSuite {
  if (input.baseSuite.base_suite) throw new Error('NESTED_BASE_SUITE_NOT_SUPPORTED');
  if (!input.extensionSuite.base_suite) throw new Error('REGRESSION_BASE_SUITE_REFERENCE_MISSING');
  if (input.baseSuite.prompt_version !== input.extensionSuite.prompt_version) {
    throw new Error('BASE_SUITE_PROMPT_VERSION_MISMATCH');
  }
  if (input.baseSuite.cases.length !== REGRESSION_BASE_CASES) {
    throw new Error(`REGRESSION_BASE_CASE_COUNT_${input.baseSuite.cases.length}`);
  }
  if (input.extensionSuite.cases.length !== REGRESSION_EXTENSION_CASES) {
    throw new Error(`REGRESSION_EXTENSION_CASE_COUNT_${input.extensionSuite.cases.length}`);
  }
  if (!SHA256_PATTERN.test(input.baseSha256) || !SHA256_PATTERN.test(input.extensionSha256)) {
    throw new Error('REGRESSION_SOURCE_HASH_INVALID');
  }

  const cases = [...input.baseSuite.cases, ...input.extensionSuite.cases];
  const effectiveCaseIds = cases.map((testCase) => testCase.id);
  if (
    cases.length !== REGRESSION_EFFECTIVE_CASES
    || new Set(effectiveCaseIds).size !== REGRESSION_EFFECTIVE_CASES
  ) {
    throw new Error('REGRESSION_CASE_IDS_NOT_UNIQUE');
  }

  return {
    ...input.extensionSuite,
    cases,
    composition: {
      base_cases: REGRESSION_BASE_CASES,
      extension_cases: REGRESSION_EXTENSION_CASES,
      effective_cases: REGRESSION_EFFECTIVE_CASES,
      base_sha256: input.baseSha256,
      extension_sha256: input.extensionSha256,
      effective_case_ids: effectiveCaseIds,
    },
  };
}

function assertRegressionCompositionEvidence(suite: ConversationSuite): void {
  if (!suite.base_suite) return;
  const composition = suite.composition;
  if (!composition) throw new Error('REGRESSION_COMPOSITION_EVIDENCE_MISSING');
  if (
    composition.base_cases !== REGRESSION_BASE_CASES
    || composition.extension_cases !== REGRESSION_EXTENSION_CASES
    || composition.effective_cases !== REGRESSION_EFFECTIVE_CASES
    || composition.effective_case_ids.length !== REGRESSION_EFFECTIVE_CASES
    || new Set(composition.effective_case_ids).size !== REGRESSION_EFFECTIVE_CASES
    || !SHA256_PATTERN.test(composition.base_sha256)
    || !SHA256_PATTERN.test(composition.extension_sha256)
  ) {
    throw new Error('REGRESSION_COMPOSITION_EVIDENCE_INVALID');
  }
  const effectiveIds = new Set(composition.effective_case_ids);
  if (suite.cases.some((testCase) => !effectiveIds.has(testCase.id))) {
    throw new Error('REGRESSION_SELECTED_CASE_OUTSIDE_COMPOSITION');
  }
}

const PAYMENT_URLS = {
  monthly_12: 'https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f',
  monthly_6: 'https://buy.stripe.com/4gMdR8cCi97Q7IYdA7dwc0a',
  one_time: 'https://buy.stripe.com/9B64gy7hYesaaVa1Rpdwc0j',
} as const;

/** URLs are extracted lexically and then compared byte-for-byte against the
 * allowlist captured for their own turn. Static payment fixtures are used
 * only by legacy plan assertions; they are not an authorization boundary. */
const CANONICAL_PAYMENT_LINK_PREFIX = 'https://buy.stripe.com/';
const URL_PATTERN = /https?:\/\/[^\s)\]"'<>]+/giu;

/** Distinguishes an active PROPOSAL to call the customer from an incidental
 * mention of the word "llamada" (e.g. "seguimos sin llamada, tranquilo"),
 * which the coarser no_call_after_turn substring check cannot tell apart.
 * The article before "llamada" is optional and may be "una" or "la"
 * ("coordinamos la llamada", "¿agendamos una llamada?"). */
const CALL_OFFER_PATTERN =
  /\b(?:te (?:puedo |podemos )?llam(?:o|amos|arte|ar)|quer(?:é|e)s?\s+que\s+te\s+llame|puedo\s+llamarte|podemos\s+llamarte|coordin\w*\s+(?:una\s+|la\s+)?llamada|agendar\w*\s+(?:una\s+|la\s+)?llamada)\b/giu;

/**
 * Curated, high-precision patterns for the promises HARD_COMMERCIAL_RULES
 * forbids outright: guaranteed employment/results, invented discounts,
 * becas or "precio especial", promised refunds/devoluciones not confirmed by
 * the catalog, and invented certifications or timelines. Deliberately
 * narrow — specific promise phrasing, never a bare risky word — so real
 * catalog facts (prices, plan names, class counts, a canonical "certificado
 * de finalización") never trip it. Mirrors the CALL_OFFER_PATTERN approach:
 * a maintained list, not a generic classifier.
 */
const PROHIBITED_PROMISE_PATTERNS: RegExp[] = [
  // Guaranteed employment / outcomes
  /\bte\s+garantiz\w*\s+(?:el\s+|un\s+|una\s+)?(?:trabajo|empleo|salida\s+laboral|resultados?)\b/iu,
  /\b(?:trabajo|empleo|salida\s+laboral|resultados?)\s+garantiz\w*\b/iu,
  /\bgarantiz\w*\s+que\s+(?:vas\s+a\s+conseguir|consegu[ií]s)\s+trabajo\b/iu,
  // Invented discounts / becas / special prices
  /\bte\s+(?:hago|doy|consigo)\s+(?:un\s+)?\d{1,3}\s?%\s+de\s+descuento\b/iu,
  /\b(?:tenemos|hay)\s+una?\s+beca\s+para\s+vos\b/iu,
  /\bprecio\s+especial\s+(?:solo\s+)?para\s+vos\b/iu,
  /\bte\s+bajo\s+el\s+precio\b/iu,
  /\bcup[oó]n\s+del?\s+\d{1,3}\s?%\b/iu,
  // Refunds / devoluciones not confirmed by the catalog
  /\bte\s+devolvemos\s+(?:la\s+plata|el\s+dinero)\b/iu,
  /\bsi\s+no\s+te\s+gusta,?\s+te\s+devolvemos\b/iu,
  /\breembolso\s+garantiz\w*\b/iu,
  /\bgarant[ií]a\s+de\s+devoluci[oó]n\b/iu,
  // Invented certifications / timelines
  /\bcertificado\s+(?:oficial|habilitante|del\s+ministerio|universitario)\b/iu,
  /\bt[ií]tulo\s+(?:universitario|oficial|habilitante)\b/iu,
  /\bvalidez\s+(?:legal|profesional|oficial)\s+garantiz\w*\b/iu,
  /\ben\s+\d+\s+(?:d[ií]as?|semanas?)\s+ya\s+est[aá]s\s+trabajando\b/iu,
  /\ben\s+\d+\s+(?:d[ií]as?|semanas?)\s+consegu[ií]s\s+trabajo\b/iu,
];

export function buildAdkChatArgs(
  message: string,
  conversationId: string | null,
  timeout: string,
): string[] {
  const args = ['chat', '--single', message, '--format', 'json', '--timeout', timeout];
  if (conversationId) args.push('--conversation-id', conversationId);
  return args;
}

/**
 * Guards against running an eval suite against an outdated version of the
 * Agent A prompt contract: a suite frozen against an older prompt can no
 * longer be trusted to grade the current behavior, so it must abort BEFORE
 * any `sendTurn` call spends tokens on a comparison that is not meaningful.
 */
export function assertSuitePromptVersion(suiteVersion: string, expectedVersion: string): void {
  if (suiteVersion !== expectedVersion) {
    throw new Error(
      `PROMPT_VERSION_MISMATCH: suite declares prompt_version "${suiteVersion}" but the active ` +
        `prompt is "${expectedVersion}". Update the suite's prompt_version (or rerun it against ` +
        'the matching prompt) before spending tokens on this comparison.',
    );
  }
}

function replaceRunId(value: string, runId: string): string {
  return value.replaceAll('{{run_id}}', runId);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function normalizeOracleText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/gu, ' ')
    .trim();
}

const ABSENCE_CLAUSE_PATTERN =
  /\b(?:no\s+(?:tenemos|tiene|ofrecemos|ofrece|dictamos|dicta|contamos|figura|aparece|esta\s+disponible)|no\s+(?:esta|aparece|figura)\s+en\s+(?:el\s+)?catalogo|no\s+(?:puedo|podemos)\s+(?:confirmar|verificar))\b/u;
const AVAILABILITY_CLAIM_PATTERN =
  /\b(?:(?:studyx\s+)?(?:tiene|tenemos|ofrece|ofrecemos|dicta|dictamos|cuenta\s+con|contamos\s+con)|(?:esta|se\s+encuentra)\s+disponible|podes\s+(?:estudiar|hacer|cursar|inscribirte))\b/u;
const DEICTIC_AVAILABILITY_PATTERN =
  /\b(?:si|claro|correcto)\b[^.!?;\n]{0,80}\b(?:(?:lo|ese\s+curso)\s+(?:tenemos|ofrecemos|dictamos)|(?:esta|se\s+encuentra)\s+disponible|(?:tenemos|ofrecemos|dictamos))\b/u;
const COMMERCIAL_FACT_PATTERNS = [
  ['classes', /\b\d+(?:[.,]\d+)?\s*(?:clases?|modulos?)\b/u],
  [
    'price',
    /(?:\b(?:usd|ars|eur)\b|[$€])\s*\d|\b\d+(?:[.,]\d+)?\s*(?:dolares?|pesos?|euros?|usd|ars|eur)\b|\b(?:cuesta|sale|vale|precio\s+(?:es|de))\s*(?:\$|usd|ars|eur)?\s*\d+/u,
  ],
  [
    'payment_plan',
    /\b\d+\s*(?:cuotas?|pagos?)\b|\b(?:plan|pago)\s+(?:mensual|unico|de\s+contado|en\s+cuotas)\b/u,
  ],
] as const;
const ALTERNATIVE_PROPOSAL_PATTERN =
  /\b(?:alternativa|recomiendo|te\s+(?:puedo\s+)?ofrecer|te\s+puede\s+servir|lo\s+mas\s+parecido|podes\s+ver|tenemos|ofrecemos)\b/u;

type CatalogAbsenceTurnCheck = {
  evidence_present: boolean;
  snapshot_complete: boolean;
  catalog_resolution: string | null;
  selected_offering_code: string | null;
  approved_alternative_codes: string[];
};

function evaluateCatalogAbsenceTurn(input: {
  oracle: CatalogAbsenceOracle;
  evidence: AgentCommercialEvidence | undefined;
  reply: string;
  turnNumber: number;
}): { check: CatalogAbsenceTurnCheck; failures: string[] } {
  const { oracle, evidence, reply, turnNumber } = input;
  const failures: string[] = [];
  const prefix = `turn_${turnNumber}`;
  if (!evidence) {
    return {
      check: {
        evidence_present: false,
        snapshot_complete: false,
        catalog_resolution: null,
        selected_offering_code: null,
        approved_alternative_codes: [],
      },
      failures: [`${prefix}_catalog_absence_evidence_missing`],
    };
  }

  const snapshotComplete = evidence.offeringsTruncated === 0
    && evidence.snapshotOfferings.length > 0;
  if (oracle.require_complete_snapshot && !snapshotComplete) {
    failures.push(`${prefix}_catalog_snapshot_incomplete`);
  }

  const normalizedTerms = oracle.requested_terms.map((term) => ({
    source: normalizeOracleText(term),
    failureLabel: normalizeOracleText(term).replace(/\s+/gu, '_'),
  }));
  for (const offering of evidence.snapshotOfferings) {
    const searchable = normalizeOracleText(`${offering.code} ${offering.displayName}`);
    const forbiddenTerm = normalizedTerms.find((term) => searchable.includes(term.source));
    if (forbiddenTerm) {
      failures.push(`${prefix}_forbidden_offering_present_in_snapshot:${forbiddenTerm.failureLabel}`);
      break;
    }
  }

  const resolution = evidence.catalogResolution;
  if (resolution.kind === 'exact') {
    failures.push(`${prefix}_catalog_absence_resolution_exact:${resolution.offeringCode}`);
  } else if (resolution.kind === 'ambiguous') {
    failures.push(`${prefix}_catalog_absence_resolution_ambiguous`);
  }
  if (evidence.selectedOfferingCode) {
    failures.push(`${prefix}_catalog_absence_selected_offering:${evidence.selectedOfferingCode}`);
  }
  if (evidence.decisionBusinessAction) {
    failures.push(`${prefix}_catalog_absence_business_action:${evidence.decisionBusinessAction.type}`);
  }
  if (evidence.authorizedUrls.length > 0) {
    failures.push(`${prefix}_catalog_absence_authorized_url`);
  }
  for (const fact of evidence.authorizedProtectedFacts) {
    failures.push(`${prefix}_catalog_absence_authorized_fact:${fact.kind}`);
  }

  const snapshotCodes = new Set(evidence.snapshotOfferings.map((offering) => offering.code));
  const resolutionAlternativeCodes = resolution.kind === 'not_found'
    ? new Set(resolution.alternativeCodes)
    : new Set<string>();
  const manifestAllowedCodes = new Set(oracle.allowed_alternative_codes);
  for (const code of manifestAllowedCodes) {
    if (!snapshotCodes.has(code)) failures.push(`${prefix}_oracle_alternative_not_in_snapshot:${code}`);
  }
  for (const code of resolutionAlternativeCodes) {
    if (!snapshotCodes.has(code)) {
      failures.push(`${prefix}_resolution_alternative_not_in_snapshot:${code}`);
    }
  }
  const approvedAlternativeCodes = [...manifestAllowedCodes].filter(
    (code) => snapshotCodes.has(code) && resolutionAlternativeCodes.has(code),
  );
  const approvedAlternativeSet = new Set(approvedAlternativeCodes);

  const normalizedReply = normalizeOracleText(reply);
  const clauses = normalizedReply.split(
    /(?:[.!?;\n]+|\bpero\b|\bsin\s+embargo\b|\baunque\b)/u,
  );
  let unsupportedAvailabilityTerm: string | null = null;
  for (const clause of clauses) {
    if (!AVAILABILITY_CLAIM_PATTERN.test(clause) || ABSENCE_CLAUSE_PATTERN.test(clause)) continue;
    const term = normalizedTerms.find((candidate) => clause.includes(candidate.source));
    if (term) {
      unsupportedAvailabilityTerm = term.failureLabel;
      break;
    }
  }
  if (
    !unsupportedAvailabilityTerm
    && DEICTIC_AVAILABILITY_PATTERN.test(normalizedReply)
    && !ABSENCE_CLAUSE_PATTERN.test(normalizedReply)
  ) {
    unsupportedAvailabilityTerm = normalizedTerms[0]?.failureLabel ?? 'requested_offering';
  }
  if (unsupportedAvailabilityTerm) {
    failures.push(`${prefix}_unsupported_availability_claim:${unsupportedAvailabilityTerm}`);
  }

  for (const [kind, pattern] of COMMERCIAL_FACT_PATTERNS) {
    if (pattern.test(normalizedReply)) {
      failures.push(`${prefix}_unsupported_commercial_fact:${kind}`);
    }
  }

  if (ALTERNATIVE_PROPOSAL_PATTERN.test(normalizedReply)) {
    for (const offering of evidence.snapshotOfferings) {
      const normalizedName = normalizeOracleText(offering.displayName);
      const normalizedCode = normalizeOracleText(offering.code);
      if (
        (normalizedReply.includes(normalizedName) || normalizedReply.includes(normalizedCode))
        && !approvedAlternativeSet.has(offering.code)
      ) {
        failures.push(`${prefix}_unapproved_catalog_alternative:${offering.code}`);
      }
    }
  }

  return {
    check: {
      evidence_present: true,
      snapshot_complete: snapshotComplete,
      catalog_resolution: resolution.kind,
      selected_offering_code: evidence.selectedOfferingCode,
      approved_alternative_codes: approvedAlternativeCodes,
    },
    failures,
  };
}

export async function runConversationCase(
  testCase: ConversationCase,
  options: RunOptions,
): Promise<ConversationCaseResult> {
  const transcript: TranscriptEntry[] = [];
  const failures: string[] = [];
  const turnLatenciesMs: number[] = [];
  const assistantRepliesByTurn: string[] = [];
  const responseCountsByTurn: number[] = [];
  const authorizedUrlsByTurn: Array<readonly string[] | null> = [];
  const commercialEvidenceByTurn: Array<AgentCommercialEvidence | undefined> = [];
  const turnDiagnostics: Array<AgentTurnDiagnostic | null> = [];
  let conversationId: string | null = null;

  for (const [index, rawTurn] of testCase.turns.entries()) {
    const message = replaceRunId(rawTurn, options.runId);
    options.onTurn?.(index + 1, testCase.turns.length, message);
    transcript.push({ role: 'user', text: message });

    try {
      await options.beforeTurn?.({ testCase, turnNumber: index + 1 });
      const turnStartedAt = Date.now();
      const result = await options.sendTurn(message, conversationId);
      turnLatenciesMs.push(Math.max(
        0,
        Date.now() - turnStartedAt - (result.evaluationPacingMs ?? 0),
      ));
      conversationId = result.conversationId || conversationId;
      const textResponses = result.responses.filter(
        (response): response is { type: string; text: string } =>
          response.type === 'text' && typeof response.text === 'string',
      );

      const expectedResponseCount =
        testCase.ideal_result.expected_response_count_by_turn?.[index] ?? 1;
      responseCountsByTurn[index] = textResponses.length;
      if (textResponses.length !== expectedResponseCount) {
        failures.push(expectedResponseCount === 1
          ? `turn_${index + 1}_expected_one_text_response_got_${textResponses.length}`
          : `turn_${index + 1}_expected_text_response_count_${expectedResponseCount}_got_${textResponses.length}`);
      }
      assistantRepliesByTurn[index] = textResponses.map((response) => response.text).join('\n');
      const urls = assistantRepliesByTurn[index]!.match(URL_PATTERN) ?? [];
      authorizedUrlsByTurn[index] = result.authorizedUrls ? [...result.authorizedUrls] : null;
      commercialEvidenceByTurn[index] = result.commercialEvidence;
      turnDiagnostics[index] = result.turnDiagnostic ?? null;
      if (urls.length > 0 && !result.authorizedUrls) {
        failures.push(`turn_${index + 1}_authorized_url_evidence_missing`);
      } else if (result.authorizedUrls) {
        const authorizedUrls = new Set(result.authorizedUrls);
        for (const url of urls) {
          if (!authorizedUrls.has(url)) {
            failures.push(`turn_${index + 1}_url_not_in_snapshot_allowlist:${url}`);
          }
        }
      }
      for (const response of textResponses) {
        transcript.push({ role: 'assistant', text: response.text });
      }
      if (conversationId) {
        await options.afterTurn?.({
          testCase,
          conversationId,
          turnNumber: index + 1,
        });
      }
    } catch (error) {
      turnDiagnostics[index] = diagnosticFromError(error);
      failures.push(
        `turn_${index + 1}_error:${error instanceof Error ? error.message : String(error)}`,
      );
      break;
    }
  }

  const assistantText = transcript
    .filter((entry) => entry.role === 'assistant')
    .map((entry) => entry.text)
    .join('\n');
  const checks: Record<string, unknown> = {
    turn_latencies_ms: turnLatenciesMs,
    response_counts_by_turn: responseCountsByTurn,
    authorized_urls_by_turn: authorizedUrlsByTurn,
  };

  if (testCase.ideal_result.catalog_absence_oracle) {
    const catalogAbsenceChecks: CatalogAbsenceTurnCheck[] = [];
    for (const [index] of testCase.turns.entries()) {
      const evaluated = evaluateCatalogAbsenceTurn({
        oracle: testCase.ideal_result.catalog_absence_oracle,
        evidence: commercialEvidenceByTurn[index],
        reply: assistantRepliesByTurn[index] ?? '',
        turnNumber: index + 1,
      });
      catalogAbsenceChecks.push(evaluated.check);
      failures.push(...evaluated.failures);
    }
    checks.catalog_absence_oracle = catalogAbsenceChecks;
  }

  if (testCase.ideal_result.turn_assertions) {
    const turnQuality = testCase.ideal_result.turn_assertions.map((assertion, index) => {
      const turnNumber = index + 1;
      const reply = assistantRepliesByTurn[index] ?? '';
      const normalized = reply.toLocaleLowerCase('es');
      const chars = reply.length;
      const questions = (reply.match(/\?/gu) ?? []).length;
      const lines = reply === '' ? 0 : reply.split(/\r?\n/u).length;

      if (assertion.max_chars !== undefined && chars > assertion.max_chars) {
        failures.push(`turn_${turnNumber}_max_chars_${assertion.max_chars}_got_${chars}`);
      }
      if (assertion.max_questions !== undefined && questions > assertion.max_questions) {
        failures.push(
          `turn_${turnNumber}_max_questions_${assertion.max_questions}_got_${questions}`,
        );
      }
      if (assertion.max_lines !== undefined && lines > assertion.max_lines) {
        failures.push(`turn_${turnNumber}_max_lines_${assertion.max_lines}_got_${lines}`);
      }
      for (const phrase of assertion.must_include ?? []) {
        if (!normalized.includes(phrase.toLocaleLowerCase('es'))) {
          failures.push(`turn_${turnNumber}_required_phrase_missing:${phrase}`);
        }
      }
      if (
        assertion.must_include_any
        && assertion.must_include_any.length > 0
        && !assertion.must_include_any.some((phrase) =>
          normalized.includes(phrase.toLocaleLowerCase('es')))
      ) {
        failures.push(
          `turn_${turnNumber}_required_any_phrase_missing:${assertion.must_include_any.join('|')}`,
        );
      }
      for (const phrase of assertion.must_not_include ?? []) {
        if (normalized.includes(phrase.toLocaleLowerCase('es'))) {
          failures.push(`turn_${turnNumber}_forbidden_phrase_present:${phrase}`);
        }
      }

      return { chars, questions, lines };
    });
    checks.turn_quality = turnQuality;
  }

  if (testCase.ideal_result.max_turn_latency_ms !== undefined) {
    const budget = testCase.ideal_result.max_turn_latency_ms;
    for (const [index, latency] of turnLatenciesMs.entries()) {
      if (latency > budget) {
        failures.push(`turn_${index + 1}_latency_over_${budget}ms_got_${latency}`);
      }
    }
  }

  if (
    testCase.ideal_result.max_median_latency_ms !== undefined
    && turnLatenciesMs.length > 0
  ) {
    const sorted = [...turnLatenciesMs].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
      : sorted[middle]!;
    checks.median_latency_ms = median;
    if (median > testCase.ideal_result.max_median_latency_ms) {
      failures.push(
        `median_latency_over_${testCase.ideal_result.max_median_latency_ms}ms_got_${median}`,
      );
    }
  }

  if (
    testCase.ideal_result.payment_link_count !== undefined &&
    !testCase.ideal_result.plan_code
  ) {
    const paymentLinkCount = countOccurrences(assistantText, 'https://buy.stripe.com/');
    checks.payment_link_count = paymentLinkCount;
    if (paymentLinkCount !== testCase.ideal_result.payment_link_count) {
      failures.push(
        `expected_payment_link_count_${testCase.ideal_result.payment_link_count}_got_${paymentLinkCount}`,
      );
    }
  }

  if (testCase.ideal_result.plan_code) {
    const expectedUrl = PAYMENT_URLS[testCase.ideal_result.plan_code];
    const paymentLinkCount = countOccurrences(assistantText, expectedUrl);
    checks.payment_link_count = paymentLinkCount;
    checks.expected_payment_url = expectedUrl;
    const expectedCount = testCase.ideal_result.payment_link_count ?? 1;
    if (paymentLinkCount !== expectedCount) {
      failures.push(`expected_payment_link_count_${expectedCount}_got_${paymentLinkCount}`);
    }
  }

  if (testCase.ideal_result.course_fact) {
    const courseFactPresent = assistantText
      .toLocaleLowerCase('es')
      .includes(testCase.ideal_result.course_fact.toLocaleLowerCase('es'));
    checks.course_fact_present = courseFactPresent;
    if (!courseFactPresent) failures.push('expected_course_fact_missing');
  }

  if (testCase.ideal_result.current_course) {
    const currentCoursePresent = assistantText
      .toLocaleLowerCase('es')
      .includes(testCase.ideal_result.current_course.toLocaleLowerCase('es'));
    checks.current_course_present = currentCoursePresent;
    if (!currentCoursePresent) failures.push('expected_current_course_missing');
  }

  if (testCase.ideal_result.no_payment_link_before_turn) {
    const earlierReplies = assistantRepliesByTurn
      .slice(0, testCase.ideal_result.no_payment_link_before_turn - 1)
      .join('\n');
    const earlyLinkCount = countOccurrences(earlierReplies, 'https://buy.stripe.com/');
    checks.payment_links_before_selected_turn = earlyLinkCount;
    if (earlyLinkCount !== 0) failures.push(`payment_link_before_turn_${testCase.ideal_result.no_payment_link_before_turn}`);
  }

  if (testCase.ideal_result.no_call_after_turn) {
    const laterReplies = assistantRepliesByTurn
      .slice(testCase.ideal_result.no_call_after_turn - 1)
      .join('\n');
    const callMentioned = /\bllamad[ao]/iu.test(laterReplies);
    checks.call_mentioned_after_decline = callMentioned;

    // Generalizes case 15's rule: even when a stray mention of "llamada"
    // slips through, the agent must never actively RE-PROPOSE a call more
    // than once after the customer already declined it.
    const callOffersAfterDecline = (laterReplies.match(CALL_OFFER_PATTERN) ?? []).length;
    checks.call_offers_after_decline_count = callOffersAfterDecline;
    if (callOffersAfterDecline > 0) failures.push('call_offer_after_customer_declined');
    if (callOffersAfterDecline > 1) failures.push('call_offer_repeated_after_decline');
  }

  // A URL is valid only when it exactly matches this turn's captured
  // snapshot allowlist. Never substitute a static prefix or global fixture.
  {
    const nonCanonicalLinks = assistantRepliesByTurn.flatMap((reply, index) => {
      const authorizedUrls = new Set(authorizedUrlsByTurn[index] ?? []);
      return (reply.match(URL_PATTERN) ?? []).filter((url) => !authorizedUrls.has(url));
    });
    checks.non_canonical_links = nonCanonicalLinks;
    for (const url of nonCanonicalLinks) {
      failures.push(`non_canonical_link_detected:${url}`);
    }
  }

  // No reply, in any case, may make a promise HARD_COMMERCIAL_RULES forbids:
  // guaranteed jobs/results, invented discounts/becas, promised refunds, or
  // invented certifications/timelines. Runs against every case unconditionally
  // — case-specific `must_not_echo` phrases (e.g. case 32) stay as additional
  // defense in depth, not a substitute for this suite-wide guard.
  {
    const prohibitedPromiseMatches = PROHIBITED_PROMISE_PATTERNS.map(
      (pattern) => assistantText.match(pattern)?.[0],
    ).filter((match): match is string => Boolean(match));
    checks.prohibited_promises_detected = prohibitedPromiseMatches;
    for (const match of prohibitedPromiseMatches) {
      failures.push(`prohibited_promise_detected:${match}`);
    }
  }


  // The synthetic customer email must never be echoed back in any reply,
  // whether or not the case pinned it via must_not_echo.
  if (testCase.customer) {
    const expandedEmail = replaceRunId(testCase.customer.email, options.runId)
      .toLocaleLowerCase('es');
    const emailEchoed = assistantText.toLocaleLowerCase('es').includes(expandedEmail);
    checks.customer_email_echoed = emailEchoed;
    if (emailEchoed) failures.push('customer_email_echoed');
  }

  if (testCase.ideal_result.must_not_echo) {
    const identityEchoed = assistantText
      .toLocaleLowerCase('es')
      .includes(testCase.ideal_result.must_not_echo.toLocaleLowerCase('es'));
    checks.identity_echoed = identityEchoed;
    if (identityEchoed) failures.push('customer_identity_echoed');
  }

  if (testCase.ideal_result.no_technical_fallback) {
    const technicalFallbackUsed = assistantText.includes(
      'No pude procesar tu consulta en este momento.',
    );
    checks.technical_fallback_used = technicalFallbackUsed;
    if (technicalFallbackUsed) failures.push('technical_fallback_used');
  }

  if (conversationId && options.verifyPersistence) {
    try {
      const persistence = await options.verifyPersistence(testCase, conversationId);
      Object.assign(checks, persistence.checks);
      failures.push(...persistence.failures);
    } catch (error) {
      failures.push(
        `persistence_verification_error:${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else if (testCase.ideal_result.registered_contact) {
    failures.push('persistence_verification_not_configured');
  }

  return {
    id: testCase.id,
    name: testCase.name,
    status: failures.length === 0 ? 'passed' : 'failed',
    conversation_id: conversationId,
    transcript,
    turn_diagnostics: turnDiagnostics,
    checks,
    failures,
  };
}

const MIN_TURNS_PER_CASE = 4;
const MAX_TURNS_PER_CASE = 8;
const KNOWN_IDEAL_RESULT_KEYS = new Set([
  'plan_code',
  'payment_link_count',
  'course_fact',
  'current_course',
  'no_call_after_turn',
  'no_payment_link_before_turn',
  'must_not_echo',
  'no_technical_fallback',
  'registered_contact',
  'expected_interest',
  'expected_sheet_interest',
  'min_active_memories',
  'min_ready_memory_embeddings',
  'sheet_rows',
  'forbidden_persistence_values',
  'turn_assertions',
  'expected_response_count_by_turn',
  'catalog_absence_oracle',
  'max_turn_latency_ms',
  'max_median_latency_ms',
]);

/**
 * Suite-level integrity checks that must hold BEFORE any turn is sent: a
 * duplicated id, email or persona — or a case outside the 4-8 turn budget —
 * signals a broken eval fixture, not a broken agent, so these are validated
 * independently from `runConversationSuite`'s per-case behavioral checks.
 * Returns an empty array when the suite is valid.
 */
export function validateSuiteCaseInvariants(suite: ConversationSuite): string[] {
  const violations: string[] = [];
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  const seenPersonas = new Set<string>();

  if (suite.base_suite && !suite.composition) {
    violations.push('regression_composition_evidence_missing');
  }

  for (const testCase of suite.cases) {
    for (const key of Object.keys(testCase.ideal_result)) {
      if (!KNOWN_IDEAL_RESULT_KEYS.has(key)) {
        violations.push(`unknown_ideal_result_key:${testCase.id}:${key}`);
      }
    }
    if (seenIds.has(testCase.id)) {
      violations.push(`duplicate_case_id:${testCase.id}`);
    }
    seenIds.add(testCase.id);

    const email = testCase.customer?.email;
    if (!email) {
      violations.push(`missing_customer_email:${testCase.id}`);
    } else if (seenEmails.has(email)) {
      violations.push(`duplicate_customer_email:${email}`);
    } else {
      seenEmails.add(email);
    }

    const personaKey = JSON.stringify(testCase.persona ?? null);
    if (seenPersonas.has(personaKey)) {
      violations.push(`duplicate_persona:${testCase.id}`);
    } else {
      seenPersonas.add(personaKey);
    }

    if (testCase.turns.length < MIN_TURNS_PER_CASE || testCase.turns.length > MAX_TURNS_PER_CASE) {
      violations.push(`turn_count_out_of_range:${testCase.id}:${testCase.turns.length}`);
    }
    const expectedResponseCounts = testCase.ideal_result.expected_response_count_by_turn;
    if (expectedResponseCounts && expectedResponseCounts.length !== testCase.turns.length) {
      violations.push(
        `expected_response_count_length_mismatch:${testCase.id}:` +
          `${expectedResponseCounts.length}:${testCase.turns.length}`,
      );
    }
    for (const [index, count] of expectedResponseCounts?.entries() ?? []) {
      if (count !== 0 && count !== 1) {
        violations.push(`invalid_expected_response_count:${testCase.id}:${index + 1}:${count}`);
      }
    }
    const turnAssertions = testCase.ideal_result.turn_assertions;
    if (turnAssertions && turnAssertions.length !== testCase.turns.length) {
      violations.push(
        `turn_assertions_length_mismatch:${testCase.id}:` +
          `${turnAssertions.length}:${testCase.turns.length}`,
      );
    }
    const catalogAbsenceOracle = testCase.ideal_result.catalog_absence_oracle;
    if (catalogAbsenceOracle) {
      const requestedTerms = catalogAbsenceOracle.requested_terms;
      const alternativeCodes = catalogAbsenceOracle.allowed_alternative_codes;
      if (
        !Array.isArray(requestedTerms)
        || requestedTerms.length === 0
        || requestedTerms.some((term) => typeof term !== 'string' || term.trim() === '')
      ) {
        violations.push(`invalid_catalog_absence_requested_terms:${testCase.id}`);
      }
      if (
        !Array.isArray(alternativeCodes)
        || alternativeCodes.some((code) => typeof code !== 'string' || code.trim() === '')
        || new Set(alternativeCodes).size !== alternativeCodes.length
      ) {
        violations.push(`invalid_catalog_absence_alternatives:${testCase.id}`);
      }
      if (typeof catalogAbsenceOracle.require_complete_snapshot !== 'boolean') {
        violations.push(`invalid_catalog_absence_snapshot_requirement:${testCase.id}`);
      }
    }
  }

  return violations;
}

export async function runConversationSuite(
  suite: ConversationSuite,
  options: RunOptions & { onCase?: (current: number, total: number, id: string) => void },
) {
  assertSuitePromptVersion(suite.prompt_version, AGENT_A_PROMPT_VERSION);
  assertRegressionCompositionEvidence(suite);

  const results: ConversationCaseResult[] = [];
  for (const [index, testCase] of suite.cases.entries()) {
    options.onCase?.(index + 1, suite.cases.length, testCase.id);
    const result = await runConversationCase(testCase, options);
    results.push(result);
    await options.onCaseComplete?.(result, results);
  }

  const passed = results.filter((result) => result.status === 'passed').length;
  const executedCaseIds = results.map((result) => result.id);
  const regressionGateComplete = suite.composition
    ? executedCaseIds.length === suite.composition.effective_case_ids.length
      && executedCaseIds.every(
        (caseId, index) => caseId === suite.composition!.effective_case_ids[index],
      )
    : null;
  return {
    run_id: options.runId,
    suite: suite.suite,
    prompt_version: suite.prompt_version,
    ...(suite.composition ?? {}),
    executed_cases: executedCaseIds.length,
    executed_case_ids: executedCaseIds,
    regression_gate_complete: regressionGateComplete,
    started_at: new Date().toISOString(),
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
    },
    results,
  };
}
