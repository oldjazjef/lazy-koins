import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { applyMigrations, listMigrations, MigrationError } from './migrations';

const API_MIGRATIONS = resolve(__dirname, '../../../../api/prisma/migrations');

describe('migration runner', () => {
  let dir: string;
  let db: Database.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lk-migrations-'));
    db = new Database(join(dir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('applies the real API history in order and records it like prisma migrate deploy', () => {
    const names = listMigrations(API_MIGRATIONS).map((m) => m.name);
    expect(names[0]).toBe('00000000000000_init');
    expect([...names].sort()).toEqual(names);

    const applied = applyMigrations(db, API_MIGRATIONS);
    expect(applied).toEqual(names);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(
      expect.arrayContaining([
        'user',
        'project',
        'project_file',
        '_prisma_migrations',
      ]),
    );

    const rows = db
      .prepare(
        'SELECT migration_name, checksum, finished_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name',
      )
      .all() as {
      migration_name: string;
      checksum: string;
      finished_at: string | null;
      applied_steps_count: number;
    }[];
    expect(rows.map((r) => r.migration_name)).toEqual(names);
    for (const row of rows) {
      expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(row.finished_at).not.toBeNull();
      expect(row.applied_steps_count).toBe(1);
    }
    // The hand-written CHECKs are part of the schema (redefined tables included).
    const projectFile = db
      .prepare("SELECT sql FROM sqlite_master WHERE name = 'project_file'")
      .get() as { sql: string };
    expect(projectFile.sql).toContain('derived_from:_%');
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it('is a no-op on a current database', () => {
    applyMigrations(db, API_MIGRATIONS);
    expect(applyMigrations(db, API_MIGRATIONS)).toEqual([]);
  });

  it('applies only what is new', () => {
    const own = join(dir, 'migrations');
    mkdirSync(join(own, '001_a'), { recursive: true });
    writeFileSync(
      join(own, '001_a', 'migration.sql'),
      'CREATE TABLE a (id INTEGER);',
    );
    expect(applyMigrations(db, own)).toEqual(['001_a']);

    mkdirSync(join(own, '002_b'));
    writeFileSync(
      join(own, '002_b', 'migration.sql'),
      'CREATE TABLE b (id INTEGER);',
    );
    expect(applyMigrations(db, own)).toEqual(['002_b']);
  });

  it('rolls a failing migration back completely and refuses to continue', () => {
    const own = join(dir, 'migrations');
    mkdirSync(join(own, '001_ok'), { recursive: true });
    writeFileSync(
      join(own, '001_ok', 'migration.sql'),
      'CREATE TABLE ok (id INTEGER);',
    );
    mkdirSync(join(own, '002_bad'));
    writeFileSync(
      join(own, '002_bad', 'migration.sql'),
      'CREATE TABLE half (id INTEGER); THIS IS NOT SQL;',
    );
    mkdirSync(join(own, '003_later'));
    writeFileSync(
      join(own, '003_later', 'migration.sql'),
      'CREATE TABLE later (id INTEGER);',
    );

    expect(() => applyMigrations(db, own)).toThrow(MigrationError);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toContain('ok');
    expect(tables).not.toContain('half');
    expect(tables).not.toContain('later');
    expect(
      db.prepare('SELECT migration_name FROM _prisma_migrations').all(),
    ).toEqual([{ migration_name: '001_ok' }]);
  });

  it('refuses a database with an unresolved failed migration from the CLI', () => {
    applyMigrations(db, API_MIGRATIONS);
    db.exec(
      "INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at) VALUES ('x', 'c', '99_broken', 'now')",
    );
    expect(() => applyMigrations(db, API_MIGRATIONS)).toThrow(/99_broken/);
  });
});
