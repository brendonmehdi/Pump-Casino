import { setTimeout as sleep } from 'node:timers/promises';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const MIGRATION_LOCK_ID = 4_242_017;
/** A wrong password, an unauthorized user or a missing database won't fix itself by waiting. */
const PERMANENT_CONNECT_ERRORS = new Set(['28P01', '28000', '3D000']);

export interface MigrationOptions {
  /** How long to keep trying while the database isn't accepting connections yet. */
  readonly waitForDatabaseMs?: number;
  readonly retryDelayMs?: number;
  readonly onRetry?: (error: unknown) => void;
}

/**
 * Applies pending migrations on one dedicated connection while holding a session advisory lock,
 * so two instances starting at once cannot run the same migration concurrently. Closing the
 * connection releases the lock, including when a migration fails. Already-applied migrations
 * are skipped, so running this on every start is safe.
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder: string,
  options: MigrationOptions = {},
): Promise<void> {
  const client = await connectWhenReady(connectionString, options);
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end();
  }
}

/** On a fresh deploy the app can start before its database accepts connections. */
async function connectWhenReady(
  connectionString: string,
  { waitForDatabaseMs = 120_000, retryDelayMs = 3_000, onRetry }: MigrationOptions,
): Promise<pg.Client> {
  const deadline = Date.now() + waitForDatabaseMs;
  for (;;) {
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end().catch(() => undefined);
      const code = (error as { code?: unknown }).code;
      const permanent = typeof code === 'string' && PERMANENT_CONNECT_ERRORS.has(code);
      if (permanent || Date.now() + retryDelayMs > deadline) throw error;
      onRetry?.(error);
      await sleep(retryDelayMs);
    }
  }
}
