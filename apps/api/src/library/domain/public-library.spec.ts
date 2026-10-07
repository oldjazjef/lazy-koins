import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type MappingSpec, validateMappingSpec } from '@lazykoins/engine';
import { InMemoryLibraryRepository } from '../testing/in-memory-library.repository';
import {
  matchEntries,
  PUBLIC_ENTRY_KEYS,
  publicEntry,
  publicEntryDetail,
  publicPage,
} from './public-library';

/** The engine's synthetic fixtures — never real data. */
const FIXTURES = resolve(
  __dirname,
  '../../../../../libs/engine/src/mapping/fixtures',
);
function spec(file: string): MappingSpec {
  const result = validateMappingSpec(
    JSON.parse(readFileSync(resolve(FIXTURES, file), 'utf8')),
  );
  if (!result.ok) throw new Error(file);
  return result.spec;
}
const KRAKEN = spec('kraken-ledger.mapping.json');
const BITFINEX = spec('bitfinex-ledger.mapping.json');

async function library() {
  const repo = new InMemoryLibraryRepository();
  const kraken = await repo.create('author-1-secret-id', {
    authorName: 'Krakenfan',
    sourceMappingId: 'mapping-of-author',
    description: 'Kraken ledger',
    spec: KRAKEN,
  });
  const bitfinex = await repo.create('author-2-secret-id', {
    authorName: null,
    sourceMappingId: null,
    description: null,
    spec: BITFINEX,
  });
  await repo.setRating(kraken.id, 'rater', 4);
  return { repo, kraken, bitfinex };
}

describe('public library (F5.18)', () => {
  it('shows exactly the allow-listed keys — no author id, source mapping or own rating', async () => {
    const { repo, kraken } = await library();
    const entry = await repo.findById(kraken.id);
    if (!entry) throw new Error('entry missing');
    expect(Object.keys(publicEntry(entry)).sort()).toEqual(
      [...PUBLIC_ENTRY_KEYS].sort(),
    );
    const text = JSON.stringify(publicEntryDetail(entry));
    expect(text).not.toContain('author-1-secret-id');
    expect(text).not.toContain('mapping-of-author');
    expect(publicEntry(entry)).toMatchObject({
      authorName: 'Krakenfan',
      ratingAverage: 4,
      ratingCount: 1,
    });
    expect(Object.keys(publicEntryDetail(entry)).sort()).toEqual(
      [...PUBLIC_ENTRY_KEYS, 'spec'].sort(),
    );
  });

  it('pages: default 20, at most 50, offset clamped; deleted entries are absent', async () => {
    const { repo, kraken, bitfinex } = await library();
    expect(publicPage(await repo.listActive(), {})).toMatchObject({
      total: 2,
      offset: 0,
      limit: 20,
    });
    expect(publicPage(await repo.listActive(), { limit: 500 }).limit).toBe(50);
    expect(publicPage(await repo.listActive(), { limit: 0 }).limit).toBe(1);
    expect(publicPage(await repo.listActive(), { offset: -5 }).offset).toBe(0);
    expect(
      publicPage(await repo.listActive(), { offset: 1, limit: 1 }).items,
    ).toHaveLength(1);
    await repo.softDelete(bitfinex.id, '2026-10-09T00:00:00.000Z');
    const page = publicPage([...repo.rows.values()], {});
    expect(page.items.map((item) => item.id)).toEqual([kraken.id]);
    expect(page.total).toBe(1);
  });

  it('searches and filters like the web list', async () => {
    const { repo, bitfinex } = await library();
    const all = await repo.listActive();
    expect(
      publicPage(all, { platform: BITFINEX.platform }).items.map((i) => i.id),
    ).toEqual([bitfinex.id]);
    expect(publicPage(all, { search: 'zzz-nothing' }).total).toBe(0);
  });

  it('matches by the header row and the file name only (surest first, ≤ 10)', async () => {
    const { repo, kraken } = await library();
    const header =
      readFileSync(
        resolve(FIXTURES, 'kraken-ledger-classic.csv'),
        'utf8',
      ).split(/\r?\n/)[0] ??
      ''.split(',').map((cell) => cell.replace(/^"|"$/g, ''));
    const found = matchEntries(await repo.listActive(), {
      fileName: 'ledgers.csv',
      headers: header,
    });
    expect(found.map((entry) => entry.id)).toEqual([kraken.id]);
    expect(
      matchEntries(await repo.listActive(), {
        fileName: 'x.csv',
        headers: ['nothing', 'matches'],
      }),
    ).toEqual([]);
    expect(
      matchEntries(await repo.listActive(), { fileName: 'x.csv', headers: [] }),
    ).toEqual([]);
    await repo.softDelete(kraken.id, '2026-10-09T00:00:00.000Z');
    expect(
      matchEntries([...repo.rows.values()], {
        fileName: 'ledgers.csv',
        headers: header,
      }),
    ).toEqual([]);
  });
});
