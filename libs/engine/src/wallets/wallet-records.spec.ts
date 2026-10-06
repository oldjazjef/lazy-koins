import { calculate } from '../calculation/calculate';
import { csvSourceFile } from '../importers/text/csv';
import { chRules } from '../rules/country-rules';
import { parseStandardFile } from '../standard/standard-importer';
import { classifyAddress, networksForAddress } from './networks';
import {
  type ChainMovement,
  tokenVerdicts,
  unitsToDecimal,
  walletBookingRows,
  walletBookingsCsv,
  walletHoldingsCsv,
  walletPlatform,
} from './wallet-records';

const ME = '0x1111111111111111111111111111111111111111';
const FRIEND = '0x2222222222222222222222222222222222222222';
const POISON = '0x2222220000000000000000000000000000002222';

function movement(over: Partial<ChainMovement>): ChainMovement {
  return {
    txHash: '0xaa',
    timestamp: '2025-03-01T10:00:00.000Z',
    asset: 'ETH',
    tokenId: null,
    tokenName: null,
    quantity: '0',
    fee: null,
    feeAsset: null,
    type: 'transfer',
    counterparty: null,
    verified: null,
    ...over,
  };
}

/** A synthetic EVM history: deposit, withdrawal with gas, token call, failed tx, spam. */
const HISTORY: ChainMovement[] = [
  movement({ txHash: '0x01', quantity: '2', counterparty: FRIEND }),
  movement({
    txHash: '0x02',
    timestamp: '2025-04-01T10:00:00.000Z',
    quantity: '-0.5',
    fee: '0.00042',
    feeAsset: 'ETH',
    counterparty: FRIEND,
  }),
  movement({
    txHash: '0x03',
    timestamp: '2025-05-01T10:00:00.000Z',
    asset: 'ETH',
    quantity: '0',
    fee: '0.001',
    feeAsset: 'ETH',
  }),
  movement({
    txHash: '0x03',
    timestamp: '2025-05-01T10:00:00.000Z',
    asset: 'USDC',
    tokenId: '0xa0b8',
    tokenName: 'USD Coin',
    quantity: '-100',
    counterparty: FRIEND,
  }),
  movement({
    txHash: '0x00',
    timestamp: '2025-02-01T10:00:00.000Z',
    asset: 'USDC',
    tokenId: '0xa0b8',
    tokenName: 'USD Coin',
    quantity: '250',
    counterparty: FRIEND,
  }),
  movement({
    txHash: '0x04',
    timestamp: '2025-06-01T10:00:00.000Z',
    quantity: '-1',
    fee: '0.0003',
    feeAsset: 'ETH',
    type: 'failed',
  }),
  movement({
    txHash: '0x05',
    timestamp: '2025-07-01T10:00:00.000Z',
    asset: 'USDT',
    tokenId: '0xbad1',
    tokenName: 'Claim your reward at usdt-gift.com',
    quantity: '1000',
    counterparty: '0x9999999999999999999999999999999999999999',
  }),
  movement({
    txHash: '0x06',
    timestamp: '2025-08-01T10:00:00.000Z',
    asset: 'USDC',
    tokenId: '0xbad2',
    tokenName: 'USD Coin',
    quantity: '0',
    counterparty: POISON,
  }),
  movement({
    txHash: '0x07',
    timestamp: '2026-01-05T10:00:00.000Z',
    quantity: '1',
    counterparty: FRIEND,
  }),
];

describe('unitsToDecimal', () => {
  it('moves the point without a JS number', () => {
    expect(unitsToDecimal('1500000000000000000', 18)).toBe('1.5');
    expect(unitsToDecimal('1', 18)).toBe('0.000000000000000001');
    expect(unitsToDecimal('123456789012345678901234567890', 18)).toBe(
      '123456789012.34567890123456789',
    );
    expect(unitsToDecimal('-2500', 8)).toBe('-0.000025');
    expect(unitsToDecimal('0', 6)).toBe('0');
    expect(unitsToDecimal('42', 0)).toBe('42');
    expect(() => unitsToDecimal('1.5', 18)).toThrow();
  });
});

describe('classifyAddress', () => {
  it('recognises each family and the networks to check', () => {
    expect(classifyAddress(ME)).toBe('evm');
    expect(networksForAddress('evm')).toEqual([
      'ethereum',
      'bsc',
      'polygon',
      'arbitrum',
      'optimism',
      'base',
    ]);
    expect(classifyAddress('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu')).toBe(
      'bitcoinAddress',
    );
    expect(
      classifyAddress(
        'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
      ),
    ).toBe('bitcoinXpub');
    expect(classifyAddress('So11111111111111111111111111111111111111112')).toBe(
      'solana',
    );
    expect(classifyAddress('not an address')).toBeUndefined();
  });
});

describe('spam heuristics (F6.6)', () => {
  it('flags scam names, zero-value poisoning and keeps real tokens', () => {
    const verdicts = tokenVerdicts(HISTORY, 'ETH');
    const by = (key: string) => verdicts.find((v) => v.tokenKey === key);
    expect(by('native')?.spam).toBe(false);
    expect(by('0xa0b8')?.spam).toBe(false);
    expect(by('0xbad1')?.reasons).toContain('namePattern');
    expect(by('0xbad2')?.reasons).toEqual(
      expect.arrayContaining(['zeroValue']),
    );
  });

  it('flags look-alike senders (address poisoning) and unverified dust', () => {
    const verdicts = tokenVerdicts(
      [
        movement({ quantity: '-1', counterparty: FRIEND }),
        movement({
          asset: 'PEPE2',
          tokenId: '0xd1',
          quantity: '0.01',
          counterparty: POISON,
        }),
        movement({
          asset: 'AIR',
          tokenId: '0xd2',
          quantity: '5',
          verified: false,
          counterparty: '0x3333333333333333333333333333333333333333',
        }),
      ],
      'ETH',
    );
    expect(verdicts.find((v) => v.tokenKey === '0xd1')?.reasons).toContain(
      'addressPoisoning',
    );
    expect(verdicts.find((v) => v.tokenKey === '0xd2')?.reasons).toContain(
      'unverifiedDust',
    );
  });

  it('a "kein Spam" override wins but keeps the reasons visible', () => {
    const verdict = tokenVerdicts(HISTORY, 'ETH', new Set(['0xbad1'])).find(
      (v) => v.tokenKey === '0xbad1',
    );
    expect(verdict).toMatchObject({ spam: false, overridden: true });
    expect(verdict?.reasons).toContain('namePattern');
  });
});

describe('derived standard records', () => {
  const context = {
    platform: 'Hauptwallet',
    accountId: 'ethereum',
    nativeAsset: 'ETH',
  };

  it('writes sorted rows: kinds, gas as fee, hash in Referenz, spam under its own asset', () => {
    const rows = walletBookingRows(HISTORY, context);
    expect(rows.map((r) => [r[3], r[4], r[5], r[6], r[10]])).toEqual([
      ['deposit', 'USDC', '250', '', '0x00'],
      ['deposit', 'ETH', '2', '', '0x01'],
      ['withdrawal', 'ETH', '-0.5', '0.00042', '0x02'],
      ['fee', 'ETH', '-0.001', '', '0x03'],
      ['withdrawal', 'USDC', '-100', '', '0x03'],
      ['fee', 'ETH', '-0.0003', '', '0x04'],
      ['spam', 'SPAM:USDT', '1000', '', '0x05'],
      ['spam', 'SPAM:USDC', '0', '', '0x06'],
      ['deposit', 'ETH', '1', '', '0x07'],
    ]);
    // Same input, same bytes (a re-fetch without news keeps the file).
    expect(walletBookingsCsv(rows)).toBe(
      walletBookingsCsv(walletBookingRows([...HISTORY].reverse(), context)),
    );
  });

  it('the calculation reads them: balance at 31.12. incl. gas, spam hidden, row = index', () => {
    const csv = walletBookingsCsv(walletBookingRows(HISTORY, context));
    const parsed = parseStandardFile(
      csvSourceFile({
        id: 'wallet-sha',
        name: 'Hauptwallet.wallet.csv',
        bytes: new TextEncoder().encode(csv),
      }),
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.bookings[0]).toMatchObject({ row: 2, group: '0x00' });
    const result = calculate({
      taxYear: 2025,
      rules: chRules,
      bookings: parsed.bookings,
      holdings: parsed.holdings,
      corrections: [],
      rates: [],
    });
    const eth = result.positions.find((p) => p.asset === 'ETH');
    // 2 − 0.5 − 0.00042 − 0.001 − 0.0003 (the 2026 deposit is after the cutoff)
    expect(eth?.quantity).toBe('1.49828');
    expect(result.positions.find((p) => p.asset === 'USDC')?.quantity).toBe(
      '150',
    );
    expect(
      result.positions
        .filter((p) => p.asset.startsWith('SPAM:'))
        .map((p) => p.status),
    ).toEqual(['spam']);
  });

  it('manual balances become statement holdings (F6.5)', () => {
    const csv = walletHoldingsCsv([
      {
        platform: 'Hauptwallet',
        accountId: 'cardano',
        asset: 'ADA',
        quantity: '1234.5',
        asOf: '2025-12-31',
        evidence: 'yoroi-31-12.pdf',
      },
    ]);
    const parsed = parseStandardFile(
      csvSourceFile({
        id: 'h',
        name: 'h.csv',
        bytes: new TextEncoder().encode(csv),
      }),
    );
    expect(parsed.holdings).toHaveLength(1);
    expect(parsed.holdings[0]).toMatchObject({
      accountId: 'cardano',
      asOf: '2025-12-31',
      evidence: 'yoroi-31-12.pdf',
    });
  });
});

describe('one platform per wallet and network (F6.5 with F7.1)', () => {
  it("a manual balance of one network never replaces another network's ledger", () => {
    const read = (csv: string, id: string) =>
      parseStandardFile(
        csvSourceFile({
          id,
          name: `${id}.csv`,
          bytes: new TextEncoder().encode(csv),
        }),
      );
    const bookings = read(
      walletBookingsCsv(
        walletBookingRows([movement({ quantity: '2' })], {
          platform: walletPlatform('Ledger', 'ethereum'),
          accountId: 'ethereum',
          nativeAsset: 'ETH',
        }),
      ),
      'b',
    );
    const holdings = read(
      walletHoldingsCsv([
        {
          platform: walletPlatform('Ledger', 'cardano'),
          accountId: 'cardano',
          asset: 'ADA',
          quantity: '100',
          asOf: '2025-12-31',
          evidence: 'beleg.pdf',
        },
      ]),
      'h',
    );
    const result = calculate({
      taxYear: 2025,
      rules: chRules,
      bookings: bookings.bookings,
      holdings: holdings.holdings,
      corrections: [],
      rates: [],
    });
    expect(
      result.positions.map((p) => [
        p.platform,
        p.asset,
        p.quantity,
        p.quantitySource,
      ]),
    ).toEqual([
      ['Ledger · cardano', 'ADA', '100', 'statement'],
      ['Ledger · ethereum', 'ETH', '2', 'ledger'],
    ]);
  });
});
