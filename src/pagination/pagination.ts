import { z } from 'zod/v4';

export interface PaginationLimits {
  readonly defaultLimit: number;
  readonly maxLimit: number;
}

export const DEFAULT_PAGINATION: PaginationLimits = { defaultLimit: 20, maxLimit: 100 };

/** Bounded page/limit query schema. Out-of-range values fail validation (422) instead of being clamped. */
export function paginationQuerySchema(limits: PaginationLimits = DEFAULT_PAGINATION) {
  return z.object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    limit: z.coerce.number().int().min(1).max(limits.maxLimit).default(limits.defaultLimit),
  });
}

export type PageRequest = z.output<ReturnType<typeof paginationQuerySchema>>;

export interface PageMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly meta: PageMeta;
}

/** Response schema for a page of items (documentation and response validation). */
export function pageSchema<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    meta: z.object({
      page: z.number().int(),
      limit: z.number().int(),
      total: z.number().int(),
      totalPages: z.number().int(),
    }),
  });
}

export function toPage<T>(items: readonly T[], total: number, request: PageRequest): Page<T> {
  return {
    items,
    meta: {
      page: request.page,
      limit: request.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / request.limit)),
    },
  };
}

export function mapPage<T, U>(page: Page<T>, map: (item: T) => U): Page<U> {
  return { items: page.items.map(map), meta: page.meta };
}
