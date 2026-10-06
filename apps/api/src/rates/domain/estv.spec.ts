import { crypto, fx } from '../testing/in-memory-estv';
import {
  type EstvExport,
  estvProjectRates,
  estvSourceLabel,
  isNewerExport,
  matchEstvAssets,
  selectLatestInitialExport,
} from './estv';

const exp = (
  exportType: string,
  exportDate: string,
  fileHash: string,
): EstvExport => ({
  exportType,
  exportDate,
  fileId: '1',
  fileHash,
  fileName: 'kursliste_2025.zip',
  fileSize: null,
});

describe('ESTV version selection (F7.4a)', () => {
  it('takes a full export, the highest schema, then the newest date — never a delta', () => {
    const list = [
      exp('THIRD.INIT.120', '2026-03-03T00:00:00.000Z', 'a'),
      exp('THIRD.DELTA.220', '2026-03-04T00:00:00.000Z', 'b'),
      exp('THIRD.INIT.220', '2026-03-01T00:00:00.000Z', 'c'),
      exp('THIRD.INIT.220', '2026-03-02T00:00:00.000Z', 'd'),
      exp('THIRD.INIT.200', '2026-03-05T00:00:00.000Z', 'e'),
      exp('THIRD.INIT.x', '2026-03-06T00:00:00.000Z', 'f'),
    ];
    expect(selectLatestInitialExport(list)?.fileHash).toBe('d');
    expect(
      selectLatestInitialExport([
        exp('THIRD.DELTA.220', '2026-03-04T00:00:00.000Z', 'b'),
      ]),
    ).toBeUndefined();
    expect(selectLatestInitialExport([])).toBeUndefined();
  });

  it('downloads only a different, not older file', () => {
    const stored = {
      exportType: 'THIRD.INIT.220',
      exportDate: '2026-03-02T00:00:00.000Z',
      fileHash: 'd',
    };
    expect(isNewerExport(null, exp('THIRD.INIT.220', '2026-01-01', 'x'))).toBe(
      true,
    );
    expect(
      isNewerExport(
        stored,
        exp('THIRD.INIT.220', '2026-05-01T00:00:00.000Z', 'd'),
      ),
    ).toBe(false);
    expect(
      isNewerExport(
        stored,
        exp('THIRD.INIT.220', '2026-05-01T00:00:00.000Z', 'n'),
      ),
    ).toBe(true);
    expect(
      isNewerExport(
        stored,
        exp('THIRD.INIT.220', '2026-01-01T00:00:00.000Z', 'o'),
      ),
    ).toBe(false);
    // An older schema never replaces a newer one.
    expect(
      isNewerExport(
        stored,
        exp('THIRD.INIT.200', '2026-06-01T00:00:00.000Z', 'p'),
      ),
    ).toBe(false);
  });

  it('labels the source with year and date of the version', () => {
    expect(estvSourceLabel(2025, '2026-10-02T18:27:05.000Z')).toBe(
      'ESTV-Kursliste 2025, Stand 02.10.2026',
    );
  });
});

describe('matching project assets to the Kursliste (F7.4a)', () => {
  const list = [
    crypto('BTC', 'Bitcoin', '70000', '1'),
    crypto('ETH', 'Ethereum', '2400', '2'),
    crypto('IOT', 'IOTA', '0.07', '3'),
    crypto('MATIC', 'Polygon Spot', '0.2', '4'),
    crypto('DOT', 'Polkadot', '4', '5'),
    crypto('DOT', 'Dotcoin', '0.01', '6'),
    crypto('UNI', 'Uniswap Protocol Token', '5', '7'),
    crypto('UNI', 'Unicorn', '0.1', '8'),
    crypto('SOL', 'Solana', '100', '9'),
    crypto('SOL', 'Solana', '100', '9'),
    crypto('XEM', 'NEM', '0.01', '10'),
    fx('USD', '0.79'),
  ];

  it('matches by ticker, alias and name; several entries → the known name or ambiguous', () => {
    const result = matchEstvAssets(
      ['btc', 'MIOTA', 'POL', 'DOT', 'UNI', 'SOL', 'NEM', 'FLR', 'USD'],
      list,
      { knownNames: { DOT: 'polkadot', UNI: 'uniswap' } },
    );
    expect(
      result.matched.map(
        ({ asset, rate }) => `${asset}=${rate.symbol}:${rate.value}`,
      ),
    ).toEqual([
      'BTC=BTC:70000',
      'DOT=DOT:4',
      'MIOTA=IOT:0.07',
      'NEM=XEM:0.01',
      'POL=MATIC:0.2',
      // Two rows of the same entry (same valor) are one.
      'SOL=SOL:100',
    ]);
    // "uniswap" is not exactly any candidate's name: no value rather than a wrong one.
    expect(result.ambiguous).toEqual([
      {
        asset: 'UNI',
        candidates: [
          { symbol: 'UNI', name: 'Unicorn', valorNumber: '8' },
          { symbol: 'UNI', name: 'Uniswap Protocol Token', valorNumber: '7' },
        ],
      },
    ]);
    // Exchange rates are never matched as assets.
    expect(result.unmatched).toEqual(['FLR', 'USD']);
  });

  it('builds the project rates: 31.12. in CHF, plus USD/EUR year-end, all labelled', () => {
    const { matched } = matchEstvAssets(['BTC'], list);
    expect(
      estvProjectRates(
        2025,
        { exportDate: '2026-03-02T08:00:00.000Z' },
        matched,
        [...list, fx('EUR', '0.93'), fx('JPY', '0.005')],
      ),
    ).toEqual([
      {
        kind: 'price',
        asset: 'BTC',
        currency: 'CHF',
        date: '2025-12-31',
        value: '70000',
        source: 'estv',
        note: 'ESTV-Kursliste 2025, Stand 02.03.2026',
      },
      expect.objectContaining({ kind: 'fx', asset: 'USD', value: '0.79' }),
      expect.objectContaining({ kind: 'fx', asset: 'EUR', value: '0.93' }),
    ]);
  });
});
