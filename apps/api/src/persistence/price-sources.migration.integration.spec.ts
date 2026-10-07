import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Migration 20261009110000_price_sources (price sources phase 2) on data stored before it: the
 * redefined `project_rate` / `user_rate` keep every row, every old CHECK and the unique index, and
 * their `source` CHECK takes the new providers (only those); `user_settings` gets
 * `coinmarketcap_key` (sealed only) and `price_sources` (a JSON array, '[]' by default). Runs the
 * real migration files on an in-memory database.
 */
const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
const TARGET = '20261009110000_price_sources';
const NOW = '2026-01-01T00:00:00+00:00';

function migrated(): Database.Database {
  const db = new Database(':memory:');
  const names = readdirSync(dir)
    .filter((n) => /^\d/.test(n))
    .sort();
  expect(names).toContain(TARGET);
  for (const name of names) {
    if (name === TARGET) {
      db.exec('PRAGMA foreign_keys=OFF');
      db.exec(
        `INSERT INTO user (id, email, identity_uid, display_name, sign_in_provider, created_at, updated_at)
         VALUES ('u1', 'a@b.c', 'dev:a@b.c', 'A', 'dev', '${NOW}', '${NOW}')`,
      );
      db.exec(
        `INSERT INTO user_settings (user_id, coingecko_key, updated_at) VALUES ('u1', 'enc:v1:cg', '${NOW}')`,
      );
      db.exec(
        `INSERT INTO project_rate (id, project_id, kind, asset, currency, date, value, source, note)
         VALUES ('r1', 'p1', 'price', 'BTC', 'USD', '2025-12-31', '90000', 'binance', NULL),
                ('r2', 'p1', 'price', 'BTC', 'CHF', '2025-12-31', '70000', 'estv', 'ESTV-Kursliste 2025')`,
      );
      db.exec(
        `INSERT INTO user_rate (id, user_id, kind, asset, currency, date, value, source)
         VALUES ('c1', 'u1', 'price', 'ETH', 'CHF', '2025-12-31', '3000', 'coingecko')`,
      );
    }
    db.exec(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
  }
  db.exec('PRAGMA foreign_keys=OFF');
  return db;
}

const userRate = (id: string, source: string) => {
  const { project_id: _p, ...rest } = projectRate(id, source);
  return { ...rest, user_id: 'u1' };
};

const projectRate = (id: string, source: string, extra = {}) => ({
  id,
  project_id: 'p1',
  kind: 'price',
  asset: 'DOT',
  currency: 'USD',
  date: '2025-12-31',
  value: '5',
  source,
  ...extra,
});

function insert(
  db: Database.Database,
  table: string,
  row: Record<string, unknown>,
): void {
  const keys = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => `@${k}`).join(', ')})`,
  ).run(row);
}

describe('migration price_sources (price sources phase 2)', () => {
  it('keeps every stored rate and setting', () => {
    const db = migrated();
    expect(
      db.prepare('SELECT id, source, note FROM project_rate ORDER BY id').all(),
    ).toEqual([
      { id: 'r1', source: 'binance', note: null },
      { id: 'r2', source: 'estv', note: 'ESTV-Kursliste 2025' },
    ]);
    expect(db.prepare('SELECT id, source FROM user_rate').all()).toEqual([
      { id: 'c1', source: 'coingecko' },
    ]);
    expect(
      db
        .prepare(
          'SELECT coingecko_key, coinmarketcap_key, price_sources FROM user_settings',
        )
        .get(),
    ).toEqual({
      coingecko_key: 'enc:v1:cg',
      coinmarketcap_key: null,
      price_sources: '[]',
    });
    db.close();
  });

  it('widens the source CHECKs to the new providers only', () => {
    const db = migrated();
    for (const [i, source] of [
      'coinmarketcap',
      'defillama',
      'coinpaprika',
      'kraken',
      'bitfinex',
      'coinbase',
    ].entries()) {
      insert(db, 'project_rate', projectRate(`n${i}`, source));
      insert(db, 'user_rate', userRate(`u${i}`, source));
    }
    expect(() =>
      insert(db, 'project_rate', projectRate('x1', 'cryptocompare')),
    ).toThrow(/CHECK constraint failed/);
    // Overrides and ESTV values stay project-only.
    expect(() => insert(db, 'user_rate', userRate('x2', 'manual'))).toThrow(
      /CHECK constraint failed/,
    );
    db.close();
  });

  it('copies every other CHECK and the unique index', () => {
    const db = migrated();
    for (const [table, owner] of [
      ['project_rate', { project_id: 'p1' }],
      ['user_rate', { user_id: 'u1' }],
    ] as const) {
      const row = (id: string, extra: Record<string, unknown>) => {
        const { project_id: _p, ...base } = projectRate(id, 'kraken');
        return { ...base, ...owner, ...extra };
      };
      for (const bad of [
        { kind: 'other' },
        { currency: 'usd' },
        { date: '31.12.2025' },
        { asset: '  ' },
        { value: '1e5' },
      ]) {
        expect(() => insert(db, table, row(`b-${table}`, bad))).toThrow(
          /CHECK constraint failed/,
        );
      }
      insert(db, table, row(`k1-${table}`, {}));
      expect(() => insert(db, table, row(`k2-${table}`, {}))).toThrow(
        /UNIQUE constraint failed/,
      );
    }
    db.close();
  });

  it('accepts only a sealed CoinMarketCap key and a JSON array of providers', () => {
    const db = migrated();
    db.exec(
      `UPDATE user_settings SET coinmarketcap_key = 'enc:v1:abc', price_sources = '[{"id":"kraken","enabled":true}]'`,
    );
    expect(() =>
      db.exec(`UPDATE user_settings SET coinmarketcap_key = 'plain-key'`),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.exec(`UPDATE user_settings SET price_sources = '{}'`),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.exec(`UPDATE user_settings SET price_sources = 'not json'`),
    ).toThrow(/CHECK constraint failed/);
    // The older key CHECK is still there.
    expect(() =>
      db.exec(`UPDATE user_settings SET etherscan_key = 'plain'`),
    ).toThrow(/CHECK constraint failed/);
    db.close();
  });
});
