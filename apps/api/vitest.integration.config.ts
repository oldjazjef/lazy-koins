import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests — the ones that talk to a real SQLite file with the real migrations.
 *
 * A separate config rather than a flag on the main one, because the two have different prerequisites:
 * `pnpm test` must pass with no database anywhere, while this needs the migrated test database (`pnpm ci:integration` does both)
 * first. Mixing them would mean either a suite that fails on a fresh checkout or a suite that quietly
 * skips the only tests able to prove owner scoping and the CHECK constraints.
 *
 * Same SWC setup as vitest.config.ts, and for the same reason: Nest DI needs
 * `emitDecoratorMetadata`, which esbuild does not emit.
 */
// Paths here are relative to the **repo root**, not to this file: `pnpm test:integration` passes
// `--config` from the root, and Vitest resolves its root from the working directory rather than from
// the config's location. `__dirname` is not an option — this file is loaded as CJS but written as ESM.
export default defineConfig({
  cacheDir: 'node_modules/.vite/apps/api-integration',
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    name: 'api-integration',
    environment: 'node',
    globals: true,
    include: ['apps/api/src/**/*.integration.spec.ts'],
    // One database, shared state: parallel files would race on the same rows.
    fileParallelism: false,
    passWithNoTests: false,
  },
});
