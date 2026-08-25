import { AGENT_A_PROMPT_VERSION } from '../../botpress-agent/src/prompts/agent-a-sales-bridge';

export type AgentChatResult = {
  conversationId: string;
  responses: Array<{ type: string; text?: string }>;
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
  checks: Record<string, unknown>;
  failures: string[];
};

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
  cases: ConversationCase[];
};

const PAYMENT_URLS = {
  monthly_12: 'https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f',
  monthly_6: 'https://buy.stripe.com/4gMdR8cCi97Q7IYdA7dwc0a',
  one_time: 'https://buy.stripe.com/9B64gy7hYesaaVa1Rpdwc0j',
} as const;

/** The only link domain the pipeline is ever allowed to send: the Stripe
 * checkout links configured in business_snapshot.workspace.payment_options.
 * Every other URL is by definition something the model authored itself,
 * which HARD_COMMERCIAL_RULES forbids outright. */
const CANONICAL_PAYMENT_LINK_PREFIX = 'https://buy.stripe.com/';
const CANONICAL_PAYMENT_LINKS = new Set(Object.values(PAYMENT_URLS));
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

export async function runConversationCase(
  testCase: ConversationCase,
  options: RunOptions,
): Promise<ConversationCaseResult> {
  const transcript: TranscriptEntry[] = [];
  const failures: string[] = [];
  const turnLatenciesMs: number[] = [];
  const assistantRepliesByTurn: string[] = [];
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

      if (textResponses.length !== 1) {
        failures.push(
          `turn_${index + 1}_expected_one_text_response_got_${textResponses.length}`,
        );
      }
      assistantRepliesByTurn[index] = textResponses.map((response) => response.text).join('\n');
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
  const checks: Record<string, unknown> = { turn_latencies_ms: turnLatenciesMs };

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
    const earlierReplies = transcript
      .slice(0, (testCase.ideal_result.no_payment_link_before_turn - 1) * 2)
      .filter((entry) => entry.role === 'assistant')
      .map((entry) => entry.text)
      .join('\n');
    const earlyLinkCount = countOccurrences(earlierReplies, 'https://buy.stripe.com/');
    checks.payment_links_before_selected_turn = earlyLinkCount;
    if (earlyLinkCount !== 0) failures.push(`payment_link_before_turn_${testCase.ideal_result.no_payment_link_before_turn}`);
  }

  if (testCase.ideal_result.no_call_after_turn) {
    const laterReplies = transcript
      .slice(testCase.ideal_result.no_call_after_turn * 2 - 1)
      .filter((entry) => entry.role === 'assistant')
      .map((entry) => entry.text)
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

  // No link outside the canonical Stripe payment-link domain may ever
  // appear in a reply: the model never authors a URL itself.
  {
    const urls = assistantText.match(URL_PATTERN) ?? [];
    const nonCanonicalLinks = urls.filter((url) => !CANONICAL_PAYMENT_LINKS.has(
      url as (typeof PAYMENT_URLS)[keyof typeof PAYMENT_URLS],
    ));
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
  }

  return violations;
}

export async function runConversationSuite(
  suite: ConversationSuite,
  options: RunOptions & { onCase?: (current: number, total: number, id: string) => void },
) {
  assertSuitePromptVersion(suite.prompt_version, AGENT_A_PROMPT_VERSION);

  const results: ConversationCaseResult[] = [];
  for (const [index, testCase] of suite.cases.entries()) {
    options.onCase?.(index + 1, suite.cases.length, testCase.id);
    const result = await runConversationCase(testCase, options);
    results.push(result);
    await options.onCaseComplete?.(result, results);
  }

  const passed = results.filter((result) => result.status === 'passed').length;
  return {
    run_id: options.runId,
    suite: suite.suite,
    prompt_version: suite.prompt_version,
    started_at: new Date().toISOString(),
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
    },
    results,
  };
}
