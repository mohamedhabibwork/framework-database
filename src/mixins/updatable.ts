import { eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  assertNoCollision,
  type InsertOf,
  type KeyOf,
  type QueryOptions,
  type RepositoryConstructor,
  type SelectOf,
  type TableOf,
} from './core';

export function Updatable<TBase extends RepositoryConstructor>(Base: TBase) {
  assertNoCollision(Base, 'Updatable', ['update', 'updateMany']);

  abstract class UpdatableRepository extends Base {
    /** Hook: adjust validated changes before update. Must return a new object. */
    protected beforeUpdate(changes: Partial<InsertOf<TableOf<TBase>>>): Partial<InsertOf<TableOf<TBase>>> {
      return changes;
    }

    /** Hook: adjust changes once for a bulk update (default: same as `beforeUpdate`). */
    protected beforeUpdateMany(changes: Partial<InsertOf<TableOf<TBase>>>): Partial<InsertOf<TableOf<TBase>>> {
      return this.beforeUpdate(changes);
    }

    /** Returns the updated row, or null when no visible row has this id. */
    async update(
      id: KeyOf<TableOf<TBase>>,
      changes: Partial<InsertOf<TableOf<TBase>>>,
    ): Promise<SelectOf<TableOf<TBase>> | null> {
      return this.write(async () => {
        const before = (await this.before(id)) as SelectOf<TableOf<TBase>> | null;
        if (this.tracksChanges && !before) return null;
        const rows = await this.db
          .update(this.table as PgTable)
          .set(this.beforeUpdate(changes))
          .where(this.visibleWhere([eq(this.table.id, id)]))
          .returning();
        const after = (rows[0] as SelectOf<TableOf<TBase>> | undefined) ?? null;
        if (after) await this.afterWrite({ action: 'updated', id, before, after });
        return after;
      });
    }

    /**
     * Bulk update of every visible row matching `query.filters`, scoped as
     * usual. Returns the updated rows. Audited per record (before rows are
     * locked inside the same transaction when the `Auditable` mixin is on).
     */
    async updateMany(
      changes: Partial<InsertOf<TableOf<TBase>>>,
      query: QueryOptions = {},
    ): Promise<readonly SelectOf<TableOf<TBase>>[]> {
      return this.write(async () => {
        const beforeRows = await this.beforeMany(query);
        const rows = (await this.db
          .update(this.table as PgTable)
          .set(this.beforeUpdateMany(changes))
          .where(this.visibleWhere(query.filters))
          .returning()) as SelectOf<TableOf<TBase>>[];
        for (const after of rows) {
          const id = (after as { id: KeyOf<TableOf<TBase>> }).id;
          await this.afterWrite({ action: 'updated', id, before: beforeRows.get(id) ?? null, after });
        }
        return rows;
      });
    }
  }
  return UpdatableRepository;
}
