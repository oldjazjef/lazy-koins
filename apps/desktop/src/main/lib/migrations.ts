import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Applies the API's Prisma migration history (`apps/api/prisma/migrations`, shipped inside the
 * app) to the desktop database — without the Prisma CLI.
 *
 * Why not `prisma migrate deploy`: Prisma has no runtime migrate API, and the CLI needs its
 * schema-engine binary per OS/arch plus the CLI package itself (tens of MB, a child process, and
 * one more native artefact to get right in an asar). The history is plain SQL, so this runner
 * applies it the way `migrate deploy` does and records each migration in a
 * **`_prisma_migrations`-compatible table** (same columns, checksum = SHA-256 hex of the file).
 * The CLI therefore accepts a desktop database as up to date — `prisma migrate status` against it
 * reports no pending migration.
 *
 * Rules, as `migrate deploy`: folders apply in name order, each once; an applied migration is
 * never re-run or rolled back; a failed one is rolled back and stops the start (the API must not
 * run on an old schema). A failed, unresolved row left by the CLI also stops it.
 */

/** The subset of better-sqlite3's `Database` this runner needs (keeps it testable). */
export interface SqliteDatabase {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  };
}

export interface Migration {
  /** Folder name, e.g. `20261006120000_files_and_mappings`. */
  name: string;
  sql: string;
  checksum: string;
}

const MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
)`;

/** Every `<dir>/<name>/migration.sql`, sorted by folder name (the timestamp prefix). */
export function listMigrations(dir: string): Migration[] {
  if (!existsSync(dir)) {
    throw new Error(`Migrations folder not found: ${dir}`);
  }
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .filter((name) => existsSync(join(dir, name, 'migration.sql')))
    .sort()
    .map((name) => {
      const bytes = readFileSync(join(dir, name, 'migration.sql'));
      return {
        name,
        sql: bytes.toString('utf8'),
        checksum: createHash('sha256').update(bytes).digest('hex'),
      };
    });
}

export class MigrationError extends Error {}

/**
 * Applies the pending migrations of `dir` to `db`. Returns the names it applied (empty = the
 * database was already current).
 *
 * Each migration runs in its own transaction with foreign keys switched off around it — Prisma's
 * SQLite table redefinitions (`CREATE new_x; INSERT …; DROP x; ALTER … RENAME`) rely on that, and
 * `PRAGMA foreign_keys` is a no-op inside a transaction, so the script's own PRAGMAs cannot do it.
 * `foreign_key_check` runs before the commit, as Prisma's generated scripts expect.
 */
export function applyMigrations(
  db: SqliteDatabase,
  dir: string,
  now: () => Date = () => new Date(),
): string[] {
  db.exec(MIGRATIONS_TABLE);

  const rows = db
    .prepare(
      'SELECT "migration_name", "finished_at", "rolled_back_at" FROM "_prisma_migrations"',
    )
    .all() as {
    migration_name: string;
    finished_at: string | null;
    rolled_back_at: string | null;
  }[];

  const failed = rows.find(
    (row) => row.finished_at === null && row.rolled_back_at === null,
  );
  if (failed) {
    throw new MigrationError(
      `Migration ${failed.migration_name} failed earlier and was never resolved. ` +
        'Restore a backup of the database (or resolve it with `prisma migrate resolve`).',
    );
  }

  const applied = new Set(
    rows
      .filter((row) => row.finished_at !== null)
      .map((row) => row.migration_name),
  );
  const done: string[] = [];

  for (const migration of listMigrations(dir)) {
    if (applied.has(migration.name)) continue;

    const id = randomUUID();
    const startedAt = now().toISOString();
    db.exec('PRAGMA foreign_keys = OFF');
    try {
      db.exec('BEGIN');
      try {
        db.exec(migration.sql);
        const violations = db.prepare('PRAGMA foreign_key_check').all();
        if (violations.length > 0) {
          throw new Error(
            `foreign_key_check reports ${violations.length} violation(s)`,
          );
        }
        db.prepare(
          'INSERT INTO "_prisma_migrations" ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count") VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)',
        ).run(
          id,
          migration.checksum,
          now().toISOString(),
          migration.name,
          startedAt,
        );
        db.exec('COMMIT');
      } catch (error) {
        // Unlike the CLI (which runs a script without a transaction and must mark it failed), the
        // rollback leaves the schema exactly as before: nothing is recorded, the next start tries
        // again, and the app refuses to start until then.
        db.exec('ROLLBACK');
        throw new MigrationError(
          `Migration ${migration.name} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
    done.push(migration.name);
  }

  return done;
}
