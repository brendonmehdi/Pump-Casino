import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { buildApp } from './http/app';
import { GameService } from './services/game-service';

const config = loadConfig();
const { db, pool } = createDatabase(config.databaseUrl, config.databasePoolMax);
const app = await buildApp({
  config,
  service: new GameService(db),
  pingDatabase: async () => {
    await pool.query('select 1');
  },
});

// An idle pooled connection can fail (e.g. the database restarts); log it instead of crashing.
pool.on('error', (error) => {
  app.log.error({ err: error }, 'idle database connection error');
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(() => pool.end())
      .then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error({ err: error }, 'shutdown failed');
          process.exit(1);
        },
      );
  });
}

await app.listen({ host: config.host, port: config.port });
