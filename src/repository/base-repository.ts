import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  type CrudTable,
  type DataContext,
  type InsertOf,
  type KeyOf,
  type QueryOptions,
  RepositoryCore,
  type RepositoryOptions,
  type SelectOf,
} from '../mixins/core';
import { Creatable } from '../mixins/creatable';
import { Deletable } from '../mixins/deletable';
import { type FindManyOptions, Readable } from '../mixins/readable';
import { SoftDeletable } from '../mixins/soft-deletable';
import { Updatable } from '../mixins/updatable';
import type { Page, PageRequest } from '../pagination/pagination';

const HardDeleteRepositoryBase = Deletable(Updatable(Creatable(Readable(RepositoryCore))));
const SoftDeleteRepositoryBase = SoftDeletable(Updatable(Creatable(Readable(RepositoryCore))));

/**
 * Generic CRUD repository backed by hard-delete operations.
 */
export class BaseRepository<TTable extends CrudTable> extends HardDeleteRepositoryBase {
  declare readonly table: TTable;

  constructor(table: TTable, context: DataContext, options: RepositoryOptions = {}) {
    super(table, context, options);
  }

  override findById(id: KeyOf<TTable>): Promise<SelectOf<TTable> | null> {
    return super.findById(id as unknown as KeyOf<CrudTable>) as Promise<SelectOf<TTable> | null>;
  }

  override findMany(query: FindManyOptions = {}): Promise<readonly SelectOf<TTable>[]> {
    return super.findMany(query) as Promise<readonly SelectOf<TTable>[]>;
  }

  override paginate(request: PageRequest, query: QueryOptions = {}): Promise<Page<SelectOf<TTable>>> {
    return super.paginate(request, query) as Promise<Page<SelectOf<TTable>>>;
  }

  override batches(size: number, query: QueryOptions = {}): AsyncGenerator<readonly SelectOf<TTable>[]> {
    return super.batches(size, query) as AsyncGenerator<readonly SelectOf<TTable>[]>;
  }

  override create(values: InsertOf<TTable>): Promise<SelectOf<TTable>> {
    return super.create(values as unknown as InsertOf<CrudTable>) as Promise<SelectOf<TTable>>;
  }

  override createMany(values: readonly InsertOf<TTable>[]): Promise<SelectOf<TTable>[]> {
    return super.createMany(values as unknown as readonly InsertOf<CrudTable>[]) as Promise<SelectOf<TTable>[]>;
  }

  override update(id: KeyOf<TTable>, changes: Partial<InsertOf<TTable>>): Promise<SelectOf<TTable> | null> {
    return super.update(
      id as unknown as KeyOf<CrudTable>,
      changes as unknown as Partial<InsertOf<CrudTable>>,
    ) as Promise<SelectOf<TTable> | null>;
  }

  override updateMany(
    changes: Partial<InsertOf<TTable>>,
    query: QueryOptions = {},
  ): Promise<readonly SelectOf<TTable>[]> {
    return super.updateMany(changes as unknown as Partial<InsertOf<CrudTable>>, query) as Promise<
      readonly SelectOf<TTable>[]
    >;
  }

  override delete(id: KeyOf<TTable>): Promise<boolean> {
    return super.delete(id as unknown as KeyOf<CrudTable>);
  }

  override deleteMany(query: QueryOptions = {}): Promise<readonly KeyOf<TTable>[]> {
    return super.deleteMany(query) as Promise<readonly KeyOf<TTable>[]>;
  }

  override deleteByIds(ids: readonly KeyOf<TTable>[]): Promise<readonly KeyOf<TTable>[]> {
    return super.deleteByIds(ids as unknown as readonly KeyOf<CrudTable>[]) as Promise<readonly KeyOf<TTable>[]>;
  }
}

/**
 * Generic CRUD repository backed by soft-delete operations.
 */
export class BaseSoftDeletableRepository<TTable extends CrudTable> extends SoftDeleteRepositoryBase {
  declare readonly table: TTable;

  constructor(table: TTable, context: DataContext, options: RepositoryOptions = {}) {
    const softDeleteColumn =
      options.softDeleteColumn ??
      ('deletedAt' in table ? ((table as Record<string, unknown>).deletedAt as AnyPgColumn) : undefined);
    super(table, context, softDeleteColumn ? { ...options, softDeleteColumn } : options);
  }

  override findById(id: KeyOf<TTable>): Promise<SelectOf<TTable> | null> {
    return super.findById(id as unknown as KeyOf<CrudTable>) as Promise<SelectOf<TTable> | null>;
  }

  override findMany(query: FindManyOptions = {}): Promise<readonly SelectOf<TTable>[]> {
    return super.findMany(query) as Promise<readonly SelectOf<TTable>[]>;
  }

  override paginate(request: PageRequest, query: QueryOptions = {}): Promise<Page<SelectOf<TTable>>> {
    return super.paginate(request, query) as Promise<Page<SelectOf<TTable>>>;
  }

  override batches(size: number, query: QueryOptions = {}): AsyncGenerator<readonly SelectOf<TTable>[]> {
    return super.batches(size, query) as AsyncGenerator<readonly SelectOf<TTable>[]>;
  }

  override create(values: InsertOf<TTable>): Promise<SelectOf<TTable>> {
    return super.create(values as unknown as InsertOf<CrudTable>) as Promise<SelectOf<TTable>>;
  }

  override createMany(values: readonly InsertOf<TTable>[]): Promise<SelectOf<TTable>[]> {
    return super.createMany(values as unknown as readonly InsertOf<CrudTable>[]) as Promise<SelectOf<TTable>[]>;
  }

  override update(id: KeyOf<TTable>, changes: Partial<InsertOf<TTable>>): Promise<SelectOf<TTable> | null> {
    return super.update(
      id as unknown as KeyOf<CrudTable>,
      changes as unknown as Partial<InsertOf<CrudTable>>,
    ) as Promise<SelectOf<TTable> | null>;
  }

  override updateMany(
    changes: Partial<InsertOf<TTable>>,
    query: QueryOptions = {},
  ): Promise<readonly SelectOf<TTable>[]> {
    return super.updateMany(changes as unknown as Partial<InsertOf<CrudTable>>, query) as Promise<
      readonly SelectOf<TTable>[]
    >;
  }

  override delete(id: KeyOf<TTable>): Promise<boolean> {
    return super.delete(id as unknown as KeyOf<CrudTable>);
  }

  override deleteMany(query: QueryOptions = {}): Promise<readonly KeyOf<TTable>[]> {
    return super.deleteMany(query) as Promise<readonly KeyOf<TTable>[]>;
  }

  override deleteByIds(ids: readonly KeyOf<TTable>[]): Promise<readonly KeyOf<TTable>[]> {
    return super.deleteByIds(ids as unknown as readonly KeyOf<CrudTable>[]) as Promise<readonly KeyOf<TTable>[]>;
  }

  override restore(id: KeyOf<TTable>): Promise<boolean> {
    return super.restore(id as unknown as KeyOf<CrudTable>);
  }

  override restoreMany(query: QueryOptions = {}): Promise<readonly KeyOf<TTable>[]> {
    return super.restoreMany(query) as Promise<readonly KeyOf<TTable>[]>;
  }

  override findDeletedById(id: KeyOf<TTable>): Promise<SelectOf<TTable> | null> {
    return super.findDeletedById(id as unknown as KeyOf<CrudTable>) as Promise<SelectOf<TTable> | null>;
  }

  override paginateDeleted(request: PageRequest, query: QueryOptions = {}): Promise<Page<SelectOf<TTable>>> {
    return super.paginateDeleted(request, query) as Promise<Page<SelectOf<TTable>>>;
  }

  override findManyDeleted(query: FindManyOptions = {}): Promise<readonly SelectOf<TTable>[]> {
    return super.findManyDeleted(query) as Promise<readonly SelectOf<TTable>[]>;
  }
}

/**
 * Initializes a default CRUD repository over `TTable`.
 * Automatically inspects if table has `deletedAt` or `options?.softDeleteColumn`
 * and instantiates `BaseSoftDeletableRepository` if soft-deletable, or `BaseRepository` if hard-deletable.
 * Supports passing `context: DataContext` directly or currying `(context: DataContext) => repository`.
 */
export function baseRepository<TTable extends CrudTable>(
  table: TTable,
  context: DataContext,
  options?: RepositoryOptions & { softDeleteColumn?: AnyPgColumn },
): BaseRepository<TTable> | BaseSoftDeletableRepository<TTable>;

export function baseRepository<TTable extends CrudTable>(
  table: TTable,
  context?: undefined,
  options?: RepositoryOptions & { softDeleteColumn?: AnyPgColumn },
): (context: DataContext) => BaseRepository<TTable> | BaseSoftDeletableRepository<TTable>;

export function baseRepository<TTable extends CrudTable>(
  table: TTable,
  context?: DataContext,
  options?: RepositoryOptions & { softDeleteColumn?: AnyPgColumn },
):
  | BaseRepository<TTable>
  | BaseSoftDeletableRepository<TTable>
  | ((context: DataContext) => BaseRepository<TTable> | BaseSoftDeletableRepository<TTable>) {
  const isSoft =
    Boolean(options?.softDeleteColumn) ||
    ('deletedAt' in table && (table as Record<string, unknown>).deletedAt != null);

  const create = (ctx: DataContext): BaseRepository<TTable> | BaseSoftDeletableRepository<TTable> => {
    if (isSoft) {
      const softDeleteColumn =
        options?.softDeleteColumn ??
        ('deletedAt' in table ? ((table as Record<string, unknown>).deletedAt as AnyPgColumn) : undefined);
      return new BaseSoftDeletableRepository(table, ctx, { ...options, softDeleteColumn });
    }
    return new BaseRepository(table, ctx, options);
  };

  if (context) {
    return create(context);
  }
  return create;
}
