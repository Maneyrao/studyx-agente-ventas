type LogLevel = 'info' | 'warn' | 'error';

interface LogFields {
  event: string;
  [key: string]: unknown;
}

/**
 * The correlation keys every orchestration log line should carry.
 *
 * One turn crosses Telegram, Botpress, three Next.js routes and PostgreSQL. If
 * a line only says "delivery failed", answering "for whom, on which batch, and
 * did anything reach the customer" means reading five services by timestamp.
 * With these keys a single `trace_id` filter reconstructs the whole path.
 *
 * Undefined keys are dropped, so a line never carries a field it cannot fill.
 */
export interface TraceContext {
  trace_id?: string;
  contact_id?: string;
  conversation_id?: string;
  batch_id?: string;
  turn_id?: string;
  decision_id?: string;
  outbound_id?: string;
}

function defined(context: TraceContext): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined && value !== null)
  );
}

function log(level: LogLevel, fields: LogFields): void {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    ...fields,
  };
  // JSON lines to stdout — collected by Vercel log drains
  console.log(JSON.stringify(entry));
}

export const logger = {
  info: (fields: LogFields) => log('info', fields),
  warn: (fields: LogFields) => log('warn', fields),
  error: (fields: LogFields) => log('error', fields),
};

/** A logger that stamps every line with the same correlation keys. */
export function withTrace(context: TraceContext) {
  const base = defined(context);
  return {
    info: (fields: LogFields) => log('info', { ...base, ...fields }),
    warn: (fields: LogFields) => log('warn', { ...base, ...fields }),
    error: (fields: LogFields) => log('error', { ...base, ...fields }),
  };
}

/**
 * Time one stage of the turn and emit its latency, whether or not it threw.
 *
 * Latency is recorded per stage rather than per request on purpose: "the turn
 * took 9 seconds" is not actionable, while "the batch window held it for 4s and
 * the model took 4.5s" says exactly where to look — and distinguishes a slow
 * model from a window doing its job.
 */
export async function timedStage<T>(
  stage: string,
  context: TraceContext,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    log('info', {
      event: 'stage.completed',
      stage,
      duration_ms: Date.now() - startedAt,
      outcome: 'ok',
      ...defined(context),
    });
    return result;
  } catch (error) {
    log('error', {
      event: 'stage.failed',
      stage,
      duration_ms: Date.now() - startedAt,
      outcome: 'error',
      error: String(error),
      ...defined(context),
    });
    throw error;
  }
}
