export type AgentChatResult = {
  conversationId: string;
  responses: Array<{ type: string; text?: string }>;
};

export type ConversationCase = {
  id: string;
  name: string;
  course: string;
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
  onTurn?: (current: number, total: number, message: string) => void;
};

export type ConversationSuite = {
  schema_version: string;
  prompt_version: string;
  suite: string;
  cases: ConversationCase[];
};

const PAYMENT_URLS = {
  monthly_12: 'https://buy.stripe.com/14A5kC31I3Nwfbq67Fdwc0f',
  monthly_6: 'https://buy.stripe.com/4gMdR8cCi97Q7IYdA7dwc0a',
  one_time: 'https://buy.stripe.com/9B64gy7hYesaaVa1Rpdwc0j',
} as const;

export function buildAdkChatArgs(
  message: string,
  conversationId: string | null,
  timeout: string,
): string[] {
  const args = ['chat', '--single', message, '--format', 'json', '--timeout', timeout];
  if (conversationId) args.push('--conversation-id', conversationId);
  return args;
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
  const assistantTextsByTurn: string[] = [];
  let conversationId: string | null = null;

  for (const [index, rawTurn] of testCase.turns.entries()) {
    const message = replaceRunId(rawTurn, options.runId);
    options.onTurn?.(index + 1, testCase.turns.length, message);
    transcript.push({ role: 'user', text: message });

    try {
      const result = await options.sendTurn(message, conversationId);
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
      for (const response of textResponses) {
        transcript.push({ role: 'assistant', text: response.text });
      }
      assistantTextsByTurn[index] = textResponses.map((response) => response.text).join('\n');
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
  const checks: Record<string, unknown> = {};

  if (testCase.ideal_result.plan_code) {
    const expectedUrl = PAYMENT_URLS[testCase.ideal_result.plan_code];
    const paymentLinkCount = countOccurrences(assistantText, expectedUrl);
    checks.payment_link_count = paymentLinkCount;
    checks.expected_payment_url = expectedUrl;
    const earlyPaymentLinkCount = assistantTextsByTurn
      .slice(0, -1)
      .reduce((total, text) => total + countOccurrences(text ?? '', expectedUrl), 0);
    checks.payment_link_before_final_turn = earlyPaymentLinkCount > 0;
    if (earlyPaymentLinkCount > 0) failures.push('payment_link_sent_before_final_turn');
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
    if (callMentioned) failures.push('call_pushed_after_customer_declined');
  }

  if (testCase.ideal_result.must_not_echo) {
    const identityEchoed = assistantText
      .toLocaleLowerCase('es')
      .includes(testCase.ideal_result.must_not_echo.toLocaleLowerCase('es'));
    checks.identity_echoed = identityEchoed;
    if (identityEchoed) failures.push('customer_identity_echoed');
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

export async function runConversationSuite(
  suite: ConversationSuite,
  options: RunOptions & { onCase?: (current: number, total: number, id: string) => void },
) {
  const results: ConversationCaseResult[] = [];
  for (const [index, testCase] of suite.cases.entries()) {
    options.onCase?.(index + 1, suite.cases.length, testCase.id);
    results.push(await runConversationCase(testCase, options));
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
