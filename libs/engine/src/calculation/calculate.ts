import { type Booking, type Holding, isIncome } from '../bookings/booking';
import {
  applyCorrections,
  isCorrectionRecord,
} from '../corrections/corrections';
import {
  type Decimal,
  parseDecimal,
  sum,
  toDecimalString,
  ZERO,
} from '../money/decimal';
import {
  type PriceQuote,
  RateTable,
  unitPriceChf,
  yearlyAverageChf,
} from '../rates/rate-table';
import {
  type CountryRules,
  INCOME_CATEGORIES,
  INCOME_CATEGORY_OF,
  ONE_OFF_KINDS,
} from '../rules/country-rules';
import {
  type CalculationInput,
  type CalculationResult,
  type CategoryTotal,
  type Check,
  CHECK_KINDS,
  type CheckKind,
  type Comparison,
  type EarnGap,
  ENGINE_VERSION,
  type IncomeLine,
  type Light,
  type OneOffEvent,
  type OpenItem,
  type PlatformTotal,
  type Position,
  type PriceColumns,
  type QuantitySource,
  type RecordSummary,
} from './types';

/**
 * The calculation (F7): a pure, deterministic function of the project's standard records,
 * corrections, rate table and country rules. Same input, same result (F7.6) — every collection
 * is sorted explicitly, never by input order.
 */

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const str = (value: Decimal) => toDecimalString(value);
const opt = (value: Decimal | undefined | null) =>
  value === undefined || value === null ? null : toDecimalString(value);

function accountKey(platform: string, accountId: string): string {
  return `${platform}|${accountId}`;
}

interface Balance {
  platform: string;
  accountId: string;
  asset: string;
  quantity: Decimal;
  ids: string[];
}

/** platform|account → asset → balance. */
type Balances = Map<string, Map<string, Balance>>;

function balanceOf(
  balances: Balances,
  platform: string,
  accountId: string,
  asset: string,
): Balance {
  const key = accountKey(platform, accountId);
  let account = balances.get(key);
  if (!account) {
    account = new Map();
    balances.set(key, account);
  }
  let balance = account.get(asset);
  if (!balance) {
    balance = { platform, accountId, asset, quantity: ZERO, ids: [] };
    account.set(asset, balance);
  }
  return balance;
}

/** The fee of a booking and the asset it is charged in. */
function feeOf(booking: Booking): { fee: Decimal; asset: string } | undefined {
  if (booking.fee === undefined || booking.fee.isZero()) return undefined;
  return { fee: booking.fee, asset: booking.feeAsset ?? booking.asset };
}

/**
 * Ledger balances (FACHREGELN, Kraken): Σ quantity − Σ fee per account and asset over every
 * booking before `before` (an ISO timestamp, exclusive).
 */
function ledgerBalances(
  bookings: readonly Booking[],
  before: string,
): Balances {
  const balances: Balances = new Map();
  for (const booking of bookings) {
    if (booking.timestamp >= before) continue;
    const own = balanceOf(
      balances,
      booking.platform,
      booking.accountId,
      booking.asset,
    );
    own.quantity = own.quantity.plus(booking.quantity);
    own.ids.push(booking.id);
    const fee = feeOf(booking);
    if (fee) {
      const charged = balanceOf(
        balances,
        booking.platform,
        booking.accountId,
        fee.asset,
      );
      charged.quantity = charged.quantity.minus(fee.fee);
      if (charged !== own) charged.ids.push(booking.id);
    }
  }
  return balances;
}

/**
 * Statement balances at a date: per account, the holdings of one file (several rows of an asset
 * add up — e.g. `DOT` and `DOT.S`). When several files state the same account and date, the one
 * with most rows wins (then the smaller file id), so nothing is counted twice.
 */
function statementBalances(
  holdings: readonly Holding[],
  date: string,
): Balances {
  const perFile = new Map<string, Map<string, Holding[]>>();
  for (const holding of holdings) {
    if (holding.asOf !== date) continue;
    const key = accountKey(holding.platform, holding.accountId);
    const files = perFile.get(key) ?? new Map<string, Holding[]>();
    const list = files.get(holding.sourceFileId) ?? [];
    list.push(holding);
    files.set(holding.sourceFileId, list);
    perFile.set(key, files);
  }
  const balances: Balances = new Map();
  for (const files of perFile.values()) {
    const chosen = [...files.entries()].sort(
      ([a, la], [b, lb]) => lb.length - la.length || compareText(a, b),
    )[0];
    if (!chosen) continue;
    for (const holding of chosen[1]) {
      const balance = balanceOf(
        balances,
        holding.platform,
        holding.accountId,
        holding.asset,
      );
      balance.quantity = balance.quantity.plus(holding.quantity);
      balance.ids.push(holding.id);
    }
  }
  return balances;
}

/** Statement balances with manual holdings (F9.3) replacing their asset. */
function overlay(statements: Balances, manual: Balances): Balances {
  const out: Balances = new Map();
  for (const [key, account] of statements) out.set(key, new Map(account));
  for (const [key, account] of manual) {
    const target = out.get(key) ?? new Map<string, Balance>();
    for (const [asset, balance] of account) target.set(asset, balance);
    out.set(key, target);
  }
  return out;
}

interface RawPosition {
  platform: string;
  accountId: string;
  asset: string;
  quantity: Decimal;
  source: QuantitySource;
  ids: string[];
}

/**
 * Positions at a date (F7.1): from the statement of an account when one exists for that date
 * (it takes precedence for the whole account), otherwise from the ledger; a manual holding
 * (F9.3) replaces its asset. |quantity| below the dust threshold is dropped.
 */
function positionsAt(
  ledger: Balances,
  statements: Balances,
  manual: Balances,
  dust: Decimal,
): RawPosition[] {
  const out = new Map<string, RawPosition>();
  const accounts = new Set([...ledger.keys(), ...statements.keys()]);
  for (const key of accounts) {
    const statement = statements.get(key);
    const source: QuantitySource = statement ? 'statement' : 'ledger';
    for (const balance of (
      statement ??
      ledger.get(key) ??
      new Map()
    ).values()) {
      out.set(`${key}|${balance.asset}`, {
        platform: balance.platform,
        accountId: balance.accountId,
        asset: balance.asset,
        quantity: balance.quantity,
        source,
        ids: [...balance.ids],
      });
    }
  }
  for (const [key, account] of manual) {
    for (const balance of account.values()) {
      out.set(`${key}|${balance.asset}`, {
        platform: balance.platform,
        accountId: balance.accountId,
        asset: balance.asset,
        quantity: balance.quantity,
        source: 'manual',
        ids: [...balance.ids],
      });
    }
  }
  return [...out.values()]
    .filter((p) => p.quantity.abs().gte(dust))
    .sort(
      (a, b) =>
        compareText(a.platform, b.platform) ||
        compareText(a.accountId, b.accountId) ||
        compareText(a.asset, b.asset),
    );
}

function priceColumns(quote: PriceQuote | undefined): PriceColumns {
  const none: PriceColumns = {
    priceUsd: null,
    usdChf: null,
    chfDirect: null,
    estvChf: null,
  };
  if (!quote) return none;
  switch (quote.origin) {
    case 'override':
    case 'estv':
      return { ...none, estvChf: str(quote.priceChf) };
    case 'home':
    case 'recordChf':
    case 'tableChf':
    case 'fx':
      return { ...none, chfDirect: str(quote.priceChf) };
    case 'recordUsd':
    case 'pegged':
    case 'tableUsd':
      return {
        ...none,
        priceUsd: opt(quote.priceUsd),
        usdChf: opt(quote.usdChf),
      };
  }
}

function lightOf(applicable: boolean, items: readonly OpenItem[]): Light {
  if (items.some((item) => item.light === 'red')) return 'red';
  if (items.length > 0) return 'yellow';
  return applicable ? 'green' : 'grey';
}

export function calculate(input: CalculationInput): CalculationResult {
  const { taxYear, rules } = input;
  const yearEnd = `${taxYear}-12-31`;
  const previousYearEnd = `${taxYear - 1}-12-31`;
  const yearStartTs = `${taxYear}-01-01T00:00:00.000Z`;
  const cutoffTs = `${taxYear + 1}-01-01T00:00:00.000Z`;
  const dust = parseDecimal(rules.dustThreshold);
  const spamPattern = new RegExp(rules.spamPattern, 'i');

  const corrected = applyCorrections(
    input.bookings,
    input.holdings,
    input.corrections,
  );
  const bookings = [...corrected.bookings].sort(
    (a, b) => compareText(a.timestamp, b.timestamp) || compareText(a.id, b.id),
  );
  const holdings = [...corrected.holdings].sort((a, b) =>
    compareText(a.id, b.id),
  );
  const bookingById = new Map(bookings.map((b) => [b.id, b] as const));
  const holdingById = new Map(holdings.map((h) => [h.id, h] as const));
  const table = new RateTable([...input.rates, ...corrected.rates]);
  const inYear = (b: Booking) =>
    b.timestamp >= yearStartTs && b.timestamp < cutoffTs;
  const quoteAt = (asset: string, date: string) =>
    unitPriceChf(table, rules, asset, date);

  // A file that has bookings for an account AND balances for it states running balances
  // (a ledger's balance column): those are checked against the ledger, never preferred to it.
  const bookingSources = new Set(
    bookings.map(
      (b) => `${b.sourceFileId}|${accountKey(b.platform, b.accountId)}`,
    ),
  );
  const ledgerHoldings = holdings.filter((h) =>
    bookingSources.has(
      `${h.sourceFileId}|${accountKey(h.platform, h.accountId)}`,
    ),
  );
  const manualHoldings = holdings.filter((h) =>
    isCorrectionRecord(h.sourceFileId),
  );
  const statementHoldings = holdings.filter(
    (h) => !ledgerHoldings.includes(h) && !isCorrectionRecord(h.sourceFileId),
  );

  // --- Positions at 31.12. (F7.1) ---
  const ledgerEnd = ledgerBalances(bookings, cutoffTs);
  const statementsEnd = statementBalances(statementHoldings, yearEnd);
  const manualEnd = statementBalances(manualHoldings, yearEnd);
  const rawPositions = positionsAt(ledgerEnd, statementsEnd, manualEnd, dust);

  const positions: Position[] = rawPositions.map((raw) => {
    const id = `pos:${raw.platform}|${raw.accountId}|${raw.asset}`;
    const spam =
      raw.source !== 'manual' &&
      (spamPattern.test(raw.asset) ||
        raw.ids.some((rid) => bookingById.get(rid)?.kind === 'spam'));
    const own = raw.ids
      .map((rid) => holdingById.get(rid))
      .find((h) => h?.priceChf !== undefined || h?.priceUsd !== undefined);
    const quote = spam
      ? undefined
      : unitPriceChf(table, rules, raw.asset, yearEnd, {
          priceChf: own?.priceChf,
          priceUsd: own?.priceUsd,
        });
    const value = quote ? raw.quantity.times(quote.priceChf) : undefined;
    const status = spam
      ? 'spam'
      : raw.quantity.isNegative()
        ? 'negative'
        : quote
          ? 'ok'
          : 'missingPrice';
    return {
      id,
      platform: raw.platform,
      accountId: raw.accountId,
      asset: raw.asset,
      quantity: str(raw.quantity),
      quantitySource: raw.source,
      priceChf: opt(quote?.priceChf),
      priceOrigin: quote?.origin ?? null,
      priceSource: quote?.source ?? null,
      priceDate: quote?.date ?? null,
      ...priceColumns(quote),
      valueChf: opt(value),
      status,
      recordIds: raw.ids,
    };
  });
  const counted = positions.filter((p) => p.status === 'ok');
  const wealth = sum(counted.map((p) => parseDecimal(p.valueChf ?? '0')));

  const platformNames = [...new Set(positions.map((p) => p.platform))].sort(
    compareText,
  );
  const platforms: PlatformTotal[] = platformNames.map((platform) => {
    const own = positions.filter(
      (p) => p.platform === platform && p.status !== 'spam',
    );
    return {
      id: `plat:${platform}`,
      platform,
      valueChf: str(
        sum(
          own
            .filter((p) => p.status === 'ok')
            .map((p) => parseDecimal(p.valueChf ?? '0')),
        ),
      ),
      positions: own.length,
      missingPrices: own.filter((p) => p.status === 'missingPrice').length,
    };
  });

  // --- Income (F7.2), valued at arrival ---
  const income: IncomeLine[] = [];
  for (const booking of bookings) {
    if (!inYear(booking) || !isIncome(booking.kind)) continue;
    income.push(incomeLine(booking, table, rules, spamPattern));
  }

  // --- Earn gap (FACHREGELN, Differenzmethode) ---
  const earnGaps = earnGapsOf(
    bookings.filter(inYear),
    overlay(
      statementBalances(statementHoldings, previousYearEnd),
      statementBalances(manualHoldings, previousYearEnd),
    ),
    overlay(statementsEnd, manualEnd),
    table,
    rules,
    taxYear,
    dust,
  );

  const categories: CategoryTotal[] = INCOME_CATEGORIES.map((category) => {
    if (category === 'earn_gap') {
      const gaps = earnGaps.filter((g) => g.status !== 'negative');
      return {
        id: `cat:${category}`,
        category,
        valueChf: str(sum(gaps.map((g) => parseDecimal(g.valueChf ?? '0')))),
        lines: gaps.length,
        missingPrices: gaps.filter((g) => g.status === 'missingPrice').length,
      };
    }
    const lines = income.filter((l) => l.category === category);
    return {
      id: `cat:${category}`,
      category,
      valueChf: str(
        sum(
          lines
            .filter((l) => l.status === 'ok')
            .map((l) => parseDecimal(l.valueChf ?? '0')),
        ),
      ),
      lines: lines.filter((l) => l.status !== 'spam').length,
      missingPrices: lines.filter((l) => l.status === 'missingPrice').length,
    };
  });
  const incomeTotal = sum(categories.map((c) => parseDecimal(c.valueChf)));

  // --- One-off events (F7.3) ---
  const incomeByBooking = new Map(income.map((l) => [l.bookingId, l] as const));
  const oneOffEvents: OneOffEvent[] = bookings
    .filter((b) => inYear(b) && ONE_OFF_KINDS.includes(b.kind))
    .map((b) => {
      const line = incomeByBooking.get(b.id);
      let value: string | null = line?.valueChf ?? null;
      if (!line) {
        const quote = quoteAt(b.asset, b.timestamp.slice(0, 10));
        value = quote ? str(b.quantity.times(quote.priceChf)) : null;
      }
      return {
        id: `evt:${b.id}`,
        timestamp: b.timestamp,
        kind: b.kind,
        platform: b.platform,
        accountId: b.accountId,
        asset: b.asset,
        quantity: str(b.quantity),
        valueChf: value,
        incomeLineId: line?.id ?? null,
        recordIds: [b.id],
      };
    });

  // --- Checks and open items (F8.1, F8.2) ---
  const items: Record<CheckKind, OpenItem[]> = {
    ledgerVsStatement: [],
    earnGap: [],
    unmatchedWithdrawals: [],
    unmatchedDeposits: [],
    openingBalance: [],
    missingPrices: [],
    unclassified: [],
    walletNetworks: [],
  };
  const applicable: Record<CheckKind, boolean> = {
    ledgerVsStatement: false,
    earnGap: earnGaps.length > 0,
    unmatchedWithdrawals: false,
    unmatchedDeposits: false,
    openingBalance: input.previous !== undefined,
    missingPrices: true,
    unclassified: true,
    walletNetworks: false,
  };
  const impactOf = (asset: string, quantity: Decimal, date: string) => {
    const quote = quoteAt(asset, date);
    return quote ? str(quantity.abs().times(quote.priceChf)) : null;
  };

  // Ledger = statement at 31.12., every asset exactly (FACHREGELN, Prüfungen).
  for (const [key, statement] of statementsEnd) {
    const ledger = ledgerEnd.get(key);
    if (!ledger) continue;
    applicable.ledgerVsStatement = true;
    const assets = [...new Set([...statement.keys(), ...ledger.keys()])].sort(
      compareText,
    );
    for (const asset of assets) {
      const s = statement.get(asset);
      const l = ledger.get(asset);
      const expected = s?.quantity ?? ZERO;
      const actual = l?.quantity ?? ZERO;
      if (expected.eq(actual)) continue;
      if (expected.abs().lt(dust) && actual.abs().lt(dust)) continue;
      const any = (s ?? l) as Balance;
      const difference = actual.minus(expected);
      items.ledgerVsStatement.push({
        key: `ledgerVsStatement:${key}|${asset}`,
        check: 'ledgerVsStatement',
        reason: 'balanceDiffers',
        light: 'red',
        platform: any.platform,
        accountId: any.accountId,
        asset,
        date: yearEnd,
        params: {
          expected: str(expected),
          actual: str(actual),
          difference: str(difference),
        },
        impactChf: impactOf(asset, difference, yearEnd),
        recordIds: [...(s?.ids ?? []), ...(l?.ids ?? [])],
      });
    }
  }
  // A ledger's own balance column agrees with Σ amount − Σ fee of that file.
  const runningByFile = new Map<string, Balance & { sourceFileId: string }>();
  for (const holding of ledgerHoldings) {
    const key = `${holding.sourceFileId}|${accountKey(holding.platform, holding.accountId)}|${holding.asset}`;
    const entry = runningByFile.get(key) ?? {
      sourceFileId: holding.sourceFileId,
      platform: holding.platform,
      accountId: holding.accountId,
      asset: holding.asset,
      quantity: ZERO,
      ids: [],
    };
    entry.quantity = entry.quantity.plus(holding.quantity);
    entry.ids.push(holding.id);
    runningByFile.set(key, entry);
  }
  if (runningByFile.size > 0) {
    applicable.ledgerVsStatement = true;
    const fileLedgers = new Map<string, Balances>();
    for (const key of [...runningByFile.keys()].sort(compareText)) {
      const running = runningByFile.get(key) as Balance & {
        sourceFileId: string;
      };
      let ledger = fileLedgers.get(running.sourceFileId);
      if (!ledger) {
        ledger = ledgerBalances(
          bookings.filter((b) => b.sourceFileId === running.sourceFileId),
          '9999-12-31T23:59:59.999Z',
        );
        fileLedgers.set(running.sourceFileId, ledger);
      }
      const computed =
        ledger
          .get(accountKey(running.platform, running.accountId))
          ?.get(running.asset)?.quantity ?? ZERO;
      if (computed.eq(running.quantity)) continue;
      const difference = computed.minus(running.quantity);
      items.ledgerVsStatement.push({
        key: `ledgerBalance:${key}`,
        check: 'ledgerVsStatement',
        reason: 'ledgerBalanceDiffers',
        light: 'red',
        platform: running.platform,
        accountId: running.accountId,
        asset: running.asset,
        date: null,
        params: {
          expected: str(running.quantity),
          actual: str(computed),
          difference: str(difference),
        },
        impactChf: impactOf(running.asset, difference, yearEnd),
        recordIds: running.ids,
      });
    }
  }
  for (const position of positions.filter((p) => p.status === 'negative')) {
    items.ledgerVsStatement.push({
      key: `negativeBalance:${position.id}`,
      check: 'ledgerVsStatement',
      reason: 'negativeBalance',
      light: 'red',
      platform: position.platform,
      accountId: position.accountId,
      asset: position.asset,
      date: yearEnd,
      params: { quantity: position.quantity },
      impactChf:
        position.valueChf === null
          ? null
          : str(parseDecimal(position.valueChf).abs()),
      recordIds: position.recordIds,
    });
  }

  for (const gap of earnGaps) {
    if (gap.status === 'income') continue;
    const negative = gap.status === 'negative';
    items.earnGap.push({
      key: `earnGap:${gap.platform}|${gap.accountId}|${gap.asset}`,
      check: 'earnGap',
      reason: negative ? 'negativeEarnGap' : 'earnGapWithoutPrice',
      light: 'yellow',
      platform: gap.platform,
      accountId: gap.accountId,
      asset: gap.asset,
      date: yearEnd,
      params: { gap: gap.gapQuantity },
      impactChf:
        negative && gap.averagePriceChf !== null
          ? str(
              parseDecimal(gap.gapQuantity)
                .abs()
                .times(parseDecimal(gap.averagePriceChf)),
            )
          : null,
      recordIds: gap.recordIds,
    });
  }

  // Withdrawals ↔ deposits across the user's own accounts.
  const { unmatchedWithdrawals, unmatchedDeposits, considered } =
    matchTransfers(bookings, rules);
  for (const b of unmatchedWithdrawals.filter(inYear)) {
    items.unmatchedWithdrawals.push(
      transferItem(b, 'unmatchedWithdrawals', 'withdrawalWithoutDeposit'),
    );
  }
  for (const b of unmatchedDeposits.filter(inYear)) {
    items.unmatchedDeposits.push(
      transferItem(b, 'unmatchedDeposits', 'depositWithoutWithdrawal'),
    );
  }
  applicable.unmatchedWithdrawals = considered.withdrawals.some(inYear);
  applicable.unmatchedDeposits = considered.deposits.some(inYear);
  function transferItem(
    b: Booking,
    check: CheckKind,
    reason: 'withdrawalWithoutDeposit' | 'depositWithoutWithdrawal',
  ): OpenItem {
    return {
      key: `${check}:${b.id}`,
      check,
      reason,
      light: 'yellow',
      platform: b.platform,
      accountId: b.accountId,
      asset: b.asset,
      date: b.timestamp.slice(0, 10),
      params: { quantity: str(b.quantity) },
      impactChf: impactOf(b.asset, b.quantity, b.timestamp.slice(0, 10)),
      recordIds: [b.id],
    };
  }

  // Opening balance = previous year's closing balance.
  if (input.previous) {
    const opening = positionsAt(
      ledgerBalances(bookings, yearStartTs),
      statementBalances(statementHoldings, previousYearEnd),
      statementBalances(manualHoldings, previousYearEnd),
      dust,
    );
    const current = new Map(
      opening.map(
        (p) => [`${p.platform}|${p.accountId}|${p.asset}`, p] as const,
      ),
    );
    const previous = new Map(
      input.previous.positions.map(
        (p) => [`${p.platform}|${p.accountId}|${p.asset}`, p] as const,
      ),
    );
    for (const key of [
      ...new Set([...current.keys(), ...previous.keys()]),
    ].sort(compareText)) {
      const now = current.get(key);
      const before = previous.get(key);
      const expected = before ? parseDecimal(before.quantity) : ZERO;
      const actual = now?.quantity ?? ZERO;
      if (expected.eq(actual)) continue;
      const [platform = '', accountId = '', asset = ''] = key.split('|');
      const difference = actual.minus(expected);
      items.openingBalance.push({
        key: `openingBalance:${key}`,
        check: 'openingBalance',
        reason: 'openingDiffers',
        light: 'yellow',
        platform,
        accountId,
        asset,
        date: previousYearEnd,
        params: {
          expected: str(expected),
          actual: str(actual),
          difference: str(difference),
        },
        impactChf: impactOf(asset, difference, previousYearEnd),
        recordIds: now?.ids ?? [],
      });
    }
  }

  for (const position of positions.filter((p) => p.status === 'missingPrice')) {
    items.missingPrices.push({
      key: `missingPrice:${position.id}`,
      check: 'missingPrices',
      reason: 'positionWithoutPrice',
      light: 'yellow',
      platform: position.platform,
      accountId: position.accountId,
      asset: position.asset,
      date: yearEnd,
      params: { quantity: position.quantity },
      impactChf: null,
      recordIds: position.recordIds,
    });
  }
  const missingIncome = new Map<string, IncomeLine[]>();
  for (const line of income.filter((l) => l.status === 'missingPrice')) {
    const list = missingIncome.get(line.asset) ?? [];
    list.push(line);
    missingIncome.set(line.asset, list);
  }
  for (const asset of [...missingIncome.keys()].sort(compareText)) {
    const lines = missingIncome.get(asset) ?? [];
    items.missingPrices.push({
      key: `missingIncomePrice:${asset}`,
      check: 'missingPrices',
      reason: 'incomeWithoutPrice',
      light: 'yellow',
      platform: null,
      accountId: null,
      asset,
      date: null,
      params: {
        count: String(lines.length),
        quantity: str(sum(lines.map((l) => parseDecimal(l.quantityNet)))),
      },
      impactChf: null,
      recordIds: lines.map((l) => l.bookingId),
    });
  }
  for (const event of oneOffEvents.filter(
    (e) => e.valueChf === null && e.incomeLineId === null,
  )) {
    items.missingPrices.push({
      key: `missingEventPrice:${event.id}`,
      check: 'missingPrices',
      reason: 'oneOffWithoutPrice',
      light: 'yellow',
      platform: event.platform,
      accountId: event.accountId,
      asset: event.asset,
      date: event.timestamp.slice(0, 10),
      params: { quantity: event.quantity },
      impactChf: null,
      recordIds: event.recordIds,
    });
  }

  const unclassified = new Map<string, Booking[]>();
  for (const booking of bookings) {
    if (!inYear(booking) || booking.kind !== 'unknown') continue;
    const key = `${booking.platform}|${booking.accountId}|${booking.asset}|${booking.rawType}`;
    const list = unclassified.get(key) ?? [];
    list.push(booking);
    unclassified.set(key, list);
  }
  for (const key of [...unclassified.keys()].sort(compareText)) {
    const list = unclassified.get(key) ?? [];
    const first = list[0] as Booking;
    items.unclassified.push({
      key: `unclassified:${key}`,
      check: 'unclassified',
      reason: 'unclassifiedBookings',
      light: 'yellow',
      platform: first.platform,
      accountId: first.accountId,
      asset: first.asset,
      date: null,
      params: {
        count: String(list.length),
        rawType: first.rawType,
        quantity: str(sum(list.map((b) => b.quantity))),
      },
      impactChf: null,
      recordIds: list.map((b) => b.id),
    });
  }

  // F6.4 is not built yet: say so instead of pretending the check passed.
  items.walletNetworks.push({
    key: 'walletNetworks:notAvailable',
    check: 'walletNetworks',
    reason: 'walletNetworksNotAvailable',
    light: 'yellow',
    platform: null,
    accountId: null,
    asset: null,
    date: null,
    params: {},
    impactChf: null,
    recordIds: [],
  });

  const checks: Check[] = CHECK_KINDS.map((kind) => ({
    kind,
    light: lightOf(applicable[kind], items[kind]),
    items: items[kind].length,
    impactChf: str(
      sum(
        items[kind]
          .filter((item) => item.impactChf !== null)
          .map((item) => parseDecimal(item.impactChf ?? '0').abs()),
      ),
    ),
  }));
  const openItems = CHECK_KINDS.flatMap((kind) => items[kind]);

  // --- Previous-year comparison (F8.3) ---
  let comparison: Comparison | null = null;
  if (input.previous) {
    const previous = input.previous;
    const visible = positions.filter((p) => p.status !== 'spam');
    const currentKeys = new Set(
      visible.map((p) => `${p.platform}|${p.accountId}|${p.asset}`),
    );
    const previousKeys = new Set(
      previous.positions.map((p) => `${p.platform}|${p.accountId}|${p.asset}`),
    );
    comparison = {
      previousTaxYear: previous.taxYear,
      previousWealthChf: previous.wealthChf,
      previousIncomeChf: previous.incomeChf,
      wealthDeltaChf: str(wealth.minus(parseDecimal(previous.wealthChf))),
      incomeDeltaChf: str(incomeTotal.minus(parseDecimal(previous.incomeChf))),
      newPositions: visible
        .filter(
          (p) => !previousKeys.has(`${p.platform}|${p.accountId}|${p.asset}`),
        )
        .map((p) => ({
          platform: p.platform,
          accountId: p.accountId,
          asset: p.asset,
          quantity: p.quantity,
          valueChf: p.valueChf,
        })),
      removedPositions: [...previous.positions]
        .filter(
          (p) => !currentKeys.has(`${p.platform}|${p.accountId}|${p.asset}`),
        )
        .sort(
          (a, b) =>
            compareText(a.platform, b.platform) ||
            compareText(a.accountId, b.accountId) ||
            compareText(a.asset, b.asset),
        ),
    };
  }

  // --- Records behind the figures (F7.5) ---
  const referenced = new Set<string>();
  for (const list of [
    positions,
    income,
    earnGaps,
    oneOffEvents,
    openItems,
  ] as readonly { recordIds: readonly string[] }[][]) {
    for (const figure of list)
      for (const rid of figure.recordIds) referenced.add(rid);
  }
  const records: Record<string, RecordSummary> = {};
  for (const rid of [...referenced].sort(compareText)) {
    const booking = bookingById.get(rid);
    if (booking) {
      records[rid] = {
        id: rid,
        type: 'booking',
        sourceFileId: booking.sourceFileId,
        row: booking.row,
        platform: booking.platform,
        accountId: booking.accountId,
        asset: booking.asset,
        quantity: str(booking.quantity),
        at: booking.timestamp,
        kind: booking.kind,
        fee: opt(booking.fee),
        feeAsset: booking.fee ? (booking.feeAsset ?? booking.asset) : null,
        rawType: booking.rawType,
        raw: booking.raw ?? null,
      };
      continue;
    }
    const holding = holdingById.get(rid);
    if (holding) {
      records[rid] = {
        id: rid,
        type: 'holding',
        sourceFileId: holding.sourceFileId,
        row: holding.row,
        platform: holding.platform,
        accountId: holding.accountId,
        asset: holding.asset,
        quantity: str(holding.quantity),
        at: holding.asOf,
        kind: null,
        fee: null,
        feeAsset: null,
        rawType: holding.evidence ?? null,
        raw: holding.raw ?? null,
      };
    }
  }

  const usdChf = table.fx('USD', yearEnd);
  const eurChf = table.fx('EUR', yearEnd);
  return {
    engineVersion: ENGINE_VERSION,
    taxYear,
    country: rules.country,
    yearEnd,
    totals: {
      wealthChf: str(wealth),
      incomeChf: str(incomeTotal),
      positions: positions.filter((p) => p.status !== 'spam').length,
      missingPrices:
        positions.filter((p) => p.status === 'missingPrice').length +
        income.filter((l) => l.status === 'missingPrice').length +
        earnGaps.filter((g) => g.status === 'missingPrice').length,
      openItems: openItems.length,
    },
    parameters: {
      usdChf: opt(usdChf?.value),
      eurChf: opt(eurChf?.value),
      usdChfSource: usdChf ? `${usdChf.source} ${usdChf.date}` : null,
      eurChfSource: eurChf ? `${eurChf.source} ${eurChf.date}` : null,
    },
    positions,
    platforms,
    income,
    categories,
    earnGaps,
    oneOffEvents,
    checks,
    openItems,
    corrections: corrected.applied,
    comparison,
    records,
  };
}

/** One income booking, valued at arrival (FACHREGELN, Ertrag). */
function incomeLine(
  booking: Booking,
  table: RateTable,
  rules: CountryRules,
  spamPattern: RegExp,
): IncomeLine {
  const category =
    INCOME_CATEGORY_OF[booking.kind as keyof typeof INCOME_CATEGORY_OF];
  const date = booking.timestamp.slice(0, 10);
  const fee = feeOf(booking);
  const feeSameAsset = fee !== undefined && fee.asset === booking.asset;
  const net = feeSameAsset ? booking.quantity.minus(fee.fee) : booking.quantity;
  const base = {
    id: `inc:${booking.id}`,
    bookingId: booking.id,
    timestamp: booking.timestamp,
    date,
    platform: booking.platform,
    accountId: booking.accountId,
    kind: booking.kind,
    category,
    asset: booking.asset,
    quantityGross: str(booking.quantity),
    fee: opt(fee?.fee),
    feeAsset: fee ? fee.asset : null,
    quantityNet: str(net),
    rawType: booking.rawType,
    group: booking.group ?? null,
    recordIds: [booking.id],
  };
  const none = {
    priceUsd: null,
    usdChf: null,
    priceChf: null,
    valueUsd: null,
    valueChf: null,
    grossValueChf: null,
    priceOrigin: null,
    priceSource: null,
  };
  if (spamPattern.test(booking.asset)) {
    return { ...base, ...none, status: 'spam' };
  }
  const override = table.lookup('price', booking.asset, 'CHF', date, 0, [
    'manual',
  ]);
  if (!override && booking.valueUsd !== undefined) {
    const fx = table.fx('USD', date);
    if (!fx) return { ...base, ...none, status: 'missingPrice' };
    const netUsd =
      feeSameAsset && booking.feeValueUsd !== undefined
        ? booking.valueUsd.minus(booking.feeValueUsd.abs())
        : booking.valueUsd;
    return {
      ...base,
      priceUsd: null,
      usdChf: str(fx.value),
      priceChf: null,
      valueUsd: str(netUsd),
      valueChf: str(netUsd.times(fx.value)),
      grossValueChf: str(booking.valueUsd.times(fx.value)),
      priceOrigin: 'recordValueUsd',
      priceSource: 'record',
      status: 'ok',
    };
  }
  const quote = unitPriceChf(table, rules, booking.asset, date, {
    priceChf: booking.priceChf,
    priceUsd: booking.priceUsd,
  });
  if (!quote) return { ...base, ...none, status: 'missingPrice' };
  return {
    ...base,
    priceUsd: opt(quote.priceUsd),
    usdChf: opt(quote.usdChf),
    priceChf: str(quote.priceChf),
    valueUsd: quote.priceUsd ? str(net.times(quote.priceUsd)) : null,
    valueChf: str(net.times(quote.priceChf)),
    grossValueChf: str(booking.quantity.times(quote.priceChf)),
    priceOrigin: quote.origin,
    priceSource: quote.source,
    status: 'ok',
  };
}

/**
 * Earn gap (FACHREGELN, Differenzmethode) for every account with statement balances at the start
 * and the end of the year and bookings in between: gap = (end − start) − Σ bookings of the year
 * (internal transfers excluded). Positive gaps are income at the yearly average price; negative
 * ones become an open item.
 */
function earnGapsOf(
  yearBookings: readonly Booking[],
  start: Balances,
  end: Balances,
  table: RateTable,
  rules: CountryRules,
  taxYear: number,
  dust: Decimal,
): EarnGap[] {
  const gaps: EarnGap[] = [];
  const accounts = [...end.keys()]
    .filter((key) => start.has(key))
    .sort(compareText);
  for (const key of accounts) {
    const own = yearBookings.filter(
      (b) => accountKey(b.platform, b.accountId) === key,
    );
    if (own.length === 0) continue;
    const startBalances = start.get(key) ?? new Map<string, Balance>();
    const endBalances = end.get(key) ?? new Map<string, Balance>();
    const booked = ledgerBalances(
      own.filter((b) => b.kind !== 'transfer'),
      '9999-12-31T23:59:59.999Z',
    ).get(key);
    const assets = [
      ...new Set([...startBalances.keys(), ...endBalances.keys()]),
    ]
      .filter((asset) => !rules.earnGapExcluded.includes(asset))
      .sort(compareText);
    for (const asset of assets) {
      const s = startBalances.get(asset);
      const e = endBalances.get(asset);
      const b = booked?.get(asset);
      const startQ = s?.quantity ?? ZERO;
      const endQ = e?.quantity ?? ZERO;
      const bookedQ = b?.quantity ?? ZERO;
      const gap = endQ.minus(startQ).minus(bookedQ);
      if (gap.abs().lt(dust)) continue;
      const any = (e ?? s) as Balance;
      const average = yearlyAverageChf(table, rules, asset, taxYear);
      const positive = gap.isPositive();
      gaps.push({
        id: `gap:${key}|${asset}`,
        platform: any.platform,
        accountId: any.accountId,
        asset,
        startQuantity: str(startQ),
        endQuantity: str(endQ),
        bookedQuantity: str(bookedQ),
        gapQuantity: str(gap),
        averagePriceChf: opt(average),
        valueChf: positive && average ? str(gap.times(average)) : null,
        status: !positive ? 'negative' : average ? 'income' : 'missingPrice',
        recordIds: [...(s?.ids ?? []), ...(e?.ids ?? []), ...(b?.ids ?? [])],
      });
    }
  }
  return gaps;
}

/**
 * Pairs each withdrawal with a deposit of the same asset on another of the user's accounts:
 * quantity within the tolerance (the network fee), arriving from one hour before to the window's
 * end after it; the closest in time wins, each deposit pairs once. Fiat is left out — it comes
 * from and goes to a bank.
 */
function matchTransfers(
  bookings: readonly Booking[],
  rules: CountryRules,
): {
  unmatchedWithdrawals: Booking[];
  unmatchedDeposits: Booking[];
  considered: { withdrawals: Booking[]; deposits: Booking[] };
} {
  const crypto = (b: Booking) => !rules.fiat.includes(b.asset);
  const withdrawals = bookings.filter(
    (b) => b.kind === 'withdrawal' && crypto(b),
  );
  const deposits = bookings.filter((b) => b.kind === 'deposit' && crypto(b));
  const tolerance = parseDecimal(rules.transferTolerance);
  const used = new Set<string>();
  const unmatchedWithdrawals: Booking[] = [];
  const hour = 3_600_000;
  for (const w of withdrawals) {
    const out = w.quantity.abs();
    const low = out.times(parseDecimal('1').minus(tolerance));
    const high = out.times(parseDecimal('1').plus(tolerance));
    const wTime = Date.parse(w.timestamp);
    let best: { booking: Booking; distance: number } | undefined;
    for (const d of deposits) {
      if (used.has(d.id) || d.asset !== w.asset) continue;
      if (d.platform === w.platform && d.accountId === w.accountId) continue;
      const distance = Date.parse(d.timestamp) - wTime;
      if (distance < -hour || distance > rules.transferWindowHours * hour)
        continue;
      const q = d.quantity.abs();
      if (q.lt(low) || q.gt(high)) continue;
      if (
        !best ||
        Math.abs(distance) < Math.abs(best.distance) ||
        (Math.abs(distance) === Math.abs(best.distance) &&
          d.id < best.booking.id)
      ) {
        best = { booking: d, distance };
      }
    }
    if (best) used.add(best.booking.id);
    else unmatchedWithdrawals.push(w);
  }
  return {
    unmatchedWithdrawals,
    unmatchedDeposits: deposits.filter((d) => !used.has(d.id)),
    considered: { withdrawals, deposits },
  };
}

/** The assets a calculation needs market prices for (not CHF, not fiat, not USD-pegged). */
export function assetsNeedingPrices(
  result: CalculationResult,
  rules: CountryRules,
): string[] {
  const assets = new Set<string>();
  for (const p of result.positions)
    if (p.status !== 'spam') assets.add(p.asset);
  for (const l of result.income) if (l.status !== 'spam') assets.add(l.asset);
  for (const g of result.earnGaps) assets.add(g.asset);
  for (const e of result.oneOffEvents) assets.add(e.asset);
  return [...assets]
    .filter(
      (a) =>
        a !== rules.homeCurrency &&
        !rules.fiat.includes(a) &&
        !rules.usdPegged.includes(a),
    )
    .sort(compareText);
}
