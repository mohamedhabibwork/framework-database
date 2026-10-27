import { AsyncLocalStorage } from 'node:async_hooks';
import { token } from '@framework/core';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js';
import type { Database } from '../connections/connection';

/** Anything queries can run on: the pooled database or an open transaction. */
export type DbExecutor = PgDatabase<PostgresJsQueryResultHKT, Record<string, never>>;

/**
 * Propagates the active transaction to repositories in the same execution
 * scope without passing `tx` through every call.
 *
 * Semantics:
 * - `transaction(fn)` opens a transaction; the callback's rejection rolls back.
 * - Nested `transaction(fn)` becomes a SAVEPOINT; an inner failure rolls back
 *   only to the savepoint if the outer callback catches it.
 * - Concurrent branches in one scope each see their own chain (AsyncLocalStorage).
 * - A context is bound to one connection; it never crosses connections.
 */
export class TransactionContext {
  readonly #storage = new AsyncLocalStorage<DbExecutor>();

  constructor(readonly database: Database) {}

  /** Current transaction if one is open in this async chain, otherwise the pool. */
  get executor(): DbExecutor {
    return this.#storage.getStore() ?? this.database;
  }

  get inTransaction(): boolean {
    return this.#storage.getStore() !== undefined;
  }

  transaction<T>(work: (tx: DbExecutor) => Promise<T>): Promise<T> {
    return this.executor.transaction((tx) => this.#storage.run(tx, () => work(tx)));
  }
}

export const TRANSACTION_CONTEXT = token<TransactionContext>('database.transaction-context');
