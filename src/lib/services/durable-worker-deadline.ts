export class WorkerDeadlineExceeded extends Error {
  constructor(readonly operation: string) {
    super(`WORKER_DEADLINE_EXCEEDED:${operation}`);
    this.name = 'WorkerDeadlineExceeded';
  }
}

export class WorkerDeadline {
  private readonly deadlineAt: number;

  constructor(durationMs: number) {
    this.deadlineAt = Date.now() + Math.min(Math.max(durationMs, 1), 45_000);
  }

  remainingMs(): number {
    return Math.max(0, this.deadlineAt - Date.now());
  }

  get reached(): boolean {
    return this.remainingMs() === 0;
  }

  assertRemaining(operation: string): void {
    if (this.reached) throw new WorkerDeadlineExceeded(operation);
  }

  async run<T>(
    operation: string,
    start: (signal: AbortSignal) => PromiseLike<T>,
  ): Promise<T> {
    this.assertRemaining(operation);
    const remaining = this.remainingMs();
    const controller = new AbortController();
    let pending: PromiseLike<T>;
    try {
      pending = start(controller.signal);
    } catch (error) {
      throw error;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        const cancellable = pending as PromiseLike<T> & { cancel?: () => void };
        cancellable.cancel?.();
        reject(new WorkerDeadlineExceeded(operation));
      }, remaining);
    });

    try {
      return await Promise.race([Promise.resolve(pending), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async runCancellable<T>(
    operation: string,
    start: () => PromiseLike<T> & { cancel(): void },
  ): Promise<T> {
    this.assertRemaining(operation);
    const remaining = this.remainingMs();
    const pending = start();

    return new Promise<T>((resolve, reject) => {
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        // postgres.js cancellation covers both queued pool acquisition and an
        // in-flight statement. We wait for the query to settle below before
        // reporting the deadline, so no database work can outlive the worker.
        pending.cancel();
      }, remaining);

      void Promise.resolve(pending).then(
        (value) => {
          clearTimeout(timer);
          if (expired) reject(new WorkerDeadlineExceeded(operation));
          else resolve(value);
        },
        (error: unknown) => {
          clearTimeout(timer);
          if (expired) reject(new WorkerDeadlineExceeded(operation));
          else reject(error);
        },
      );
    });
  }
}

export function runDeadlineQuery<T>(
  deadline: WorkerDeadline,
  operation: string,
  start: () => PromiseLike<T> & { cancel(): void },
): Promise<T> {
  return deadline.runCancellable(operation, start);
}
