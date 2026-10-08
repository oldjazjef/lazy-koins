import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Migration 20261010110000_transaction_edits (F9.11) on data stored before it: project
 * corrections "umklassieren" / "ausblenden" become global transaction edits — the newest
 * project's win, the others are kept as `superseded` (with where they came from), undone ones
 * stay undone, and the migrated corrections leave the projects; price overrides and manual
 * records stay. Plus the new tables' CHECKs. Real migration files, in-memory database,
 * synthetic rows only.
 */
const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
const TARGET = '20261010110000_transaction_edits';
const NOW = '2026-01-01T00:00:00.000+00:00';

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
  const correction = db.prepare(
    `INSERT INTO correction (id, project_id, type, data, reason, created_at, undone_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  // b:1 — both projects disagree: 2025 wins, 2024 is superseded.
  correction.run(
    'c1',
    'p24',
    'reclassify',
    '{"type":"reclassify","bookingId":"b:1","kind":"transfer"}',
    'Alt',
    '2025-01-01T00:00:00.000+00:00',
    null,
  );
  correction.run(
    'c2',
    'p25',
    'reclassify',
    '{"type":"reclassify","bookingId":"b:1","kind":"income_staking"}',
    'Neu',
    '2026-01-02T00:00:00.000+00:00',
    null,
  );
  // b:2 — hidden in 2024 only: active.
  correction.run(
    'c3',
    'p24',
    'exclude_booking',
    '{"type":"exclude_booking","bookingId":"b:2"}',
    'Doppelt',
    '2025-02-01T00:00:00.000+00:00',
    null,
  );
  // b:3 — undone: stays undone.
  correction.run(
    'c4',
    'p25',
    'reclassify',
    '{"type":"reclassify","bookingId":"b:3","kind":"spam"}',
    'Spam?',
    '2026-01-03T00:00:00.000+00:00',
    '2026-01-04T00:00:00.000+00:00',
  );
  // A price override stays a project correction (F9.1).
  correction.run(
    'c5',
    'p25',
    'price_override',
    '{"type":"price_override","asset":"BTC","date":"2025-12-31","priceChf":"1"}',
    'Kurs',
    NOW,
    null,
  );
}

describe('transaction_edit migration (F9.11)', () => {
  it('turns reclassify / exclude corrections into global edits; the newest project wins', () => {
    const db = migrated();
    const edits = db
      .prepare(
        `SELECT id, tx_key AS key, changes, reason, source, status, origin, decided_at AS decidedAt
         FROM transaction_edit ORDER BY id`,
      )
      .all() as Record<string, string | null>[];
    expect(
      edits.map((e) => [e['id'], e['key'], e['status'], e['source']]),
    ).toEqual([
      ['c1', 'b:1', 'superseded', 'migrated'],
      ['c2', 'b:1', 'active', 'migrated'],
      ['c3', 'b:2', 'active', 'migrated'],
      ['c4', 'b:3', 'undone', 'migrated'],
    ]);
    expect(JSON.parse(edits[1]?.['changes'] ?? '')).toEqual({
      kind: 'income_staking',
    });
    expect(JSON.parse(edits[2]?.['changes'] ?? '')).toEqual({ hidden: true });
    expect(edits[0]).toMatchObject({
      origin: 'Steuern 2024 2024',
      reason: 'Alt',
    });
    expect(edits[0]?.['decidedAt']).not.toBeNull();
    expect(edits[3]?.['decidedAt']).toBe('2026-01-04T00:00:00.000+00:00');
    expect(db.prepare('SELECT id FROM correction ORDER BY id').all()).toEqual([
      { id: 'c5' },
    ]);
  });

  it('keeps the CHECKs of the new tables', () => {
    const db = migrated();
    const edit = (columns: Record<string, unknown>) => {
      const row = {
        id: `e${Math.random()}`,
        owner_id: 'u1',
        tx_key: 'b:9',
        changes: '{"kind":"spam"}',
        reason: 'r',
        created_at: NOW,
        ...columns,
      };
      const names = Object.keys(row);
      return () =>
        db
          .prepare(
            `INSERT INTO transaction_edit (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
          )
          .run(...Object.values(row));
    };
    for (const bad of [
      { tx_key: '' },
      { changes: '[1]' },
      { changes: 'nope' },
      { reason: '  ' },
      { source: 'robot' },
      { status: 'maybe' },
      { status: 'undone' },
    ]) {
      expect(edit(bad)).toThrow(/CHECK constraint failed/);
    }
    expect(edit({ status: 'undone', decided_at: NOW })).not.toThrow();
    const suggestion = (columns: Record<string, unknown>) => {
      const row = {
        id: `s${Math.random()}`,
        owner_id: 'u1',
        tx_key: `b:${Math.random()}`,
        kind: 'spam',
        reason: 'r',
        confidence: 50,
        created_at: NOW,
        ...columns,
      };
      const names = Object.keys(row);
      return () =>
        db
          .prepare(
            `INSERT INTO transaction_suggestion (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
          )
          .run(...Object.values(row));
    };
    for (const bad of [
      { kind: 'gift' },
      { confidence: 101 },
      { status: 'later' },
      { linked_key: '' },
    ]) {
      expect(suggestion(bad)).toThrow(/CHECK constraint failed/);
    }
    expect(suggestion({})).not.toThrow();
  });
});
