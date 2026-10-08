import type {
  BookingKind,
  CheckKind,
  Light,
  MissingFileHint,
  OpenItem,
  PositionStatus,
  QuantitySource,
} from '@lazykoins/engine';

/**
 * The texts of every document the API writes (F10, F11.2) — statements, internal report, mail
 * draft — in one language. Country-specific wording (titles, form references, income categories)
 * comes from the country rules (F10.3, `rulesInLanguage`); this holds the rest. One object per
 * locale in this folder; German is the original and must not change (export-language.spec.ts).
 */
export interface OpenItemText {
  /** `platform / account / asset` of the item. */
  readonly where: string;
  /** A parameter of the item, `''` when absent. */
  readonly p: (key: string) => string;
  /** The item's date in the user's format. */
  readonly date: string;
  readonly asset: string;
}

export interface HintText {
  readonly where: string;
  readonly date: string;
}

export interface MethodContext {
  readonly currency: string;
  readonly taxYear: number;
  readonly dustThreshold: string;
  readonly usdPegged: string;
  readonly priceToleranceDays: number;
  readonly earnGapExcluded: string;
  readonly appVersion: string;
}

export interface ExportTexts {
  /** `<html lang>` of the PDFs. */
  readonly htmlLang: string;
  readonly checkLabels: Readonly<Record<CheckKind, string>>;
  readonly lightLabels: Readonly<Record<Light, string>>;
  /** Status of a position — the Excel's SUMIFS/COUNTIFS match these texts. */
  readonly statusLabels: Readonly<Record<PositionStatus, string>>;
  readonly statusNoteSpam: string;
  readonly statusNoteNegative: string;
  readonly oneOff: {
    readonly loss: string;
    readonly hardfork: string;
    readonly airdrop: string;
  };
  readonly quantitySourceLabels: Readonly<Record<QuantitySource, string>>;
  /** How a price was found; `CHF` in a label is replaced by the tax currency. */
  readonly originLabels: Readonly<Record<string, string>>;
  readonly openItems: Readonly<
    Record<OpenItem['reason'], (item: OpenItemText) => string>
  >;
  readonly hints: Readonly<
    Record<MissingFileHint['kind'], (hint: HintText, zero: boolean) => string>
  >;

  // --- statement header (F10.4) ---
  readonly variantSimple: string;
  readonly variantDetailed: string;
  readonly statementTitle: (taxYear: number, variant: string) => string;
  readonly metaLine: (m: {
    owner: string;
    taxYear: number;
    canton: string;
    created: string;
    calculated: string;
  }) => string;
  readonly pageTitleSimple: (taxYear: number) => string;
  readonly pageTitleDetailed: (taxYear: number) => string;
  /** File names: `<project>_<variant>_<date>`. */
  readonly fileVariants: {
    readonly einfach: string;
    readonly ausfuehrlich: string;
    readonly 'pruefbericht-intern': string;
    readonly wertschriften: string;
    readonly ertragsliste: string;
    readonly nachweis: string;
  };

  // --- column titles ---
  readonly col: {
    readonly platformWallet: string;
    readonly mainPositions: string;
    readonly smallPositions: string;
    readonly taxValue: (currency: string) => string;
    readonly total: string;
    readonly totalIncome: string;
    readonly totalWealth: string;
    readonly category: string;
    readonly bookings: string;
    readonly income: (currency: string) => string;
    readonly platform: string;
    readonly account: string;
    readonly asset: string;
    readonly quantity: string;
    readonly quantityNet: string;
    readonly price: (currency: string) => string;
    readonly value: (currency: string) => string;
    readonly status: string;
    readonly source: string;
    readonly date: string;
    readonly dateUtc: string;
    readonly gross: string;
    readonly grossInfo: (currency: string) => string;
    readonly kind: string;
    readonly event: string;
    readonly note: string;
    readonly year: string;
    readonly priceUsd: string;
    readonly valueUsd: string;
    readonly fxPair: (currency: string) => string;
    readonly fxPairDay: (currency: string) => string;
    readonly priceDirect: (currency: string) => string;
    readonly priceOverride: (currency: string) => string;
    readonly quantitySource: string;
    readonly priceSource: string;
    readonly quantityExact: string;
    readonly reference: string;
    readonly start: string;
    readonly end: string;
    readonly startHolding: string;
    readonly endHolding: string;
    readonly history: string;
    readonly gap: string;
    readonly averagePrice: (currency: string) => string;
  };

  // --- statements ---
  readonly statementSheet: string;
  readonly sheets: {
    readonly overview: string;
    readonly parameters: string;
    readonly holdings: string;
    readonly income: string;
    readonly earnGap: string;
    readonly oneOff: string;
    readonly method: string;
  };
  readonly parametersTitle: string;
  /** `USD/CHF per 31.12.` (+ the year in the workbook). */
  readonly fxAtYearEnd: (base: string, currency: string) => string;
  readonly parametersNote: (usdName: string, eurName: string) => string;
  readonly holdingsTitle: (taxYear: number) => string;
  readonly incomeDetailTitle: string;
  readonly earnGapTitle: string;
  readonly earnGapExplanation: string;
  readonly earnGapMethodPrefix: string;
  readonly gapIncome: string;
  readonly gapNegative: string;
  readonly oneOffTitle: string;
  readonly methodTitle: string;
  readonly wealthByPlatform: (taxYear: number) => string;
  readonly unpricedCount: (statusLabel: string) => string;
  readonly incomeByCategory: (taxYear: number) => string;
  readonly hintsTitle: string;
  readonly colourLegend: string;
  readonly methodLines: (m: MethodContext) => readonly string[];

  // --- further tax documents (F10.11–F10.13) ---
  readonly documents: {
    /** Where a record comes from: `<file>, Zeile <n>` / `Tx <hash>`. */
    readonly origin: (file: string, row: number) => string;
    readonly originTx: (hash: string) => string;
    readonly manualRecord: string;
    readonly securities: {
      readonly title: (taxYear: number) => string;
      readonly sheet: string;
      readonly intro: string;
      readonly incomeWith: (currency: string) => string;
      readonly incomeWithout: (currency: string) => string;
      readonly withholdingNote: string;
      readonly totals: string;
      readonly noHolding: string;
    };
    readonly incomeList: {
      readonly title: (taxYear: number) => string;
      readonly lines: string;
      readonly linesSheet: string;
      readonly byCategory: string;
      readonly byAsset: string;
      readonly summarySheet: string;
      readonly origin: string;
      readonly none: string;
    };
    readonly evidence: {
      readonly title: (taxYear: number) => string;
      readonly transactions: (taxYear: number) => string;
      readonly transactionsSheet: string;
      readonly holdings: (taxYear: number) => string;
      readonly holdingsSheet: string;
      readonly treatment: string;
      readonly change: string;
      readonly changeText: (before: string, after: string) => string;
      readonly reason: string;
      readonly evidence: string;
      readonly treatments: Readonly<Record<string, string>>;
      readonly kinds: Readonly<Record<BookingKind, string>>;
      readonly evidenceKinds: {
        readonly statement: (files: string) => string;
        readonly ledger: (bookings: number) => string;
        readonly wallet: (files: string) => string;
        readonly manual: (note: string) => string;
      };
      readonly hiddenNote: string;
      readonly none: string;
    };
  };

  // --- internal report (F10.2a) ---
  readonly internal: {
    readonly title: string;
    readonly note: string;
    readonly overviewSheet: string;
    readonly checks: string;
    readonly check: string;
    readonly light: string;
    readonly points: string;
    readonly impact: (currency: string) => string;
    readonly noChecks: string;
    readonly openItems: string;
    readonly topic: string;
    readonly description: string;
    readonly estimatedImpact: (currency: string) => string;
    readonly itemNote: string;
    readonly done: string;
    readonly open: string;
    readonly noOpenItems: string;
    readonly unpriced: string;
    readonly hint: string;
    readonly positionAtYearEnd: string;
    readonly negativeBalance: string;
    readonly noYearEndPrice: string;
    readonly incomeKind: string;
    readonly noDailyPrice: (rawType: string) => string;
    readonly priceMissing: string;
    readonly allPriced: string;
    readonly earnGap: string;
    readonly negativeGap: string;
    readonly noAveragePrice: string;
    readonly noGapWarnings: string;
    readonly files: string;
    readonly missingFileHint: string;
    readonly noFileHints: string;
    readonly openSummary: (open: number, done: number) => string;
  };

  // --- mail draft (F10.6) ---
  readonly mail: {
    readonly greeting: (advisor: string) => string;
    readonly noStatementYet: string;
    readonly intro: (taxYear: number, canton: string) => string;
    readonly attachments: string;
    readonly questions: string;
    readonly none: string;
    readonly noAttachments: string;
    readonly assumptions: readonly string[];
    readonly closing: string;
    readonly subject: (taxYear: number) => string;
  };
}
