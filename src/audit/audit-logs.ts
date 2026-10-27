import type { JsonObject } from '@framework/core';
import type { InferSelectModel } from 'drizzle-orm';
import { bigserial, index, jsonb, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';
import type { AuditAction } from '../mixins/core';

export interface AuditChanges {
  readonly before?: JsonObject;
  readonly after?: JsonObject;
  /** Fields whose values differ (updates only). */
  readonly fields?: readonly string[];
}

export const AUDIT_ACTIONS = [
  'created',
  'updated',
  'deleted',
  'restored',
  'imported',
] as const satisfies readonly AuditAction[];

/**
 * Framework-owned audit trail. Applications re-export it from their schema
 * index so Drizzle Kit generates its migration with the app's other tables.
 */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    resource: varchar('resource', { length: 255 }).notNull(),
    resourceId: text('resource_id').notNull(),
    action: varchar('action', { length: 50, enum: AUDIT_ACTIONS }).notNull(),
    actorId: text('actor_id'),
    actorType: varchar('actor_type', { length: 50 }).notNull(),
    correlationId: text('correlation_id').notNull(),
    changes: jsonb('changes').$type<AuditChanges>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_resource_id_idx').on(table.resource, table.resourceId, table.id),
    index('audit_logs_resource_idx').on(table.resource, table.id),
  ],
);

export type AuditLogRow = InferSelectModel<typeof auditLogs>;
