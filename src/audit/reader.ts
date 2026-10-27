import { token } from '@framework/core';
import { and, count, desc, eq, type SQL } from 'drizzle-orm';
import { z } from 'zod/v4';
import type { AuditAction } from '../mixins/core';
import { type Page, type PageRequest, paginationQuerySchema, toPage } from '../pagination/pagination';
import type { DbExecutor } from '../transactions/transaction-context';
import { AUDIT_ACTIONS, type AuditLogRow, auditLogs } from './audit-logs';

export interface AuditFilters {
  readonly resource?: string;
  readonly resourceId?: string;
  readonly action?: AuditAction;
  readonly actorId?: string;
  readonly correlationId?: string;
}

export const auditActionSchema = z.enum(AUDIT_ACTIONS);

/** Bounded, allowlisted query for the audit trail endpoints. */
export const auditQuerySchema = paginationQuerySchema().extend({
  resource: z.string().min(1).max(120).optional(),
  resourceId: z.string().min(1).max(200).optional(),
  action: auditActionSchema.optional(),
  actorId: z.string().min(1).max(200).optional(),
  correlationId: z.string().min(1).max(200).optional(),
});

export type AuditTrailQuery = z.output<typeof auditQuerySchema>;

/**
 * Reads the framework-owned audit trail across resources. Repositories with
 * the `Auditable` mixin write the rows; this reader serves audit endpoints
 * (list, per-entity, per-actor, by correlation id).
 */
export class AuditReader {
  constructor(private readonly db: DbExecutor) {}

  async findById(id: number): Promise<AuditLogRow | null> {
    const rows = await this.db.select().from(auditLogs).where(eq(auditLogs.id, id)).limit(1);
    return rows[0] ?? null;
  }

  async page(request: PageRequest, filters: AuditFilters = {}): Promise<Page<AuditLogRow>> {
    const where = this.#where(filters);
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

  #where(filters: AuditFilters): SQL | undefined {
    const conditions: SQL[] = [
      ...(filters.resource ? [eq(auditLogs.resource, filters.resource)] : []),
      ...(filters.resourceId ? [eq(auditLogs.resourceId, filters.resourceId)] : []),
      ...(filters.action ? [eq(auditLogs.action, filters.action)] : []),
      ...(filters.actorId ? [eq(auditLogs.actorId, filters.actorId)] : []),
      ...(filters.correlationId ? [eq(auditLogs.correlationId, filters.correlationId)] : []),
    ];
    return conditions.length > 0 ? and(...conditions) : undefined;
  }
}

export const AUDIT_READER = token<AuditReader>('database.audit-reader');
