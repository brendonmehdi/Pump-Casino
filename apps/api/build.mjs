import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

/**
 * Bundles the server and migration entry points. Workspace packages (@pump/*) are TypeScript
 * sources and are compiled into the bundle, along with their own dependencies; the API's direct
 * npm dependencies stay external and load from node_modules at runtime.
 */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((name) => !name.startsWith('@pump/'));

await build({
  entryPoints: ['src/server.ts', 'src/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
});
