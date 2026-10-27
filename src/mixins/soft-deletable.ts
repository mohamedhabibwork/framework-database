import { FrameworkError } from '@framework/core';
import { and, asc, count, desc, eq, inArray, isNotNull, type SQL, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { type Page, type PageRequest, toPage } from '../pagination/pagination';
import {
  assertNoCollision,
  type KeyOf,
  type QueryOptions,
  type RepositoryConstructor,
  type SelectOf,
  type TableOf,
} from './core';
import type { FindManyOptions } from './readable';

/**
 * Replaces the delete strategy: `delete` sets the configured timestamp column
 * to the database clock (`now()`, valid for Date- and string-mode columns)
 * and `restore` clears it. Reads and updates already exclude deleted rows.
 */
export function SoftDeletable<TBase extends RepositoryConstructor>(Base: TBase) {
  assertNoCollision(Base, 'SoftDeletable', [
    'delete',
    'deleteMany',
    'restore',
    'restoreMany',
    'deletedWhere',
    'findDeletedById',
    'paginateDeleted',
    'findManyDeleted',
  ]);

  abstract class SoftDeletableRepository extends Base {
    #deletedAt(): AnyPgColumn {
      const column = this.options.softDeleteColumn;
      if (!column) {
        throw new FrameworkError('SOFT_DELETE_MISCONFIGURED', 'SoftDeletable requires options.softDeleteColumn');
      }
      return column;
    }

    #propertyName(column: AnyPgColumn): string {
      const entry = Object.entries(this.table).find(([, value]) => value === column);
      if (!entry) {
        throw new FrameworkError('SOFT_DELETE_MISCONFIGURED', 'softDeleteColumn is not a column of this table');
      }
      return entry[0];
    }

    async delete(id: KeyOf<TableOf<TBase>>): Promise<boolean> {
      const column = this.#deletedAt();
      return this.write(async () => {
        const before = (await this.before(id)) as SelectOf<TableOf<TBase>> | null;
        const rows = await this.db
          .update(this.table as PgTable)
          .set({ [this.#propertyName(column)]: sql`now()` })
          .where(this.visibleWhere([eq(this.table.id, id)]))
          .returning();
        const after = (rows[0] as SelectOf<TableOf<TBase>> | undefined) ?? null;
        if (after) await this.afterWrite({ action: 'deleted', id, before, after });
        return after !== null;
      });
    }

    /** Bulk soft delete of every visible row matching `query.filters`. */
    async deleteMany(query: QueryOptions = {}): Promise<readonly KeyOf<TableOf<TBase>>[]> {
      const column = this.#deletedAt();
      return this.write(async () => {
        const beforeRows = await this.beforeMany(query);
        const rows = (await this.db
          .update(this.table as PgTable)
          .set({ [this.#propertyName(column)]: sql`now()` })
          .where(this.visibleWhere(query.filters))
          .returning()) as SelectOf<TableOf<TBase>>[];
        const ids: KeyOf<TableOf<TBase>>[] = [];
        for (const after of rows) {
          const id = (after as { id: KeyOf<TableOf<TBase>> }).id;
          ids.push(id);
          await this.afterWrite({ action: 'deleted', id, before: beforeRows.get(id) ?? null, after });
        }
        return ids;
      });
    }

    async restore(id: KeyOf<TableOf<TBase>>): Promise<boolean> {
      const column = this.#deletedAt();
      return this.write(async () => {
        const rows = await this.db
          .update(this.table as PgTable)
          .set({ [this.#propertyName(column)]: null })
          .where(and(...this.scopeConditions(), eq(this.table.id, id), isNotNull(column)))
          .returning();
        const after = (rows[0] as SelectOf<TableOf<TBase>> | undefined) ?? null;
        if (after) await this.afterWrite({ action: 'restored', id, before: null, after });
        return after !== null;
      });
    }

    /** Bulk restore of every soft-deleted row matching `query.filters`. */
    async restoreMany(query: QueryOptions = {}): Promise<readonly KeyOf<TableOf<TBase>>[]> {
      const column = this.#deletedAt();
      return this.write(async () => {
        const rows = (await this.db
          .update(this.table as PgTable)
          .set({ [this.#propertyName(column)]: null })
          .where(and(...this.scopeConditions(), isNotNull(column), ...(query.filters ?? [])))
          .returning()) as SelectOf<TableOf<TBase>>[];
        for (const row of rows) {
          const id = (row as { id: KeyOf<TableOf<TBase>> }).id;
          await this.afterWrite({ action: 'restored', id, before: null, after: row });
        }
        return rows.map((row) => (row as { id: KeyOf<TableOf<TBase>> }).id);
      });
    }

    /** Bulk soft delete by explicit ids (intersected with the visible scope). */
    async deleteByIds(ids: readonly KeyOf<TableOf<TBase>>[]): Promise<readonly KeyOf<TableOf<TBase>>[]> {
      if (ids.length === 0) return [];
      return this.deleteMany({ filters: [inArray(this.table.id, ids as unknown[])] });
    }

    /** Scope filters, soft-delete inclusion (isNotNull) and any extra conditions. */
    deletedWhere(extra: readonly SQL[] = []): SQL | undefined {
      const column = this.#deletedAt();
      const conditions = [...this.scopeConditions(), isNotNull(column), ...extra];
      return conditions.length > 0 ? and(...conditions) : undefined;
    }

    /** Single soft-deleted row by primary key (null when missing or active). */
    async findDeletedById(id: KeyOf<TableOf<TBase>>): Promise<SelectOf<TableOf<TBase>> | null> {
      const rows = await this.db
        .select()
        .from(this.table as PgTable)
        .where(this.deletedWhere([eq(this.table.id, id)]))
        .limit(1);
      return (rows[0] as SelectOf<TableOf<TBase>> | undefined) ?? null;
    }

    /** Paginated list of soft-deleted rows; requested sort first, `id` always last. */
    async paginateDeleted(request: PageRequest, query: QueryOptions = {}): Promise<Page<SelectOf<TableOf<TBase>>>> {
      const where = this.deletedWhere(query.filters);
      const ordering = [
        ...(query.sort ?? []).map((s) => (s.direction === 'desc' ? desc(s.column) : asc(s.column))),
        asc(this.table.id),
      ];
      const [rows, totals] = await Promise.all([
        this.db
          .select()
          .from(this.table as PgTable)
          .where(where)
          .orderBy(...ordering)
          .limit(request.limit)
          .offset((request.page - 1) * request.limit),
        this.db
          .select({ total: count() })
          .from(this.table as PgTable)
          .where(where),
      ]);
      return toPage(rows as SelectOf<TableOf<TBase>>[], totals[0]?.total ?? 0, request);
    }

    /** Every soft-deleted row matching the query, ordered and hard-capped. */
    async findManyDeleted(query: FindManyOptions = {}): Promise<readonly SelectOf<TableOf<TBase>>[]> {
      const limit = Math.min(Math.max(query.limit ?? 1000, 1), 10_000);
      const rows = (await this.db
        .select()
        .from(this.table as PgTable)
        .where(this.deletedWhere(query.filters))
        .orderBy(...(query.sort ?? []).map((s) => (s.direction === 'desc' ? desc(s.column) : asc(s.column))))
        .limit(limit)) as SelectOf<TableOf<TBase>>[];
      return rows;
    }
  }
  return SoftDeletableRepository;
}
