import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/db/migrate';
import { MIGRATIONS_FOLDER, TEST_DATABASE_URL } from './support';

async function appliedMigrations(): Promise<number> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ n: number }>(
      'select count(*)::int as n from drizzle.__drizzle_migrations',
    );
    return rows[0]?.n ?? 0;
  } finally {
    await client.end();
  }
}

// Production runs the migrations at every container start, so they must be safe to repeat.
describe('runMigrations', () => {
  it('does nothing on an up-to-date database, even when two instances start at once', async () => {
    const before = await appliedMigrations();
    expect(before).toBeGreaterThan(0);
    await Promise.all([
      runMigrations(TEST_DATABASE_URL, MIGRATIONS_FOLDER),
      runMigrations(TEST_DATABASE_URL, MIGRATIONS_FOLDER),
    ]);
    expect(await appliedMigrations()).toBe(before);
  });

  it('keeps retrying while the database is unreachable, then gives up', async () => {
    const retries: unknown[] = [];
    await expect(
      runMigrations('postgres://pump:unused@127.0.0.1:1/pump_test', MIGRATIONS_FOLDER, {
        waitForDatabaseMs: 5_000,
        retryDelayMs: 50,
        onRetry: (error) => retries.push(error),
      }),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
    expect(retries.length).toBeGreaterThan(0);
  });

  it('fails at once on a wrong password instead of waiting', async () => {
    const url = new URL(TEST_DATABASE_URL);
    url.password = 'wrong-password';
    const retries: unknown[] = [];
    await expect(
      runMigrations(url.toString(), MIGRATIONS_FOLDER, {
        onRetry: (error) => retries.push(error),
      }),
    ).rejects.toMatchObject({ code: '28P01' });
    expect(retries).toEqual([]);
  });
});
