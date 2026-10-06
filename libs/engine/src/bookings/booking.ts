import type { Decimal } from '../money/decimal';

/**
 * What a booking is — the closed list of the standard format "lazy-koins Buchungen v1" (the one
 * input model every file is turned into, directly or through a mapping). The platform's own
 * wording stays next to it in `rawType`, so a reclassification (F9.2) can always be explained.
 *
 * Income categories follow F7.2 (Zinsen/Earn, Staking, Airdrop, Launchpool, Hardfork).
 */
export const BOOKING_KINDS = [
  /** One leg of a buy/sell/convert; the other asset's leg is its own booking (same `group`). */
  'trade',
  /** Asset arriving from outside the platform (another exchange, a wallet, a bank). */
  'deposit',
  /** Asset leaving the platform. */
  'withdrawal',
  /** A fee charged on its own row (fees of a row travel in `fee` instead). */
  'fee',
  /** Moving an asset between the user's own accounts (spot ↔ earn/staking/funding). Not income. */
  'transfer',
  /** Income: interest / Earn products. */
  'income_interest',
  /** Income: staking rewards. */
  'income_staking',
  /** Income: airdrops. */
  'income_airdrop',
  /** Income: launchpool rewards. */
  'income_launchpool',
  /** Income: coins received from a hard fork. */
  'income_hardfork',
  /** A loss (hack, scam, lost key) — reported separately (F7.3). */
  'loss',
  /** Spam / scam tokens, hidden from the statement (F6.6). */
  'spam',
  /**
   * Not classified. Never dropped: it stays visible (and counted in the balance) until a mapping
   * or a correction (F9.2) says what it is.
   */
  'unknown',
] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

/** The kinds that are income of the year (F7.2), valued at the time they arrive. */
export const INCOME_KINDS = [
  'income_interest',
  'income_staking',
  'income_airdrop',
  'income_launchpool',
  'income_hardfork',
] as const satisfies readonly BookingKind[];
export type IncomeKind = (typeof INCOME_KINDS)[number];

export function isIncome(kind: BookingKind): kind is IncomeKind {
  return (INCOME_KINDS as readonly BookingKind[]).includes(kind);
}

export function isBookingKind(value: string): value is BookingKind {
  return (BOOKING_KINDS as readonly string[]).includes(value);
}

/** F7.5: where a record came from — the original file (its SHA-256) and the 1-based row. */
export interface SourceRef {
  readonly sourceFileId: string;
  /** 1-based, as a spreadsheet shows it — for a PDF, the page. */
  readonly row: number;
  /** The source row's values, keyed by its header, as text (never interpreted). */
  readonly raw?: Readonly<Record<string, string>>;
}

/**
 * One movement of one asset on one account (a "Buchung" of the standard format), exactly as read
 * from one row of one original file. Imported bookings are never changed afterwards — corrections
 * are separate data applied on top (F9.4).
 */
export interface Booking extends SourceRef {
  /** Stable within its source file: `<file>:<row>`. */
  readonly id: string;
  /** The platform (`kraken`, `binance`, …) or wallet the account lives on. */
  readonly platform: string;
  /** The account or wallet on that platform — several accounts per platform are possible. */
  readonly accountId: string;
  /** ISO 8601 in UTC (`2025-03-01T12:00:00.000Z`), converted from the source's zone. */
  readonly timestamp: string;
  /** Asset symbol, normalised (`BTC`, `ETH`, `CHF`). */
  readonly asset: string;
  /** Signed: positive arrives on the account, negative leaves it. Never a JS number. */
  readonly quantity: Decimal;
  readonly kind: BookingKind;
  /** Fee charged with this movement, as a positive amount that leaves the account. */
  readonly fee?: Decimal;
  /** The fee's asset; `asset` when absent. */
  readonly feeAsset?: string;
  /** Price of one unit in CHF / USD at `timestamp`, when the source states one. */
  readonly priceChf?: Decimal;
  readonly priceUsd?: Decimal;
  /** Bookings of one event (the legs of a trade) share a group (Kraken `refid`, …). */
  readonly group?: string;
  readonly note?: string;
  /** The platform's own type/sub-type, verbatim (`earn/reward`, `Simple Earn Flexible Interest`). */
  readonly rawType: string;
  /** The platform's own asset name when it differs from `asset` (`XXBT`, `DOT.S`). */
  readonly rawAsset?: string;
}

/**
 * A balance at a date (a "Bestand" of the standard format): what a statement says an account
 * held (F8.1: ledger balance = statement balance), or a manual position with its evidence (F6.5).
 */
export interface Holding extends SourceRef {
  readonly id: string;
  readonly platform: string;
  readonly accountId: string;
  readonly asset: string;
  readonly quantity: Decimal;
  /** ISO date (`2025-12-31`), end of day. */
  readonly asOf: string;
  readonly priceChf?: Decimal;
  readonly priceUsd?: Decimal;
  /** Where the figure comes from ("Kontoauszug Kraken 31.12.2025, S. 2"). */
  readonly evidence?: string;
}
