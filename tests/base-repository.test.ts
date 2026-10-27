import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ExecutionContext, FrameworkError } from '@framework/core';
import { createTestDatabase, requireTestDatabaseUrl, type TestDatabase } from '@framework/testing';
import { eq, like } from 'drizzle-orm';
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import {
  BaseRepository,
  BaseSoftDeletableRepository,
  baseRepository,
  createConnection,
  type DatabaseConnection,
  type DataContext,
  RepositoryCore,
  SoftDeletable,
  TransactionContext,
} from '../src';

const articles = pgTable('articles', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
});

const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
});

const ACTOR = { id: 'admin-1', type: 'user' } as const;
const makeDataContext = (transactions: TransactionContext): DataContext => ({
  transactions,
  execution: new ExecutionContext('test', 'corr-base-repo', ACTOR),
});

let database: TestDatabase;
let connection: DatabaseConnection;

beforeAll(async () => {
  database = await createTestDatabase({ adminUrl: requireTestDatabaseUrl() });
  connection = createConnection({ url: database.url, maxConnections: 4 });
  await connection.sql`create table articles (id serial primary key, title text not null, deleted_at timestamptz)`;
  await connection.sql`create table tags (id serial primary key, name text not null)`;
});

afterAll(async () => {
  await connection?.close();
  await database?.drop();
});

const getContext = () => makeDataContext(new TransactionContext(connection.db));

describe('BaseRepository (hard-delete)', () => {
  test('performs CRUD operations on hard-delete tables', async () => {
    const ctx = getContext();
    const repo = new BaseRepository(tags, ctx);

    const tag1 = await repo.create({ name: 'typescript' });
    expect(tag1.id).toBeDefined();
    expect(tag1.name).toBe('typescript');

    const found = await repo.findById(tag1.id);
    expect(found?.name).toBe('typescript');

    const updated = await repo.update(tag1.id, { name: 'ts' });
    expect(updated?.name).toBe('ts');

    const page = await repo.paginate({ page: 1, limit: 10 });
    expect(page.items.some((t) => t.id === tag1.id)).toBe(true);
    expect(page.meta.total).toBeGreaterThanOrEqual(1);

    const deleted = await repo.delete(tag1.id);
    expect(deleted).toBe(true);

    const missing = await repo.findById(tag1.id);
    expect(missing).toBeNull();
  });

  test('batches and bulk operations function properly', async () => {
    const ctx = getContext();
    const repo = new BaseRepository(tags, ctx);

    const created = await repo.createMany([{ name: 'bulk-1' }, { name: 'bulk-2' }, { name: 'bulk-3' }]);
    expect(created.length).toBe(3);

    const updatedRows = await repo.updateMany({ name: 'bulk-updated' }, { filters: [like(tags.name, 'bulk-%')] });
    expect(updatedRows.length).toBeGreaterThanOrEqual(3);

    const many = await repo.findMany({ filters: [eq(tags.name, 'bulk-updated')] });
    expect(many.length).toBeGreaterThanOrEqual(3);

    const ids: number[] = [];
    for await (const batch of repo.batches(2, { filters: [eq(tags.name, 'bulk-updated')] })) {
      ids.push(...batch.map((b) => b.id));
    }
    expect(ids.length).toBeGreaterThanOrEqual(3);

    const deletedIds = await repo.deleteByIds(created.map((c) => c.id));
    expect(deletedIds.length).toBe(3);
  });
});

describe('BaseSoftDeletableRepository & SoftDeletable extensions', () => {
  test('soft delete hides rows from active queries and findDeletedById/paginateDeleted retrieves them', async () => {
    const ctx = getContext();
    const repo = new BaseSoftDeletableRepository(articles, ctx);

    const a1 = await repo.create({ title: 'Active Post 1' });
    const a2 = await repo.create({ title: 'Active Post 2' });

    expect(await repo.delete(a1.id)).toBe(true);

    // Active queries must NOT see a1
    expect(await repo.findById(a1.id)).toBeNull();
    const activePage = await repo.paginate({ page: 1, limit: 10 });
    expect(activePage.items.some((a) => a.id === a1.id)).toBe(false);
    expect(activePage.items.some((a) => a.id === a2.id)).toBe(true);

    // Soft-deleted queries MUST see a1
    const deletedRow = await repo.findDeletedById(a1.id);
    expect(deletedRow).not.toBeNull();
    expect(deletedRow?.id).toBe(a1.id);
    expect(deletedRow?.title).toBe('Active Post 1');
    expect(deletedRow?.deletedAt).not.toBeNull();

    // Soft-deleted pagination MUST see a1
    const deletedPage = await repo.paginateDeleted({ page: 1, limit: 10 });
    expect(deletedPage.items.some((a) => a.id === a1.id)).toBe(true);
    expect(deletedPage.items.some((a) => a.id === a2.id)).toBe(false);

    // findManyDeleted with filters
    const foundDeleted = await repo.findManyDeleted({ filters: [eq(articles.title, 'Active Post 1')] });
    expect(foundDeleted.some((a) => a.id === a1.id)).toBe(true);

    // Restore brings it back to active
    expect(await repo.restore(a1.id)).toBe(true);
    expect(await repo.findDeletedById(a1.id)).toBeNull();
    const restoredRow = await repo.findById(a1.id);
    expect(restoredRow?.title).toBe('Active Post 1');
    expect(restoredRow?.deletedAt).toBeNull();
  });

  test('restoreMany restores multiple soft-deleted records', async () => {
    const ctx = getContext();
    const repo = new BaseSoftDeletableRepository(articles, ctx);

    const b1 = await repo.create({ title: 'Restore Bulk 1' });
    const b2 = await repo.create({ title: 'Restore Bulk 2' });

    await repo.delete(b1.id);
    await repo.delete(b2.id);

    expect(await repo.findDeletedById(b1.id)).not.toBeNull();
    expect(await repo.findDeletedById(b2.id)).not.toBeNull();

    const restoredIds = await repo.restoreMany({ filters: [like(articles.title, 'Restore Bulk%')] });
    expect(restoredIds).toContain(b1.id);
    expect(restoredIds).toContain(b2.id);

    expect(await repo.findById(b1.id)).not.toBeNull();
    expect(await repo.findById(b2.id)).not.toBeNull();
  });

  test('SoftDeletable asserts collision for new methods', () => {
    class DummyRepository extends RepositoryCore<typeof articles> {
      findDeletedById() {
        return null;
      }
    }
    expect(() => SoftDeletable(DummyRepository)).toThrow(FrameworkError);
  });
});

describe('baseRepository factory', () => {
  test('automatically creates BaseSoftDeletableRepository for tables with deletedAt', () => {
    const ctx = getContext();
    const repo = baseRepository(articles, ctx);
    expect(repo).toBeInstanceOf(BaseSoftDeletableRepository);
  });

  test('automatically creates BaseRepository for tables without deletedAt', () => {
    const ctx = getContext();
    const repo = baseRepository(tags, ctx);
    expect(repo).toBeInstanceOf(BaseRepository);
    expect(repo).not.toBeInstanceOf(BaseSoftDeletableRepository);
  });

  test('supports explicit softDeleteColumn option overriding auto-detection', () => {
    const ctx = getContext();
    const repo = baseRepository(articles, ctx, { softDeleteColumn: articles.deletedAt });
    expect(repo).toBeInstanceOf(BaseSoftDeletableRepository);
  });

  test('supports currying (context: DataContext) => repository', () => {
    const ctx = getContext();
    const curriedArticles = baseRepository(articles);
    expect(typeof curriedArticles).toBe('function');
    const repoArticles = curriedArticles(ctx);
    expect(repoArticles).toBeInstanceOf(BaseSoftDeletableRepository);

    const curriedTags = baseRepository(tags);
    expect(typeof curriedTags).toBe('function');
    const repoTags = curriedTags(ctx);
    expect(repoTags).toBeInstanceOf(BaseRepository);
  });
});
