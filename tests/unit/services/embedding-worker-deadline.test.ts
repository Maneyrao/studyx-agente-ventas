import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/orchestrator', () => ({
  sql: Object.assign(() => Promise.resolve([]), {
    begin: async () => [],
    end: async () => {},
  }),
}));

import { runMessageEmbeddingWorker } from '@/lib/services/message-embedding-worker.service';
import {
  WorkerDeadline,
  WorkerDeadlineExceeded,
} from '@/lib/services/durable-worker-deadline';
import type { DbClient } from '@/lib/db/types';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

function queryText(strings: TemplateStringsArray): string {
  return strings.join(' ').replace(/\s+/g, ' ').trim();
}

function resolvedQuery<T>(value: T): Promise<T> & { cancel(): void } {
  return Object.assign(Promise.resolve(value), { cancel: () => {} });
}

describe('embedding worker hard deadline', () => {
  it('observes a rejecting runtime CancelRequest promise without masking a successful query', async () => {
    let resolveMain!: (value: string) => void;
    const main = new Promise<string>((resolve) => { resolveMain = resolve; });
    const pending = Object.assign(main, {
      cancel: (() => {
        resolveMain('committed');
        return Promise.reject(new Error('CANCEL_REQUEST_FAILED'));
      }) as unknown as () => void,
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);

    try {
      const outcome = await new WorkerDeadline(40)
        .runCancellable('runtime-cancel-rejection', () => pending)
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(outcome).toEqual({ value: 'committed' });
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('waits for both ReadyForQuery and a delayed CancelRequest before reporting deadline', async () => {
    let rejectMain!: (error: Error) => void;
    let resolveCancel!: () => void;
    const main = new Promise<never>((_resolve, reject) => { rejectMain = reject; });
    const cancelRequest = new Promise<void>((resolve) => { resolveCancel = resolve; });
    const pending = Object.assign(main, {
      cancel: (() => {
        rejectMain(new Error('QUERY_CANCELLED'));
        return cancelRequest;
      }) as unknown as () => void,
    });
    let settled = false;
    const observed = new WorkerDeadline(40)
      .runCancellable('delayed-cancel-request', () => pending)
      .then(
        (value) => {
          settled = true;
          return { value };
        },
        (error: unknown) => {
          settled = true;
          return { error };
        },
      );

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(settled).toBe(false);
    resolveCancel();
    const outcome = await observed;
    expect('error' in outcome ? outcome.error : null).toBeInstanceOf(WorkerDeadlineExceeded);
  });

  it('bounds a delayed pool/SQL claim and does not continue after the deadline', async () => {
    let dbCalls = 0;
    const delayed = () => {
      dbCalls += 1;
      let reject!: (error: Error) => void;
      const pending = new Promise<never>((_resolve, fail) => { reject = fail; });
      return Object.assign(pending, { cancel: () => reject(new Error('QUERY_CANCELLED')) });
    };
    const db = Object.assign(delayed, {
      begin: async () => { throw new Error('native begin must not be used'); },
      end: async () => {},
    }) as unknown as DbClient;

    const startedAt = Date.now();
    const result = await runMessageEmbeddingWorker(
      { worker_id: 'delayed-db', limit: 1, deadline_ms: 60 },
      { sql: db as never, embed: async () => [] },
    );

    expect(dbCalls).toBe(1);
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(result).toMatchObject({ claimed: 0, completed: 0, deadline_reached: true });
  });

  it('cannot commit a stalled multi-statement completion after reporting the deadline', async () => {
    const stalled = deferred();
    let completionStarted!: () => void;
    const completionReached = new Promise<void>((resolve) => { completionStarted = resolve; });
    let materialized = false;
    let finalized = false;
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);

    const query = ((strings: TemplateStringsArray) => {
      const text = queryText(strings);
      if (text.includes('claim_embedding_jobs')) {
        return resolvedQuery([{
          id: 'a0000000-0000-4000-8000-000000000001',
          message_id: 'b0000000-0000-4000-8000-000000000001',
          contact_id: 'c0000000-0000-4000-8000-000000000001',
          attempt_count: 1,
          max_attempts: 5,
        }]);
      }
      if (text.includes('SELECT content FROM messages')) {
        return resolvedQuery([{ content: 'deadline' }]);
      }
      if (text.includes('complete_message_embedding_job')) {
        completionStarted();
        let cancelled = false;
        let resolve!: (value: Array<{ completed: boolean }>) => void;
        let reject!: (error: Error) => void;
        const pending = new Promise<Array<{ completed: boolean }>>((done, fail) => {
          resolve = done;
          reject = fail;
        });
        void stalled.promise.then(() => {
          if (cancelled) return;
          materialized = true;
          finalized = true;
          resolve([{ completed: true }]);
        });
        return Object.assign(pending, {
          cancel: () => {
            cancelled = true;
            reject(new Error('QUERY_CANCELLED'));
          },
        });
      }
      throw new Error(`Unexpected SQL: ${text}`);
    }) as never;
    const db = Object.assign(query, {
      begin: async () => { throw new Error('native begin must not be used'); },
      end: async () => {},
    }) as unknown as DbClient;

    try {
      const worker = runMessageEmbeddingWorker(
        { worker_id: 'stalled-completion', limit: 1, deadline_ms: 300 },
        { sql: db as never, embed: async () => Array.from({ length: 768 }, () => 0) },
      );
      const reachedCompletion = await Promise.race([
        completionReached.then(() => true),
        worker.then(() => false),
      ]);
      expect(reachedCompletion).toBe(true);
      const result = await worker;
      expect(result).toMatchObject({ completed: 0, deadline_reached: true });

      stalled.resolve();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(materialized).toBe(false);
      expect(finalized).toBe(false);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      stalled.resolve();
    }
  });

  it('cancels a queued pool acquisition so releasing it cannot execute SQL or commit', async () => {
    const acquired = deferred();
    let sqlExecutions = 0;
    let commits = 0;
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => unhandled.push(error);
    process.on('unhandledRejection', onUnhandled);
    const query = (() => {
      let cancelled = false;
      let resolve!: (value: never[]) => void;
      let reject!: (error: Error) => void;
      const pending = new Promise<never[]>((done, fail) => {
        resolve = done;
        reject = fail;
      });
      void acquired.promise.then(() => {
        if (cancelled) return;
        sqlExecutions += 1;
        commits += 1;
        resolve([]);
      });
      return Object.assign(pending, {
        cancel: () => {
          cancelled = true;
          reject(new Error('QUERY_CANCELLED'));
        },
      });
    }) as never;
    const db = Object.assign(query, {
      begin: async () => { throw new Error('native begin must not be used'); },
      end: async () => {},
    }) as unknown as DbClient;

    try {
      const result = await runMessageEmbeddingWorker(
        { worker_id: 'queued-pool', limit: 1, deadline_ms: 60 },
        { sql: db as never, embed: async () => [] },
      );
      expect(result).toMatchObject({ claimed: 0, completed: 0, deadline_reached: true });

      acquired.resolve();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(sqlExecutions).toBe(0);
      expect(commits).toBe(0);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      acquired.resolve();
    }
  });
});
