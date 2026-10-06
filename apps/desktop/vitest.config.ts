import { defineConfig } from 'vitest/config';

/**
 * The Electron main process's pure helpers (data folder, lock file, migration runner, app://
 * routing) — plain Node, no Electron: the files under src/main/lib never import `electron`.
 * better-sqlite3 here is the workspace copy built for Node; the packaged app gets its own copy
 * rebuilt for Electron (scripts/stage.mjs), so the two never collide.
 */
export default defineConfig({
  cacheDir: '../../node_modules/.vite/apps/desktop',
  test: {
    name: 'desktop',
    environment: 'node',
    globals: true,
    include: ['src/**/*.spec.ts'],
    passWithNoTests: false,
  },
});
