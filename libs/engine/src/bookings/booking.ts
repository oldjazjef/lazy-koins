import type { Decimal } from '../money/decimal';

/**
 * What a booking is, as the engine understands it. The platform's own wording stays next to it
 * in `rawType`, so a reclassification (F9.2) can always be explained.
 *
 * Income categories follow F7.2 (Zinsen/Earn, Staking, Airdrop, Launchpool, Hardfork).
 */
export const BOOKING_KINDS = [
  /** One leg of a buy/sell/convert; the other asset's leg is its own booking. */
  'trade',
  /** Asset arriving from outside the platform (another exchange, a wallet, a bank). */
  'deposit',
  /** Asset leaving the platform. */
  'withdrawal',
  /** A fee charged by the platform or the network. */
  'fee',
  /** Income: interest / Earn products. */
  'interest',
  /** Income: staking rewards. */
  'staking',
  /** Income: airdrops. */
  'airdrop',
  /** Income: launchpool rewards. */
  'launchpool',
  /** Income: coins received from a hard fork. */
  'hardfork',
  /** Recognised row the engine does not interpret (yet); kept for traceability. */
  'other',
] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

/** The kinds that are income of the year (F7.2), valued at the time they arrive. */
export const INCOME_KINDS = [
  'interest',
  'staking',
  'airdrop',
  'launchpool',
  'hardfork',
] as const satisfies readonly BookingKind[];
export type IncomeKind = (typeof INCOME_KINDS)[number];

export function isIncome(kind: BookingKind): kind is IncomeKind {
  return (INCOME_KINDS as readonly BookingKind[]).includes(kind);
}

/**
 * One movement of one asset on one account, exactly as an importer read it from one row of one
 * original file. Imported bookings are never changed afterwards — corrections are separate data
 * applied on top (F9.4).
 */
export interface Booking {
  /** Stable within its source file (importers derive it from file + row + leg). */
  readonly id: string;
  /** The platform (`kraken`, `binance`, …) or wallet network the account lives on. */
  readonly platform: string;
  /** The account or wallet on that platform — several accounts per platform are possible. */
  readonly accountId: string;
  /** ISO 8601 in UTC (`2025-03-01T12:00:00.000Z`); the importer converts from the source's zone. */
  readonly timestamp: string;
  /** Asset symbol as normalised by the importer (`BTC`, `ETH`, `CHF`). */
  readonly asset: string;
  /** Signed: positive arrives on the account, negative leaves it. Never a JS number. */
  readonly quantity: Decimal;
  readonly kind: BookingKind;
  /** F7.5 traceability: the original file (its SHA-256 id) … */
  readonly sourceFileId: string;
  /** … and the 1-based row as a spreadsheet shows it — for a PDF, the page. */
  readonly row: number;
  /** The platform's own type/sub-type, verbatim (`staking`, `Simple Earn Flexible Interest`). */
  readonly rawType: string;
}
