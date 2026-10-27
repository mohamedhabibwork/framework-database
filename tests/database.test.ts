import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ExecutionContext } from '@framework/core';
import { createTestDatabase, requireTestDatabaseUrl, type TestDatabase } from '@framework/testing';
import { eq, like } from 'drizzle-orm';
import { pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';
import {
  Auditable,
  type AuditLogRow,
  Creatable,
  createConnection,
  type DatabaseConnection,
  type DataContext,
  Deletable,
  Readable,
  RepositoryCore,
  SoftDeletable,
  TransactionContext,
  Updatable,
} from '../src';

const widgets = pgTable('widgets', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  // String mode, as generated tables use; soft delete must not send a JS Date here.
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'string' }),
});

class WidgetRepository extends SoftDeletable(Updatable(Creatable(Readable(RepositoryCore<typeof widgets>)))) {}
class AuditedWidgetRepository extends Auditable(
  SoftDeletable(Updatable(Creatable(Readable(RepositoryCore<typeof widgets>)))),
  'widgets',
) {}

const ACTOR = { id: 'user-1', type: 'user' } as const;
const dataContext = (transactions: TransactionContext): DataContext => ({
  transactions,
  execution: new ExecutionContext('test', 'corr-1', ACTOR),
});

let database: TestDatabase;
let connection: DatabaseConnection;

beforeAll(async () => {
  database = await createTestDatabase({ adminUrl: requireTestDatabaseUrl() });
  connection = createConnection({ url: database.url, maxConnections: 4 });
  await connection.sql`create table widgets (id serial primary key, name text not null, deleted_at timestamptz)`;
  await connection.sql`create table audit_logs (
    id bigserial primary key, resource text not null, resource_id text not null, action text not null,
    actor_id text, actor_type text not null, correlation_id text not null, changes jsonb not null,
    created_at timestamptz not null default now())`;
});

afterAll(async () => {
  await connection?.close();
  await database?.drop();
});

const repository = () =>
  new WidgetRepository(widgets, dataContext(new TransactionContext(connection.db)), {
    softDeleteColumn: widgets.deletedAt,
  });

describe('CRUD mixins against PostgreSQL', () => {
  test('soft delete hides rows from reads/updates and restore brings them back', async () => {
    const repo = repository();
    const widget = await repo.create({ name: 'gear' });

    expect(await repo.delete(widget.id)).toBe(true);
    expect(await repo.findById(widget.id)).toBeNull();
    expect(await repo.update(widget.id, { name: 'hidden' })).toBeNull();
    expect(await repo.delete(widget.id)).toBe(false);
    const page = await repo.paginate({ page: 1, limit: 100 });
    expect(page.items.map((w) => w.id)).not.toContain(widget.id);

    const [raw] = await connection.sql<{ deleted: boolean }[]>`
      select deleted_at is not null as deleted from widgets where id = ${widget.id}`;
    expect(raw?.deleted).toBe(true);

    expect(await repo.restore(widget.id)).toBe(true);
    expect((await repo.findById(widget.id))?.name).toBe('gear');
  });

  test('pagination is bounded, ordered by id and counts visible rows', async () => {
    const repo = repository();
    for (const name of ['a', 'b', 'c']) await repo.create({ name });
    const first = await repo.paginate({ page: 1, limit: 2 });
    const second = await repo.paginate({ page: 2, limit: 2 });
    const ids = [...first.items, ...second.items].map((w) => w.id);
    expect(ids).toEqual([...ids].sort((x, y) => x - y));
    expect(first.meta.total).toBe(second.meta.total);
  });

  test('findMany, count and exists honor filters and limits', async () => {
    const repo = repository();
    for (const name of ['keep-1', 'keep-2', 'drop-me']) await repo.create({ name });
    expect(await repo.count()).toBeGreaterThanOrEqual(3);
    expect(await repo.count({ filters: [like(widgets.name, 'keep-%')] })).toBe(2);
    expect(await repo.exists({ filters: [eq(widgets.name, 'keep-1')] })).toBe(true);
    expect(await repo.exists({ filters: [eq(widgets.name, 'missing')] })).toBe(false);
    const found = await repo.findMany({ filters: [like(widgets.name, 'keep-%')], limit: 1 });
    expect(found).toHaveLength(1);
  });

  test('updateMany changes every matching row and skips filtered-out ones', async () => {
    const repo = repository();
    const keep = await repo.create({ name: 'bulk-keep' });
    const drop = await repo.create({ name: 'bulk-drop' });
    const updated = await repo.updateMany({ name: 'bulk-renamed' }, { filters: [like(widgets.name, 'bulk-keep%')] });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.id).toBe(keep.id);
    expect((await repo.findById(drop.id))?.name).toBe('bulk-drop');
  });

  test('deleteMany removes matching rows and reports their ids', async () => {
    const repo = repository();
    await repo.create({ name: 'del-1' });
    await repo.create({ name: 'del-2' });
    await repo.create({ name: 'del-keep' });
    const ids = await repo.deleteMany({ filters: [like(widgets.name, 'del-%')] });
    expect(ids.length).toBeGreaterThanOrEqual(2);
    expect(await repo.count({ filters: [like(widgets.name, 'del-%')] })).toBe(0);
    expect(await repo.findById(ids[0] as number)).toBeNull();
    // Soft-deleted rows come back with restoreMany.
    const restored = await repo.restoreMany({ filters: [like(widgets.name, 'del-%')] });
    expect(restored.length).toBeGreaterThanOrEqual(2);
    expect(await repo.exists({ filters: [eq(widgets.name, 'del-1')] })).toBe(true);
  });

  test('mixins that provide the same method cannot be combined', () => {
    expect(() => SoftDeletable(Deletable(Readable(RepositoryCore<typeof widgets>)))).toThrow(/MIXIN|already provided/);
  });
});

describe('TransactionContext', () => {
  test('rejected callback rolls back every write in the transaction', async () => {
    const transactions = new TransactionContext(connection.db);
    const repo = new WidgetRepository(widgets, dataContext(transactions), { softDeleteColumn: widgets.deletedAt });

    await expect(
      transactions.transaction(async () => {
        await repo.create({ name: 'rolled-back' });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');

    const rows = await connection.sql`select 1 from widgets where name = 'rolled-back'`;
    expect(rows).toHaveLength(0);
  });

  test('nested transaction is a savepoint: inner failure caught by outer keeps outer writes', async () => {
    const transactions = new TransactionContext(connection.db);
    const repo = new WidgetRepository(widgets, dataContext(transactions), { softDeleteColumn: widgets.deletedAt });

    await transactions.transaction(async () => {
      await repo.create({ name: 'outer' });
      await transactions
        .transaction(async () => {
          await repo.create({ name: 'inner' });
          throw new Error('inner abort');
        })
        .catch(() => undefined);
    });

    const names = (
      await connection.sql<{ name: string }[]>`select name from widgets where name in ('outer', 'inner')`
    ).map((r) => r.name);
    expect(names).toEqual(['outer']);
  });

  test('concurrent async branches do not share a transaction', async () => {
    const transactions = new TransactionContext(connection.db);
    const seen: boolean[] = [];
    await Promise.all([
      transactions.transaction(async () => {
        await Bun.sleep(5);
        seen.push(transactions.inTransaction);
      }),
      (async () => {
        await Bun.sleep(1);
        seen.push(transactions.inTransaction);
      })(),
    ]);
    expect(seen.sort()).toEqual([false, true]);
  });
});

describe('Auditable', () => {
  const audited = (transactions = new TransactionContext(connection.db)) =>
    new AuditedWidgetRepository(widgets, dataContext(transactions), { softDeleteColumn: widgets.deletedAt });

  test('records create/update/delete/restore with actor, correlation id and field diff', async () => {
    const repo = audited();
    const widget = await repo.create({ name: 'audited' });
    await repo.update(widget.id, { name: 'renamed' });
    await repo.delete(widget.id);
    await repo.restore(widget.id);

    const trail = await repo.auditTrail(widget.id, { page: 1, limit: 10 });
    expect(trail.items.map((e: AuditLogRow) => e.action)).toEqual(['restored', 'deleted', 'updated', 'created']);
    const updated = trail.items[2] as AuditLogRow;
    expect(updated).toMatchObject({
      actorId: 'user-1',
      actorType: 'user',
      correlationId: 'corr-1',
      resource: 'widgets',
    });
    expect(updated.changes.fields).toEqual(['name']);
    expect(updated.changes.before).toMatchObject({ name: 'audited' });
    expect(updated.changes.after).toMatchObject({ name: 'renamed' });

    const log = await repo.auditLog({ page: 1, limit: 100 }, { action: 'created' });
    expect(log.items.every((e: AuditLogRow) => e.action === 'created')).toBe(true);
  });

  test('audit rows roll back with the failed transaction', async () => {
    const transactions = new TransactionContext(connection.db);
    const repo = audited(transactions);
    await expect(
      transactions.transaction(async () => {
        await repo.create({ name: 'ghost' });
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    const rows = await connection.sql`select 1 from audit_logs where changes->'after'->>'name' = 'ghost'`;
    expect(rows).toHaveLength(0);
  });

  test('updates of missing rows write nothing', async () => {
    expect(await audited().update(999_999, { name: 'x' })).toBeNull();
  });
});
