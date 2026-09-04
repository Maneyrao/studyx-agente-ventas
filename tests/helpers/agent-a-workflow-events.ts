export interface WorkflowEventV1 {
  readonly event: string;
  readonly trace_id: string;
  readonly [field: string]: unknown;
}

export function observeWorkflowConsoleInfoV1(
  original: Console['info'],
  traceId: string,
  events: WorkflowEventV1[],
): Console['info'] {
  return (...args: unknown[]) => {
    if (typeof args[0] === 'string') {
      try {
        const value: unknown = JSON.parse(args[0]);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const event = value as Record<string, unknown>;
          if (event.trace_id === traceId && typeof event.event === 'string'
              && event.event.startsWith('studyx.turn.')) events.push(event as WorkflowEventV1);
        }
      } catch { /* Other console output remains untouched. */ }
    }
    original.apply(console, args);
  };
}
