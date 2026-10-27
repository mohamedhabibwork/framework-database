import { type ExecutionContext, FrameworkError, type JsonObject, type JsonValue, token } from '@framework/core';
import { and, eq, type InferInsertModel, type InferSelectModel, isNull, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { DbExecutor, TransactionContext } from '../transactions/transaction-context';

/**
 * Tables usable by the CRUD mixins: single-column primary key named `id`.
 * The column set deliberately has no index signature: stacked mixins see the
 * table as `CrudTable & typeof concreteTable`, and an index signature here
 * would erase the concrete columns from inferred row types.
 */
export type CrudTable = PgTable<{
  name: string;
  schema: string | undefined;
  columns: { id: AnyPgColumn };
  dialect: 'pg';
}> & { readonly id: AnyPgColumn };

export type SelectOf<TTable extends CrudTable> = InferSelectModel<TTable>;
export type InsertOf<TTable extends CrudTable> = InferInsertModel<TTable>;
export type KeyOf<TTable extends CrudTable> = TTable['id']['_']['data'];

/**
 * The context shared by controller -> service -> repository within one
 * scope: the transaction propagation and who/what is acting.
 */
export interface DataContext {
  readonly transactions: TransactionContext;
  readonly execution: ExecutionContext;
}

export const DATA_CONTEXT = token<DataContext>('database.data-context');

export type AuditAction = 'created' | 'updated' | 'deleted' | 'restored' | 'imported';

export interface RowChange<TTable extends CrudTable> {
  readonly action: AuditAction;
  readonly id: KeyOf<TTable>;
  readonly before: SelectOf<TTable> | null;
  readonly after: SelectOf<TTable> | null;
}

export interface SortSpec {
  readonly column: AnyPgColumn;
  readonly direction: 'asc' | 'desc';
}

export interface QueryOptions {
  readonly filters?: readonly SQL[];
  readonly sort?: readonly SortSpec[];
}

export interface RepositoryOptions {
  /** Column marking soft-deleted rows; required by the SoftDeletable mixin. */
  readonly softDeleteColumn?: AnyPgColumn;
  /** Property names never written to audit snapshots (e.g. secrets). */
  readonly auditExclude?: readonly string[];
}

type RowValue = JsonValue | Date | bigint | undefined;

/** Converts a database row into a JSON snapshot (Date -> ISO, bigint -> string). */
export function toJsonRow(row: object, exclude: readonly string[] = []): JsonObject {
  const entries = Object.entries(row as Readonly<Record<string, RowValue>>)
    .filter(([key, value]) => !exclude.includes(key) && value !== undefined)
    .map(([key, value]): [string, JsonValue] => [
      key,
      value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? value.toString() : (value as JsonValue),
    ]);
  return Object.fromEntries(entries);
}

/**
 * Shared state and write pipeline for all CRUD mixins. The data context is
 * injected explicitly; no static or global connection exists.
 */
export class RepositoryCore<TTable extends CrudTable> {
  constructor(
    readonly table: TTable,
    readonly context: DataContext,
    readonly options: RepositoryOptions = {},
  ) {}

  get transactions(): TransactionContext {
    return this.context.transactions;
  }

  protected get db(): DbExecutor {
    return this.context.transactions.executor;
  }

  /** Override to add scope filters (tenant, ownership). Combined with AND. */
  scopeConditions(): SQL[] {
    return [];
  }

  /** Column reference by property name (ownership scoping, sort specs). */
  column(field: string): AnyPgColumn | undefined {
    return (this.table as unknown as Readonly<Record<string, AnyPgColumn>>)[field];
  }

  /** Scope filters, soft-delete exclusion and any extra conditions. */
  visibleWhere(extra: readonly SQL[] = []): SQL | undefined {
    const conditions = [...this.scopeConditions(), ...extra];
    if (this.options.softDeleteColumn) conditions.push(isNull(this.options.softDeleteColumn));
    return conditions.length > 0 ? and(...conditions) : undefined;
  }

  /** True when write hooks need the previous row and an atomic transaction (auditing). */
  protected get tracksChanges(): boolean {
    return false;
  }

  /** Runs a write, wrapping it in a transaction when change tracking requires atomicity. */
  protected write<T>(work: () => Promise<T>): Promise<T> {
    if (!this.tracksChanges || this.transactions.inTransaction) return work();
    return this.transactions.transaction(() => work());
  }

  /** Previous visible row for change tracking (locked for the rest of the transaction). */
  protected async before(id: KeyOf<TTable>): Promise<SelectOf<TTable> | null> {
    if (!this.tracksChanges) return null;
    const rows = await this.db
      .select()
      .from(this.table as PgTable)
      .where(this.visibleWhere([eq(this.table.id, id)]))
      .for('update')
      .limit(1);
    return (rows[0] as SelectOf<TTable> | undefined) ?? null;
  }

  /**
   * Previous visible rows for bulk change tracking, keyed by id and locked
   * for the rest of the transaction (same guarantees as {@link before}).
   */
  protected async beforeMany(query: QueryOptions = {}): Promise<Map<KeyOf<TTable>, SelectOf<TTable>>> {
    const locked = new Map<KeyOf<TTable>, SelectOf<TTable>>();
    if (!this.tracksChanges) return locked;
    const rows = (await this.db
      .select()
      .from(this.table as PgTable)
      .where(this.visibleWhere(query.filters))
      .for('update')) as SelectOf<TTable>[];
    for (const row of rows) locked.set((row as { id: KeyOf<TTable> }).id, row);
    return locked;
  }

  /** Hook invoked inside the write (and its transaction) after every change. */
  protected async afterWrite(_change: RowChange<TTable>): Promise<void> {}
}

// TypeScript's mixin pattern requires a constructor accepting any arguments.
// biome-ignore lint/suspicious/noExplicitAny: required mixin constructor signature
export type RepositoryConstructor = abstract new (...args: any[]) => RepositoryCore<CrudTable>;

export type TableOf<TBase extends RepositoryConstructor> = InstanceType<TBase>['table'];

/** Fails when two mixins would contribute the same method (e.g. Deletable + SoftDeletable). */
export function assertNoCollision(base: RepositoryConstructor, mixin: string, methods: readonly string[]): void {
  for (const method of methods) {
    if (method in base.prototype) {
      throw new FrameworkError(
        'MIXIN_COLLISION',
        `Mixin "${mixin}" cannot be applied: method "${method}" is already provided by another mixin`,
      );
    }
  }
}
