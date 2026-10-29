import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const MIGRATION_LOCK_ID = 4_242_017;

/**
 * Applies pending migrations on one dedicated connection while holding a session advisory lock,
 * so two instances starting at once cannot run the same migration concurrently. Closing the
 * connection releases the lock, including when a migration fails.
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder: string,
): Promise<void> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await migrate(drizzle({ client }), { migrationsFolder });
  } finally {
    await client.end();
  }
}
