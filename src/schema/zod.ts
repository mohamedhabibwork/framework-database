/**
 * Central Drizzle–Zod compatibility adapter. Generated CRUD imports schema
 * factories only from here, so switching between the standalone
 * `drizzle-zod` package and `drizzle-orm/zod` is a one-file change.
 * Pinned and verified: drizzle-zod 0.8.3 with zod 4.6.5.
 */
export { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
