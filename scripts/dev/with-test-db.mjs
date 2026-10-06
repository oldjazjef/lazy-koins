#!/usr/bin/env node
/**
 * Runs a command with DATABASE_URL pointed at the integration-test database — a throwaway SQLite
 * file at <repo>/tmp/lazykoins-test.db — unless something already set DATABASE_URL.
 *
 * WHY: the integration suite writes into whatever DATABASE_URL names, and apps/api/.env names your
 * development database. A variable set in the environment wins over every .env file (dotenv never
 * overwrites), so this keeps the suite off your data without touching any .env.
 *
 * The path is absolute on purpose: the Prisma CLI and Vitest must open the same file.
 *
 * Usage:
 *   node scripts/dev/with-test-db.mjs <command> [args...]
 *   node scripts/dev/with-test-db.mjs --reset          # delete the test database file
 *   DATABASE_URL=file:/elsewhere.db node scripts/dev/with-test-db.mjs ...   # override
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const testDb = path.join(repoRoot, 'tmp', 'lazykoins-test.db');

const [command, ...args] = process.argv.slice(2);

if (command === '--reset') {
  for (const suffix of ['', '-wal', '-shm', '-journal'])
    rmSync(`${testDb}${suffix}`, { force: true });
  console.log(`with-test-db: removed ${testDb}`);
  process.exit(0);
}

if (!command) {
  console.error(
    'Usage: node scripts/dev/with-test-db.mjs <command> [args...] | --reset',
  );
  process.exit(1);
}

const env = { ...process.env };
if (env.DATABASE_URL) {
  console.log('with-test-db: DATABASE_URL is already set — using it as-is.');
} else {
  mkdirSync(path.dirname(testDb), { recursive: true });
  env.DATABASE_URL = `file:${testDb}`;
  console.log(`with-test-db: DATABASE_URL -> ${env.DATABASE_URL}`);
}

// `shell: true` because the command is usually `pnpm`/`nx`, which resolve through shims on Windows.
const child = spawn(command, args, {
  env,
  stdio: 'inherit',
  shell: true,
  cwd: repoRoot,
});
child.on('error', (error) => {
  console.error(`with-test-db: failed to start "${command}": ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
