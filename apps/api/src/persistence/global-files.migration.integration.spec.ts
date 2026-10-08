import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Migration 20261010100000_global_files (F5.21–F5.24) on data stored before it: the reading moves
 * from `project_file` to `stored_file` — the NEWEST project's reading wins, every project keeps
 * its selection and deactivation, a disagreement raises one notification per file, and the
 * stored file's `source` names wallets and derived files. Runs the real migration files on an
 * in-memory database (synthetic rows only).
 */
const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
const TARGET = '20261010100000_global_files';
const NOW = '2026-01-01T00:00:00.000+00:00';
const sha = (c: string) => c.repeat(64);

function migrated(): Database.Database {
  const db = new Database(':memory:');
  const names = readdirSync(dir)
    .filter((n) => /^\d/.test(n))
    .sort();
  expect(names).toContain(TARGET);
  for (const name of names) {
    if (name === TARGET) seed(db);
    db.exec(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
  }
  return db;
}

function seed(db: Database.Database): void {
  db.exec(
    `INSERT INTO user (id, email, identity_uid, display_name, sign_in_provider, created_at, updated_at)
     VALUES ('u1', 'a@b.c', 'dev:a@b.c', 'A', 'dev', '${NOW}', '${NOW}')`,
  );
  for (const [id, year] of [
    ['p24', 2024],
    ['p25', 2025],
  ] as const) {
    db.prepare(
      `INSERT INTO project (id, owner_id, name, tax_year, canton, created_at, updated_at)
       VALUES (?, 'u1', ?, ?, 'ZH', '${NOW}', '${NOW}')`,
    ).run(id, `Steuern ${year}`, year);
  }
  for (const id of ['m1', 'm2']) {
    db.prepare(
      `INSERT INTO import_mapping (id, owner_id, name, platform, spec, fingerprint, version, origin, updated_at)
       VALUES (?, 'u1', 'Kraken', 'kraken', '{"platform":"kraken"}', 'fp', 1, 'manual', '${NOW}')`,
    ).run(id);
  }
  for (const [id, c] of [
    ['f1', 'a'],
    ['f2', 'b'],
    ['f3', 'c'],
    ['f4', 'd'],
  ] as const) {
    db.prepare(
      `INSERT INTO stored_file (id, owner_id, sha256, bytes, size, media_type, kind, original_name)
       VALUES (?, 'u1', ?, X'61', 1, 'text/csv', 'csv', ?)`,
    ).run(id, sha(c), `${id}.csv`);
  }
  const entry = db.prepare(
    `INSERT INTO project_file (id, project_id, file_id, display_name, status, importer_id, mapping_id,
       platform, booking_count, coverage, origin, added_at, disabled_at, disabled_note)
     VALUES (@id, @project, @file, @name, @status, @importer, @mapping, 'kraken', @bookings, '[]',
       @origin, '${NOW}', @disabled, @note)`,
  );
  const base = {
    importer: null,
    mapping: null,
    bookings: 0,
    disabled: null,
    note: null,
  };
  // f1: read differently by the two projects — 2025 (newest) wins; deactivated in 2025.
  entry.run({
    ...base,
    id: 'a',
    project: 'p24',
    file: 'f1',
    name: 'ledger.csv',
    status: 'mapped',
    importer: 'mapping:m1',
    mapping: 'm1',
    bookings: 5,
    origin: 'uploaded',
  });
  entry.run({
    ...base,
    id: 'b',
    project: 'p25',
    file: 'f1',
    name: 'ledger.csv',
    status: 'mapped',
    importer: 'mapping:m2',
    mapping: 'm2',
    bookings: 7,
    origin: 'from_project:p24',
    disabled: NOW,
    note: 'doppelt',
  });
  // f2: derived from f1's entry in 2025; f3: a wallet fetch; f4: the same reading everywhere.
  entry.run({
    ...base,
    id: 'c',
    project: 'p25',
    file: 'f2',
    name: 'auszug.bestaende.csv',
    status: 'standard',
    importer: 'standard-v1',
    origin: 'derived_from:b',
  });
  entry.run({
    ...base,
    id: 'd',
    project: 'p25',
    file: 'f3',
    name: 'Ledger.wallet-buchungen.csv',
    status: 'standard',
    importer: 'standard-v1',
    origin: 'wallet:w1',
  });
  for (const [id, project] of [
    ['e', 'p24'],
    ['f', 'p25'],
  ] as const) {
    entry.run({
      ...base,
      id,
      project,
      file: 'f4',
      name: 'beleg.pdf',
      status: 'evidence_only',
      origin: 'uploaded',
    });
  }
}

describe('migration global_files (F5.21–F5.24)', () => {
  it('moves the newest project’s reading to the stored file and keeps every selection', () => {
    const db = migrated();
    expect(
      db
        .prepare(
          'SELECT id, status, mapping_id, booking_count, source FROM stored_file ORDER BY id',
        )
        .all(),
    ).toEqual([
      {
        id: 'f1',
        status: 'mapped',
        mapping_id: 'm2',
        booking_count: 7,
        source: 'uploaded',
      },
      {
        id: 'f2',
        status: 'standard',
        mapping_id: null,
        booking_count: 0,
        source: 'derived_from:f1',
      },
      {
        id: 'f3',
        status: 'standard',
        mapping_id: null,
        booking_count: 0,
        source: 'wallet:w1',
      },
      {
        id: 'f4',
        status: 'evidence_only',
        mapping_id: null,
        booking_count: 0,
        source: 'uploaded',
      },
    ]);
    expect(
      db
        .prepare(
          'SELECT id, project_id, file_id, origin, disabled_note FROM project_file ORDER BY id',
        )
        .all(),
    ).toEqual([
      {
        id: 'a',
        project_id: 'p24',
        file_id: 'f1',
        origin: 'uploaded',
        disabled_note: null,
      },
      {
        id: 'b',
        project_id: 'p25',
        file_id: 'f1',
        origin: 'from_project:p24',
        disabled_note: 'doppelt',
      },
      {
        id: 'c',
        project_id: 'p25',
        file_id: 'f2',
        origin: 'derived_from:b',
        disabled_note: null,
      },
      {
        id: 'd',
        project_id: 'p25',
        file_id: 'f3',
        origin: 'wallet:w1',
        disabled_note: null,
      },
      {
        id: 'e',
        project_id: 'p24',
        file_id: 'f4',
        origin: 'uploaded',
        disabled_note: null,
      },
      {
        id: 'f',
        project_id: 'p25',
        file_id: 'f4',
        origin: 'uploaded',
        disabled_note: null,
      },
    ]);
  });

  it('reports a file the projects read differently — once, with its name', () => {
    const db = migrated();
    expect(
      db.prepare('SELECT user_id, kind, topic, params FROM notification').all(),
    ).toEqual([
      {
        user_id: 'u1',
        kind: 'info',
        topic: 'files.readingConflict:f1',
        params: '{"name":"f1.csv"}',
      },
    ]);
  });

  it('keeps the foreign keys intact', () => {
    const db = migrated();
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });
});
