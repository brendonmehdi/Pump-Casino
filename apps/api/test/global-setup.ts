import pg from 'pg';
import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS_FOLDER, TEST_DATABASE_URL, assertTestDatabase } from './support';

/** Rebuilds the test database from zero, proving the migrations apply cleanly every run. */
export default async function setup(): Promise<void> {
  assertTestDatabase(TEST_DATABASE_URL);
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await client.query('drop schema if exists drizzle cascade');
    await client.query('drop schema if exists public cascade');
    await client.query('create schema public');
  } finally {
    await client.end();
  }
  await runMigrations(TEST_DATABASE_URL, MIGRATIONS_FOLDER);
}
