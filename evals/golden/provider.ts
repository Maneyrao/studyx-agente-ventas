type GoldenProviderRoleV1 = 'agent' | 'planner' | 'judge' | 'post_sale' | 'unknown';

interface GoldenTokenUsageV1 {
  readonly input: number | null;
  readonly output: number | null;
  readonly total: number | null;
  readonly cached: number | null;
}

export interface GoldenProviderAttemptV1 {
  readonly call_id: string;
  readonly attempt: number;
  readonly role: GoldenProviderRoleV1;
  readonly provider: 'nvidia_nim' | 'deepseek';
  readonly source_model?: string | null;
  readonly requested_model: string | null;
  readonly returned_model: string | null;
  readonly status: number | null;
  readonly rate_limit_wait_ms: number;
  retry_wait_ms: number;
  readonly latency_ms: number;
  readonly tokens: GoldenTokenUsageV1 | null;
  readonly finish_reason: string | null;
  readonly error_code: string | null;
  readonly response_content: string | null;
  readonly provider_response: unknown | null;
}

export interface GoldenProviderReportV1 {
  readonly provider: 'nvidia_nim' | 'deepseek';
  readonly base_url: string;
  readonly model: string;
  readonly max_requests_per_minute: number | null;
  readonly judge_model?: string;
  readonly logical_calls: number;
  readonly attempts: number;
  readonly usage_missing_attempts: number;
  readonly tokens: GoldenTokenUsageV1 | null;
  readonly records: readonly GoldenProviderAttemptV1[];
}

export interface GoldenResponsesProviderV1 {
  readonly fetch: typeof fetch;
  report(): GoldenProviderReportV1;
}

interface GoldenProviderConfigV1 {
  readonly provider: 'nvidia_nim';
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
  readonly maxRequestsPerMinute: number;
  readonly maxAttempts: number;
  readonly retryBaseDelayMs: number;
}

interface GoldenProviderDependenciesV1 {
  readonly fetchImpl: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly onReport?: (report: GoldenProviderReportV1) => void | Promise<void>;
}

interface ResponsesRequestV1 {
  readonly model?: unknown;
  readonly instructions?: unknown;
  readonly input?: unknown;
  readonly temperature?: unknown;
  readonly max_output_tokens?: unknown;
  readonly text?: {
    readonly format?: {
      readonly type?: unknown;
      readonly name?: unknown;
      readonly schema?: unknown;
    };
  };
}

interface NimChatCompletionV1 {
  readonly id?: unknown;
  readonly model?: unknown;
  readonly choices?: readonly {
    readonly message?: { readonly content?: unknown };
    readonly finish_reason?: unknown;
  }[];
  readonly usage?: {
    readonly prompt_tokens?: unknown;
    readonly completion_tokens?: unknown;
    readonly total_tokens?: unknown;
    readonly prompt_tokens_details?: { readonly cached_tokens?: unknown };
  };
  readonly [key: string]: unknown;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError');
}

function defaultSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function requestRole(body: ResponsesRequestV1): GoldenProviderRoleV1 {
  const name = stringValue(body.text?.format?.name) ?? '';
  if (name.includes('golden_semantic_turn_judge')) return 'judge';
  if (name.includes('post_sale')) return 'post_sale';
  if (name.includes('agent_a_turn_proposal')) return 'agent';
  if (name.includes('agent_a_commercial_turn_plan')) return 'planner';
  return 'unknown';
}

function contentFromInput(input: unknown): string {
  return typeof input === 'string' ? input : JSON.stringify(input ?? '');
}

function toNimRequest(body: ResponsesRequestV1, model: string): Record<string, unknown> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (typeof body.instructions === 'string' && body.instructions.length > 0) {
    messages.push({ role: 'system', content: body.instructions });
  }
  messages.push({ role: 'user', content: contentFromInput(body.input) });
  const format = body.text?.format;
  return {
    model,
    messages,
    ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
    ...(typeof body.max_output_tokens === 'number' ? { max_tokens: body.max_output_tokens } : {}),
    stream: false,
    ...(format?.type === 'json_schema'
      && typeof format.name === 'string'
      && format.schema !== undefined ? {
        response_format: {
          type: 'json_schema',
          json_schema: { name: format.name, strict: true, schema: format.schema },
        },
      } : {}),
  };
}

function tokenUsage(payload: NimChatCompletionV1): GoldenTokenUsageV1 | null {
  if (!payload.usage) return null;
  return {
    input: finiteNumber(payload.usage.prompt_tokens),
    output: finiteNumber(payload.usage.completion_tokens),
    total: finiteNumber(payload.usage.total_tokens),
    cached: finiteNumber(payload.usage.prompt_tokens_details?.cached_tokens),
  };
}

function safeSuccessfulResponse(payload: NimChatCompletionV1): NimChatCompletionV1 {
  return structuredClone(payload);
}

function responseEnvelope(payload: NimChatCompletionV1, content: string): Record<string, unknown> {
  const usage = tokenUsage(payload);
  return {
    id: stringValue(payload.id) ?? 'nim-chat-completion',
    model: stringValue(payload.model),
    output_text: content,
    output: [{
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: content }],
    }],
    ...(usage ? {
      usage: {
        input_tokens: usage.input,
        output_tokens: usage.output,
        total_tokens: usage.total,
        input_tokens_details: { cached_tokens: usage.cached },
      },
    } : {}),
  };
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || [500, 502, 503, 504].includes(status);
}

function retryAfterMilliseconds(response: Response, now: number): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : null;
}

function sanitizedErrorResponse(status: number, code: string): Response {
  return new Response(JSON.stringify({ error: { code } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function decodeRequest(input: RequestInfo | URL, init?: RequestInit): Promise<{
  body: ResponsesRequestV1;
  signal?: AbortSignal;
}> {
  const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const rawBody = init?.body === undefined
    ? (input instanceof Request ? await input.clone().text() : '')
    : String(init.body);
  return { body: JSON.parse(rawBody) as ResponsesRequestV1, ...(signal ? { signal } : {}) };
}

function sumKnown(records: readonly GoldenProviderAttemptV1[], key: keyof GoldenTokenUsageV1): number | null {
  const values = records.map((record) => record.tokens?.[key]).filter((value): value is number => value !== null && value !== undefined);
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function createGoldenResponsesProviderV1(
  config: GoldenProviderConfigV1,
  dependencies: GoldenProviderDependenciesV1,
): GoldenResponsesProviderV1 {
  if (!config.apiKey.trim()) throw new Error('GOLDEN_NIM_API_KEY_MISSING');
  if (config.maxRequestsPerMinute < 1) throw new Error('GOLDEN_PROVIDER_RATE_LIMIT_INVALID');
  if (config.maxAttempts < 1) throw new Error('GOLDEN_PROVIDER_MAX_ATTEMPTS_INVALID');
  const baseUrl = config.baseUrl.replace(/\/+$/u, '');
  const endpoint = `${baseUrl}/chat/completions`;
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? defaultSleep;
  const intervalMs = Math.ceil(60_000 / config.maxRequestsPerMinute);
  const records: GoldenProviderAttemptV1[] = [];
  let logicalCalls = 0;
  let nextStartAt = 0;
  let reservationTail: Promise<void> = Promise.resolve();
  let reportTail: Promise<void> = Promise.resolve();

  const buildReport = (): GoldenProviderReportV1 => {
    const input = sumKnown(records, 'input');
    const output = sumKnown(records, 'output');
    const total = sumKnown(records, 'total');
    const cached = sumKnown(records, 'cached');
    const anyTokens = input !== null || output !== null || total !== null || cached !== null;
    return {
      provider: 'nvidia_nim', base_url: baseUrl, model: config.model,
      max_requests_per_minute: config.maxRequestsPerMinute,
      logical_calls: logicalCalls, attempts: records.length,
      usage_missing_attempts: records.filter((record) => record.tokens === null).length,
      tokens: anyTokens ? { input, output, total, cached } : null,
      records: structuredClone(records),
    };
  };

  const persistRecord = async (record: GoldenProviderAttemptV1): Promise<void> => {
    records.push(record);
    if (dependencies.onReport) {
      const snapshot = buildReport();
      reportTail = reportTail.then(async () => dependencies.onReport?.(snapshot));
      await reportTail;
    }
  };

  const reserve = async (signal?: AbortSignal): Promise<number> => {
    let release!: () => void;
    const previous = reservationTail;
    reservationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      if (signal?.aborted) throw abortError();
      const wait = Math.max(0, nextStartAt - now());
      if (wait > 0) await sleep(wait, signal);
      if (signal?.aborted) throw abortError();
      const startedAt = now();
      nextStartAt = Math.max(startedAt, nextStartAt) + intervalMs;
      return wait;
    } finally {
      release();
    }
  };

  const adaptedFetch: typeof fetch = async (input, init) => {
    logicalCalls += 1;
    const callId = `call-${String(logicalCalls).padStart(4, '0')}`;
    const decoded = await decodeRequest(input, init);
    const requestedModel = stringValue(decoded.body.model);
    const role = requestRole(decoded.body);
    const requestBody = JSON.stringify(toNimRequest(decoded.body, config.model));
    let lastNetworkError: unknown;

    for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
      const rateLimitWait = await reserve(decoded.signal);
      const startedAt = now();
      let response: Response;
      try {
        response = await dependencies.fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: requestBody,
          signal: decoded.signal,
        });
      } catch (error) {
        if (decoded.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          await persistRecord({
            call_id: callId, attempt, role, provider: 'nvidia_nim', requested_model: requestedModel,
            returned_model: null, status: null, rate_limit_wait_ms: rateLimitWait, retry_wait_ms: 0,
            latency_ms: Math.max(0, now() - startedAt), tokens: null, finish_reason: null,
            error_code: 'NIM_ABORTED', response_content: null, provider_response: null,
          });
          throw error;
        }
        lastNetworkError = error;
        const record: GoldenProviderAttemptV1 = {
          call_id: callId, attempt, role, provider: 'nvidia_nim', requested_model: requestedModel,
          returned_model: null, status: null, rate_limit_wait_ms: rateLimitWait, retry_wait_ms: 0,
          latency_ms: Math.max(0, now() - startedAt), tokens: null, finish_reason: null,
          error_code: 'NIM_NETWORK_ERROR', response_content: null, provider_response: null,
        };
        if (attempt < config.maxAttempts) {
          record.retry_wait_ms = config.retryBaseDelayMs * (2 ** (attempt - 1));
        }
        await persistRecord(record);
        if (attempt >= config.maxAttempts) throw error;
        await sleep(record.retry_wait_ms, decoded.signal);
        continue;
      }

      if (!response.ok) {
        const errorCode = `NIM_HTTP_${response.status}`;
        const record: GoldenProviderAttemptV1 = {
          call_id: callId, attempt, role, provider: 'nvidia_nim', requested_model: requestedModel,
          returned_model: null, status: response.status, rate_limit_wait_ms: rateLimitWait, retry_wait_ms: 0,
          latency_ms: Math.max(0, now() - startedAt), tokens: null, finish_reason: null,
          error_code: errorCode, response_content: null, provider_response: null,
        };
        if (!isTransientStatus(response.status) || attempt >= config.maxAttempts) {
          await persistRecord(record);
          return sanitizedErrorResponse(response.status, errorCode);
        }
        const retryAfter = retryAfterMilliseconds(response, now()) ?? 0;
        record.retry_wait_ms = Math.max(retryAfter, config.retryBaseDelayMs * (2 ** (attempt - 1)));
        await persistRecord(record);
        await sleep(record.retry_wait_ms, decoded.signal);
        continue;
      }

      let payload: NimChatCompletionV1;
      try {
        payload = await response.json() as NimChatCompletionV1;
      } catch {
        await persistRecord({
          call_id: callId, attempt, role, provider: 'nvidia_nim', requested_model: requestedModel,
          returned_model: null, status: response.status, rate_limit_wait_ms: rateLimitWait, retry_wait_ms: 0,
          latency_ms: Math.max(0, now() - startedAt), tokens: null, finish_reason: null,
          error_code: 'NIM_INVALID_JSON', response_content: null, provider_response: null,
        });
        return sanitizedErrorResponse(502, 'NIM_INVALID_JSON');
      }
      const firstChoice = payload.choices?.[0];
      const content = stringValue(firstChoice?.message?.content) ?? '';
      await persistRecord({
        call_id: callId, attempt, role, provider: 'nvidia_nim', requested_model: requestedModel,
        returned_model: stringValue(payload.model), status: response.status,
        rate_limit_wait_ms: rateLimitWait, retry_wait_ms: 0,
        latency_ms: Math.max(0, now() - startedAt), tokens: tokenUsage(payload),
        finish_reason: stringValue(firstChoice?.finish_reason), error_code: null,
        response_content: content, provider_response: safeSuccessfulResponse(payload),
      });
      return new Response(JSON.stringify(responseEnvelope(payload, content)), {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw lastNetworkError ?? new Error('GOLDEN_PROVIDER_ATTEMPTS_EXHAUSTED');
  };

  return {
    fetch: adaptedFetch,
    report: buildReport,
  };
}

/** Evaluation transport only: production's configured model and guard stay intact. */
export function createGoldenOfficialResponsesProviderV1(
  config: { readonly agentModel: string; readonly judgeModel: string },
  dependencies: GoldenProviderDependenciesV1,
): GoldenResponsesProviderV1 {
  if (!['deepseek-v4-flash', 'deepseek-v4-pro'].includes(config.agentModel)) {
    throw new Error('GOLDEN_OFFICIAL_AGENT_MODEL_UNSUPPORTED');
  }
  if (config.judgeModel !== 'deepseek-v4-flash') throw new Error('GOLDEN_OFFICIAL_JUDGE_MODEL_UNSUPPORTED');
  const now = dependencies.now ?? Date.now;
  const records: GoldenProviderAttemptV1[] = [];
  let reportTail: Promise<void> = Promise.resolve();
  const report = (): GoldenProviderReportV1 => ({
    provider: 'deepseek', base_url: 'https://api.deepseek.com', model: config.agentModel,
    judge_model: config.judgeModel, max_requests_per_minute: null,
    logical_calls: records.length, attempts: records.length,
    usage_missing_attempts: records.filter(record => record.tokens === null).length,
    tokens: records.some(record => record.tokens !== null) ? {
      input: sumKnown(records, 'input'), output: sumKnown(records, 'output'),
      total: sumKnown(records, 'total'), cached: sumKnown(records, 'cached'),
    } : null,
    records: structuredClone(records),
  });
  const publish = async () => {
    const snapshot = report();
    reportTail = reportTail.then(async () => { await dependencies.onReport?.(snapshot); });
    await reportTail;
  };
  const adaptedFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== 'https://api.deepseek.com' || url.pathname !== '/responses') {
      throw new Error('GOLDEN_OFFICIAL_ORIGIN_NOT_ALLOWLISTED');
    }
    const { body, signal } = await decodeRequest(input, init);
    const role = requestRole(body);
    if (role === 'unknown') throw new Error('GOLDEN_OFFICIAL_ROLE_UNKNOWN');
    const actualModel = role === 'agent' || role === 'planner' ? config.agentModel
      : role === 'judge' ? config.judgeModel : stringValue(body.model);
    const mappedBody = role === 'post_sale' ? body : { ...body, model: actualModel };
    const index = records.length;
    const startedAt = now();
    const pending: GoldenProviderAttemptV1 = {
      call_id: `call-${String(index + 1).padStart(4, '0')}`, attempt: 1, role, provider: 'deepseek',
      source_model: stringValue(body.model), requested_model: actualModel, returned_model: null,
      status: null, rate_limit_wait_ms: 0, retry_wait_ms: 0, latency_ms: 0,
      tokens: null, finish_reason: null, error_code: 'IN_FLIGHT', response_content: null, provider_response: null,
    };
    records.push(pending);
    await publish();
    try {
      const response = await dependencies.fetchImpl(input, {
        ...init, body: JSON.stringify(mappedBody), ...(signal ? { signal } : {}),
      });
      const decoded: unknown = await response.clone().json().catch(() => null);
      const payload = decoded && typeof decoded === 'object' && !Array.isArray(decoded)
        ? decoded as Record<string, unknown> : null;
      const usage = payload?.usage as { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown;
        input_tokens_details?: { cached_tokens?: unknown } } | undefined;
      const output = Array.isArray(payload?.output) ? payload.output : [];
      const outputText = output.flatMap(item => item && typeof item === 'object'
        && Array.isArray(item.content) ? item.content : [])
        .map(item => item && typeof item === 'object' ? stringValue(item.text) ?? '' : '').join('');
      records[index] = {
        ...pending, status: response.status, latency_ms: now() - startedAt,
        returned_model: stringValue(payload?.model),
        tokens: usage ? { input: finiteNumber(usage.input_tokens), output: finiteNumber(usage.output_tokens),
          total: finiteNumber(usage.total_tokens), cached: finiteNumber(usage.input_tokens_details?.cached_tokens) } : null,
        finish_reason: stringValue(payload?.status), error_code: response.ok ? null : `DEEPSEEK_HTTP_${response.status}`,
        response_content: stringValue(payload?.output_text) ?? (outputText || null),
        provider_response: payload,
      };
      await publish();
      return response;
    } catch (error) {
      records[index] = { ...pending, latency_ms: now() - startedAt,
        error_code: signal?.aborted || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name))
          ? 'DEEPSEEK_ABORTED' : 'DEEPSEEK_NETWORK_ERROR' };
      await publish();
      throw error;
    }
  };
  return { fetch: adaptedFetch, report };
}
