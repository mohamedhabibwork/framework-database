import { eq, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  assertNoCollision,
  type KeyOf,
  type QueryOptions,
  type RepositoryConstructor,
  type SelectOf,
  type TableOf,
} from './core';

/** Hard delete. Mutually exclusive with SoftDeletable (both provide `delete`). */
export function Deletable<TBase extends RepositoryConstructor>(Base: TBase) {
  assertNoCollision(Base, 'Deletable', ['delete', 'deleteMany']);

  abstract class DeletableRepository extends Base {
    /** Returns true when a visible row was removed. */
    async delete(id: KeyOf<TableOf<TBase>>): Promise<boolean> {
      return this.write(async () => {
        const rows = await this.db
          .delete(this.table as PgTable)
          .where(this.visibleWhere([eq(this.table.id, id)]))
          .returning();
        const before = (rows[0] as SelectOf<TableOf<TBase>> | undefined) ?? null;
        if (before) await this.afterWrite({ action: 'deleted', id, before, after: null });
        return before !== null;
      });
    }

    /**
     * Bulk delete of every visible row matching `query.filters`. Returns the
     * removed ids. Audited per record (`returning()` yields the removed rows).
     */
    async deleteMany(query: QueryOptions = {}): Promise<readonly KeyOf<TableOf<TBase>>[]> {
      return this.write(async () => {
        const rows = (await this.db
          .delete(this.table as PgTable)
          .where(this.visibleWhere(query.filters))
          .returning()) as SelectOf<TableOf<TBase>>[];
        const ids: KeyOf<TableOf<TBase>>[] = [];
        for (const before of rows) {
          const id = (before as { id: KeyOf<TableOf<TBase>> }).id;
          ids.push(id);
          await this.afterWrite({ action: 'deleted', id, before, after: null });
        }
        return ids;
      });
    }

    /**
     * Bulk delete by explicit ids (intersected with the visible scope).
     * Returns the ids actually removed.
     */
    async deleteByIds(ids: readonly KeyOf<TableOf<TBase>>[]): Promise<readonly KeyOf<TableOf<TBase>>[]> {
      if (ids.length === 0) return [];
      return this.deleteMany({ filters: [inArray(this.table.id, ids as unknown[])] });
    }
  }
  return DeletableRepository;
}
