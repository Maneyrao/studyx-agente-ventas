import type postgres from 'postgres';

export interface OrchestratorSessionPolicy {
  current_user: string;
  statement_timeout: string;
  lock_timeout: string;
  idle_in_transaction_session_timeout: string;
}

export interface ResilientPostgresRuntimeOptions {
  createClient: () => postgres.Sql;
  expectedRole?: string | null;
  preflightTimeoutMs?: number;
  healthyForMs?: number;
  now?: () => number;
}

export class OrchestratorDatabaseUnavailableError extends Error {
  readonly code = 'ORCHESTRATOR_DATABASE_UNAVAILABLE';

  constructor(readonly cause?: unknown) {
    super('ORCHESTRATOR_DATABASE_UNAVAILABLE');
    this.name = 'OrchestratorDatabaseUnavailableError';
  }
}

export class OrchestratorDatabasePolicyMismatchError extends Error {
  readonly code = 'ORCHESTRATOR_DATABASE_POLICY_MISMATCH';

  constructor(readonly setting: string) {
    super(`ORCHESTRATOR_DATABASE_POLICY_MISMATCH:${setting}`);
    this.name = 'OrchestratorDatabasePolicyMismatchError';
  }
}

const DEFAULT_PREFLIGHT_TIMEOUT_MS = 1_500;
const DEFAULT_HEALTHY_FOR_MS = 15_000;

const MAX_POLICY_MS = {
  statement_timeout: 8_000,
  lock_timeout: 1_500,
  idle_in_transaction_session_timeout: 10_000,
} as const;

type CancellablePromise<T> = Promise<T> & { cancel(): void };

function cancelledQueryError(): Error & { code: string } {
  return Object.assign(new Error('canceling statement due to user request'), { code: '57014' });
}

function durationMs(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === '0') return 0;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|min|h)$/u.exec(normalized);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1_000 : unit === 'min' ? 60_000 : 3_600_000;
  return amount * multiplier;
}

function assertSessionPolicy(
  policy: OrchestratorSessionPolicy,
  expectedRole: string | null,
): void {
  if (!expectedRole) return;
  if (policy.current_user !== expectedRole) {
    throw new OrchestratorDatabasePolicyMismatchError('current_user');
  }

  for (const [setting, maximum] of Object.entries(MAX_POLICY_MS)) {
    const value = durationMs(policy[setting as keyof typeof MAX_POLICY_MS]);
    if (value === null || value === 0 || value > maximum) {
      throw new OrchestratorDatabasePolicyMismatchError(setting);
    }
  }
}

function isTaggedTemplateCall(args: unknown[]): args is [TemplateStringsArray, ...unknown[]] {
  const strings = args[0];
  return Array.isArray(strings) && Array.isArray((strings as unknown as { raw?: unknown }).raw);
}

function observePossiblePromise(value: unknown): void {
  if (value && typeof (value as PromiseLike<unknown>).then === 'function') {
    void Promise.resolve(value).catch(() => undefined);
  }
}

export function createResilientPostgresRuntime(options: ResilientPostgresRuntimeOptions) {
  const now = options.now ?? Date.now;
  const expectedRole = options.expectedRole?.trim() || null;
  const preflightTimeoutMs = Math.min(Math.max(options.preflightTimeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS, 1), 3_000);
  const healthyForMs = Math.max(options.healthyForMs ?? DEFAULT_HEALTHY_FOR_MS, 0);
  let active = options.createClient();
  let generation = 1;
  let lastVerifiedAt: number | null = null;
  let verification: Promise<void> | null = null;
  let stopped = false;

  async function endClient(client: postgres.Sql): Promise<void> {
    try {
      await client.end({ timeout: 0 });
    } catch {
      // The generation is already detached. A close failure must not put a
      // stale socket back in service or hide the original availability error.
    }
  }

  async function readPolicy(client: postgres.Sql): Promise<OrchestratorSessionPolicy> {
    const pending = client<OrchestratorSessionPolicy[]>`
      SELECT
        current_user,
        current_setting('statement_timeout') AS statement_timeout,
        current_setting('lock_timeout') AS lock_timeout,
        current_setting('idle_in_transaction_session_timeout') AS idle_in_transaction_session_timeout
    `;

    return new Promise<OrchestratorSessionPolicy>((resolve, reject) => {
      let settled = false;
      const settle = (operation: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        operation();
      };
      const timer = setTimeout(() => {
        settle(() => {
          try {
            observePossiblePromise((pending.cancel as unknown as () => unknown)());
          } catch {
            // end({ timeout: 0 }) in the recycle path is the final fence.
          }
          reject(new OrchestratorDatabaseUnavailableError());
        });
      }, preflightTimeoutMs);

      void Promise.resolve(pending).then(
        (rows) => settle(() => {
          const policy = rows[0];
          if (!policy) reject(new OrchestratorDatabaseUnavailableError());
          else resolve(policy);
        }),
        (error: unknown) => settle(() => reject(error)),
      );
    });
  }

  async function verify(client: postgres.Sql): Promise<void> {
    const policy = await readPolicy(client);
    assertSessionPolicy(policy, expectedRole);
  }

  async function recycle(stale: postgres.Sql): Promise<postgres.Sql> {
    if (active === stale) {
      active = options.createClient();
      generation += 1;
      console.warn(JSON.stringify({ event: 'db.client.recycled', generation }));
    }
    await endClient(stale);
    return active;
  }

  async function verifyWithOneRecycle(): Promise<void> {
    const first = active;
    try {
      await verify(first);
    } catch (error) {
      if (error instanceof OrchestratorDatabasePolicyMismatchError) throw error;
      const replacement = await recycle(first);
      try {
        await verify(replacement);
      } catch (replacementError) {
        if (replacementError instanceof OrchestratorDatabasePolicyMismatchError) throw replacementError;
        await endClient(replacement);
        throw new OrchestratorDatabaseUnavailableError(replacementError);
      }
    }
    lastVerifiedAt = now();
  }

  async function ensureReady(): Promise<void> {
    if (stopped) throw new OrchestratorDatabaseUnavailableError(new Error('DATABASE_CLIENT_ENDED'));
    if (lastVerifiedAt !== null && now() - lastVerifiedAt < healthyForMs) return;
    if (verification) return verification;
    verification = verifyWithOneRecycle();
    try {
      await verification;
    } finally {
      verification = null;
    }
  }

  function guardedQuery<T>(args: [TemplateStringsArray, ...unknown[]]): CancellablePromise<T> {
    let cancelled = false;
    let actual: (PromiseLike<T> & { cancel?: () => void }) | null = null;
    const execution = (async () => {
      await ensureReady();
      if (cancelled) throw cancelledQueryError();
      actual = Reflect.apply(active as unknown as (...queryArgs: unknown[]) => PromiseLike<T>, active, args);
      if (cancelled) {
        actual.cancel?.();
        throw cancelledQueryError();
      }
      return await actual;
    })();
    return Object.assign(execution, {
      cancel: () => {
        cancelled = true;
        if (actual?.cancel) observePossiblePromise(actual.cancel());
      },
    });
  }

  const target = function sqlTarget(...args: unknown[]) {
    if (!isTaggedTemplateCall(args)) {
      return Reflect.apply(active as unknown as (...helperArgs: unknown[]) => unknown, active, args);
    }
    return guardedQuery(args);
  };

  const sql = new Proxy(target, {
    apply(_target, _thisArg, args: unknown[]) {
      return target(...args);
    },
    has(_target, property) {
      if (property === 'begin' || property === 'end') return true;
      return property in active;
    },
    get(_target, property) {
      if (property === 'begin') {
        return async (...args: unknown[]) => {
          await ensureReady();
          const begin = active.begin as unknown as (...beginArgs: unknown[]) => unknown;
          return Reflect.apply(begin, active, args);
        };
      }
      if (property === 'end') {
        return async (endOptions?: { timeout?: number }) => {
          if (stopped) return;
          stopped = true;
          verification = null;
          await active.end(endOptions);
        };
      }
      const value = Reflect.get(active, property, active);
      return typeof value === 'function' ? value.bind(active) : value;
    },
  }) as unknown as postgres.Sql;

  return {
    sql,
    ensureReady,
    inspect: () => ({ generation, lastVerifiedAt, stopped }),
  };
}
