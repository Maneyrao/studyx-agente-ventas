/**
 * Structured, text-free facts about a provider failure (Botpress API / integration).
 * Only allow-listed shapes are copied; the error message itself never is, so
 * customer text or credentials cannot leak into evidence or logs.
 */
export interface ProviderErrorSummary {
  readonly api_type?: string;
  readonly api_code?: number;
  readonly upstream_type?: string;
  readonly upstream_status?: number;
  readonly error_id?: string;
}

const ERROR_ID = /^err_[A-Za-z0-9]{1,64}$/;
const WORD = /^[A-Za-z]{1,40}$/;

export function summarizeProviderError(error: unknown): ProviderErrorSummary | null {
  if (!(error instanceof Error)) return null;
  const raw = error as Error & { isApiError?: unknown; type?: unknown; code?: unknown; id?: unknown };
  const summary: { -readonly [K in keyof ProviderErrorSummary]: ProviderErrorSummary[K] } = {};
  if (raw.isApiError === true) {
    if (typeof raw.type === 'string' && WORD.test(raw.type)) summary.api_type = raw.type;
    if (typeof raw.code === 'number' && Number.isInteger(raw.code) && raw.code >= 100 && raw.code <= 599) {
      summary.api_code = raw.code;
    }
  }
  const upstream = /\[([A-Za-z]{1,40})\] Request failed with status code (\d{3})\b/.exec(raw.message);
  if (upstream) {
    summary.upstream_type = upstream[1];
    summary.upstream_status = Number(upstream[2]);
  }
  const messageId = /\(Error ID: (err_[A-Za-z0-9]{1,64})\)/.exec(raw.message)?.[1];
  const errorId = typeof raw.id === 'string' && ERROR_ID.test(raw.id) ? raw.id : messageId;
  if (errorId) summary.error_id = errorId;
  return Object.keys(summary).length > 0 ? summary : null;
}
