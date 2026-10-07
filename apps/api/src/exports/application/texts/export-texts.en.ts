import type { ExportTexts } from './export-texts.types';

/**
 * English (F11.2). Swiss terms without an English equivalent keep the German term in
 * parentheses where the reader needs it (the country rules do the same for titles and form
 * references, F10.3).
 */
export const EN_EXPORT_TEXTS: ExportTexts = {
  htmlLang: 'en',
  checkLabels: {
    ledgerVsStatement: 'Balance per ledger = balance per account statement',
    earnGap: 'Missing Earn income (difference method)',
    unmatchedWithdrawals: 'Withdrawals without a matching deposit',
    unmatchedDeposits:
      'Deposits without a matching withdrawal (possible income)',
    openingBalance: 'Opening balance = closing balance of the previous year',
    missingPrices: 'Positions without a price',
    unclassified: 'Unclassified bookings',
    walletNetworks: 'Wallets checked on every network',
  },
  lightLabels: {
    green: 'green',
    yellow: 'yellow',
    red: 'red',
    grey: 'not applicable',
  },
  statusLabels: {
    ok: 'ok',
    missingPrice: 'without price',
    spam: 'Spam',
    negative: 'Negative',
  },
  statusNoteSpam:
    'Spam/scam token without market value; not included in the total.',
  statusNoteNegative: 'negative balance; not included in the total.',
  oneOff: { loss: 'Loss', hardfork: 'Hardfork', airdrop: 'Airdrop' },
  quantitySourceLabels: {
    statement: 'Account statement',
    ledger: 'Ledger (Σ quantity − Σ fee)',
    manual: 'Manual (correction)',
  },
  originLabels: {
    home: 'CHF',
    override: 'Overridden',
    estv: 'ESTV rate list (Kursliste)',
    recordChf: 'Price CHF per receipt',
    recordUsd: 'Price USD per receipt × USD/CHF',
    recordValueUsd: 'USD value per platform × USD/CHF',
    pegged: 'Stablecoin = 1 USD × USD/CHF',
    fx: 'Exchange rate (ECB)',
    tableChf: 'Daily price CHF',
    tableUsd: 'Daily close USD × USD/CHF',
  },
  openItems: {
    balanceDiffers: ({ where, p }) =>
      `${where}: ledger ${p('actual')} ≠ account statement ${p('expected')} (difference ${p('difference')})`,
    ledgerBalanceDiffers: ({ where, p }) =>
      `${where}: Σ bookings ${p('actual')} ≠ balance column ${p('expected')}`,
    negativeBalance: ({ where, p }) =>
      `${where}: negative holding ${p('quantity')} – bookings are missing`,
    negativeEarnGap: ({ where, p }) =>
      `${where}: negative Earn gap ${p('gap')} – check holdings or history`,
    earnGapWithoutPrice: ({ where, p }) =>
      `${where}: Earn gap ${p('gap')} without a yearly average price`,
    withdrawalWithoutDeposit: ({ where, p, date }) =>
      `${where}: withdrawal ${p('quantity')} on ${date} without arriving on an own account`,
    depositWithoutWithdrawal: ({ where, p, date }) =>
      `${where}: deposit ${p('quantity')} on ${date} without origin – possible income`,
    openingDiffers: ({ where, p }) =>
      `${where}: opening balance ${p('actual')} ≠ previous year's closing balance ${p('expected')}`,
    positionWithoutPrice: ({ where }) =>
      `${where}: no price at 31.12. – add the ESTV price`,
    incomeWithoutPrice: ({ p, asset }) =>
      `${asset}: ${p('count')} income bookings without a price`,
    oneOffWithoutPrice: ({ where }) =>
      `${where}: one-off event without a price – add the ESTV price`,
    ambiguousPrice: ({ asset }) =>
      `${asset}: ambiguous price – the ticker stands for several coins; choose the coin under Rates`,
    unclassifiedBookings: ({ where, p }) =>
      `${where}: ${p('count')} bookings “${p('rawType')}” not classified`,
    walletNetworksNotAvailable: () =>
      'Wallet lookup on every network is not available yet – check manually',
    walletNetworksUnchecked: ({ p }) =>
      `Wallet ${p('wallet')}: networks not checked yet`,
    walletNetworkNotSelected: ({ p }) =>
      `Wallet ${p('wallet')}: used on ${p('network')}, but not selected`,
    walletNetworkNotFetched: ({ p }) =>
      `Wallet ${p('wallet')} / ${p('network')}: not fetched yet`,
    walletManualBalanceMissing: ({ p }) =>
      `Wallet ${p('wallet')} / ${p('network')}: enter the balance at 31.12. manually with a receipt`,
    walletFetchFailed: ({ p }) =>
      `Wallet ${p('wallet')} / ${p('network')}: fetch failed`,
  },
  hints: {
    noYearData: ({ where, date }, zero) =>
      zero
        ? `${where}: bookings end on ${date}, balance 0 afterwards – nothing is missing`
        : `${where}: no bookings in the tax year – history ends on ${date}`,
    startsLate: ({ where, date }) =>
      `${where}: bookings only from ${date} – export from 01.01. is missing`,
    endsEarly: ({ where, date }, zero) =>
      zero
        ? `${where}: bookings only until ${date}, balance 0 afterwards – nothing is missing`
        : `${where}: bookings only until ${date} – export until 31.12. is missing`,
    noYearEndBalance: ({ where }) =>
      `${where}: no balance/account statement at 31.12.`,
  },

  variantSimple: 'simple',
  variantDetailed: 'detailed',
  statementTitle: (taxYear, variant) =>
    `Crypto tax statement ${taxYear} (${variant})`,
  metaLine: (m) =>
    `${m.owner} · Tax year ${m.taxYear} · Canton ${m.canton} · created on ${m.created} · calculated on ${m.calculated}`,
  pageTitleSimple: (taxYear) => `Tax statement ${taxYear}`,
  pageTitleDetailed: (taxYear) => `Tax statement ${taxYear} (detailed)`,
  fileVariants: {
    einfach: 'simple',
    ausfuehrlich: 'detailed',
    'pruefbericht-intern': 'internal-review',
  },

  col: {
    platformWallet: 'Platform / wallet',
    mainPositions: 'Main positions',
    smallPositions: 'Small positions',
    taxValue: (t) => `Tax value ${t}`,
    total: 'Total',
    totalIncome: 'Total income',
    totalWealth: 'Total wealth',
    category: 'Category',
    bookings: 'Bookings',
    income: (t) => `Income ${t}`,
    platform: 'Platform',
    account: 'Account',
    asset: 'Asset',
    quantity: 'Quantity',
    quantityNet: 'Net quantity',
    price: (t) => `Price ${t}`,
    value: (t) => `Value ${t}`,
    status: 'Status',
    source: 'Source',
    date: 'Date',
    dateUtc: 'Date (UTC)',
    gross: 'Gross',
    grossInfo: (t) => `Gross ${t} (info)`,
    kind: 'Type',
    event: 'Event',
    note: 'Note',
    year: 'Year',
    priceUsd: 'Price USD',
    valueUsd: 'Value USD',
    fxPair: (t) => `USD/${t}`,
    fxPairDay: (t) => `USD/${t} day`,
    priceDirect: (t) => `Price ${t} direct`,
    priceOverride: (t) =>
      t === 'CHF' ? 'ESTV price (override)' : 'Price (override)',
    quantitySource: 'Quantity source',
    priceSource: 'Price source',
    quantityExact: 'Exact quantity',
    reference: 'Reference',
    start: 'Start',
    end: 'End',
    startHolding: 'Holding start',
    endHolding: 'Holding end',
    history: 'Σ history',
    gap: 'Gap',
    averagePrice: (t) => `Ø price ${t}`,
  },

  statementSheet: 'Statement',
  sheets: {
    overview: 'Overview',
    parameters: 'Parameters',
    holdings: 'Holdings 31.12.',
    income: 'Income detail',
    earnGap: 'Earn gap',
    oneOff: 'One-off events',
    method: 'Method',
  },
  parametersTitle: 'Parameters',
  fxAtYearEnd: (base, t) => `${base}/${t} at 31.12.`,
  parametersNote: (usd, eur) =>
    `The formulas of the other sheets use these values (named cells ${usd}, ${eur}).`,
  holdingsTitle: (taxYear) => `Holdings at 31.12.${taxYear}`,
  incomeDetailTitle: 'Income detail',
  earnGapTitle: 'Earn gap (difference method)',
  earnGapExplanation:
    'Gap = (holding at end − holding at start) − Σ history (without internal transfers); only positive gaps are income, valued at the yearly average.',
  earnGapMethodPrefix: 'Difference method: ',
  gapIncome: 'Income',
  gapNegative: 'negative – no income',
  oneOffTitle: 'One-off events',
  methodTitle: 'Method',
  wealthByPlatform: (taxYear) => `Wealth at 31.12.${taxYear} by platform`,
  unpricedCount: (label) => `Positions ${label} (not in the total)`,
  incomeByCategory: (taxYear) => `Income ${taxYear} by category`,
  hintsTitle: 'Notes',
  colourLegend:
    'Colours: blue = input, black = formula, green = reference to Parameters.',
  methodLines: (m) => {
    const T = m.currency;
    const prices =
      T === 'CHF'
        ? 'Prices (the first available applies): 1. ESTV price (Kursliste) or override, 2. price CHF direct (e.g. from the account statement), 3. price USD × USD/CHF of the reference date.'
        : `Valued in ${T} (the project's tax currency). Prices (the first available applies): 1. override, 2. price ${T} direct, 3. price USD × USD/${T} of the reference date.`;
    const fiat =
      T === 'CHF'
        ? 'CHF = 1; EUR via EUR/CHF'
        : `${T} = 1; other currencies via their rate in ${T} (ECB, converted via USD or EUR where needed)`;
    return [
      'Method',
      '',
      `Wealth: holdings at 31.12.${m.taxYear} per platform/account and asset. If an account has an account statement at the reference date, it applies; otherwise the balance from the ledger (Σ quantity − Σ fee of all bookings until the end of the year). Positions with |quantity| < ${m.dustThreshold} are left out.`,
      prices,
      `Stablecoins (${m.usdPegged}) = 1 USD; ${fiat}. USD prices: daily close (Binance, UTC), at most ${m.priceToleranceDays} days old, otherwise the first price after (≤ ${m.priceToleranceDays} days). Currencies: ECB reference rates, last fixing.`,
      `Income: valued at the time it arrived (day in UTC), net after a fee in the same asset; gross as information. If the platform provides a USD value (e.g. Kraken amountusd − feeusd), that value × USD/${T} of the day applies.`,
      `Earn gap (difference method): (holding at end − holding at start) − Σ history without internal transfers, per account and asset; only positive gaps are income, valued at the yearly average. Excluded: ${m.earnGapExcluded}.`,
      'One-off events (hardforks, airdrops, losses) are shown separately.',
      'Positions and events without an available price are listed with their quantity, without a value, and are not included in the total.',
      'Spam/scam tokens (e.g. with “Claim” in the name) have no market value and are not included in the total.',
      'Assumptions (conservative): Launchpool/HODLer airdrops are income; Kraken income net after fees.',
      'Every figure can be traced back to its booking in the original file.',
      `Created with lazy-koins ${m.appVersion}.`,
    ];
  },

  internal: {
    title: 'Internal review report – not for the tax authority',
    note: 'Working document for you and your tax advisor (Treuhänder) – do not attach it to the tax return. The statements for the tax authority do not contain these points.',
    overviewSheet: 'Overview',
    checks: 'Checks',
    check: 'Check',
    light: 'Light',
    points: 'Items',
    impact: (t) => `Impact ${t}`,
    noChecks: 'No checks calculated.',
    openItems: 'Open items',
    topic: 'Topic',
    description: 'Description',
    estimatedImpact: (t) => `Estimated impact ${t}`,
    itemNote: 'Note',
    done: 'done',
    open: 'open',
    noOpenItems: 'No open items.',
    unpriced: 'Without price',
    hint: 'Note',
    positionAtYearEnd: 'Position 31.12.',
    negativeBalance: 'negative balance – bookings missing?',
    noYearEndPrice: 'no price at 31.12. – add the ESTV price',
    incomeKind: 'Income',
    noDailyPrice: (rawType) => `no daily price (${rawType}) – add a price`,
    priceMissing: 'price missing – add the ESTV price',
    allPriced: 'Every position and income has a price.',
    earnGap: 'Earn gap',
    negativeGap: 'negative gap – check holdings or history',
    noAveragePrice: 'no yearly average price – add a price',
    noGapWarnings: 'No Earn gap warnings.',
    files: 'Files',
    missingFileHint: 'Note on missing files',
    noFileHints: 'No notes on missing files.',
    openSummary: (open, done) => `${open} open, ${done} done`,
  },

  mail: {
    greeting: (advisor) => (advisor ? `Dear ${advisor}` : 'Hello'),
    noStatementYet: '- (no statement created yet)',
    intro: (taxYear, canton) =>
      `Please find attached my documents on cryptocurrencies for the tax year ${taxYear} (canton ${canton}):`,
    attachments: 'Attachments:',
    questions: 'Open questions (not included in the statements):',
    none: '- none',
    noAttachments: '- (no attachments)',
    assumptions: [
      '- Assumption: Launchpool/HODLer airdrops declared as income (conservative).',
      '- Assumption: income declared net after fees.',
    ],
    closing: 'Kind regards',
    subject: (taxYear) => `Taxes ${taxYear}: crypto wealth and income`,
  },
};
