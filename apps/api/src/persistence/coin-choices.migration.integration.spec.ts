import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

/**
 * Migration 20261009090000_coin_choices on data stored before it (F7.4): every CoinGecko id of
 * `coingecko_ids` becomes a CoinGecko choice in `coin_choices` (symbol upper case, no name), junk
 * is dropped, and the new CHECKs hold. Runs the real migration files on an in-memory database.
 */
const dir = join(__dirname, '..', '..', 'prisma', 'migrations');
const TARGET = '20261009090000_coin_choices';

describe('migration coin_choices (F7.4)', () => {
  it('carries the stored CoinGecko ids over as choices', () => {
    const db = new Database(':memory:');
    const names = readdirSync(dir)
      .filter((n) => /^\d/.test(n))
      .sort();
    expect(names).toContain(TARGET);
    for (const name of names) {
      if (name === TARGET) {
        db.exec(
          `INSERT INTO user (id, email, identity_uid, display_name, sign_in_provider, created_at, updated_at)
           VALUES ('u1', 'a@b.c', 'dev:a@b.c', 'A', 'dev', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00'),
                  ('u2', 'b@b.c', 'dev:b@b.c', 'B', 'dev', '2026-01-01T00:00:00+00:00', '2026-01-01T00:00:00+00:00')`,
        );
        db.exec(
          `INSERT INTO user_settings (user_id, coingecko_ids, updated_at) VALUES
           ('u1', '{"pol":"polygon-ecosystem-token","X":5}', '2026-01-01T00:00:00+00:00'),
           ('u2', '{}', '2026-01-01T00:00:00+00:00')`,
        );
      }
      db.exec(readFileSync(join(dir, name, 'migration.sql'), 'utf8'));
    }
    const rows = db
      .prepare(
        'SELECT user_id, coin_choices, coin_dismissed FROM user_settings ORDER BY user_id',
      )
      .all() as {
      user_id: string;
      coin_choices: string;
      coin_dismissed: string;
    }[];
    expect(
      rows.map((r) => [
        r.user_id,
        JSON.parse(r.coin_choices),
        r.coin_dismissed,
      ]),
    ).toEqual([
      [
        'u1',
        {
          POL: {
            provider: 'coingecko',
            id: 'polygon-ecosystem-token',
            name: null,
            symbol: null,
          },
        },
        '[]',
      ],
      ['u2', {}, '[]'],
    ]);
    expect(() =>
      db.exec(
        `UPDATE user_settings SET coin_dismissed = '{}' WHERE user_id = 'u1'`,
      ),
    ).toThrow(/CHECK constraint failed/);
    expect(() =>
      db.exec(
        `INSERT INTO coin_market (provider, coin_id, symbol, name, market_cap_rank, fetched_at)
         VALUES ('coingecko', 'opinion', 'opn', 'Opinion', 1191, '2026-01-01T00:00:00+00:00')`,
      ),
    ).toThrow(/CHECK constraint failed/);
    db.close();
  });
});
