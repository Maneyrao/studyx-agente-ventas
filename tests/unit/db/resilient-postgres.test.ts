import { describe, expect, it, vi } from 'vitest';
import type postgres from 'postgres';
import { createResilientPostgresRuntime } from '@/lib/db/resilient-postgres';

type Rows = Array<Record<string, unknown>>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

function cancellable<T>(promise: Promise<T>, cancel: () => void = () => {}): Promise<T> & { cancel(): void } {
  return Object.assign(promise, { cancel });
}

function makeClient(input: { stallProbe?: boolean; business?: () => Promise<Rows> } = {}) {
  const state = { probes: 0, business: 0, begins: 0, ended: 0 };
  const query = ((strings: TemplateStringsArray) => {
    const text = strings.join(' ');
    if (text.includes('studyx_liveness')) {
      state.probes += 1;
      if (input.stallProbe) {
        const pending = deferred<Rows>();
        return cancellable(pending.promise, () => pending.reject(Object.assign(new Error('cancelled'), { code: '57014' })));
      }
      return cancellable(Promise.resolve([{ studyx_liveness: 1 }]));
    }
    state.business += 1;
    return cancellable(input.business?.() ?? Promise.resolve([{ ok: true }]));
  }) as unknown as postgres.Sql;
  Object.assign(query, {
    begin: vi.fn(async (_options: unknown, operation?: (tx: postgres.Sql) => Promise<unknown>) => {
      state.begins += 1;
      const callback = typeof _options === 'function' ? _options : operation;
      return callback ? callback(query) : [];
    }),
    end: vi.fn(async () => { state.ended += 1; }),
  });
  return { client: query, state };
}

describe('lease-safe resilient postgres runtime', () => {
  it('recycles a stale idle generation before running business SQL', async () => {
    const stale = makeClient({ stallProbe: true });
    const replacement = makeClient();
    const runtime = createResilientPostgresRuntime({
      createClient: vi.fn().mockReturnValueOnce(stale.client).mockReturnValueOnce(replacement.client),
      preflightTimeoutMs: 10,
    });

    await expect(runtime.sql`SELECT business`).resolves.toEqual([{ ok: true }]);
    expect(stale.state.ended).toBe(1);
    expect(stale.state.business).toBe(0);
    expect(replacement.state.business).toBe(1);
  });

  it('rotates away from a long-busy generation without closing its in-flight write', async () => {
    let now = 0;
    const firstBusiness = deferred<Rows>();
    const first = makeClient({ business: () => firstBusiness.promise });
    const second = makeClient();
    const runtime = createResilientPostgresRuntime({
      createClient: vi.fn().mockReturnValueOnce(first.client).mockReturnValueOnce(second.client),
      healthyForMs: 5_000,
      now: () => now,
    });

    const inFlight = runtime.sql`SELECT first_write`;
    await vi.waitFor(() => expect(first.state.business).toBe(1));
    now = 5_001;

    await expect(runtime.sql`SELECT second_request`).resolves.toEqual([{ ok: true }]);
    expect(first.state.ended).toBe(0);
    expect(second.state.business).toBe(1);

    firstBusiness.resolve([{ committed: true }]);
    await expect(inFlight).resolves.toEqual([{ committed: true }]);
    await vi.waitFor(() => expect(first.state.ended).toBe(1));
  });

  it('shares one probe across concurrent first requests', async () => {
    const client = makeClient();
    const runtime = createResilientPostgresRuntime({ createClient: () => client.client });

    await Promise.all(Array.from({ length: 25 }, () => runtime.sql`SELECT business`));

    expect(client.state.probes).toBe(1);
    expect(client.state.business).toBe(25);
  });

  it('guards transactions through the same leased generation', async () => {
    const client = makeClient();
    const runtime = createResilientPostgresRuntime({ createClient: () => client.client });

    await expect(runtime.sql.begin(async () => 'committed')).resolves.toBe('committed');
    expect(client.state.probes).toBe(1);
    expect(client.state.begins).toBe(1);
  });
});
