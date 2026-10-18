import type postgres from 'postgres';

export type DbClient = postgres.Sql | postgres.TransactionSql;

export interface PostgresErrorLike extends Error {
  code?: string;
  constraint_name?: string;
  constraint?: string;
}

export function getPostgresError(error: unknown): PostgresErrorLike | null {
  if (!(error instanceof Error)) return null;
  return error as PostgresErrorLike;
}

const TRANSIENT_DATABASE_AVAILABILITY_CODES = new Set([
  'CONNECTION_DESTROYED',
  '57014',
]);

export function isTransientDatabaseAvailabilityError(error: unknown): boolean {
  let current = error;

  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    const candidate = current as PostgresErrorLike & { cause?: unknown };
    if (candidate.code && TRANSIENT_DATABASE_AVAILABILITY_CODES.has(candidate.code)) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
}

