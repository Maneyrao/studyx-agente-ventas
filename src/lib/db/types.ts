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

