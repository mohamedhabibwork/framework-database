import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { type AuditChanges, type AuditLogRow, auditLogs } from '../audit/audit-logs';
import { type Page, type PageRequest, toPage } from '../pagination/pagination';
import {
  type AuditAction,
  assertNoCollision,
  type KeyOf,
  type RepositoryConstructor,
  type RowChange,
  type TableOf,
  toJsonRow,
} from './core';

export interface AuditQuery {
  readonly action?: AuditAction;
  readonly actorId?: string;
}

/**
 * Records every create/update/delete/restore/import into `audit_logs` in the
 * same transaction as the change, attributed to the shared execution context
 * (actor + correlation id). Adds per-record and per-resource audit queries.
 */
export function Auditable<TBase extends RepositoryConstructor>(Base: TBase, resource: string) {
  assertNoCollision(Base, 'Auditable', ['auditTrail', 'auditLog']);

  abstract class AuditableRepository extends Base {
    protected override get tracksChanges(): boolean {
      return true;
    }

    protected override async afterWrite(change: RowChange<TableOf<TBase>>): Promise<void> {
      await super.afterWrite(change);
      const exclude = this.options.auditExclude ?? [];
      const before = change.before ? toJsonRow(change.before, exclude) : undefined;
      const after = change.after ? toJsonRow(change.after, exclude) : undefined;
      const fields =
        before && after
          ? Object.keys(after).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
          : undefined;
      const changes: AuditChanges = {
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
        ...(fields ? { fields } : {}),
      };
      const { actor, correlationId } = this.context.execution;
      await this.db.insert(auditLogs).values({
        resource,
        resourceId: String(change.id),
        action: change.action,
        actorId: actor.id,
        actorType: actor.type,
        correlationId,
        changes,
      });
    }

    /** Audit entries of one record, newest first. */
    auditTrail(id: KeyOf<TableOf<TBase>>, request: PageRequest, query: AuditQuery = {}): Promise<Page<AuditLogRow>> {
      return this.#page(request, [eq(auditLogs.resourceId, String(id)), ...this.#filters(query)]);
    }

    /** Audit entries of the whole resource, newest first. */
    auditLog(request: PageRequest, query: AuditQuery = {}): Promise<Page<AuditLogRow>> {
      return this.#page(request, this.#filters(query));
    }

    #filters(query: AuditQuery): SQL[] {
      return [
        ...(query.action ? [eq(auditLogs.action, query.action)] : []),
        ...(query.actorId ? [eq(auditLogs.actorId, query.actorId)] : []),
      ];
    }

    async #page(request: PageRequest, conditions: SQL[]): Promise<Page<AuditLogRow>> {
      const where = and(eq(auditLogs.resource, resource), ...conditions);
      const [rows, totals] = await Promise.all([
        this.db
          .select()
          .from(auditLogs)
          .where(where)
          .orderBy(desc(auditLogs.id))
          .limit(request.limit)
          .offset((request.page - 1) * request.limit),
        this.db.select({ total: count() }).from(auditLogs).where(where),
      ]);
      return toPage(rows, totals[0]?.total ?? 0, request);
    }
  }
  return AuditableRepository;
}
