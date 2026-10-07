import type { ExportTexts } from './export-texts.types';

/**
 * German (Switzerland) — the original texts of the documents. Pinned byte for byte by
 * `export-language.spec.ts`: change them only on purpose (and update the snapshot then).
 */
export const DE_CH_EXPORT_TEXTS: ExportTexts = {
  htmlLang: 'de-CH',
  checkLabels: {
    ledgerVsStatement: 'Saldo laut Ledger = Saldo laut Kontoauszug',
    earnGap: 'Fehlende Earn-Erträge (Differenzmethode)',
    unmatchedWithdrawals: 'Auszahlungen ohne Gegenbuchung',
    unmatchedDeposits: 'Zuflüsse ohne Gegenbuchung (möglicher Ertrag)',
    openingBalance: 'Anfangsbestand = Endbestand des Vorjahres',
    missingPrices: 'Positionen ohne Kurs',
    unclassified: 'Nicht zugeordnete Buchungen',
    walletNetworks: 'Wallets auf allen Netzwerken geprüft',
  },
  lightLabels: {
    green: 'grün',
    yellow: 'gelb',
    red: 'rot',
    grey: 'nicht anwendbar',
  },
  statusLabels: {
    ok: 'ok',
    missingPrice: 'ohne Kurswert',
    spam: 'Spam',
    negative: 'Negativ',
  },
  statusNoteSpam: 'Spam-/Scam-Token ohne Marktwert; nicht im Total enthalten.',
  statusNoteNegative: 'negativer Saldo; nicht im Total enthalten.',
  oneOff: { loss: 'Verlust', hardfork: 'Hardfork', airdrop: 'Airdrop' },
  quantitySourceLabels: {
    statement: 'Kontoauszug',
    ledger: 'Ledger (Σ Menge − Σ Gebühr)',
    manual: 'Manuell (Korrektur)',
  },
  originLabels: {
    home: 'CHF',
    override: 'Überschrieben',
    estv: 'ESTV-Kursliste',
    recordChf: 'Kurs CHF laut Beleg',
    recordUsd: 'Kurs USD laut Beleg × USD/CHF',
    recordValueUsd: 'USD-Wert laut Plattform × USD/CHF',
    pegged: 'Stablecoin = 1 USD × USD/CHF',
    fx: 'Devisenkurs (EZB)',
    tableChf: 'Tageskurs CHF',
    tableUsd: 'Tagesschluss USD × USD/CHF',
  },
  openItems: {
    balanceDiffers: ({ where, p }) =>
      `${where}: Ledger ${p('actual')} ≠ Kontoauszug ${p('expected')} (Differenz ${p('difference')})`,
    ledgerBalanceDiffers: ({ where, p }) =>
      `${where}: Σ Buchungen ${p('actual')} ≠ Saldo-Spalte ${p('expected')}`,
    negativeBalance: ({ where, p }) =>
      `${where}: negativer Bestand ${p('quantity')} – Buchungen fehlen`,
    negativeEarnGap: ({ where, p }) =>
      `${where}: negative Earn-Lücke ${p('gap')} – Bestand oder Historie prüfen`,
    earnGapWithoutPrice: ({ where, p }) =>
      `${where}: Earn-Lücke ${p('gap')} ohne Jahresmittelkurs`,
    withdrawalWithoutDeposit: ({ where, p, date }) =>
      `${where}: Auszahlung ${p('quantity')} am ${date} ohne Eingang auf einem eigenen Konto`,
    depositWithoutWithdrawal: ({ where, p, date }) =>
      `${where}: Zufluss ${p('quantity')} am ${date} ohne Herkunft – möglicher Ertrag`,
    openingDiffers: ({ where, p }) =>
      `${where}: Anfangsbestand ${p('actual')} ≠ Endbestand Vorjahr ${p('expected')}`,
    positionWithoutPrice: ({ where }) =>
      `${where}: kein Kurs per 31.12. – ESTV-Kurs nachtragen`,
    incomeWithoutPrice: ({ p, asset }) =>
      `${asset}: ${p('count')} Ertragsbuchungen ohne Kurs`,
    oneOffWithoutPrice: ({ where }) =>
      `${where}: Einmalereignis ohne Kurs – ESTV-Kurs nachtragen`,
    ambiguousPrice: ({ asset }) =>
      `${asset}: Kurs mehrdeutig – das Kürzel steht für mehrere Coins; unter Kurse den Coin wählen`,
    unclassifiedBookings: ({ where, p }) =>
      `${where}: ${p('count')} Buchungen „${p('rawType')}“ nicht zugeordnet`,
    walletNetworksNotAvailable: () =>
      'Wallet-Abfrage auf allen Netzwerken ist noch nicht verfügbar – manuell prüfen',
    walletNetworksUnchecked: ({ p }) =>
      `Wallet ${p('wallet')}: Netzwerke noch nicht geprüft`,
    walletNetworkNotSelected: ({ p }) =>
      `Wallet ${p('wallet')}: auf ${p('network')} genutzt, aber nicht erfasst`,
    walletNetworkNotFetched: ({ p }) =>
      `Wallet ${p('wallet')} / ${p('network')}: noch nicht abgerufen`,
    walletManualBalanceMissing: ({ p }) =>
      `Wallet ${p('wallet')} / ${p('network')}: Saldo per 31.12. manuell mit Beleg erfassen`,
    walletFetchFailed: ({ p }) =>
      `Wallet ${p('wallet')} / ${p('network')}: Abruf fehlgeschlagen`,
  },
  hints: {
    noYearData: ({ where, date }, zero) =>
      zero
        ? `${where}: Buchungen enden am ${date}, danach Saldo 0 – nichts fehlt`
        : `${where}: keine Buchungen im Steuerjahr – Historie endet am ${date}`,
    startsLate: ({ where, date }) =>
      `${where}: Buchungen erst ab ${date} – Export ab 01.01. fehlt`,
    endsEarly: ({ where, date }, zero) =>
      zero
        ? `${where}: Buchungen nur bis ${date}, danach Saldo 0 – nichts fehlt`
        : `${where}: Buchungen nur bis ${date} – Export bis 31.12. fehlt`,
    noYearEndBalance: ({ where }) =>
      `${where}: kein Saldo/Kontoauszug per 31.12.`,
  },

  variantSimple: 'einfach',
  variantDetailed: 'ausführlich',
  statementTitle: (taxYear, variant) =>
    `Steuerauszug Kryptowährungen ${taxYear} (${variant})`,
  metaLine: (m) =>
    `${m.owner} · Steuerjahr ${m.taxYear} · Kanton ${m.canton} · erstellt am ${m.created} · berechnet am ${m.calculated}`,
  pageTitleSimple: (taxYear) => `Steuerauszug ${taxYear}`,
  pageTitleDetailed: (taxYear) => `Steuerauszug ${taxYear} (ausführlich)`,
  fileVariants: {
    einfach: 'einfach',
    ausfuehrlich: 'ausfuehrlich',
    'pruefbericht-intern': 'pruefbericht-intern',
  },

  col: {
    platformWallet: 'Plattform / Wallet',
    mainPositions: 'Hauptpositionen',
    smallPositions: 'Kleinpositionen',
    taxValue: (t) => `Steuerwert ${t}`,
    total: 'Total',
    totalIncome: 'Total Ertrag',
    totalWealth: 'Total Vermögen',
    category: 'Kategorie',
    bookings: 'Buchungen',
    income: (t) => `Ertrag ${t}`,
    platform: 'Plattform',
    account: 'Konto',
    asset: 'Asset',
    quantity: 'Menge',
    quantityNet: 'Menge netto',
    price: (t) => `Kurs ${t}`,
    value: (t) => `Wert ${t}`,
    status: 'Status',
    source: 'Quelle',
    date: 'Datum',
    dateUtc: 'Datum (UTC)',
    gross: 'Brutto',
    grossInfo: (t) => `Brutto ${t} (Info)`,
    kind: 'Art',
    event: 'Ereignis',
    note: 'Hinweis',
    year: 'Jahr',
    priceUsd: 'Kurs USD',
    valueUsd: 'Wert USD',
    fxPair: (t) => `USD/${t}`,
    fxPairDay: (t) => `USD/${t} Tag`,
    priceDirect: (t) => `Kurs ${t} direkt`,
    priceOverride: (t) =>
      t === 'CHF' ? 'ESTV-Kurs (Override)' : 'Kurs (Override)',
    quantitySource: 'Quelle Menge',
    priceSource: 'Quelle Kurs',
    quantityExact: 'Menge exakt',
    reference: 'Referenz',
    start: 'Anfang',
    end: 'Ende',
    startHolding: 'Bestand Anfang',
    endHolding: 'Bestand Ende',
    history: 'Σ Historie',
    gap: 'Lücke',
    averagePrice: (t) => `Ø Kurs ${t}`,
  },

  statementSheet: 'Auszug',
  sheets: {
    overview: 'Übersicht',
    parameters: 'Parameter',
    holdings: 'Bestand 31.12.',
    income: 'Ertrag Detail',
    earnGap: 'Earn-Lücke',
    oneOff: 'Einmalereignisse',
    method: 'Methodik',
  },
  parametersTitle: 'Parameter',
  fxAtYearEnd: (base, t) => `${base}/${t} per 31.12.`,
  parametersNote: (usd, eur) =>
    `Die Formeln der übrigen Blätter rechnen mit diesen Werten (benannte Zellen ${usd}, ${eur}).`,
  holdingsTitle: (taxYear) => `Bestand per 31.12.${taxYear}`,
  incomeDetailTitle: 'Ertrag Detail',
  earnGapTitle: 'Earn-Lücke (Differenzmethode)',
  earnGapExplanation:
    'Lücke = (Bestand Ende − Bestand Anfang) − Σ Historie (ohne interne Umbuchungen); nur positive Lücken sind Ertrag, bewertet zum Jahresmittel.',
  earnGapMethodPrefix: 'Differenzmethode: ',
  gapIncome: 'Ertrag',
  gapNegative: 'negativ – kein Ertrag',
  oneOffTitle: 'Einmalereignisse',
  methodTitle: 'Methodik',
  wealthByPlatform: (taxYear) => `Vermögen per 31.12.${taxYear} je Plattform`,
  unpricedCount: (label) => `Positionen ${label} (nicht im Total)`,
  incomeByCategory: (taxYear) => `Ertrag ${taxYear} je Kategorie`,
  hintsTitle: 'Hinweise',
  colourLegend:
    'Farben: blau = Eingabe, schwarz = Formel, grün = Verweis auf Parameter.',
  methodLines: (m) => {
    const T = m.currency;
    const prices =
      T === 'CHF'
        ? 'Kurse (erste vorhandene gilt): 1. ESTV-Kurs bzw. Override, 2. Kurs CHF direkt (z. B. aus dem Kontoauszug), 3. Kurs USD × USD/CHF des Stichtags.'
        : `Bewertung in ${T} (Steuerwährung des Projekts). Kurse (erste vorhandene gilt): 1. Override, 2. Kurs ${T} direkt, 3. Kurs USD × USD/${T} des Stichtags.`;
    const fiat =
      T === 'CHF'
        ? 'CHF = 1; EUR über EUR/CHF'
        : `${T} = 1; andere Währungen über ihren Kurs in ${T} (EZB, wo nötig über USD bzw. EUR umgerechnet)`;
    return [
      'Methodik',
      '',
      `Vermögen: Bestand per 31.12.${m.taxYear} je Plattform/Konto und Asset. Hat ein Konto einen Kontoauszug per Stichtag, gilt dieser; sonst der Saldo aus dem Ledger (Σ Menge − Σ Gebühr aller Buchungen bis Jahresende). Positionen mit |Menge| < ${m.dustThreshold} entfallen.`,
      prices,
      `Stablecoins (${m.usdPegged}) = 1 USD; ${fiat}. USD-Kurse: Tagesschluss (Binance, UTC), höchstens ${m.priceToleranceDays} Tage alt, sonst erster Kurs danach (≤ ${m.priceToleranceDays} Tage). Devisen: EZB-Referenzkurse, letztes Fixing.`,
      `Ertrag: zum Zuflusszeitpunkt (Tag in UTC) bewertet, netto nach Gebühr im gleichen Asset; Brutto als Information. Liefert die Plattform einen USD-Wert (z. B. Kraken amountusd − feeusd), gilt dieser × USD/${T} des Tages.`,
      `Earn-Lücke (Differenzmethode): (Bestand Ende − Bestand Anfang) − Σ Historie ohne interne Umbuchungen, je Konto und Asset; nur positive Lücken sind Ertrag, bewertet zum Jahresmittel. Ausgenommen: ${m.earnGapExcluded}.`,
      'Einmalereignisse (Hardforks, Airdrops, Verluste) werden separat ausgewiesen.',
      'Positionen und Ereignisse ohne verfügbaren Kurswert werden mit ihrer Menge, ohne Wert aufgeführt und sind nicht im Total enthalten.',
      'Spam-/Scam-Token (z. B. mit „Claim“ im Namen) haben keinen Marktwert und sind nicht im Total enthalten.',
      'Annahmen (konservativ): Launchpool-/HODLer-Airdrops sind Ertrag; Kraken-Erträge netto nach Gebühr.',
      'Jede Zahl ist bis zur Buchung in der Originaldatei rückverfolgbar.',
      `Erstellt mit lazy-koins ${m.appVersion}.`,
    ];
  },

  internal: {
    title: 'Interner Prüfbericht – nicht für die Steuerbehörde',
    note: 'Arbeitsunterlage für dich und deinen Treuhänder – nicht der Steuererklärung beilegen. Die Auszüge für die Steuerbehörde enthalten diese Punkte nicht.',
    overviewSheet: 'Übersicht',
    checks: 'Prüfungen',
    check: 'Prüfung',
    light: 'Ampel',
    points: 'Punkte',
    impact: (t) => `Auswirkung ${t}`,
    noChecks: 'Keine Prüfungen berechnet.',
    openItems: 'Offene Punkte',
    topic: 'Thema',
    description: 'Beschreibung',
    estimatedImpact: (t) => `Geschätzte Auswirkung ${t}`,
    itemNote: 'Notiz',
    done: 'erledigt',
    open: 'offen',
    noOpenItems: 'Keine offenen Punkte.',
    unpriced: 'Ohne Kurs',
    hint: 'Hinweis',
    positionAtYearEnd: 'Position 31.12.',
    negativeBalance: 'negativer Saldo – Buchungen fehlen?',
    noYearEndPrice: 'kein Kurs per 31.12. – ESTV-Kurs nachtragen',
    incomeKind: 'Ertrag',
    noDailyPrice: (rawType) => `kein Tageskurs (${rawType}) – Kurs nachtragen`,
    priceMissing: 'Kurs fehlt – ESTV-Kurs nachtragen',
    allPriced: 'Alle Positionen und Erträge haben einen Kurs.',
    earnGap: 'Earn-Lücke',
    negativeGap: 'negative Lücke – Bestand oder Historie prüfen',
    noAveragePrice: 'kein Jahresmittelkurs – Kurs nachtragen',
    noGapWarnings: 'Keine Warnungen zur Earn-Lücke.',
    files: 'Dateien',
    missingFileHint: 'Hinweis zu fehlenden Dateien',
    noFileHints: 'Keine Hinweise zu fehlenden Dateien.',
    openSummary: (open, done) => `${open} offen, ${done} erledigt`,
  },

  mail: {
    greeting: (advisor) => (advisor ? `Guten Tag ${advisor}` : 'Guten Tag'),
    noStatementYet: '- (noch kein Auszug erstellt)',
    intro: (taxYear, canton) =>
      `Anbei meine Unterlagen zu den Kryptowährungen für das Steuerjahr ${taxYear} (Kanton ${canton}):`,
    attachments: 'Anhänge:',
    questions: 'Offene Fachfragen (in den Auszügen nicht enthalten):',
    none: '- keine',
    noAttachments: '- (keine Anhänge)',
    assumptions: [
      '- Annahme: Launchpool-/HODLer-Airdrops als Ertrag deklariert (konservativ).',
      '- Annahme: Erträge netto nach Gebühr deklariert.',
    ],
    closing: 'Freundliche Grüsse',
    subject: (taxYear) => `Steuern ${taxYear}: Krypto-Vermögen und Ertrag`,
  },
};
