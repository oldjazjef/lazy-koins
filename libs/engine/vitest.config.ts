import { defineConfig } from 'vitest/config';

/**
 * Vitest for the pure engine: plain Node, no DOM, no framework. The golden test
 * (src/golden/golden.spec.ts) is part of this run and skips itself when private/ is absent.
 */
export default defineConfig({
  cacheDir: '../../node_modules/.vite/libs/engine',
  test: {
    name: 'engine',
    environment: 'node',
    globals: true,
    include: ['src/**/*.spec.ts'],
    passWithNoTests: false,
  },
});
