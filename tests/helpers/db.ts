import postgres from 'postgres';

const LOCAL_TEST_HOST = '127.0.0.1';
const LOCAL_TEST_PORTS = new Set(['54322', '55432', '55433', '55434', '55435']);

export type LocalDatabaseInspection =
  | { allowed: true; url: string }
  | { allowed: false; reason: string };

export function inspectLocalTestDatabaseUrl(rawUrl: string | undefined): LocalDatabaseInspection {
  if (!rawUrl) {
    return {
      allowed: false,
      reason: 'TEST_DATABASE_URL is not set; integration tests require disposable Supabase at 127.0.0.1:54322.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, reason: 'TEST_DATABASE_URL is not a valid URL.' };
  }

  const postgresProtocol = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
  if (!postgresProtocol || parsed.hostname !== LOCAL_TEST_HOST || !LOCAL_TEST_PORTS.has(parsed.port)) {
    return {
      allowed: false,
      reason: 'TEST_DATABASE_URL must target an approved disposable PostgreSQL port on 127.0.0.1; remote databases are refused.',
    };
  }

  return { allowed: true, url: rawUrl };
}

export function openLocalTestDatabase() {
  const inspection = inspectLocalTestDatabaseUrl(process.env.TEST_DATABASE_URL);
  if (!inspection.allowed) throw new Error(inspection.reason);
  return postgres(inspection.url, { max: 1 });
}

export function openIndependentLocalTestDatabases(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error('Independent test connection count must be between 1 and 50.');
  }

  return Array.from({ length: count }, () => openLocalTestDatabase());
}
