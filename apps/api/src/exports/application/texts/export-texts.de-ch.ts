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
    wertschriften: 'wertschriftenverzeichnis',
    ertragsliste: 'ertragsliste',
    nachweis: 'nachweis',
    'e-steuerauszug': 'e-steuerauszug',
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

  eTax: {
    title: (taxYear) => `E-Steuerauszug ${taxYear} (eCH-0196)`,
    intro:
      'Wertschriftenliste der Kryptowährungen und Krypto-Erträge im Format eCH-0196 (Version 2.2) zum Import in die kantonale Steuersoftware. Die Daten stehen vollständig im Barcode am Ende des Dokuments.',
    client: 'Kunde',
    canton: 'Kanton, Steuerjahr',
    statementId: 'Dokument-ID',
    maker: 'Erstellt mit',
    makerValue:
      'lazy-koins, von der steuerpflichtigen Person aus den eigenen Exporten erstellt',
    depot: 'Depot',
    pos: 'Pos.',
    name: 'Bezeichnung',
    valor: 'Valor',
    quantity: 'Bestand 31.12.',
    price: 'Kurs CHF',
    taxValue: 'Steuerwert CHF',
    revenueB: 'Ertrag B CHF',
    payments: 'Zuflüsse',
    totalTaxValue: 'Total Steuerwert CHF',
    totalRevenueA: 'Total Bruttoertrag A (mit Verrechnungssteuer) CHF',
    totalRevenueB: 'Total Bruttoertrag B (ohne Verrechnungssteuer) CHF',
    totalWithholding: 'Total Verrechnungssteueranspruch CHF',
    undefinedValue: 'undefiniert',
    undefinedNote:
      'Ohne Kurs: Steuerwert bzw. Ertrag als «undefiniert» gekennzeichnet und mit 0 im Total.',
    earnGap: 'Earn-Lücke (Differenzmethode)',
    limitationsTitle: 'Abbildung im Standard',
    limitations: [
      'Kein Steuerauszug eines Finanzinstituts: ohne Clearing-Nummer (00000), LEI oder UID; die Plattformen sind als Depots aufgeführt.',
      'Kryptowährungen sieht eCH-0196 nicht eigens vor: Titelkategorie «Devisen/Noten» (CURRNOTE) wie in der ESTV-Kursliste, ohne ISIN; Valorennummer und Bezeichnung aus der Kursliste, sonst das Kürzel; Domizil CH, Währung CHF.',
      'Ohne Bestandesmutationen: der Bestand per 31.12. steht im Steuerwert, die Bewegungen im Transaktions- und Bestandesnachweis.',
      'Erträge ohne Verrechnungssteueranspruch (Rubrik B), ohne ausländische Quellensteuern (DA-1).',
      'Als Spam erkannte Token und negative Bestände sind nicht enthalten.',
    ],
    barcodeSheet: (sheet, sheets) => `Barcode-Blatt ${sheet} von ${sheets}`,
    barcodeNote:
      'PDF417 Structured Append (eCH-0196 Beilage 2): der vollständige E-Steuerauszug für den Import in die Steuersoftware.',
  },

  documents: {
    origin: (file, row) => `${file}, Zeile ${row}`,
    originTx: (hash) => `Tx ${hash}`,
    manualRecord: 'Manuelle Erfassung (Korrektur)',
    securities: {
      title: (taxYear) => `Wertschriften- und Guthabenverzeichnis ${taxYear}`,
      sheet: 'Wertschriftenverzeichnis',
      intro:
        'Kryptowährungen und Guthaben auf Plattformen und Wallets, je Asset und Plattform/Wallet. Steuerwert = Menge × Kurs per 31.12.',
      incomeWith: (t) => `Ertrag mit VST ${t}`,
      incomeWithout: (t) => `Ertrag ohne VST ${t}`,
      withholdingNote:
        'Erträge aus Kryptowährungen unterliegen nicht der Verrechnungssteuer (VST): sie stehen in der Spalte «ohne VST».',
      totals: 'Total',
      noHolding: 'kein Bestand per 31.12.',
    },
    incomeList: {
      title: (taxYear) => `Ertrags- und Belegliste ${taxYear}`,
      lines: 'Erträge je Zufluss',
      linesSheet: 'Erträge',
      byCategory: 'Summen je Kategorie',
      byAsset: 'Summen je Asset',
      summarySheet: 'Summen',
      origin: 'Herkunft',
      none: 'Keine steuerbaren Erträge in diesem Jahr.',
    },
    evidence: {
      title: (taxYear) => `Transaktions- und Bestandesnachweis ${taxYear}`,
      transactions: (taxYear) => `Transaktionen ${taxYear}`,
      transactionsSheet: 'Transaktionen',
      holdings: (taxYear) => `Bestände per 31.12.${taxYear}`,
      holdingsSheet: 'Bestände 31.12.',
      treatment: 'Steuerlich',
      change: 'Änderung',
      changeText: (before, after) => `${before} → ${after}`,
      reason: 'Begründung',
      evidence: 'Nachweis',
      treatments: {
        income: 'Ertrag',
        oneOff: 'Einmalereignis',
        balance: 'Bestand',
        checkOnly: 'Bestand laut Kontoauszug',
        transfer: 'Übertrag eigene Konten',
        spam: 'Spam',
        unknown: 'Bestand',
        afterYear: 'Nach dem Steuerjahr',
        excluded: 'Nicht berücksichtigt',
      },
      kinds: {
        trade: 'Handel',
        deposit: 'Einzahlung',
        withdrawal: 'Auszahlung',
        fee: 'Gebühr',
        transfer: 'Übertrag',
        income_interest: 'Ertrag Zinsen',
        income_staking: 'Ertrag Staking',
        income_airdrop: 'Airdrop',
        income_launchpool: 'Ertrag Launchpool',
        income_hardfork: 'Hardfork',
        loss: 'Verlust',
        spam: 'Spam',
        unknown: 'Übrige Buchung',
      },
      evidenceKinds: {
        statement: (files) => `Kontoauszug: ${files}`,
        ledger: (bookings) => `Ledger aus ${bookings} Buchungen`,
        wallet: (files) => `Wallet-Abruf: ${files}`,
        manual: (note) => (note ? `Manuell, Beleg: ${note}` : 'Manuell'),
      },
      hiddenNote:
        'Nicht berücksichtigte Buchungen sind mit Begründung aufgeführt; die Originaldatei bleibt unverändert.',
      none: 'Keine Transaktionen in diesem Jahr.',
    },
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
