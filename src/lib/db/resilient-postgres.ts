import type postgres from 'postgres';

type CancellablePromise<T> = Promise<T> & { cancel(): void };

interface Generation {
  readonly id: number;
  readonly client: postgres.Sql;
  inFlight: number;
  lastHealthyAt: number | null;
  retiring: boolean;
  verification: Promise<void> | null;
  ending: Promise<void> | null;
}

export interface ResilientPostgresRuntimeOptions {
  readonly createClient: () => postgres.Sql;
  readonly preflightTimeoutMs?: number;
  readonly healthyForMs?: number;
  readonly now?: () => number;
}

export class OrchestratorDatabaseUnavailableError extends Error {
  readonly code = 'ORCHESTRATOR_DATABASE_UNAVAILABLE';
  constructor(readonly cause?: unknown) {
    super('ORCHESTRATOR_DATABASE_UNAVAILABLE');
    this.name = 'OrchestratorDatabaseUnavailableError';
  }
}

function cancelledQueryError(): Error & { code: string } {
  return Object.assign(new Error('canceling statement due to user request'), { code: '57014' });
}

function isTaggedTemplateCall(args: unknown[]): args is [TemplateStringsArray, ...unknown[]] {
  const strings = args[0];
  return Array.isArray(strings) && Array.isArray((strings as unknown as { raw?: unknown }).raw);
}

export function createResilientPostgresRuntime(options: ResilientPostgresRuntimeOptions) {
  const now = options.now ?? Date.now;
  const preflightTimeoutMs = Math.min(Math.max(options.preflightTimeoutMs ?? 1_500, 1), 3_000);
  const healthyForMs = Math.max(options.healthyForMs ?? 5_000, 0);
  let nextGeneration = 0;
  let stopped = false;

  const makeGeneration = (): Generation => ({
    id: ++nextGeneration,
    client: options.createClient(),
    inFlight: 0,
    lastHealthyAt: null,
    retiring: false,
    verification: null,
    ending: null,
  });
  let active = makeGeneration();

  const isFresh = (generation: Generation) => generation.lastHealthyAt !== null
    && now() - generation.lastHealthyAt < healthyForMs;

  async function retire(generation: Generation): Promise<void> {
    generation.retiring = true;
    if (generation.inFlight > 0 || generation.ending) return;
    generation.ending = generation.client.end({ timeout: 0 }).catch(() => undefined);
    await generation.ending;
  }

  function rotate(generation: Generation, reason: string): Generation {
    if (active !== generation) return active;
    generation.retiring = true;
    active = makeGeneration();
    console.warn(JSON.stringify({
      event: 'db.client.generation_rotated',
      retired_generation: generation.id,
      active_generation: active.id,
      reason,
      retired_in_flight: generation.inFlight,
    }));
    void retire(generation);
    return active;
  }

  async function verify(generation: Generation): Promise<void> {
    if (generation.verification) return generation.verification;
    generation.verification = (async () => {
      const pending = generation.client<Array<{ studyx_liveness: number }>>`
        SELECT 1 AS studyx_liveness
      ` as CancellablePromise<Array<{ studyx_liveness: number }>>;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const rows = await Promise.race([
          pending,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              try { pending.cancel(); } catch { /* generation retirement is the final fence */ }
              reject(new OrchestratorDatabaseUnavailableError());
            }, preflightTimeoutMs);
          }),
        ]);
        if (rows[0]?.studyx_liveness !== 1) throw new OrchestratorDatabaseUnavailableError();
        generation.lastHealthyAt = now();
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    try {
      await generation.verification;
    } finally {
      generation.verification = null;
    }
  }

  async function acquire(): Promise<Generation> {
    if (stopped) throw new OrchestratorDatabaseUnavailableError(new Error('DATABASE_CLIENT_ENDED'));
    let generation = active;

    // A generation that remains busy beyond the liveness window may contain a
    // stuck socket. Detach it, but never close it while a transaction or write
    // is in flight. New work gets a fresh client; the old lease retires only
    // after its owner settles. This is the safety property the old recycler
    // lacked.
    if (generation.inFlight > 0 && !isFresh(generation)) {
      generation = rotate(generation, 'busy_generation_expired');
    }

    if (!isFresh(generation)) {
      try {
        await verify(generation);
      } catch (firstError) {
        generation = rotate(generation, 'liveness_failed');
        try {
          await verify(generation);
        } catch (secondError) {
          await retire(generation);
          throw new OrchestratorDatabaseUnavailableError(secondError ?? firstError);
        }
      }
    }

    if (generation !== active || generation.retiring) return acquire();
    generation.inFlight += 1;
    return generation;
  }

  async function release(generation: Generation, healthy: boolean): Promise<void> {
    generation.inFlight = Math.max(0, generation.inFlight - 1);
    if (healthy) generation.lastHealthyAt = now();
    if (generation.retiring && generation.inFlight === 0) await retire(generation);
  }

  function guardedQuery<T>(args: [TemplateStringsArray, ...unknown[]]): CancellablePromise<T> {
    let cancelled = false;
    let actual: (PromiseLike<T> & { cancel?: () => void }) | null = null;
    const execution = (async () => {
      const generation = await acquire();
      let healthy = false;
      try {
        if (cancelled) throw cancelledQueryError();
        actual = Reflect.apply(
          generation.client as unknown as (...queryArgs: unknown[]) => PromiseLike<T>,
          generation.client,
          args,
        ) as PromiseLike<T> & { cancel?: () => void };
        if (cancelled) {
          actual.cancel?.();
          throw cancelledQueryError();
        }
        const result = await actual;
        healthy = true;
        return result;
      } finally {
        await release(generation, healthy);
      }
    })();
    return Object.assign(execution, {
      cancel: () => {
        cancelled = true;
        actual?.cancel?.();
      },
    });
  }

  const target = function sqlTarget(...args: unknown[]) {
    if (!isTaggedTemplateCall(args)) {
      return Reflect.apply(active.client as unknown as (...helperArgs: unknown[]) => unknown, active.client, args);
    }
    return guardedQuery(args);
  };

  const sql = new Proxy(target, {
    apply(_target, _thisArg, args: unknown[]) {
      return target(...args);
    },
    has(_target, property) {
      if (property === 'begin' || property === 'end') return true;
      return property in active.client;
    },
    get(_target, property) {
      if (property === 'begin') {
        return async (...args: unknown[]) => {
          const generation = await acquire();
          let healthy = false;
          try {
            const begin = generation.client.begin as unknown as (...beginArgs: unknown[]) => Promise<unknown>;
            const result = await Reflect.apply(begin, generation.client, args);
            healthy = true;
            return result;
          } finally {
            await release(generation, healthy);
          }
        };
      }
      if (property === 'end') {
        return async (endOptions?: { timeout?: number }) => {
          if (stopped) return;
          stopped = true;
          const current = active;
          current.retiring = true;
          if (current.inFlight === 0) await current.client.end(endOptions);
        };
      }
      const value = Reflect.get(active.client, property, active.client);
      return typeof value === 'function' ? value.bind(active.client) : value;
    },
  }) as unknown as postgres.Sql;

  return { sql, inspect: () => ({ generation: active.id, inFlight: active.inFlight, stopped }) };
}
