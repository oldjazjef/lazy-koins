import type { Booking, BookingKind, Holding } from '../bookings/booking';
import type { Correction } from '../corrections/corrections';
import { parseDecimal } from '../money/decimal';
import type { RateEntry } from '../rates/rate-table';
import { chRules } from '../rules/country-rules';
import { assetsNeedingPrices, calculate } from './calculate';
import type { CalculationInput, Position } from './types';

/** Synthetic records only (CLAUDE.md, Private data). */
let seq = 0;
function booking(
  over: Partial<
    Omit<Booking, 'quantity' | 'fee' | 'valueUsd' | 'feeValueUsd'>
  > & {
    quantity: string;
    fee?: string;
    valueUsd?: string;
    feeValueUsd?: string;
  },
): Booking {
  seq += 1;
  const { quantity, fee, valueUsd, feeValueUsd, ...rest } = over;
  return {
    id: `f1:${seq}`,
    sourceFileId: 'f1',
    row: seq,
    platform: 'kraken',
    accountId: 'main',
    timestamp: '2025-06-01T12:00:00.000Z',
    asset: 'BTC',
    kind: 'trade',
    rawType: 'trade',
    ...rest,
    quantity: parseDecimal(quantity),
    fee: fee === undefined ? undefined : parseDecimal(fee),
    valueUsd: valueUsd === undefined ? undefined : parseDecimal(valueUsd),
    feeValueUsd:
      feeValueUsd === undefined ? undefined : parseDecimal(feeValueUsd),
  } as Booking;
}

function holding(
  over: Partial<Omit<Holding, 'quantity' | 'priceChf'>> & {
    quantity: string;
    priceChf?: string;
  },
): Holding {
  seq += 1;
  const { quantity, priceChf, ...rest } = over;
  return {
    id: `s1:${seq}:holding`,
    sourceFileId: 's1',
    row: seq,
    platform: 'kraken',
    accountId: 'main',
    asset: 'BTC',
    asOf: '2025-12-31',
    ...rest,
    quantity: parseDecimal(quantity),
    priceChf: priceChf === undefined ? undefined : parseDecimal(priceChf),
  } as Holding;
}

const fx = (date: string, value: string, asset = 'USD'): RateEntry => ({
  kind: 'fx',
  asset,
  currency: 'CHF',
  date,
  value,
  source: 'ecb',
});
const usd = (
  asset: string,
  date: string,
  value: string,
  source: RateEntry['source'] = 'binance',
): RateEntry => ({
  kind: 'price',
  asset,
  currency: 'USD',
  date,
  value,
  source,
});
const chf = (
  asset: string,
  date: string,
  value: string,
  source: RateEntry['source'] = 'coingecko',
): RateEntry => ({
  kind: 'price',
  asset,
  currency: 'CHF',
  date,
  value,
  source,
});

function input(over: Partial<CalculationInput> = {}): CalculationInput {
  return {
    taxYear: 2025,
    rules: chRules,
    bookings: [],
    holdings: [],
    corrections: [],
    rates: [fx('2025-12-31', '0.8'), fx('2025-06-01', '0.9')],
    ...over,
  };
}

function correction(
  id: string,
  data: Correction['data'],
  createdAt = '2026-01-10T00:00:00.000Z',
): Correction {
  return { id, createdAt, reason: 'Test', data };
}

describe('positions at 31.12. (F7.1)', () => {
  it('sums a ledger: Σ quantity − Σ fee up to year end, later bookings ignored', () => {
    const result = calculate(
      input({
        bookings: [
          booking({ asset: 'CHF', quantity: '1000', kind: 'deposit' }),
          booking({ asset: 'CHF', quantity: '-500', fee: '1.3' }),
          booking({ asset: 'BTC', quantity: '0.005' }),
          booking({
            asset: 'BTC',
            quantity: '0.000012345678901234',
            kind: 'income_staking',
            fee: '0.000000000000000034',
          }),
          booking({
            asset: 'BTC',
            quantity: '1',
            timestamp: '2026-01-01T00:00:00.000Z',
          }),
        ],
        rates: [fx('2025-12-31', '0.8'), usd('BTC', '2025-12-31', '90000')],
      }),
    );
    const btc = result.positions.find((p) => p.asset === 'BTC');
    expect(btc).toMatchObject({
      quantity: '0.0050123456789012',
      quantitySource: 'ledger',
      priceUsd: '90000',
      usdChf: '0.8',
      priceChf: '72000',
      valueChf: '360.8888888808864',
      status: 'ok',
    });
    expect(result.positions.find((p) => p.asset === 'CHF')).toMatchObject({
      quantity: '498.7',
      valueChf: '498.7',
      priceOrigin: 'home',
    });
  });

  it('subtracts a fee charged in another asset from that asset', () => {
    const result = calculate(
      input({
        bookings: [
          booking({ asset: 'BNB', quantity: '1', kind: 'deposit' }),
          booking({
            asset: 'ETH',
            quantity: '2',
            fee: '0.01',
            feeAsset: 'BNB',
          }),
        ],
      }),
    );
    expect(
      result.positions.map((p) => [p.asset, p.quantity, p.recordIds.length]),
    ).toEqual([
      ['BNB', '0.99', 2],
      ['ETH', '2', 1],
    ]);
  });

  it('drops |quantity| < 1e-7 (FACHREGELN)', () => {
    const result = calculate(
      input({
        bookings: [
          booking({ asset: 'DOGE', quantity: '0.00000009' }),
          booking({ asset: 'ADA', quantity: '0.0000001' }),
        ],
      }),
    );
    expect(result.positions.map((p) => p.asset)).toEqual(['ADA']);
  });

  it('prefers a statement for the whole account and matches a Kraken-like ledger exactly', () => {
    const bookings = [
      booking({ asset: 'ETH', quantity: '1.5', kind: 'deposit' }),
      booking({ asset: 'ETH', quantity: '-0.25', fee: '0.0001' }),
      booking({ asset: 'DOT', quantity: '10' }),
      booking({
        asset: 'DOT',
        quantity: '0.123456789012345678',
        kind: 'income_staking',
      }),
    ];
    const statement = [
      holding({ asset: 'ETH', quantity: '1.2499' }),
      holding({ asset: 'DOT', quantity: '7' }),
      // DOT.S: a second balance of the same asset adds up.
      holding({ asset: 'DOT', quantity: '3.123456789012345678' }),
    ];
    const result = calculate(input({ bookings, holdings: statement }));
    expect(
      result.positions.map((p) => [p.asset, p.quantity, p.quantitySource]),
    ).toEqual([
      ['DOT', '10.123456789012345678', 'statement'],
      ['ETH', '1.2499', 'statement'],
    ]);
    expect(
      result.checks.find((c) => c.kind === 'ledgerVsStatement'),
    ).toMatchObject({ light: 'green', items: 0 });
  });

  it('flags a ledger that differs from the statement, with the difference and its CHF impact', () => {
    const result = calculate(
      input({
        bookings: [booking({ asset: 'ETH', quantity: '1.5' })],
        holdings: [holding({ asset: 'ETH', quantity: '1.4' })],
        rates: [fx('2025-12-31', '0.8'), usd('ETH', '2025-12-31', '3000')],
      }),
    );
    expect(
      result.checks.find((c) => c.kind === 'ledgerVsStatement'),
    ).toMatchObject({ light: 'red', items: 1, impactChf: '240' });
    expect(
      result.openItems.find((i) => i.reason === 'balanceDiffers'),
    ).toMatchObject({
      asset: 'ETH',
      params: { expected: '1.4', actual: '1.5', difference: '0.1' },
      impactChf: '240',
    });
  });

  it("checks a ledger's own running balances without preferring them to the ledger", () => {
    const bookings = [
      booking({ asset: 'ETH', quantity: '2', sourceFileId: 'L' }),
      booking({ asset: 'ETH', quantity: '-1', fee: '0.01', sourceFileId: 'L' }),
    ];
    const ok = calculate(
      input({
        bookings,
        holdings: [
          holding({
            asset: 'ETH',
            quantity: '0.99',
            sourceFileId: 'L',
            asOf: '2025-06-01',
          }),
        ],
      }),
    );
    expect(ok.positions[0]).toMatchObject({
      quantity: '0.99',
      quantitySource: 'ledger',
    });
    expect(ok.checks.find((c) => c.kind === 'ledgerVsStatement')?.light).toBe(
      'green',
    );
    const off = calculate(
      input({
        bookings,
        holdings: [
          holding({
            asset: 'ETH',
            quantity: '1',
            sourceFileId: 'L',
            asOf: '2025-06-01',
          }),
        ],
      }),
    );
    expect(
      off.openItems.find((i) => i.reason === 'ledgerBalanceDiffers'),
    ).toMatchObject({ params: { expected: '1', actual: '0.99' } });
  });

  it('keeps a position without price with value null and status missingPrice', () => {
    const result = calculate(
      input({ bookings: [booking({ asset: 'XYZ', quantity: '5' })] }),
    );
    expect(result.positions[0]).toMatchObject({
      valueChf: null,
      priceChf: null,
      status: 'missingPrice',
    });
    expect(result.totals).toMatchObject({ wealthChf: '0', missingPrices: 1 });
    expect(result.openItems.map((i) => i.reason)).toContain(
      'positionWithoutPrice',
    );
  });

  it('hides spam tokens (name or spam bookings) from the total', () => {
    const result = calculate(
      input({
        bookings: [
          booking({ asset: 'CLAIMETH', quantity: '1000', kind: 'deposit' }),
          booking({ asset: 'SCAM', quantity: '5', kind: 'spam' }),
        ],
      }),
    );
    expect(result.positions.map((p) => p.status)).toEqual(['spam', 'spam']);
    expect(result.totals.positions).toBe(0);
  });
});

describe('price priority (FACHREGELN, Kurse)', () => {
  const at = (rates: RateEntry[], extra: { priceChf?: string } = {}) =>
    calculate(
      input({
        holdings: [holding({ asset: 'ETH', quantity: '2', ...extra })],
        rates: [fx('2025-12-31', '0.8'), ...rates],
      }),
    ).positions[0] as Position;

  it('ESTV beats a statement CHF price, which beats a stored USD price', () => {
    const rates = [usd('ETH', '2025-12-31', '3000')];
    expect(at(rates)).toMatchObject({
      priceChf: '2400',
      priceOrigin: 'tableUsd',
    });
    expect(at(rates, { priceChf: '2500' })).toMatchObject({
      priceChf: '2500',
      priceOrigin: 'recordChf',
      chfDirect: '2500',
    });
    expect(
      at([...rates, chf('ETH', '2025-12-31', '2600', 'estv')], {
        priceChf: '2500',
      }),
    ).toMatchObject({
      priceChf: '2600',
      priceOrigin: 'estv',
      estvChf: '2600',
      valueChf: '5200',
    });
  });

  it('an override (F9.1) beats ESTV', () => {
    const result = calculate(
      input({
        holdings: [holding({ asset: 'ETH', quantity: '2' })],
        rates: [
          fx('2025-12-31', '0.8'),
          chf('ETH', '2025-12-31', '2600', 'estv'),
        ],
        corrections: [
          correction('c1', {
            type: 'price_override',
            asset: 'ETH',
            date: '2025-12-31',
            priceChf: '2700',
          }),
        ],
      }),
    );
    expect(result.positions[0]).toMatchObject({
      priceChf: '2700',
      priceOrigin: 'override',
    });
  });

  it('values stablecoins at 1 USD, CHF at 1 and EUR via EUR/CHF', () => {
    const result = calculate(
      input({
        bookings: [
          booking({ asset: 'USDC', quantity: '100' }),
          booking({ asset: 'CHF', quantity: '50' }),
          booking({ asset: 'EUR', quantity: '10' }),
        ],
        rates: [fx('2025-12-31', '0.8'), fx('2025-12-31', '0.93', 'EUR')],
      }),
    );
    expect(
      result.positions.map((p) => [p.asset, p.valueChf, p.priceOrigin]),
    ).toEqual([
      ['CHF', '50', 'home'],
      ['EUR', '9.3', 'fx'],
      ['USDC', '80', 'pegged'],
    ]);
    expect(result.parameters).toMatchObject({ usdChf: '0.8', eurChf: '0.93' });
  });

  it('uses the last price at most 14 days old, else the first after within 14 days', () => {
    expect(at([usd('ETH', '2025-12-17', '3000')]).priceChf).toBe('2400');
    expect(at([usd('ETH', '2025-12-16', '3000')]).status).toBe('missingPrice');
    // A later price within 14 days (the year-end close is missing).
    expect(at([usd('ETH', '2026-01-14', '3100')])).toMatchObject({
      priceChf: '2480',
      priceDate: '2026-01-14',
    });
    expect(at([usd('ETH', '2026-01-15', '3100')]).status).toBe('missingPrice');
    // Before wins over after when both are within the tolerance.
    expect(
      at([usd('ETH', '2025-12-20', '3000'), usd('ETH', '2026-01-01', '9999')])
        .priceChf,
    ).toBe('2400');
  });

  it('forward-fills the exchange rate from the last fixing', () => {
    const result = calculate(
      input({
        holdings: [holding({ asset: 'USDT', quantity: '10' })],
        rates: [fx('2025-12-29', '0.79')],
      }),
    );
    expect(result.positions[0]?.valueChf).toBe('7.9');
  });
});

describe('income (F7.2) valued at arrival', () => {
  it('values net after a fee in the same asset, gross as information', () => {
    const result = calculate(
      input({
        bookings: [
          booking({
            asset: 'DOT',
            quantity: '2',
            fee: '0.5',
            kind: 'income_staking',
            timestamp: '2025-06-01T23:30:00.000Z',
          }),
        ],
        rates: [fx('2025-06-01', '0.9'), usd('DOT', '2025-06-01', '5')],
      }),
    );
    expect(result.income[0]).toMatchObject({
      category: 'staking',
      date: '2025-06-01',
      quantityNet: '1.5',
      priceUsd: '5',
      usdChf: '0.9',
      priceChf: '4.5',
      valueUsd: '7.5',
      valueChf: '6.75',
      grossValueChf: '9',
    });
    expect(result.totals.incomeChf).toBe('6.75');
    expect(
      result.categories.find((c) => c.category === 'staking'),
    ).toMatchObject({ valueChf: '6.75', lines: 1 });
  });

  it("uses the platform's own USD value net of the fee's (Kraken amountusd − feeusd) × USD/CHF of the day", () => {
    const result = calculate(
      input({
        bookings: [
          booking({
            asset: 'ETH',
            quantity: '0.01',
            fee: '0.0025',
            valueUsd: '30.00',
            feeValueUsd: '7.50',
            kind: 'income_interest',
          }),
        ],
        rates: [fx('2025-06-01', '0.9'), usd('ETH', '2025-06-01', '9999')],
      }),
    );
    expect(result.income[0]).toMatchObject({
      priceOrigin: 'recordValueUsd',
      valueUsd: '22.5',
      valueChf: '20.25',
      grossValueChf: '27',
    });
  });

  it('only counts bookings of the tax year, and lists airdrops, hard forks and losses separately (F7.3)', () => {
    const result = calculate(
      input({
        bookings: [
          booking({ asset: 'ETH', quantity: '1', kind: 'income_airdrop' }),
          booking({ asset: 'BCH', quantity: '1', kind: 'income_hardfork' }),
          booking({ asset: 'ETH', quantity: '-0.5', kind: 'loss' }),
          booking({
            asset: 'ETH',
            quantity: '1',
            kind: 'income_airdrop',
            timestamp: '2024-12-31T23:59:59.000Z',
          }),
        ],
        rates: [fx('2025-06-01', '0.9'), usd('ETH', '2025-06-01', '2000')],
      }),
    );
    expect(result.income.map((l) => l.asset)).toEqual(['ETH', 'BCH']);
    expect(
      result.oneOffEvents.map((e) => [
        e.kind,
        e.valueChf,
        e.incomeLineId !== null,
      ]),
    ).toEqual([
      ['income_airdrop', '1800', true],
      ['income_hardfork', null, true],
      ['loss', '-900', false],
    ]);
    expect(result.openItems.map((i) => i.key)).toContain(
      'missingIncomePrice:BCH',
    );
  });
});

describe('Earn gap (FACHREGELN, Differenzmethode)', () => {
  const holdings = [
    holding({
      platform: 'binance',
      asset: 'BNB',
      quantity: '10',
      asOf: '2024-12-31',
      sourceFileId: 'S24',
    }),
    holding({
      platform: 'binance',
      asset: 'USDT',
      quantity: '100',
      asOf: '2024-12-31',
      sourceFileId: 'S24',
    }),
    holding({
      platform: 'binance',
      asset: 'BNB',
      quantity: '12.5',
      sourceFileId: 'S25',
    }),
    holding({
      platform: 'binance',
      asset: 'ADA',
      quantity: '5',
      sourceFileId: 'S25',
    }),
    holding({
      platform: 'binance',
      asset: 'USDT',
      quantity: '300',
      sourceFileId: 'S25',
    }),
  ];
  const bookings = [
    booking({
      platform: 'binance',
      asset: 'BNB',
      quantity: '1',
      kind: 'trade',
      sourceFileId: 'H',
    }),
    booking({
      platform: 'binance',
      asset: 'BNB',
      quantity: '0.5',
      kind: 'income_interest',
      sourceFileId: 'H',
    }),
    booking({
      platform: 'binance',
      asset: 'BNB',
      quantity: '-4',
      kind: 'transfer',
      sourceFileId: 'H',
    }),
    booking({
      platform: 'binance',
      asset: 'ADA',
      quantity: '6',
      kind: 'trade',
      sourceFileId: 'H',
    }),
  ];
  const rates = [
    fx('2025-01-01', '0.9'),
    fx('2025-12-31', '0.8'),
    usd('BNB', '2025-01-01', '600'),
    usd('BNB', '2025-12-31', '700'),
  ];

  it('values a positive gap at the yearly average and reports a negative one', () => {
    const result = calculate(input({ bookings, holdings, rates }));
    expect(
      result.earnGaps.map((g) => [
        g.asset,
        g.gapQuantity,
        g.status,
        g.valueChf,
      ]),
    ).toEqual([
      ['ADA', '-1', 'negative', null],
      // (12.5 − 10) − (1 + 0.5) = 1; transfers excluded; average (600·0.9 + 700·0.8) / 2 = 550
      ['BNB', '1', 'income', '550'],
    ]);
    expect(
      result.categories.find((c) => c.category === 'earn_gap')?.valueChf,
    ).toBe('550');
    expect(
      result.openItems.find((i) => i.reason === 'negativeEarnGap'),
    ).toMatchObject({ asset: 'ADA', params: { gap: '-1' } });
    // USDT is excluded (FACHREGELN); the positions come from the statement.
    expect(result.earnGaps.some((g) => g.asset === 'USDT')).toBe(false);
    expect(result.positions.map((p) => p.quantitySource)).toEqual([
      'statement',
      'statement',
      'statement',
    ]);
  });

  it('needs balances at both ends and bookings in between', () => {
    const result = calculate(
      input({
        bookings,
        holdings: holdings.filter((h) => h.asOf === '2025-12-31'),
        rates,
      }),
    );
    expect(result.earnGaps).toEqual([]);
    expect(result.checks.find((c) => c.kind === 'earnGap')?.light).toBe('grey');
  });
});

describe('corrections (F9)', () => {
  it('reclassifies a booking, with before and after; undone corrections are simply absent', () => {
    const reward = booking({
      asset: 'CHF',
      quantity: '10',
      kind: 'income_interest',
    });
    const result = calculate(
      input({
        bookings: [reward],
        corrections: [
          correction('c1', {
            type: 'reclassify',
            bookingId: reward.id,
            kind: 'transfer',
          }),
          correction('c2', {
            type: 'reclassify',
            bookingId: 'gone:1',
            kind: 'spam',
          }),
        ],
      }),
    );
    expect(result.income).toEqual([]);
    expect(result.corrections).toEqual([
      {
        correctionId: 'c1',
        type: 'reclassify',
        status: 'applied',
        before: { bookingId: reward.id, kind: 'income_interest' },
        after: { bookingId: reward.id, kind: 'transfer' },
      },
      expect.objectContaining({ correctionId: 'c2', status: 'targetMissing' }),
    ]);
    expect(calculate(input({ bookings: [reward] })).totals.incomeChf).toBe(
      '10',
    );
  });

  it('adds manual bookings and holdings that trace to the correction', () => {
    const result = calculate(
      input({
        bookings: [booking({ asset: 'ETH', quantity: '1' })],
        corrections: [
          correction('m1', {
            type: 'manual_booking',
            booking: {
              platform: 'ledger-nano',
              accountId: 'main',
              timestamp: '2025-08-01T00:00:00Z',
              asset: 'BCH',
              quantity: '2',
              kind: 'income_hardfork',
              priceChf: '300',
            },
          }),
          correction('m2', {
            type: 'manual_holding',
            holding: {
              platform: 'kraken',
              accountId: 'main',
              asset: 'ETH',
              quantity: '0.75',
              asOf: '2025-12-31',
              priceChf: '2000',
            },
          }),
        ],
      }),
    );
    expect(result.income[0]).toMatchObject({
      bookingId: 'correction:m1',
      valueChf: '600',
    });
    expect(result.positions.find((p) => p.asset === 'ETH')).toMatchObject({
      quantity: '0.75',
      quantitySource: 'manual',
      valueChf: '1500',
    });
    expect(result.records['correction:m2']).toMatchObject({
      sourceFileId: 'correction:m2',
      row: 0,
    });
  });
});

describe('checks (F8.1)', () => {
  it('pairs withdrawals with deposits on own accounts, within fee tolerance and time window', () => {
    const result = calculate(
      input({
        bookings: [
          booking({
            asset: 'ETH',
            quantity: '-1',
            kind: 'withdrawal',
            timestamp: '2025-03-01T10:00:00.000Z',
          }),
          booking({
            platform: 'wallet',
            asset: 'ETH',
            quantity: '0.995',
            kind: 'deposit',
            timestamp: '2025-03-01T10:20:00.000Z',
          }),
          booking({
            asset: 'BTC',
            quantity: '-0.1',
            kind: 'withdrawal',
            timestamp: '2025-04-01T10:00:00.000Z',
          }),
          booking({
            platform: 'wallet',
            asset: 'BTC',
            quantity: '0.1',
            kind: 'deposit',
            timestamp: '2025-05-01T10:00:00.000Z',
          }),
          booking({ asset: 'CHF', quantity: '-100', kind: 'withdrawal' }),
        ],
      }),
    );
    expect(
      result.openItems
        .filter((i) => i.check === 'unmatchedWithdrawals')
        .map((i) => i.asset),
    ).toEqual(['BTC']);
    expect(
      result.openItems
        .filter((i) => i.check === 'unmatchedDeposits')
        .map((i) => i.asset),
    ).toEqual(['BTC']);
    expect(
      result.checks.find((c) => c.kind === 'unmatchedWithdrawals')?.light,
    ).toBe('yellow');
  });

  it('compares the opening balance with the previous year and the totals (F8.3)', () => {
    const result = calculate(
      input({
        bookings: [
          booking({
            asset: 'CHF',
            quantity: '100',
            timestamp: '2024-05-01T00:00:00.000Z',
          }),
          booking({ asset: 'CHF', quantity: '50' }),
        ],
        previous: {
          taxYear: 2024,
          wealthChf: '120',
          incomeChf: '0',
          positions: [
            {
              platform: 'kraken',
              accountId: 'main',
              asset: 'CHF',
              quantity: '120',
              valueChf: '120',
            },
            {
              platform: 'kraken',
              accountId: 'main',
              asset: 'ETH',
              quantity: '1',
              valueChf: '2000',
            },
          ],
        },
      }),
    );
    expect(
      result.openItems
        .filter((i) => i.check === 'openingBalance')
        .map((i) => [i.asset, i.params['difference']]),
    ).toEqual([
      ['CHF', '-20'],
      ['ETH', '-1'],
    ]);
    expect(result.comparison).toMatchObject({
      previousTaxYear: 2024,
      wealthDeltaChf: '30',
      removedPositions: [expect.objectContaining({ asset: 'ETH' })],
      newPositions: [],
    });
  });

  it('groups unclassified bookings; without wallets the wallet check is not applicable', () => {
    const result = calculate(
      input({
        bookings: [
          booking({
            asset: 'ETH',
            quantity: '1',
            kind: 'unknown',
            rawType: 'odd',
          }),
          booking({
            asset: 'ETH',
            quantity: '2',
            kind: 'unknown',
            rawType: 'odd',
          }),
        ],
      }),
    );
    expect(
      result.openItems.find((i) => i.check === 'unclassified'),
    ).toMatchObject({
      params: { count: '2', rawType: 'odd', quantity: '3' },
    });
    expect(result.checks.find((c) => c.kind === 'walletNetworks')?.light).toBe(
      'grey',
    );
    expect(result.checks.find((c) => c.kind === 'openingBalance')?.light).toBe(
      'grey',
    );
  });
});

describe('determinism (F7.6)', () => {
  it('gives the same result for shuffled input', () => {
    const bookings: Booking[] = [];
    for (let i = 0; i < 30; i += 1) {
      const kinds: BookingKind[] = [
        'trade',
        'income_staking',
        'deposit',
        'withdrawal',
      ];
      bookings.push(
        booking({
          asset: ['BTC', 'ETH', 'DOT'][i % 3] ?? 'BTC',
          quantity: i % 4 === 3 ? '-0.1' : '0.3',
          kind: kinds[i % 4] ?? 'trade',
          timestamp: `2025-0${(i % 9) + 1}-1${i % 10}T00:00:00.000Z`,
          platform: i % 2 ? 'kraken' : 'binance',
        }),
      );
    }
    const rates = [fx('2025-01-01', '0.9'), usd('BTC', '2025-03-10', '80000')];
    const a = calculate(input({ bookings, rates }));
    const b = calculate(
      input({ bookings: [...bookings].reverse(), rates: [...rates].reverse() }),
    );
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(assetsNeedingPrices(a, chRules)).toEqual(['BTC', 'DOT', 'ETH']);
  });
});
