import { defineConfig } from 'drizzle-kit';

// Used only by `drizzle-kit generate`, which diffs the schema file against earlier migrations
// and needs no database connection. Migrations are applied by src/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
});
