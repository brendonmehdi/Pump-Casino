import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export function createDatabase(connectionString: string, maxConnections: number) {
  const pool = new pg.Pool({
    connectionString,
    max: maxConnections,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  return { pool, db: drizzle({ client: pool, schema }) };
}

export type Database = ReturnType<typeof createDatabase>['db'];
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
/** Anything that can run queries: the pool-backed database or an open transaction. */
export type Queryable = Database | Transaction;
