import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { csvSourceFile, MAPPING_VERSION } from '@lazykoins/engine';
import {
  baseName,
  droppedKeys,
  headerMatchRequest,
  normaliseRemoteUrl,
  validateRemoteSpec,
} from './remote-library';

const FIXTURES = resolve(
  __dirname,
  '../../../../../libs/engine/src/mapping/fixtures',
);
const json = (file: string) =>
  JSON.parse(readFileSync(resolve(FIXTURES, file), 'utf8')) as Record<
    string,
    unknown
  >;

describe('normaliseRemoteUrl (F5.18)', () => {
  it.each([
    ['https://lazykoins.example.ch', 'https://lazykoins.example.ch'],
    ['  https://LazyKoins.Example.ch/  ', 'https://lazykoins.example.ch'],
    ['https://example.ch/api', 'https://example.ch'],
    ['https://example.ch/api/', 'https://example.ch'],
    ['https://example.ch/lk/api', 'https://example.ch/lk'],
    ['https://example.ch:8443/sub/', 'https://example.ch:8443/sub'],
    ['http://localhost:3333/api', 'http://localhost:3333'],
    ['http://127.0.0.1:3341', 'http://127.0.0.1:3341'],
    ['http://[::1]:3341/', 'http://[::1]:3341'],
  ])('accepts %s', (raw, url) => {
    expect(normaliseRemoteUrl(raw)).toEqual({ ok: true, url });
  });

  it.each([
    ['', 'invalidUrl'],
    ['lazykoins.example.ch', 'invalidUrl'],
    ['ftp://example.ch', 'invalidUrl'],
    ['javascript:alert(1)', 'invalidUrl'],
    ['file:///etc/passwd', 'invalidUrl'],
    ['http://example.ch', 'httpsRequired'],
    ['http://192.168.1.10', 'httpsRequired'],
    ['http://localhost.example.ch', 'httpsRequired'],
    ['https://user:pw@example.ch', 'credentialsInUrl'],
    ['https://user@example.ch', 'credentialsInUrl'],
    ['https://example.ch/?x=1', 'invalidUrl'],
    ['https://example.ch/?', 'invalidUrl'],
    ['https://example.ch/#top', 'invalidUrl'],
    [`https://example.ch/${'a'.repeat(400)}`, 'tooLong'],
  ])('refuses %s (%s)', (raw, problem) => {
    expect(normaliseRemoteUrl(raw)).toEqual({ ok: false, problem });
  });
});

describe('headerMatchRequest — what leaves the device for a suggestion (F5.18)', () => {
  it('sends the header row and the base file name — no data row, no folder', () => {
    const bytes = readFileSync(resolve(FIXTURES, 'kraken-ledger-classic.csv'));
    const file = csvSourceFile({
      id: 'sha',
      name: 'C:\\Users\\anna\\Steuern\\ledgers.csv',
      bytes: new Uint8Array(bytes),
    });
    const request = headerMatchRequest(
      file,
      'C:\\Users\\anna\\Steuern\\ledgers.csv',
    );
    expect(request).toEqual({
      fileName: 'ledgers.csv',
      headers: [
        'txid',
        'refid',
        'time',
        'type',
        'subtype',
        'aclass',
        'asset',
        'amount',
        'fee',
        'balance',
      ],
    });
    // Nothing of the data rows.
    const sent = JSON.stringify(request);
    for (const value of ['LSYN02', 'TSYN1001', '0.0100000000', '2018-03-01']) {
      expect(sent).not.toContain(value);
    }
  });

  it('skips a preamble and drops cells that look like data', () => {
    const file = {
      id: 'x',
      name: 'x.csv',
      kind: 'csv' as const,
      sheets: [
        {
          name: 'Sheet1',
          rows: [
            ['Account statement'],
            ['IBAN', 'CH9300762011623852957'],
            ['Date', 'Asset', 'Amount', 'Note'],
            ['2025-01-01', 'BTC', '0.1', 'x'],
          ],
        },
      ],
    };
    const request = headerMatchRequest(file, 'statement.csv');
    expect(request?.headers).toEqual(['Date', 'Asset', 'Amount', 'Note']);
    expect(JSON.stringify(request)).not.toContain('CH9300762011623852957');
  });

  it('never sends a personal-looking cell, even when the guess lands on a preamble row', () => {
    const file = {
      id: 'x',
      name: 'x.csv',
      kind: 'csv' as const,
      sheets: [
        {
          name: 'Sheet1',
          rows: [
            ['Owner', 'anna@example.org', 'CH9300762011623852957'],
            ['Asset', '0x52908400098527886E0F7030069857D2E4169EE7'],
          ],
        },
      ],
    };
    // The only clean row has one usable cell left: nothing goes out.
    expect(headerMatchRequest(file, 'x.csv')).toBeUndefined();
  });

  it('caps sizes and has nothing for a PDF or an empty file', () => {
    const wide = {
      id: 'x',
      name: 'x.csv',
      kind: 'csv' as const,
      sheets: [
        {
          name: 'S',
          rows: [
            Array.from(
              { length: 500 },
              (_, i) => `Spalte ${i} ${'Beschreibung'.repeat(20)}`,
            ),
          ],
        },
      ],
    };
    const request = headerMatchRequest(wide, 'a'.repeat(400));
    expect(request?.headers).toHaveLength(200);
    expect(request?.headers[0]).toHaveLength(200);
    expect(request?.fileName).toHaveLength(255);
    expect(
      headerMatchRequest(
        { id: 'p', name: 'a.pdf', kind: 'pdf', pages: [] },
        'a.pdf',
      ),
    ).toBeUndefined();
    expect(
      headerMatchRequest(
        {
          id: 'e',
          name: 'e.csv',
          kind: 'csv',
          sheets: [{ name: 'S', rows: [] }],
        },
        'e.csv',
      ),
    ).toBeUndefined();
    expect(baseName('/home/anna/x.csv')).toBe('x.csv');
  });
});

describe('validateRemoteSpec (F5.18)', () => {
  it('accepts every engine fixture and standard mapping unchanged', () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const result = validateRemoteSpec(json(file));
      expect(result.ok, file).toBe(true);
    }
    const standard = resolve(__dirname, '../../../../../mappings/standard');
    const specs = readdirSync(standard).filter((f) => f.endsWith('.json'));
    expect(specs.length).toBeGreaterThan(0);
    for (const file of specs) {
      const result = validateRemoteSpec(
        JSON.parse(readFileSync(resolve(standard, file), 'utf8')),
      );
      expect(result, file).toMatchObject({ ok: true });
    }
  });

  it('refuses keys this app does not know (zod would strip them silently)', () => {
    const spec = json('kraken-ledger.mapping.json');
    const result = validateRemoteSpec({
      ...spec,
      futureFeature: { on: true },
      match: { ...(spec['match'] as object), counterAsset: 'x' },
    });
    expect(result).toEqual({
      ok: false,
      paths: expect.arrayContaining(['/futureFeature', '/match/counterAsset']),
    });
  });

  it('refuses a newer spec version and an invalid spec', () => {
    const spec = json('kraken-ledger.mapping.json');
    expect(
      validateRemoteSpec({ ...spec, version: MAPPING_VERSION + 1 }),
    ).toEqual({ ok: false, paths: ['/version'] });
    const invalid = validateRemoteSpec({ ...spec, match: { headers: 'x' } });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.paths[0]).toMatch(/^\/match/);
    expect(validateRemoteSpec(null).ok).toBe(false);
  });

  it('names dropped keys as JSON Pointers', () => {
    expect(
      droppedKeys(
        { a: 1, 'b/c': 2, l: [{ x: 1, y: 2 }] },
        { a: 1, l: [{ x: 1 }] },
        '',
      ),
    ).toEqual(['/b~1c', '/l/0/y']);
  });
});
