import { describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';
import {
  createResilientPostgresRuntime,
  type OrchestratorSessionPolicy,
} from '@/lib/db/resilient-postgres';

type QueryResult = Array<Record<string, unknown>>;

interface FakeClientState {
  client: postgres.Sql;
  livenessQueries: number;
  businessQueries: number;
  beginCalls: number;
  ended: number;
}

const VALID_POLICY: OrchestratorSessionPolicy = {
  current_user: 'orchestrator_role',
  statement_timeout: '8s',
  lock_timeout: '1500ms',
  idle_in_transaction_session_timeout: '10s',
};

function cancellable<T>(promise: Promise<T>, cancel: () => void = () => {}): Promise<T> & { cancel(): void } {
  return Object.assign(promise, { cancel });
}

function makeClient(input: {
  policy?: OrchestratorSessionPolicy;
  stallLiveness?: boolean;
  businessResult?: QueryResult;
} = {}): FakeClientState {
  const pendingRejectors = new Set<(error: Error) => void>();
  const state = {
    livenessQueries: 0,
    businessQueries: 0,
    beginCalls: 0,
    ended: 0,
  };

  const query = ((strings: TemplateStringsArray) => {
    const text = strings.join(' ').replace(/\s+/gu, ' ').trim();
    if (text.includes('current_user')) {
      state.livenessQueries += 1;
      if (input.stallLiveness) {
        let reject!: (error: Error) => void;
        const stalled = new Promise<QueryResult>((_resolve, fail) => {
          reject = fail;
          pendingRejectors.add(fail);
        });
        return cancellable(stalled, () => {
          pendingRejectors.delete(reject);
          reject(Object.assign(new Error('QUERY_CANCELLED'), { code: '57014' }));
        });
      }
      return cancellable(Promise.resolve([input.policy ?? VALID_POLICY]));
    }

    state.businessQueries += 1;
    return cancellable(Promise.resolve(input.businessResult ?? [{ ok: true }]));
  }) as unknown as postgres.Sql;

  Object.assign(query, {
    begin: vi.fn(async (_options: unknown, operation?: (db: postgres.Sql) => Promise<unknown>) => {
      state.beginCalls += 1;
      const callback = typeof _options === 'function' ? _options : operation;
      return callback ? callback(query) : [];
    }),
    end: vi.fn(async () => {
      state.ended += 1;
      for (const reject of pendingRejectors) {
        reject(Object.assign(new Error('CONNECTION_DESTROYED'), { code: 'CONNECTION_DESTROYED' }));
      }
      pendingRejectors.clear();
    }),
  });

  return Object.assign(state, { client: query });
}

describe('resilient postgres runtime', () => {
  it('recycles one stale generation and runs the business query once on the replacement', async () => {
    const stale = makeClient({ stallLiveness: true });
    const replacement = makeClient();
    const factory = vi.fn()
      .mockReturnValueOnce(stale.client)
      .mockReturnValueOnce(replacement.client);
    const runtime = createResilientPostgresRuntime({
      createClient: factory,
      expectedRole: 'orchestrator_role',
      preflightTimeoutMs: 20,
    });

    const result = await runtime.sql`SELECT business`;

    expect(result).toEqual([{ ok: true }]);
    expect(stale.ended).toBe(1);
    expect(stale.businessQueries).toBe(0);
    expect(replacement.businessQueries).toBe(1);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('shares one liveness check across concurrent first queries', async () => {
    const healthy = makeClient();
    const factory = vi.fn(() => healthy.client);
    const runtime = createResilientPostgresRuntime({
      createClient: factory,
      expectedRole: 'orchestrator_role',
    });

    await Promise.all(Array.from({ length: 100 }, () => runtime.sql`SELECT business`));

    expect(healthy.livenessQueries).toBe(1);
    expect(healthy.businessQueries).toBe(100);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('fails closed on an administrative role without running business SQL', async () => {
    const admin = makeClient({ policy: { ...VALID_POLICY, current_user: 'postgres' } });
    const runtime = createResilientPostgresRuntime({
      createClient: () => admin.client,
      expectedRole: 'orchestrator_role',
    });

    await expect(runtime.sql`SELECT business`).rejects.toMatchObject({
      code: 'ORCHESTRATOR_DATABASE_POLICY_MISMATCH',
    });
    expect(admin.businessQueries).toBe(0);
    expect(admin.ended).toBe(0);
  });

  it('fails closed when role timeouts are looser than the production policy', async () => {
    const loose = makeClient({
      policy: { ...VALID_POLICY, statement_timeout: '2min', lock_timeout: '0' },
    });
    const runtime = createResilientPostgresRuntime({
      createClient: () => loose.client,
      expectedRole: 'orchestrator_role',
    });

    await expect(runtime.sql`SELECT business`).rejects.toMatchObject({
      code: 'ORCHESTRATOR_DATABASE_POLICY_MISMATCH',
    });
    expect(loose.businessQueries).toBe(0);
  });

  it('fails within the bounded recovery budget when both generations stall', async () => {
    const first = makeClient({ stallLiveness: true });
    const second = makeClient({ stallLiveness: true });
    const factory = vi.fn()
      .mockReturnValueOnce(first.client)
      .mockReturnValueOnce(second.client);
    const runtime = createResilientPostgresRuntime({
      createClient: factory,
      expectedRole: 'orchestrator_role',
      preflightTimeoutMs: 20,
    });
    const startedAt = Date.now();

    await expect(runtime.sql`SELECT business`).rejects.toMatchObject({
      code: 'ORCHESTRATOR_DATABASE_UNAVAILABLE',
    });
    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(first.ended).toBe(1);
    expect(second.ended).toBe(1);
    expect(first.businessQueries + second.businessQueries).toBe(0);
  });

  it('cancels before the guarded business query starts without a delayed execution', async () => {
    const healthy = makeClient();
    const runtime = createResilientPostgresRuntime({
      createClient: () => healthy.client,
      expectedRole: 'orchestrator_role',
    });

    const pending = runtime.sql`SELECT business`;
    pending.cancel();

    await expect(pending).rejects.toMatchObject({ code: '57014' });
    expect(healthy.businessQueries).toBe(0);
  });

  it('guards begin and keeps the stable sql reference across a recycle', async () => {
    const stale = makeClient({ stallLiveness: true });
    const replacement = makeClient();
    const runtime = createResilientPostgresRuntime({
      createClient: vi.fn()
        .mockReturnValueOnce(stale.client)
        .mockReturnValueOnce(replacement.client),
      expectedRole: 'orchestrator_role',
      preflightTimeoutMs: 20,
    });
    const stableReference = runtime.sql;

    const value = await runtime.sql.begin(async () => 'committed');

    expect(value).toBe('committed');
    expect(runtime.sql).toBe(stableReference);
    expect(stale.beginCalls).toBe(0);
    expect(replacement.beginCalls).toBe(1);
  });

  it('exposes begin capability checks used to select the transactional projection path', () => {
    const healthy = makeClient();
    const runtime = createResilientPostgresRuntime({ createClient: () => healthy.client });

    expect('begin' in runtime.sql).toBe(true);
    expect(typeof runtime.sql.begin).toBe('function');
  });

  it('ends the active generation exactly once through the stable proxy', async () => {
    const healthy = makeClient();
    const runtime = createResilientPostgresRuntime({ createClient: () => healthy.client });

    await runtime.sql.end();
    await runtime.sql.end();

    expect(healthy.ended).toBe(1);
    expect(runtime.inspect()).toMatchObject({ stopped: true, generation: 1 });
  });
});
