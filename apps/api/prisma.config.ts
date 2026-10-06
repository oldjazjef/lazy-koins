import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { sqliteFilePath } from './src/persistence/prisma/sqlite-url';

// The Prisma CLI runs outside the Nest process, so the environment is loaded here, with the same
// precedence as app.module.ts (paths relative to the repo root, where every script runs).
// Prisma 7 no longer loads `.env` implicitly.
loadEnv({
  path: ['apps/api/.env.local', 'apps/api/.env', '.env', '.env.local'],
  quiet: true,
});

export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    // Resolved to an absolute path with the same rule as PrismaService (relative = against the
    // working directory), so the CLI and the app always open the same file. Without an .env —
    // `pnpm install` runs `prisma generate`, which needs no database — a throwaway path under
    // tmp/ keeps generate working.
    url: `file:${sqliteFilePath(process.env['DATABASE_URL'] ?? 'file:./tmp/unset.db')}`,
  },
  migrations: { path: './prisma/migrations' },
});
