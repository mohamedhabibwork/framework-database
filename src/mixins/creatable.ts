import type { PgTable } from 'drizzle-orm/pg-core';
import {
  assertNoCollision,
  type InsertOf,
  type KeyOf,
  type RepositoryConstructor,
  type SelectOf,
  type TableOf,
} from './core';

export function Creatable<TBase extends RepositoryConstructor>(Base: TBase) {
  assertNoCollision(Base, 'Creatable', ['create', 'createMany']);

  abstract class CreatableRepository extends Base {
    /** Hook: adjust validated input before insert (e.g. set owner). Must return a new object. */
    protected beforeCreate(values: InsertOf<TableOf<TBase>>): InsertOf<TableOf<TBase>> {
      return values;
    }

    async create(values: InsertOf<TableOf<TBase>>): Promise<SelectOf<TableOf<TBase>>> {
      return this.write(async () => {
        const rows = await this.db
          .insert(this.table as PgTable)
          .values(this.beforeCreate(values))
          .returning();
        const row = rows[0] as SelectOf<TableOf<TBase>>;
        await this.afterWrite({
          action: 'created',
          id: (row as { id: KeyOf<TableOf<TBase>> }).id,
          before: null,
          after: row,
        });
        return row;
      });
    }

    /** Bulk insert in one statement (imports); every row is tracked as `imported`. */
    async createMany(values: readonly InsertOf<TableOf<TBase>>[]): Promise<SelectOf<TableOf<TBase>>[]> {
      if (values.length === 0) return [];
      return this.write(async () => {
        const rows = (await this.db
          .insert(this.table as PgTable)
          .values(values.map((v) => this.beforeCreate(v)))
          .returning()) as SelectOf<TableOf<TBase>>[];
        for (const row of rows) {
          await this.afterWrite({
            action: 'imported',
            id: (row as { id: KeyOf<TableOf<TBase>> }).id,
            before: null,
            after: row,
          });
        }
        return rows;
      });
    }
  }
  return CreatableRepository;
}
