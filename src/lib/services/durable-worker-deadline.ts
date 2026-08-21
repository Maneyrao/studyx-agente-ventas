export class WorkerDeadlineExceeded extends Error {
  constructor(
    readonly operation: string,
    readonly queryError?: unknown,
    readonly cancelError?: unknown,
  ) {
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
      let finished = false;
      let mainSettled = false;
      let mainSucceeded = false;
      let mainValue: T | undefined;
      let mainError: unknown;
      let cancelSettled = false;
      let cancelError: unknown;

      const finish = () => {
        if (finished || !mainSettled) return;
        if (expired && !cancelSettled) return;
        finished = true;
        clearTimeout(timer);

        // If PostgreSQL completed successfully, report that committed truth
        // even when a racing CancelRequest failed. Otherwise expose both the
        // main query and cancellation failures on the deadline error.
        if (mainSucceeded) resolve(mainValue as T);
        else if (expired) {
          reject(new WorkerDeadlineExceeded(operation, mainError, cancelError));
        } else reject(mainError);
      };

      const timer = setTimeout(() => {
        expired = true;
        // postgres.js cancellation covers both queued pool acquisition and an
        // in-flight statement. At runtime cancel() returns an auxiliary
        // CancelRequest Promise despite its declared void type. Observe it and
        // wait for both it and ReadyForQuery before reporting the deadline.
        try {
          const cancelRequest = (pending.cancel as unknown as () => unknown)();
          void Promise.resolve(cancelRequest).then(
            () => {
              cancelSettled = true;
              finish();
            },
            (error: unknown) => {
              cancelError = error;
              cancelSettled = true;
              finish();
            },
          );
        } catch (error) {
          cancelError = error;
          cancelSettled = true;
          finish();
        }
      }, remaining);

      void Promise.resolve(pending).then(
        (value) => {
          mainValue = value;
          mainSucceeded = true;
          mainSettled = true;
          finish();
        },
        (error: unknown) => {
          mainError = error;
          mainSettled = true;
          finish();
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
