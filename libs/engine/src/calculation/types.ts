import type { Booking, BookingKind, Holding } from '../bookings/booking';
import type { AppliedCorrection, Correction } from '../corrections/corrections';
import type { PriceOrigin, RateEntry } from '../rates/rate-table';
import type { CountryRules, IncomeCategory } from '../rules/country-rules';

/**
 * The calculation's input and result (F7). Everything in the result is JSON-friendly: amounts
 * are **decimal strings** (CLAUDE.md, Numbers), absent values `null`, and every figure lists the
 * ids of the records it was computed from (F7.5) — `records` resolves them to file + row.
 */

/** The previous year's project, when there is one (F8.1 opening balance, F8.3 comparison). */
export interface PreviousYear {
  readonly taxYear: number;
  readonly wealthChf: string;
  readonly incomeChf: string;
  readonly positions: readonly {
    readonly platform: string;
    readonly accountId: string;
    readonly asset: string;
    readonly quantity: string;
    readonly valueChf: string | null;
  }[];
}

/**
 * F6.4 / F8.1 "Wallets auf allen Netzwerken geprüft": the state of one wallet of the project on
 * one network, as the API knows it (activity check, fetch, manual balance). Only the check reads
 * it — the wallet's records come in as ordinary (derived) files.
 */
export interface WalletNetworkState {
  readonly network: string;
  /** Selected for the wallet (its records are part of the project). */
  readonly selected: boolean;
  /** F6.4 activity: true = used, false = never used, null = not checked. */
  readonly used: boolean | null;
  /** What can be fetched there: `history`, `income` (balance by hand) or `manual`. */
  readonly coverage: 'history' | 'income' | 'manual';
  /** The last fetch: ok, failed, or never. */
  readonly fetch: 'ok' | 'error' | 'none';
  /** A manual balance with evidence exists for the project's 31.12. (F6.5). */
  readonly manualBalance: boolean;
}

export interface WalletState {
  readonly walletId: string;
  readonly label: string;
  /** F6.4 ran for every network the address can live on. */
  readonly networksChecked: boolean;
  readonly networks: readonly WalletNetworkState[];
}

export interface CalculationInput {
  readonly taxYear: number;
  readonly rules: CountryRules;
  /** The standard records of every file of the project (bookings of all years are fine). */
  readonly bookings: readonly Booking[];
  readonly holdings: readonly Holding[];
  /** Active corrections (undone ones are left out by the caller). */
  readonly corrections: readonly Correction[];
  /** The project's stored prices and exchange rates (F7.4). */
  readonly rates: readonly RateEntry[];
  readonly previous?: PreviousYear;
  /** The project's wallets (F6.4); absent or empty = the wallet check is not applicable. */
  readonly wallets?: readonly WalletState[];
  /**
   * F7.4: tickers that stand for several coins and for which the user has not chosen one — each
   * such asset of the year gets an open item (`ambiguousPrice:<asset>`). The caller also keeps
   * by-ticker prices of them out of `rates`.
   */
  readonly ambiguousAssets?: readonly string[];
}

/** Where a figure came from — a record of a file (F7.5) or of a correction. */
export interface RecordSummary {
  readonly id: string;
  readonly type: 'booking' | 'holding';
  readonly sourceFileId: string;
  readonly row: number;
  readonly platform: string;
  readonly accountId: string;
  readonly asset: string;
  readonly quantity: string;
  /** Booking: ISO timestamp; holding: its date. */
  readonly at: string;
  readonly kind: BookingKind | null;
  readonly fee: string | null;
  readonly feeAsset: string | null;
  readonly rawType: string | null;
  readonly raw: Readonly<Record<string, string>> | null;
}

export type QuantitySource = 'statement' | 'ledger' | 'manual';
export type PositionStatus = 'ok' | 'missingPrice' | 'spam' | 'negative';

/** The price columns a statement shows (FACHREGELN, Bestand) — each null when not used. */
export interface PriceColumns {
  /** USD per unit (record, stablecoin = 1, stored close). */
  readonly priceUsd: string | null;
  /** USD/CHF used with it. */
  readonly usdChf: string | null;
  /** "Kurs CHF direkt": a record's CHF price, a stored CHF price, or a fiat rate. */
  readonly chfDirect: string | null;
  /** ESTV Kursliste value or an override (F7.4, F9.1). */
  readonly estvChf: string | null;
}

export interface Position extends PriceColumns {
  /** `pos:<platform>|<account>|<asset>` */
  readonly id: string;
  readonly platform: string;
  readonly accountId: string;
  readonly asset: string;
  readonly quantity: string;
  readonly quantitySource: QuantitySource;
  /** CHF per unit used, and how it was found. */
  readonly priceChf: string | null;
  readonly priceOrigin: PriceOrigin | null;
  readonly priceSource: string | null;
  readonly priceDate: string | null;
  readonly valueChf: string | null;
  readonly status: PositionStatus;
  readonly recordIds: readonly string[];
}

export interface PlatformTotal {
  /** `plat:<platform>` */
  readonly id: string;
  readonly platform: string;
  readonly valueChf: string;
  readonly positions: number;
  readonly missingPrices: number;
}

export type IncomeStatus = 'ok' | 'missingPrice' | 'spam';
export type IncomeOrigin = PriceOrigin | 'recordValueUsd';

export interface IncomeLine {
  /** `inc:<booking id>` */
  readonly id: string;
  readonly bookingId: string;
  readonly timestamp: string;
  readonly date: string;
  readonly platform: string;
  readonly accountId: string;
  readonly kind: BookingKind;
  readonly category: IncomeCategory;
  readonly asset: string;
  readonly quantityGross: string;
  readonly fee: string | null;
  readonly feeAsset: string | null;
  /** After a fee in the same asset (FACHREGELN: netto is declared). */
  readonly quantityNet: string;
  readonly priceUsd: string | null;
  readonly usdChf: string | null;
  readonly priceChf: string | null;
  /** The platform's own USD value, net of the fee's USD value (Kraken `amountusd − feeusd`). */
  readonly valueUsd: string | null;
  readonly valueChf: string | null;
  /** Before the fee — information only, not in the total. */
  readonly grossValueChf: string | null;
  readonly priceOrigin: IncomeOrigin | null;
  readonly priceSource: string | null;
  readonly status: IncomeStatus;
  readonly rawType: string;
  readonly group: string | null;
  readonly recordIds: readonly string[];
}

export interface CategoryTotal {
  /** `cat:<category>` */
  readonly id: string;
  readonly category: IncomeCategory;
  readonly valueChf: string;
  readonly lines: number;
  readonly missingPrices: number;
}

export type EarnGapStatus = 'income' | 'negative' | 'missingPrice';

/** FACHREGELN, Earn-Lücke (Differenzmethode), per account and asset. */
export interface EarnGap {
  /** `gap:<platform>|<account>|<asset>` */
  readonly id: string;
  readonly platform: string;
  readonly accountId: string;
  readonly asset: string;
  readonly startQuantity: string;
  readonly endQuantity: string;
  readonly bookedQuantity: string;
  /** (end − start) − booked. */
  readonly gapQuantity: string;
  readonly averagePriceChf: string | null;
  /** Only for a positive gap with a price. */
  readonly valueChf: string | null;
  readonly status: EarnGapStatus;
  readonly recordIds: readonly string[];
}

/** F7.3: hard forks, airdrops and losses, listed separately. */
export interface OneOffEvent {
  /** `evt:<booking id>` */
  readonly id: string;
  readonly timestamp: string;
  readonly kind: BookingKind;
  readonly platform: string;
  readonly accountId: string;
  readonly asset: string;
  readonly quantity: string;
  /** Value at arrival (income) or at the day of the loss; null = no price ("ESTV-Kurs nachtragen"). */
  readonly valueChf: string | null;
  readonly incomeLineId: string | null;
  readonly recordIds: readonly string[];
}

export const CHECK_KINDS = [
  'ledgerVsStatement',
  'earnGap',
  'unmatchedWithdrawals',
  'unmatchedDeposits',
  'openingBalance',
  'missingPrices',
  'unclassified',
  'walletNetworks',
] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

/** Traffic light (F8.1): grey = not applicable (no data for this check). */
export type Light = 'green' | 'yellow' | 'red' | 'grey';

export const OPEN_ITEM_REASONS = [
  'balanceDiffers',
  'ledgerBalanceDiffers',
  'negativeBalance',
  'negativeEarnGap',
  'earnGapWithoutPrice',
  'withdrawalWithoutDeposit',
  'depositWithoutWithdrawal',
  'openingDiffers',
  'positionWithoutPrice',
  'incomeWithoutPrice',
  'oneOffWithoutPrice',
  /** The ticker stands for several coins and none is chosen: "Kurs mehrdeutig – Coin wählen". */
  'ambiguousPrice',
  'unclassifiedBookings',
  /** The placeholder of engine version 1 — kept so stored snapshots still read. */
  'walletNetworksNotAvailable',
  'walletNetworksUnchecked',
  'walletNetworkNotSelected',
  'walletNetworkNotFetched',
  'walletManualBalanceMissing',
  'walletFetchFailed',
] as const;
export type OpenItemReason = (typeof OPEN_ITEM_REASONS)[number];

/** F8.2: something to look at, with its estimated CHF impact (null = unknown). */
export interface OpenItem {
  /** Stable across recalculations of the same data — ticks and notes are keyed by it. */
  readonly key: string;
  readonly check: CheckKind;
  readonly reason: OpenItemReason;
  readonly light: 'yellow' | 'red';
  readonly platform: string | null;
  readonly accountId: string | null;
  readonly asset: string | null;
  readonly date: string | null;
  /** Values for the message (`expected`, `actual`, `difference`, `count`, …), decimal strings. */
  readonly params: Readonly<Record<string, string>>;
  readonly impactChf: string | null;
  readonly recordIds: readonly string[];
}

export interface Check {
  readonly kind: CheckKind;
  readonly light: Light;
  readonly items: number;
  /** Sum of the known impacts (absolute values). */
  readonly impactChf: string;
}

export interface Comparison {
  readonly previousTaxYear: number;
  readonly previousWealthChf: string;
  readonly previousIncomeChf: string;
  readonly wealthDeltaChf: string;
  readonly incomeDeltaChf: string;
  readonly newPositions: readonly {
    readonly platform: string;
    readonly accountId: string;
    readonly asset: string;
    readonly quantity: string;
    readonly valueChf: string | null;
  }[];
  readonly removedPositions: readonly {
    readonly platform: string;
    readonly accountId: string;
    readonly asset: string;
    readonly quantity: string;
    readonly valueChf: string | null;
  }[];
}

/**
 * Every amount of the result (`…Chf` fields) is in the project's **tax currency** `currency`
 * (F4.1a; CHF by default). The field names predate F4.1a and stay for the stored snapshots and
 * the API types; `usdChf` / `eurChf` are USD/T and EUR/T.
 */
export interface CalculationResult {
  readonly engineVersion: number;
  readonly taxYear: number;
  readonly country: string;
  /** ISO 4217 code of the tax currency (F4.1a). Snapshots of engine version ≤ 3 lack it = CHF. */
  readonly currency: string;
  readonly yearEnd: string;
  readonly totals: {
    readonly wealthChf: string;
    readonly incomeChf: string;
    readonly positions: number;
    readonly missingPrices: number;
    readonly openItems: number;
  };
  /** The USD/T and EUR/T used at 31.12. (the Excel's parameters; T = `currency`). */
  readonly parameters: {
    readonly usdChf: string | null;
    readonly eurChf: string | null;
    readonly usdChfSource: string | null;
    readonly eurChfSource: string | null;
  };
  readonly positions: readonly Position[];
  readonly platforms: readonly PlatformTotal[];
  readonly income: readonly IncomeLine[];
  readonly categories: readonly CategoryTotal[];
  readonly earnGaps: readonly EarnGap[];
  readonly oneOffEvents: readonly OneOffEvent[];
  readonly checks: readonly Check[];
  readonly openItems: readonly OpenItem[];
  readonly corrections: readonly AppliedCorrection[];
  readonly comparison: Comparison | null;
  /** Every record a figure names, by id (F7.5). */
  readonly records: Readonly<Record<string, RecordSummary>>;
}

/**
 * Bumped when the same input would give a different result (snapshots record it). 4 = the tax
 * currency per project (F4.1a: `currency`, valuation in T with FX cross rates).
 */
export const ENGINE_VERSION = 4;
