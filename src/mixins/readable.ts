import { asc, count, desc, eq, gt } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { type Page, type PageRequest, toPage } from '../pagination/pagination';
import {
  assertNoCollision,
  type KeyOf,
  type QueryOptions,
  type RepositoryConstructor,
  type SelectOf,
  type TableOf,
} from './core';

export interface FindManyOptions extends QueryOptions {
  /** Hard cap on returned rows (default 1000, max 10_000). */
  readonly limit?: number;
}

export function Readable<TBase extends RepositoryConstructor>(Base: TBase) {
  assertNoCollision(Base, 'Readable', ['findById', 'paginate', 'batches', 'findMany', 'count', 'exists']);

  abstract class ReadableRepository extends Base {
    async findById(id: KeyOf<TableOf<TBase>>): Promise<SelectOf<TableOf<TBase>> | null> {
      const rows = await this.db
        .select()
        .from(this.table as PgTable)
        .where(this.visibleWhere([eq(this.table.id, id)]))
        .limit(1);
      return (rows[0] as SelectOf<TableOf<TBase>> | undefined) ?? null;
    }

    /**
     * Every visible row matching the query, ordered and hard-capped
     * (exports, feeds). For unbounded iteration use {@link batches}.
     */
    async findMany(query: FindManyOptions = {}): Promise<readonly SelectOf<TableOf<TBase>>[]> {
      const limit = Math.min(Math.max(query.limit ?? 1000, 1), 10_000);
      const rows = (await this.db
        .select()
        .from(this.table as PgTable)
        .where(this.visibleWhere(query.filters))
        .orderBy(...(query.sort ?? []).map((s) => (s.direction === 'desc' ? desc(s.column) : asc(s.column))))
        .limit(limit)) as SelectOf<TableOf<TBase>>[];
      return rows;
    }

    /** Number of visible rows matching the query. */
    async count(query: QueryOptions = {}): Promise<number> {
      const rows = await this.db
        .select({ total: count() })
        .from(this.table as PgTable)
        .where(this.visibleWhere(query.filters));
      return rows[0]?.total ?? 0;
    }

    /** Whether at least one visible row matches the query. */
    async exists(query: QueryOptions = {}): Promise<boolean> {
      return (await this.count(query)) > 0;
    }

    /** Offset pagination; requested sort first, `id` always last for determinism. */
    async paginate(request: PageRequest, query: QueryOptions = {}): Promise<Page<SelectOf<TableOf<TBase>>>> {
      const where = this.visibleWhere(query.filters);
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

    /** Keyset iteration by id for large exports; memory bounded by `size`. */
    async *batches(size: number, query: QueryOptions = {}): AsyncGenerator<readonly SelectOf<TableOf<TBase>>[]> {
      let last: KeyOf<TableOf<TBase>> | undefined;
      while (true) {
        const rows = (await this.db
          .select()
          .from(this.table as PgTable)
          .where(
            this.visibleWhere([...(query.filters ?? []), ...(last === undefined ? [] : [gt(this.table.id, last)])]),
          )
          .orderBy(asc(this.table.id))
          .limit(size)) as SelectOf<TableOf<TBase>>[];
        if (rows.length === 0) return;
        yield rows;
        last = (rows.at(-1) as { id: KeyOf<TableOf<TBase>> }).id;
        if (rows.length < size) return;
      }
    }
  }
  return ReadableRepository;
}
