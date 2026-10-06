import { resolve } from 'node:path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Vitest for the NestJS app.
 *
 * The SWC plugin is not optional here: esbuild — Vite's default transformer — does not emit
 * `emitDecoratorMetadata`, and without that metadata Nest cannot resolve constructor parameters
 * by type, so every injected dependency arrives as `undefined`. SWC emits it.
 *
 * Vitest rather than Jest keeps one test runner in the repo (see the root CLAUDE.md); the Nx Nest
 * generator was run with `--unitTestRunner=none` for that reason.
 */
export default defineConfig({
  // No explicit `root`: the Nx target runs with `cwd: apps/api`, so the default is already right,
  // and referencing `__dirname` here would make this ESM file depend on CJS globals.
  cacheDir: '../../node_modules/.vite/apps/api',
  // The engine is consumed through the tsconfig path alias (no build of its own), as webpack does.
  resolve: {
    alias: {
      '@lazykoins/engine': resolve(__dirname, '../../libs/engine/src/index.ts'),
    },
  },
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
    name: 'api',
    environment: 'node',
    globals: true,
    include: ['src/**/*.spec.ts'],
    // `*.integration.spec.ts` needs a migrated SQLite file, so it is not part of the default run —
    // `pnpm test` has to stay runnable on a fresh checkout, or nobody runs it. Those specs are what
    // actually prove the owner scoping and the CHECK constraints a port double can only assert
    // about; run them with `pnpm ci:integration`.
    exclude: ['src/**/*.integration.spec.ts'],
    passWithNoTests: false,
    // `ConfigModule.forRoot` validates the environment when app.module.ts is *imported*, so the
    // module-graph spec needs a valid one before any test code runs. Placeholders only: nothing in
    // the unit suite connects to a database or to Firebase. A developer's real values still win.
    env: {
      DATABASE_URL:
        process.env['DATABASE_URL'] ?? 'file:./tmp/unit-tests-never-opened.db',
      AUTH_MODE: process.env['AUTH_MODE'] ?? 'dev',
    },
  },
});
