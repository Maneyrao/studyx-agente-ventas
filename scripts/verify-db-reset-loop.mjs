import { spawnSync } from 'node:child_process';

const EXPECTED_HOST = '127.0.0.1';
const EXPECTED_PORT = '54322';
const ATTEMPTS = 3;

function assertDisposableLocalDatabase(rawUrl) {
  if (!rawUrl) {
    throw new Error(
      'TEST_DATABASE_URL is required. Refusing to reset a database without an explicit local target.'
    );
  }

  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }

  const allowedProtocol = url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  if (!allowedProtocol || url.hostname !== EXPECTED_HOST || url.port !== EXPECTED_PORT) {
    throw new Error(
      `Unsafe database target. Expected PostgreSQL at ${EXPECTED_HOST}:${EXPECTED_PORT}; no reset was executed.`
    );
  }
}

try {
  assertDisposableLocalDatabase(process.env.TEST_DATABASE_URL);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

let failures = 0;

for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
  console.log(`[db-reset-loop] attempt ${attempt}/${ATTEMPTS}`);
  const result = spawnSync(
    'supabase',
    // `supabase/seed.sql` is the canonical ordered entrypoint. Omitting it
    // would prove only migrations, not the catalog state Agent A actually uses.
    ['db', 'reset', '--local', '--yes'],
    { cwd: process.cwd(), stdio: 'inherit', shell: false }
  );

  if (result.error) {
    failures += 1;
    console.error(`[db-reset-loop] unable to start Supabase CLI: ${result.error.message}`);
    continue;
  }

  if (result.status !== 0) {
    failures += 1;
    console.error(`[db-reset-loop] attempt ${attempt} failed with exit code ${result.status ?? 'unknown'}`);
  }
}

if (failures > 0) {
  console.error(`[db-reset-loop] ${failures}/${ATTEMPTS} reset attempts failed.`);
  process.exit(1);
}

console.log(`[db-reset-loop] ${ATTEMPTS}/${ATTEMPTS} reset attempts passed.`);
