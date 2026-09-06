import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const script = resolve(process.cwd(), 'scripts/push-agent-loop-migrations.mjs');
const localDatabaseUrl =
  'postgresql://postgres@127.0.0.1:55433/studyx_push_test?sslmode=disable';

function fakeNpx(version: string, migrations = ['20260906170927_outbound_message_parts.sql']) {
  const directory = mkdtempSync(join(tmpdir(), 'studyx-supabase-cli-'));
  temporaryDirectories.push(directory);
  const calls = join(directory, 'calls.log');
  const executable = join(directory, 'npx');
  writeFileSync(executable, `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_NPX_CALLS"
if [ "$3" = "--version" ]; then
  printf '%s\\n' "$FAKE_SUPABASE_VERSION"
else
  printf '%s\\n' "$FAKE_SUPABASE_RESULT"
fi
`, 'utf8');
  chmodSync(executable, 0o755);
  return {
    calls,
    env: {
      ...process.env,
      PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
      FAKE_NPX_CALLS: calls,
      FAKE_SUPABASE_VERSION: version,
      FAKE_SUPABASE_RESULT: JSON.stringify({ migrations }),
      AGENT_LOOP_MIGRATION_DATABASE_URL: localDatabaseUrl,
    },
  };
}

function invoke(env: NodeJS.ProcessEnv, mode = '--dry-run'): string {
  return execFileSync(process.execPath, [script, mode], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('Agent Loop migration push', () => {
  it('pins and verifies Supabase 2.116.0 before the exact dry-run command', () => {
    const fake = fakeNpx('2.116.0');

    invoke(fake.env);

    expect(readFileSync(fake.calls, 'utf8').trim().split('\n')).toEqual([
      '-y supabase@2.116.0 --version',
      `-y supabase@2.116.0 db push --db-url ${localDatabaseUrl} --dry-run`,
    ]);
  });

  it('fails before db push when npx resolves the incompatible 2.84.2 CLI', () => {
    const fake = fakeNpx('2.84.2');

    expect(() => invoke(fake.env)).toThrow(/SUPABASE_CLI_VERSION_MISMATCH/u);
    expect(readFileSync(fake.calls, 'utf8').trim()).toBe(
      '-y supabase@2.116.0 --version',
    );
  });

  it('uses the pinned package for apply and never a floating Supabase selector', () => {
    const fake = fakeNpx('2.116.0');

    invoke(fake.env, '--apply');

    const calls = readFileSync(fake.calls, 'utf8');
    expect(calls).toContain(
      `-y supabase@2.116.0 db push --db-url ${localDatabaseUrl} --dry-run\n`
        + `-y supabase@2.116.0 db push --db-url ${localDatabaseUrl} --yes`,
    );
    expect(calls).not.toMatch(/supabase@(?:latest|next)|\bnpx\s+supabase\b/u);
  });

  it('refuses apply when the immediate dry-run contains a migration outside the Agent Loop allowlist', () => {
    const fake = fakeNpx('2.116.0', ['20260906000001_unreviewed.sql']);

    expect(() => invoke(fake.env, '--apply')).toThrow(/UNEXPECTED_PENDING_MIGRATIONS/u);
    expect(readFileSync(fake.calls, 'utf8').trim().split('\n')).toEqual([
      '-y supabase@2.116.0 --version',
      `-y supabase@2.116.0 db push --db-url ${localDatabaseUrl} --dry-run`,
    ]);
  });

  it('accepts the real 2.116.0 up-to-date dry-run output as an empty allowlist', () => {
    const fake = fakeNpx('2.116.0');
    fake.env.FAKE_SUPABASE_RESULT = 'Remote database is up to date.';

    invoke(fake.env);

    expect(readFileSync(fake.calls, 'utf8').trim().split('\n')).toHaveLength(2);
  });

  it('rejects an explicit remote TLS downgrade before invoking npx', () => {
    const fake = fakeNpx('2.116.0');
    fake.env.AGENT_LOOP_MIGRATION_DATABASE_URL =
      'postgresql://postgres:secret@db.example.com:5432/postgres?sslmode=disable';

    expect(() => invoke(fake.env)).toThrow(/REMOTE_TLS_DOWNGRADE_REJECTED/u);
    expect(() => readFileSync(fake.calls, 'utf8')).toThrow();
  });
});
