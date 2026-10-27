import type { ExecutionContext } from '@framework/core';

/**
 * A named, explicitly registered unit of seed data. Seeders run in list
 * order via `db:seed`; each receives a runtime context for audit-attributed
 * writes. Registered in the app's seeder registry (see the `seeders` CLI
 * hook) and shared with tests, which can run a subset by name.
 */
export interface Seeder {
  readonly name: string;
  run(context: SeedContext): Promise<void>;
}

/** Handed to every seeder: who runs it and an optional log sink. */
export interface SeedContext {
  readonly execution: ExecutionContext;
  /** Progress line for `db:seed` output (no-op in tests unless wired). */
  log(message: string): void;
}

/** Declares a seeder; identity comes from the name. */
export const defineSeeder = (seeder: Seeder): Seeder => seeder;

/**
 * A record builder for tests and seeders: `make` returns in-memory rows,
 * `create` persists them through the injected sink and returns what the
 * sink produced (typically the repository row with generated ids). The same
 * factory definitions back both seed data and test fixtures, so shapes
 * cannot drift between environments.
 */
export interface Factory<TAttributes, TRow = TAttributes> {
  /** Overrides are merged over the generated attributes. */
  make(overrides?: Partial<TAttributes>): TAttributes;
  create(overrides?: Partial<TAttributes>): Promise<TRow>;
  /** Sequential builds share one counter (useful for unique fields). */
  readonly sequence: () => number;
}

export const defineFactory = <TAttributes, TRow = TAttributes>(options: {
  /** Generates one attribute set; `n` is a 1-based build counter. */
  definition: (n: number) => TAttributes;
  /** Persists one attribute set (a repository or direct insert). */
  persist?: (attributes: TAttributes) => Promise<TRow>;
}): Factory<TAttributes, TRow> => {
  let counter = 0;
  return {
    make(overrides?: Partial<TAttributes>): TAttributes {
      counter += 1;
      return { ...options.definition(counter), ...overrides };
    },
    async create(overrides?: Partial<TAttributes>): Promise<TRow> {
      const attributes = { ...this.make(overrides) };
      if (!options.persist) throw new Error('defineFactory: no persist function; use make() instead');
      return options.persist(attributes);
    },
    sequence: () => counter,
  };
};
