import { fileURLToPath } from 'node:url';
import { loadConfig } from './config';
import { runMigrations } from './db/migrate';

// Runs at every container start, before the server (see the Dockerfile), and by
// `pnpm db:migrate` locally. This file sits one level below apps/api both as src/migrate.ts and
// as dist/migrate.js.
const config = loadConfig();
await runMigrations(config.databaseUrl, fileURLToPath(new URL('../drizzle', import.meta.url)), {
  onRetry: (error) => {
    const reason = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Database not reachable yet (${reason}); retrying.\n`);
  },
});
process.stdout.write('Migrations applied.\n');
