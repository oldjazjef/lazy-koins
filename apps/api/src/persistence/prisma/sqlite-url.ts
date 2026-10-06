import { isAbsolute, resolve } from 'node:path';

/**
 * `DATABASE_URL` (`file:./.data/lazykoins.db`, `file:/data/lazykoins.db`) → an absolute file path.
 *
 * One rule for every consumer: a relative path resolves against the **working directory**. Left
 * alone, the Prisma CLI resolves it against the folder of prisma.config.ts while the app resolves it
 * against its cwd — two different files, and an app that silently runs on an empty database. Both
 * prisma.config.ts and PrismaService call this, and every script runs from the repo root (the
 * container from /app), so they always agree.
 */
export function sqliteFilePath(
  url: string,
  cwd: string = process.cwd(),
): string {
  if (!url.startsWith('file:')) {
    throw new Error(
      `DATABASE_URL must be a SQLite file URL (file:...), got ${JSON.stringify(url)}`,
    );
  }
  const path = url.slice('file:'.length).split('?')[0] ?? '';
  if (path.length === 0) throw new Error('DATABASE_URL has no file path');
  return isAbsolute(path) ? path : resolve(cwd, path);
}
