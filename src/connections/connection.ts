import { token } from '@framework/core';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export type Database = PostgresJsDatabase<Record<string, never>>;

export interface DatabaseConnection {
  readonly db: Database;
  readonly sql: postgres.Sql;
  close(timeoutSeconds?: number): Promise<void>;
}

export interface ConnectionOptions {
  readonly url: string;
  /** Explicit pool size; never unbounded. */
  readonly maxConnections: number;
  readonly idleTimeoutSeconds?: number;
  readonly connectTimeoutSeconds?: number;
  readonly applicationName?: string;
}

export const DATABASE = token<DatabaseConnection>('database.connection');

export function createConnection(options: ConnectionOptions): DatabaseConnection {
  const sql = postgres(options.url, {
    max: options.maxConnections,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    onnotice: () => {},
    connection: { application_name: options.applicationName ?? 'framework' },
  });
  const db = drizzle(sql);
  return {
    db,
    sql,
    close: (timeoutSeconds = 5) => sql.end({ timeout: timeoutSeconds }),
  };
}

/** Readiness probe: a bounded round-trip to the database. */
export async function pingDatabase(connection: DatabaseConnection): Promise<boolean> {
  try {
    await connection.sql`select 1`;
    return true;
  } catch {
    return false;
  }
}
