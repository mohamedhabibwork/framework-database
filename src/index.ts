// Public API of @framework/database.
// Convention: every interface/type lives in `./types`, every constant in
// `./constants`; runtime values (classes, functions, mixins) stay in their modules.
export { auditLogs } from './audit/audit-logs';
export { AuditReader, auditActionSchema, auditQuerySchema } from './audit/reader';
export { createConnection, pingDatabase } from './connections/connection';
export {
  AUDIT_ACTIONS,
  AUDIT_READER,
  DATA_CONTEXT,
  DATABASE,
  DEFAULT_PAGINATION,
  TRANSACTION_CONTEXT,
} from './constants';
// Grouped conventions: every interface/type lives in `./types`, every constant in
// `./constants`; runtime values stay in their modules.
export type { Factory, SeedContext, Seeder } from './factories';
export { defineFactory, defineSeeder } from './factories';
export { migrationStatus, runMigrations } from './migrations/migrations';
export { Auditable } from './mixins/auditable';
export { assertNoCollision, RepositoryCore, toJsonRow } from './mixins/core';
export { Creatable } from './mixins/creatable';
export { Deletable } from './mixins/deletable';
export { Readable } from './mixins/readable';
export { SoftDeletable } from './mixins/soft-deletable';
export { Updatable } from './mixins/updatable';
export { mapPage, pageSchema, paginationQuerySchema, toPage } from './pagination/pagination';
export { BaseRepository, BaseSoftDeletableRepository, baseRepository } from './repository/base-repository';
export { toIsoTimestamp, toIsoTimestampOrNull } from './schema/timestamps';
export { createInsertSchema, createSelectSchema, createUpdateSchema } from './schema/zod';
export { TransactionContext } from './transactions/transaction-context';
export type {
  AuditAction,
  AuditChanges,
  AuditFilters,
  AuditLogRow,
  AuditQuery,
  AuditTrailQuery,
  ConnectionOptions,
  CrudTable,
  Database,
  DatabaseConnection,
  DataContext,
  DbExecutor,
  FindManyOptions,
  InsertOf,
  KeyOf,
  MigrationState,
  Page,
  PageMeta,
  PageRequest,
  PaginationLimits,
  QueryOptions,
  RepositoryOptions,
  RowChange,
  SelectOf,
  SortSpec,
  TableOf,
} from './types';
