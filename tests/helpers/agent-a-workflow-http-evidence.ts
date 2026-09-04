export interface WorkflowHttpExchangeV1 {
  readonly boundary: 'deepseek' | 'backend';
  readonly url: string;
  readonly requestBody: unknown;
  readonly responseBody: unknown;
  readonly status: number | null;
  readonly error: string | null;
  readonly elapsedMs: number;
}

export function workflowCommitSucceededV1(
  actionSucceeded: boolean,
  turnId: string | null,
  exchanges: readonly WorkflowHttpExchangeV1[],
): boolean {
  return actionSucceeded && turnId !== null && exchanges.some((exchange) => {
    if (exchange.boundary !== 'backend' || !exchange.url.endsWith(`/turns/${turnId}/decision`)
        || exchange.status === null || exchange.status >= 300 || exchange.error) return false;
    const result = exchange.responseBody as { status?: string; turn_id?: string } | null;
    return result?.turn_id === turnId && ['committed', 'duplicate'].includes(result.status ?? '');
  });
}

export function observeWorkflowFetchV1(
  fetchImplementation: typeof fetch,
  exchanges: WorkflowHttpExchangeV1[],
  backendOrigin: string,
): typeof fetch {
  return async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    const boundary = url.origin === 'https://api.deepseek.com' ? 'deepseek'
      : url.origin === backendOrigin ? 'backend' : null;
    if (!boundary) return fetchImplementation(request, init);
    const startedAt = Date.now();
    const body = typeof init?.body === 'string' ? init.body
      : request instanceof Request ? await request.clone().text() : null;
    let requestBody: unknown = body;
    try { if (body) requestBody = JSON.parse(body); } catch { /* Keep non-JSON evidence. */ }
    try {
      const response = await fetchImplementation(request, init);
      const text = await response.clone().text();
      let responseBody: unknown = text;
      try { responseBody = JSON.parse(text); } catch { /* Malformed provider output is evidence too. */ }
      exchanges.push({ boundary, url: `${url.origin}${url.pathname}`, requestBody, responseBody,
        status: response.status, error: null, elapsedMs: Date.now() - startedAt });
      return response;
    } catch (error) {
      exchanges.push({ boundary, url: `${url.origin}${url.pathname}`, requestBody, responseBody: null,
        status: null, error: error instanceof Error ? error.message : 'UNKNOWN', elapsedMs: Date.now() - startedAt });
      throw error;
    }
  };
}
