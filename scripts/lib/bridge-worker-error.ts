export function formatBridgeWorkerError(error: unknown): string {
  if (!(error instanceof Error) || !/^[A-Z][A-Z0-9_]{0,127}$/u.test(error.message)) {
    return 'WORKER_ERROR';
  }
  const detail = (error as Error & { readonly detail?: unknown }).detail;
  if (typeof detail === 'string') {
    const path = detail.split(':', 1)[0];
    if (path && /^(?:root|[a-z][a-z0-9_.]{0,159})$/u.test(path)) {
      return `${error.message}:${path}`;
    }
  }
  const reason = (error as Error & { readonly reason?: unknown }).reason;
  if (typeof reason === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/u.test(reason)) {
    return `${error.message}:${reason}`;
  }
  return error.message;
}
