import type postgres from 'postgres';

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
}

type TransactionDb = {
  begin<T>(callback: (tx: postgres.TransactionSql) => Promise<T>): Promise<T>;
};

export function runDeadlineTransaction<T>(
  db: TransactionDb,
  deadline: WorkerDeadline,
  operation: string,
  callback: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return deadline.run(operation, () => db.begin(async (tx) => {
    // This check runs only after a pooled connection is acquired. If the pool
    // wait consumed the wall budget, no SQL (especially no claim) is emitted.
    deadline.assertRemaining(`${operation}:pool`);
    const timeout = `${Math.max(1, deadline.remainingMs())}ms`;
    await tx`SELECT set_config('statement_timeout', ${timeout}, true)`;
    deadline.assertRemaining(`${operation}:statement-timeout`);
    return callback(tx);
  }));
}
