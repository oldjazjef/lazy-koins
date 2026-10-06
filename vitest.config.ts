import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      '**/vite.config.{mjs,js,ts,mts}',
      '**/vitest.config.{mjs,js,ts,mts}',
      '!vitest.config.{mjs,js,ts,mts}',
      '!vite.config.{mjs,js,ts,mts}',
      // Agent worktrees can sit under `.claude/worktrees/` inside this repo — each is a full
      // checkout with its own vitest.config.ts, so without this exclusion two live worktrees
      // collide on the same project name and `pnpm test` fails to even start.
      '!.claude/worktrees/**',
      // Real tax data (see CLAUDE.md, Private data). Never scanned; the golden test in
      // libs/engine reads it explicitly and skips when it is absent.
      '!private/**',
    ],
  },
});
