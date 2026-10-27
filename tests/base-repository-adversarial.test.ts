import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ExecutionContext, FrameworkError } from '@framework/core';
import { createTestDatabase, requireTestDatabaseUrl, type TestDatabase } from '@framework/testing';
import { like } from 'drizzle-orm';
import { type AnyPgColumn, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import {
  BaseRepository,
  BaseSoftDeletableRepository,
  baseRepository,
  createConnection,
  type DatabaseConnection,
  type DataContext,
  Deletable,
  RepositoryCore,
  SoftDeletable,
  TransactionContext,
} from '../src';

// Schema 1: Standard soft-delete table with deletedAt property
const posts = pgTable('adv_posts', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
});

// Schema 2: Standard hard-delete table without deletedAt
const categories = pgTable('adv_categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

// Schema 3: Custom soft-delete column name (archivedAt instead of deletedAt)
const documents = pgTable('adv_documents', {
  id: serial('id').primaryKey(),
  content: text('content').notNull(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
});

// Schema 4: Snake-case property name in drizzle
const notes = pgTable('adv_notes', {
  id: serial('id').primaryKey(),
  body: text('body').notNull(),
  deleted_at: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
});

const ACTOR = { id: 'challenger-1', type: 'system' } as const;
const makeDataContext = (transactions: TransactionContext): DataContext => ({
  transactions,
  execution: new ExecutionContext('test', 'corr-adversarial-repo', ACTOR),
});

let database: TestDatabase;
let connection: DatabaseConnection;

beforeAll(async () => {
  database = await createTestDatabase({ adminUrl: requireTestDatabaseUrl() });
  connection = createConnection({ url: database.url, maxConnections: 4 });
  await connection.sql`create table adv_posts (id serial primary key, title text not null, deleted_at timestamptz)`;
  await connection.sql`create table adv_categories (id serial primary key, name text not null)`;
  await connection.sql`create table adv_documents (id serial primary key, content text not null, archived_at timestamptz)`;
  await connection.sql`create table adv_notes (id serial primary key, body text not null, deleted_at timestamptz)`;
});

afterAll(async () => {
  await connection?.close();
  await database?.drop();
});

const getContext = () => makeDataContext(new TransactionContext(connection.db));

describe('Adversarial Test Suite: M1 Repositories & Soft-Delete Core', () => {
  // =========================================================================
  // 1. COLLISION GUARDS
  // =========================================================================
  describe('Collision Guards & Mixin Composition', () => {
    test('SoftDeletable throws MIXIN_COLLISION for all reserved method names', () => {
      const reserved = [
        'delete',
        'deleteMany',
        'restore',
        'restoreMany',
        'deletedWhere',
        'findDeletedById',
        'paginateDeleted',
        'findManyDeleted',
      ] as const;

      for (const methodName of reserved) {
        class CollidingRepo extends RepositoryCore<typeof posts> {
          [methodName]() {
            return null;
          }
        }
        expect(() => SoftDeletable(CollidingRepo)).toThrow(FrameworkError);
        try {
          SoftDeletable(CollidingRepo);
        } catch (err: unknown) {
          expect(err instanceof FrameworkError).toBe(true);
          const fErr = err as FrameworkError;
          expect(fErr.code).toBe('MIXIN_COLLISION');
          expect(fErr.message).toContain(methodName);
          expect(fErr.message).toContain('SoftDeletable');
        }
      }
    });

    test('Deletable throws MIXIN_COLLISION when colliding with SoftDeletable methods', () => {
      class CollidingWithDelete extends RepositoryCore<typeof posts> {
        delete() {
          return Promise.resolve(false);
        }
      }
      expect(() => Deletable(CollidingWithDelete)).toThrow(FrameworkError);

      class CollidingWithDeleteMany extends RepositoryCore<typeof posts> {
        deleteMany() {
          return Promise.resolve([]);
        }
      }
      expect(() => Deletable(CollidingWithDeleteMany)).toThrow(FrameworkError);
    });

    test('Stacked application of SoftDeletable onto Deletable fails with MIXIN_COLLISION', () => {
      const HardBase = Deletable(RepositoryCore<typeof posts>);
      expect(() => SoftDeletable(HardBase)).toThrow(FrameworkError);
    });

    test('Stacked application of Deletable onto SoftDeletable fails with MIXIN_COLLISION', () => {
      const SoftBase = SoftDeletable(RepositoryCore<typeof posts>);
      expect(() => Deletable(SoftBase)).toThrow(FrameworkError);
    });
  });

  // =========================================================================
  // 2. AUTO-DETECTION & TABLE SHAPES
  // =========================================================================
  describe('Auto-detection Logic & Table Shapes', () => {
    test('Table WITH deletedAt property automatically resolves to BaseSoftDeletableRepository', () => {
      const ctx = getContext();
      const repo = baseRepository(posts, ctx);
      expect(repo).toBeInstanceOf(BaseSoftDeletableRepository);
      expect(repo.options.softDeleteColumn).toBe(posts.deletedAt);
    });

    test('Table WITHOUT deletedAt property automatically resolves to BaseRepository (hard-delete)', () => {
      const ctx = getContext();
      const repo = baseRepository(categories, ctx);
      expect(repo).toBeInstanceOf(BaseRepository);
      expect(repo).not.toBeInstanceOf(BaseSoftDeletableRepository);
      expect(repo.options.softDeleteColumn).toBeUndefined();
    });

    test('Table with custom column name (archivedAt) defaults to hard delete unless softDeleteColumn is specified', async () => {
      const ctx = getContext();

      // Without explicit option -> BaseRepository
      const defaultRepo = baseRepository(documents, ctx);
      expect(defaultRepo).toBeInstanceOf(BaseRepository);
      expect(defaultRepo).not.toBeInstanceOf(BaseSoftDeletableRepository);

      // With explicit softDeleteColumn -> BaseSoftDeletableRepository
      const customSoftRepo = baseRepository(documents, ctx, {
        softDeleteColumn: documents.archivedAt,
      }) as BaseSoftDeletableRepository<typeof documents>;
      expect(customSoftRepo).toBeInstanceOf(BaseSoftDeletableRepository);
      expect(customSoftRepo.options.softDeleteColumn).toBe(documents.archivedAt);

      // Live verification of custom column soft delete operations
      const doc = await customSoftRepo.create({ content: 'Confidential Spec' });
      expect(doc.id).toBeDefined();
      expect(doc.archivedAt).toBeNull();

      // Soft delete using custom column
      const deleteResult = await customSoftRepo.delete(doc.id);
      expect(deleteResult).toBe(true);

      // Verify active query excludes it
      expect(await customSoftRepo.findById(doc.id)).toBeNull();

      // Verify soft-deleted query finds it
      const deletedDoc = await customSoftRepo.findDeletedById(doc.id);
      expect(deletedDoc).not.toBeNull();
      expect(deletedDoc?.id).toBe(doc.id);
      expect(deletedDoc?.archivedAt).not.toBeNull();

      // Restore it
      const restoreResult = await customSoftRepo.restore(doc.id);
      expect(restoreResult).toBe(true);
      expect(await customSoftRepo.findDeletedById(doc.id)).toBeNull();
      expect(await customSoftRepo.findById(doc.id)).not.toBeNull();
    });

    test('Table with snake_case property name (deleted_at) works with explicit softDeleteColumn', async () => {
      const ctx = getContext();
      const repo = baseRepository(notes, ctx, {
        softDeleteColumn: notes.deleted_at,
      }) as BaseSoftDeletableRepository<typeof notes>;
      expect(repo).toBeInstanceOf(BaseSoftDeletableRepository);

      const note = await repo.create({ body: 'Secret Meeting Notes' });
      await repo.delete(note.id);

      const found = await repo.findDeletedById(note.id);
      expect(found).not.toBeNull();
      expect(found?.deleted_at).not.toBeNull();
      expect(await repo.findById(note.id)).toBeNull();
    });

    test('Passing deletedAt: null or undefined does not trigger false positive soft-delete', () => {
      const ctx = getContext();
      const dummyTableWithNull = {
        ...categories,
        deletedAt: null,
      } as unknown as typeof categories;

      const repo = baseRepository(dummyTableWithNull, ctx);
      expect(repo).toBeInstanceOf(BaseRepository);
      expect(repo).not.toBeInstanceOf(BaseSoftDeletableRepository);
    });

    test('Configuring softDeleteColumn from a FOREIGN table fails on write with SOFT_DELETE_MISCONFIGURED', async () => {
      const ctx = getContext();
      // Pass posts.deletedAt to categories table
      const mismatchedRepo = baseRepository(categories, ctx, {
        softDeleteColumn: posts.deletedAt as unknown as AnyPgColumn,
      });
      expect(mismatchedRepo).toBeInstanceOf(BaseSoftDeletableRepository);

      const cat = await mismatchedRepo.create({ name: 'Invalid Cat' });
      // Attempting to soft-delete must fail because softDeleteColumn is not on categories table
      await expect(mismatchedRepo.delete(cat.id)).rejects.toThrow(FrameworkError);
      try {
        await mismatchedRepo.delete(cat.id);
      } catch (err: unknown) {
        expect(err instanceof FrameworkError).toBe(true);
        const fErr = err as FrameworkError;
        expect(fErr.code).toBe('SOFT_DELETE_MISCONFIGURED');
        expect(fErr.message).toContain('softDeleteColumn is not a column of this table');
      }
    });

    test('Instantiating BaseSoftDeletableRepository without softDeleteColumn on table without deletedAt throws on call', async () => {
      const ctx = getContext();
      const repo = new BaseSoftDeletableRepository(categories, ctx);
      await expect(repo.findDeletedById(1)).rejects.toThrow(FrameworkError);
      try {
        await repo.findDeletedById(1);
      } catch (err: unknown) {
        expect(err instanceof FrameworkError).toBe(true);
        const fErr = err as FrameworkError;
        expect(fErr.code).toBe('SOFT_DELETE_MISCONFIGURED');
        expect(fErr.message).toContain('SoftDeletable requires options.softDeleteColumn');
      }
    });
  });

  // =========================================================================
  // 3. CURRIED USAGE baseRepository(table)(context)
  // =========================================================================
  describe('Curried Usage baseRepository(table)(context)', () => {
    test('baseRepository(table) returns factory that creates repository when given context', async () => {
      const curriedPosts = baseRepository(posts);
      expect(typeof curriedPosts).toBe('function');

      const ctx1 = getContext();
      const ctx2 = getContext();

      const repo1 = curriedPosts(ctx1);
      const repo2 = curriedPosts(ctx2);

      expect(repo1).toBeInstanceOf(BaseSoftDeletableRepository);
      expect(repo2).toBeInstanceOf(BaseSoftDeletableRepository);
      expect(repo1).not.toBe(repo2);
      expect(repo1.context).toBe(ctx1);
      expect(repo2.context).toBe(ctx2);
    });

    test('baseRepository(table, undefined, options) passes options to curried instances', () => {
      const curriedDocs = baseRepository(documents, undefined, {
        softDeleteColumn: documents.archivedAt,
      }) as (ctx: DataContext) => BaseSoftDeletableRepository<typeof documents>;
      expect(typeof curriedDocs).toBe('function');

      const ctx = getContext();
      const repo = curriedDocs(ctx);
      expect(repo).toBeInstanceOf(BaseSoftDeletableRepository);
      expect(repo.options.softDeleteColumn).toBe(documents.archivedAt);
    });

    test('curried baseRepository works with hard-delete tables', () => {
      const curriedCats = baseRepository(categories);
      const ctx = getContext();
      const repo = curriedCats(ctx);
      expect(repo).toBeInstanceOf(BaseRepository);
      expect(repo).not.toBeInstanceOf(BaseSoftDeletableRepository);
    });
  });

  // =========================================================================
  // 4. SOFT-DELETED QUERIES (findDeletedById, paginateDeleted, findManyDeleted)
  // =========================================================================
  describe('Soft-Deleted Queries: 0, 1, and Multiple Records', () => {
    test('State 0: Zero deleted rows', async () => {
      const ctx = getContext();
      const repo = baseRepository(posts, ctx) as BaseSoftDeletableRepository<typeof posts>;

      // Create 2 active rows only
      const p1 = await repo.create({ title: 'Zero-Test Active 1' });
      const p2 = await repo.create({ title: 'Zero-Test Active 2' });

      // findDeletedById on non-existent id
      expect(await repo.findDeletedById(999_999)).toBeNull();

      // findDeletedById on active ids MUST return null
      expect(await repo.findDeletedById(p1.id)).toBeNull();
      expect(await repo.findDeletedById(p2.id)).toBeNull();

      // paginateDeleted with filter for Zero-Test
      const page = await repo.paginateDeleted({ page: 1, limit: 10 }, { filters: [like(posts.title, 'Zero-Test%')] });
      expect(page.items).toHaveLength(0);
      expect(page.meta.total).toBe(0);
      expect(page.meta.totalPages).toBe(1);

      // findManyDeleted with filter
      const many = await repo.findManyDeleted({ filters: [like(posts.title, 'Zero-Test%')] });
      expect(many).toHaveLength(0);
    });

    test('State 1: Exactly 1 deleted row among active rows', async () => {
      const ctx = getContext();
      const repo = baseRepository(posts, ctx) as BaseSoftDeletableRepository<typeof posts>;

      const a1 = await repo.create({ title: 'Single-Test Active' });
      const d1 = await repo.create({ title: 'Single-Test Deleted' });

      await repo.delete(d1.id);

      // Verify active isolation
      expect(await repo.findById(d1.id)).toBeNull();
      expect(await repo.findById(a1.id)).not.toBeNull();

      // findDeletedById
      const foundDeleted = await repo.findDeletedById(d1.id);
      expect(foundDeleted).not.toBeNull();
      expect(foundDeleted?.id).toBe(d1.id);
      expect(foundDeleted?.title).toBe('Single-Test Deleted');
      expect(foundDeleted?.deletedAt).not.toBeNull();

      // paginateDeleted returns exactly 1
      const page = await repo.paginateDeleted({ page: 1, limit: 10 }, { filters: [like(posts.title, 'Single-Test%')] });
      expect(page.items).toHaveLength(1);
      expect(page.items[0]?.id).toBe(d1.id);
      expect(page.meta.total).toBe(1);
      expect(page.meta.totalPages).toBe(1);

      // findManyDeleted returns exactly 1
      const many = await repo.findManyDeleted({ filters: [like(posts.title, 'Single-Test%')] });
      expect(many).toHaveLength(1);
      expect(many[0]?.id).toBe(d1.id);
    });

    test('State 2: Multiple deleted rows with pagination, limit boundaries, and sorting', async () => {
      const ctx = getContext();
      const repo = baseRepository(posts, ctx) as BaseSoftDeletableRepository<typeof posts>;

      // Create 5 active posts and 5 deleted posts
      const activeTitles = ['Multi Active A', 'Multi Active B', 'Multi Active C', 'Multi Active D', 'Multi Active E'];
      for (const title of activeTitles) {
        await repo.create({ title });
      }

      const deletedTitles = [
        'Multi Del E-Echo',
        'Multi Del A-Alpha',
        'Multi Del C-Charlie',
        'Multi Del B-Bravo',
        'Multi Del D-Delta',
      ];
      const deletedIds: number[] = [];
      for (const title of deletedTitles) {
        const row = await repo.create({ title });
        await repo.delete(row.id);
        deletedIds.push(row.id);
      }

      // Test multi-page pagination: limit 2 over 5 items -> 3 pages
      const page1 = await repo.paginateDeleted(
        { page: 1, limit: 2 },
        {
          filters: [like(posts.title, 'Multi Del%')],
          sort: [{ column: posts.title, direction: 'asc' }],
        },
      );
      expect(page1.meta.total).toBe(5);
      expect(page1.meta.totalPages).toBe(3);
      expect(page1.items).toHaveLength(2);
      expect(page1.items[0]?.title).toBe('Multi Del A-Alpha');
      expect(page1.items[1]?.title).toBe('Multi Del B-Bravo');

      const page2 = await repo.paginateDeleted(
        { page: 2, limit: 2 },
        {
          filters: [like(posts.title, 'Multi Del%')],
          sort: [{ column: posts.title, direction: 'asc' }],
        },
      );
      expect(page2.meta.total).toBe(5);
      expect(page2.meta.totalPages).toBe(3);
      expect(page2.items).toHaveLength(2);
      expect(page2.items[0]?.title).toBe('Multi Del C-Charlie');
      expect(page2.items[1]?.title).toBe('Multi Del D-Delta');

      const page3 = await repo.paginateDeleted(
        { page: 3, limit: 2 },
        {
          filters: [like(posts.title, 'Multi Del%')],
          sort: [{ column: posts.title, direction: 'asc' }],
        },
      );
      expect(page3.meta.total).toBe(5);
      expect(page3.meta.totalPages).toBe(3);
      expect(page3.items).toHaveLength(1);
      expect(page3.items[0]?.title).toBe('Multi Del E-Echo');

      // Page 4: out of bounds
      const page4 = await repo.paginateDeleted(
        { page: 4, limit: 2 },
        {
          filters: [like(posts.title, 'Multi Del%')],
          sort: [{ column: posts.title, direction: 'asc' }],
        },
      );
      expect(page4.meta.total).toBe(5);
      expect(page4.items).toHaveLength(0);

      // Test sorting in DESC order
      const pageDesc = await repo.paginateDeleted(
        { page: 1, limit: 5 },
        {
          filters: [like(posts.title, 'Multi Del%')],
          sort: [{ column: posts.title, direction: 'desc' }],
        },
      );
      expect(pageDesc.items.map((i) => i.title)).toEqual([
        'Multi Del E-Echo',
        'Multi Del D-Delta',
        'Multi Del C-Charlie',
        'Multi Del B-Bravo',
        'Multi Del A-Alpha',
      ]);

      // Test findManyDeleted limit clamp
      const manyLimited = await repo.findManyDeleted({
        filters: [like(posts.title, 'Multi Del%')],
        limit: 3,
        sort: [{ column: posts.title, direction: 'asc' }],
      });
      expect(manyLimited).toHaveLength(3);
      expect(manyLimited.map((m) => m.title)).toEqual([
        'Multi Del A-Alpha',
        'Multi Del B-Bravo',
        'Multi Del C-Charlie',
      ]);

      // Cleanup: restore all 5
      const restored = await repo.restoreMany({ filters: [like(posts.title, 'Multi Del%')] });
      expect(restored).toHaveLength(5);
      for (const id of deletedIds) {
        expect(await repo.findDeletedById(id)).toBeNull();
        expect(await repo.findById(id)).not.toBeNull();
      }
    });
  });

  // =========================================================================
  // 5. IDEMPOTENCY & LIFECYCLE GUARDS
  // =========================================================================
  describe('Idempotency & Lifecycle Edge Cases', () => {
    test('delete(id) on already soft-deleted record returns false', async () => {
      const ctx = getContext();
      const repo = baseRepository(posts, ctx) as BaseSoftDeletableRepository<typeof posts>;

      const p = await repo.create({ title: 'Idempotent Delete' });
      expect(await repo.delete(p.id)).toBe(true);

      // Second delete must return false (no rows updated)
      expect(await repo.delete(p.id)).toBe(false);
    });

    test('restore(id) on already active record returns false', async () => {
      const ctx = getContext();
      const repo = baseRepository(posts, ctx) as BaseSoftDeletableRepository<typeof posts>;

      const p = await repo.create({ title: 'Idempotent Restore' });
      // Record is active, restore must return false
      expect(await repo.restore(p.id)).toBe(false);
    });

    test('restore(id) on non-existent record returns false', async () => {
      const ctx = getContext();
      const repo = baseRepository(posts, ctx) as BaseSoftDeletableRepository<typeof posts>;
      expect(await repo.restore(999_999)).toBe(false);
    });

    test('delete(id) on non-existent record returns false', async () => {
      const ctx = getContext();
      const repo = baseRepository(posts, ctx) as BaseSoftDeletableRepository<typeof posts>;
      expect(await repo.delete(999_999)).toBe(false);
    });

    test('deleteByIds with empty array returns empty array immediately', async () => {
      const ctx = getContext();
      const repo = baseRepository(posts, ctx) as BaseSoftDeletableRepository<typeof posts>;
      const result = await repo.deleteByIds([]);
      expect(result).toEqual([]);
    });

    test('Physical hard delete on BaseRepository completely removes row from database', async () => {
      const ctx = getContext();
      const repo = baseRepository(categories, ctx) as BaseRepository<typeof categories>;

      const cat = await repo.create({ name: 'Physical Delete Test' });
      expect(await repo.delete(cat.id)).toBe(true);

      // Verify row is physically gone from PostgreSQL
      const rawRows = await connection.sql`select * from adv_categories where id = ${cat.id}`;
      expect(rawRows.length).toBe(0);
    });

    test('Soft delete on BaseSoftDeletableRepository retains row in database with timestamp', async () => {
      const ctx = getContext();
      const repo = baseRepository(posts, ctx) as BaseSoftDeletableRepository<typeof posts>;

      const post = await repo.create({ title: 'Retained in Postgres' });
      expect(await repo.delete(post.id)).toBe(true);

      // Verify row physically exists in PostgreSQL
      const rawRows = await connection.sql`select * from adv_posts where id = ${post.id}`;
      expect(rawRows.length).toBe(1);
      expect(rawRows[0]?.deleted_at).not.toBeNull();
    });
  });
});
