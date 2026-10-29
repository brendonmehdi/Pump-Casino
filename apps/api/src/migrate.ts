import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';
import { runMigrations } from './db/migrate';

// Run before each deploy (Railway pre-deploy command) and by `pnpm db:migrate` locally.
// This file sits one level below apps/api both as src/migrate.ts and as dist/migrate.js.
const config = loadConfig();
await runMigrations(config.databaseUrl, fileURLToPath(new URL('../drizzle', import.meta.url)));
process.stdout.write('Migrations applied.\n');
