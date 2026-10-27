import { join } from 'node:path';
import { FrameworkError } from '@framework/core';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { z } from 'zod/v4';
import type { DatabaseConnection } from '../connections/connection';

/** Arbitrary constant key for pg_advisory_lock; one migrator at a time per database. */
const MIGRATION_LOCK_KEY = 72_810_441;

const journalSchema = z.object({
  entries: z.array(z.object({ idx: z.number(), tag: z.string(), when: z.number() })),
});

export interface MigrationState {
  readonly tag: string;
  readonly applied: boolean;
}

async function readJournal(folder: string): Promise<z.output<typeof journalSchema>> {
  const file = Bun.file(join(folder, 'meta', '_journal.json'));
  if (!(await file.exists())) return { entries: [] };
  return journalSchema.parse(await file.json());
}

/**
 * Applies pending Drizzle Kit migrations under a session advisory lock so
 * concurrent deploy steps cannot race. Never called on server startup.
 * Requires a pool of at least 2: one reserved connection holds the lock.
 */
export async function runMigrations(connection: DatabaseConnection, folder: string): Promise<void> {
  if ((connection.sql.options.max ?? 0) < 2) {
    throw new FrameworkError('MIGRATION_POOL_TOO_SMALL', 'runMigrations needs a connection pool of at least 2');
  }
  const reserved = await connection.sql.reserve();
  try {
    await reserved`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`;
    let migrationError: Error | undefined;
    try {
      await migrate(connection.db, { migrationsFolder: folder });
    } catch (error) {
      migrationError = error instanceof Error ? error : new Error(String(error));
    }
    try {
      await reserved`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`;
    } catch (unlockError) {
      // Never mask the migration failure; the lock is released with the session anyway.
      if (!migrationError) throw unlockError;
    }
    if (migrationError) throw migrationError;
  } catch (error) {
    throw new FrameworkError('MIGRATION_FAILED', 'Migration failed', { cause: error });
  } finally {
    reserved.release();
  }
}

/** Compares the journal with Drizzle's bookkeeping table (matched by journal timestamp). */
export async function migrationStatus(connection: DatabaseConnection, folder: string): Promise<MigrationState[]> {
  const journal = await readJournal(folder);
  const tableExists = await connection.sql<{ exists: boolean }[]>`
    select to_regclass('drizzle.__drizzle_migrations') is not null as exists`;
  const applied = new Set<number>();
  if (tableExists[0]?.exists) {
    const rows = await connection.sql<{ created_at: string }[]>`select created_at from drizzle.__drizzle_migrations`;
    for (const row of rows) applied.add(Number(row.created_at));
  }
  return journal.entries.map((entry) => ({ tag: entry.tag, applied: applied.has(entry.when) }));
}
