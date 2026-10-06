import type { BookingKind, Project } from './api.types';
import type { ProjectSentSummary } from './mail.types';

/**
 * Shapes of the calculation, rates, corrections, exports and settings endpoints, hand-mirrored
 * from apps/api (`calculation/`, `rates/`, `exports/`, `settings/` DTOs) and the engine's
 * `calculation/types.ts`. Amounts are decimal **strings** — never `number`.
 */

/** `GET /api/projects` entries carry the latest calculation's figures (F4.2). */
export interface ProjectListItem extends Project {
  wealthChf: string | null;
  incomeChf: string | null;
  calculatedAt: string | null;
  /** F4.7: sent to the Treuhänder (null = not yet). */
  sent: ProjectSentSummary | null;
}

export const INCOME_CATEGORIES = [
  'interest',
  'staking',
  'airdrop',
  'launchpool',
  'hardfork',
  'earn_gap',
] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

export const POSITION_STATUSES = [
  'ok',
  'missingPrice',
  'spam',
  'negative',
] as const;
export type PositionStatus = (typeof POSITION_STATUSES)[number];

export const QUANTITY_SOURCES = ['statement', 'ledger', 'manual'] as const;
export type QuantitySource = (typeof QUANTITY_SOURCES)[number];

export const PRICE_ORIGINS = [
  'home',
  'override',
  'estv',
  'recordChf',
  'recordUsd',
  'recordValueUsd',
  'pegged',
  'fx',
  'tableChf',
  'tableUsd',
] as const;
export type PriceOrigin = (typeof PRICE_ORIGINS)[number];

export interface Position {
  id: string;
  platform: string;
  accountId: string;
  asset: string;
  quantity: string;
  quantitySource: QuantitySource;
  priceChf: string | null;
  priceOrigin: PriceOrigin | null;
  priceSource: string | null;
  priceDate: string | null;
  priceUsd: string | null;
  usdChf: string | null;
  chfDirect: string | null;
  estvChf: string | null;
  valueChf: string | null;
  status: PositionStatus;
  recordIds: string[];
}

export interface PlatformTotal {
  id: string;
  platform: string;
  valueChf: string;
  positions: number;
  missingPrices: number;
}

export interface IncomeLine {
  id: string;
  bookingId: string;
  timestamp: string;
  date: string;
  platform: string;
  accountId: string;
  kind: BookingKind;
  category: IncomeCategory;
  asset: string;
  quantityGross: string;
  fee: string | null;
  feeAsset: string | null;
  quantityNet: string;
  priceUsd: string | null;
  usdChf: string | null;
  priceChf: string | null;
  valueUsd: string | null;
  valueChf: string | null;
  grossValueChf: string | null;
  priceOrigin: PriceOrigin | null;
  priceSource: string | null;
  status: 'ok' | 'missingPrice' | 'spam';
  rawType: string;
  group: string | null;
  recordIds: string[];
}

export interface CategoryTotal {
  id: string;
  category: IncomeCategory;
  valueChf: string;
  lines: number;
  missingPrices: number;
}

export interface EarnGap {
  id: string;
  platform: string;
  accountId: string;
  asset: string;
  startQuantity: string;
  endQuantity: string;
  bookedQuantity: string;
  gapQuantity: string;
  averagePriceChf: string | null;
  valueChf: string | null;
  status: 'income' | 'negative' | 'missingPrice';
  recordIds: string[];
}

export interface OneOffEvent {
  id: string;
  timestamp: string;
  kind: BookingKind;
  platform: string;
  accountId: string;
  asset: string;
  quantity: string;
  valueChf: string | null;
  incomeLineId: string | null;
  recordIds: string[];
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

export const LIGHTS = ['green', 'yellow', 'red', 'grey'] as const;
export type Light = (typeof LIGHTS)[number];

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
  'unclassifiedBookings',
  'walletNetworksNotAvailable',
  'walletNetworksUnchecked',
  'walletNetworkNotSelected',
  'walletNetworkNotFetched',
  'walletManualBalanceMissing',
  'walletFetchFailed',
] as const;
export type OpenItemReason = (typeof OPEN_ITEM_REASONS)[number];

export interface Check {
  kind: CheckKind;
  light: Light;
  items: number;
  impactChf: string;
}

export interface OpenItem {
  key: string;
  check: CheckKind;
  reason: OpenItemReason;
  light: 'yellow' | 'red';
  platform: string | null;
  accountId: string | null;
  asset: string | null;
  date: string | null;
  params: Record<string, string>;
  impactChf: string | null;
  recordIds: string[];
  done: boolean;
  note: string;
}

export interface PositionRef {
  platform: string;
  accountId: string;
  asset: string;
  quantity: string;
  valueChf: string | null;
}

export interface Comparison {
  previousTaxYear: number;
  previousWealthChf: string;
  previousIncomeChf: string;
  wealthDeltaChf: string;
  incomeDeltaChf: string;
  newPositions: PositionRef[];
  removedPositions: PositionRef[];
}

export const CORRECTION_TYPES = [
  'price_override',
  'reclassify',
  'manual_booking',
  'manual_holding',
] as const;
export type CorrectionType = (typeof CORRECTION_TYPES)[number];

export interface AppliedCorrection {
  correctionId: string;
  type: CorrectionType;
  status: 'applied' | 'targetMissing';
  before: Record<string, string | null> | null;
  after: Record<string, string | null> | null;
}

export interface CalculationResult {
  engineVersion: number;
  taxYear: number;
  country: string;
  yearEnd: string;
  totals: {
    wealthChf: string;
    incomeChf: string;
    positions: number;
    missingPrices: number;
    openItems: number;
  };
  parameters: {
    usdChf: string | null;
    eurChf: string | null;
    usdChfSource: string | null;
    eurChfSource: string | null;
  };
  positions: Position[];
  platforms: PlatformTotal[];
  income: IncomeLine[];
  categories: CategoryTotal[];
  earnGaps: EarnGap[];
  oneOffEvents: OneOffEvent[];
  checks: Check[];
  corrections: AppliedCorrection[];
  comparison: Comparison | null;
}

export interface SnapshotMeta {
  id: string;
  projectId: string;
  inputHash: string;
  engineVersion: number;
  wealthChf: string;
  incomeChf: string;
  createdAt: string;
}

export interface FileRef {
  projectFileId: string;
  sha256: string;
  displayName: string;
}

/** `GET /result`, `POST /calculate` */
export interface ResultView {
  snapshot: SnapshotMeta | null;
  stale: boolean;
  result: CalculationResult | null;
  files: FileRef[];
}

export interface FigureRecord {
  id: string;
  type: 'booking' | 'holding';
  sourceFileId: string;
  row: number;
  platform: string;
  accountId: string;
  asset: string;
  quantity: string;
  at: string;
  kind: BookingKind | null;
  fee: string | null;
  feeAsset: string | null;
  rawType: string | null;
  raw: Record<string, string> | null;
  projectFileId: string | null;
  fileName: string | null;
  correctionId: string | null;
}

/** `GET /result/records?figure=` */
export interface FigureRecords {
  figureId: string;
  total: number;
  records: FigureRecord[];
}

/** `GET /checks` */
export interface ChecksView {
  snapshot: SnapshotMeta | null;
  checks: Check[];
  items: OpenItem[];
  comparison: Comparison | null;
}

export interface Correction {
  id: string;
  type: CorrectionType;
  data: Record<string, unknown>;
  reason: string;
  createdAt: string;
  undoneAt: string | null;
  applied: AppliedCorrection | null;
}

export type RateSource = 'manual' | 'estv' | 'binance' | 'coingecko' | 'ecb';

export interface RateSeries {
  kind: 'price' | 'fx';
  asset: string;
  currency: 'CHF' | 'USD';
  source: RateSource;
  points: number;
  from: string;
  to: string;
  yearEnd: { date: string; value: string } | null;
  fetchedAt: string;
}

export interface StoredRate {
  id: string;
  kind: 'price' | 'fx';
  asset: string;
  currency: 'CHF' | 'USD';
  date: string;
  value: string;
  source: RateSource;
  /** The label of an automatic ESTV value: `ESTV-Kursliste 2025, Stand 02.10.2026` (F7.4a). */
  note: string | null;
  fetchedAt: string;
}

/** `GET /rates` */
export interface RatesView {
  taxYear: number;
  online: boolean;
  series: RateSeries[];
  manual: StoredRate[];
  /** F7.4a: the stored Kursliste of the tax year and the version in use. */
  estv: {
    autoEnabled: boolean;
    available: string | null;
    cryptoCount: number;
    applied: string | null;
    outdated: boolean;
  };
}

/** F7.4a: what applying the stored Kursliste to a project did. */
export interface EstvApplySummary {
  year: number;
  label: string | null;
  matched: { asset: string; symbol: string; name: string; value: string }[];
  ambiguous: {
    asset: string;
    candidates: { symbol: string; name: string; valorNumber: string | null }[];
  }[];
  fx: string[];
}

export const ESTV_PHASES = ['metadata', 'download', 'parse', 'store'] as const;
export type EstvPhase = (typeof ESTV_PHASES)[number];

/** `GET /rates/estv` — the deployment's Kursliste (F7.4a). */
export interface EstvStatus {
  autoEnabled: boolean;
  online: boolean;
  running: {
    years: number[];
    year: number;
    startedAt: string;
    progress: {
      phase: EstvPhase;
      bytes: number;
      totalBytes: number | null;
      entries: number;
    };
  } | null;
  lastCheckAt: string | null;
  years: {
    year: number;
    version: {
      exportType: string;
      exportDate: string;
      schemaVersion: string;
      downloadedAt: string;
      entryCount: number;
      cryptoCount: number;
      fxCount: number;
      label: string;
    } | null;
    check: {
      checkedAt: string;
      outcome: 'updated' | 'current' | 'failed';
      error: string | null;
    } | null;
  }[];
}

export const FETCH_STATUSES = [
  'fetched',
  'cached',
  'notFound',
  'failed',
] as const;
export type FetchStatus = (typeof FETCH_STATUSES)[number];

export interface RefreshSummary {
  fx: number;
  estv: EstvApplySummary;
  assets: {
    asset: string;
    status: FetchStatus;
    source: string | null;
    points: number;
  }[];
}

export interface ManualRateRequest {
  kind: 'price' | 'fx';
  asset: string;
  currency: 'CHF' | 'USD';
  date: string;
  value: string;
}

/** Statements for the tax authority (F10.1, F10.2) — no open items, checks or instructions. */
export const STATEMENT_KINDS = [
  'simple_pdf',
  'simple_xlsx',
  'detailed_pdf',
  'detailed_xlsx',
] as const;
/** The internal check report (F10.2a) — kept apart, never attached to the Treuhänder mail by default. */
export const INTERNAL_KINDS = [
  'internal_report_pdf',
  'internal_report_xlsx',
] as const;
export const EXPORT_KINDS = [...STATEMENT_KINDS, ...INTERNAL_KINDS] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export function isInternalKind(kind: ExportKind): boolean {
  return (INTERNAL_KINDS as readonly string[]).includes(kind);
}

export interface ProjectExport {
  id: string;
  kind: ExportKind;
  fileName: string;
  mediaType: string;
  size: number;
  snapshotId: string | null;
  wealthChf: string;
  incomeChf: string;
  createdAt: string;
}

export interface MailDraft {
  to: string;
  subject: string;
  body: string;
}

export interface Settings {
  displayName: string;
  canton: string;
  advisorName: string;
  advisorEmail: string;
  numberFormat: 'de-CH';
  dateFormat: 'dd.MM.yyyy';
  onlineRates: boolean;
  /** Hints (`…abcd`) or null — never the key. */
  keys: { coingecko: string | null; etherscan: string | null };
  coingeckoIds: Record<string, string>;
  keyStorageAvailable: boolean;
}

export interface UpdateSettingsRequest {
  displayName?: string;
  canton?: string;
  advisorName?: string;
  advisorEmail?: string;
  onlineRates?: boolean;
  keys?: { coingecko?: string | null; etherscan?: string | null };
  coingeckoIds?: Record<string, string>;
}
