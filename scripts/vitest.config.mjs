import { defineConfig } from 'vitest/config';

/** Tests of the build scripts (scripts/build/*.spec.mjs) — plain Node. */
export default defineConfig({
  test: {
    name: 'scripts',
    environment: 'node',
    include: ['build/**/*.spec.mjs'],
    // The version spec creates a throwaway git repository.
    testTimeout: 20_000,
  },
});
