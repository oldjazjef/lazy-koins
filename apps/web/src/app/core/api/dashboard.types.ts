import type { BookingKind, Project, ProjectFileStatus } from './api.types';
import type {
  CorrectionType,
  FigureRecord,
  OpenItem,
} from './calculation.types';

/**
 * Hand-mirrored API types of the dashboard (F11.4–F11.9), the carry-over between projects
 * (F4.4, F4.4a) and the packages (F10.8, F10.9). Amounts are decimal strings.
 */

export const KPI_KINDS = [
  'deposits',
  'withdrawals',
  'income',
  'costs',
  'tradingFees',
] as const;
export type KpiKind = (typeof KPI_KINDS)[number];

export interface DashboardPoint {
  readonly date: string;
  readonly valueChf: string;
  readonly missing: readonly string[];
}

export interface Kpi {
  readonly kind: KpiKind;
  readonly valueChf: string;
  readonly recordIds: readonly string[];
  readonly missingPrices: number;
}

export interface AllocationSlice {
  /** null = "Andere". */
  readonly asset: string | null;
  readonly valueChf: string;
  readonly sharePct: string;
  readonly assets: number;
}

export interface DashboardAccount {
  readonly platform: string;
  readonly accountId: string;
  readonly quantity: string;
  readonly valueChf: string | null;
}

export const HOLDING_STATUSES = ['ok', 'missingPrice', 'negative'] as const;
export type DashboardHoldingStatus = (typeof HOLDING_STATUSES)[number];

export interface DashboardHolding {
  readonly asset: string;
  readonly quantity: string;
  readonly priceChf: string | null;
  readonly valueChf: string | null;
  readonly status: DashboardHoldingStatus;
  readonly sparkline: readonly (string | null)[];
  readonly accounts: readonly DashboardAccount[];
}

export interface DashboardView {
  readonly from: string;
  readonly to: string;
  readonly series: readonly DashboardPoint[];
  readonly startValueChf: string;
  readonly endValueChf: string;
  readonly changeChf: string;
  readonly changePct: string | null;
  readonly kpis: readonly Kpi[];
  readonly incomeSharePct: string | null;
  readonly allocation: readonly AllocationSlice[];
  readonly holdings: readonly DashboardHolding[];
  readonly missingPrices: readonly string[];
  readonly projects: readonly {
    readonly id: string;
    readonly name: string;
    readonly taxYear: number;
  }[];
  readonly online: boolean;
  readonly unreadable: number;
}

export interface DashboardRecord extends FigureRecord {
  readonly projectId: string | null;
}

export interface DashboardRecords {
  readonly figureId: string;
  readonly total: number;
  readonly records: readonly DashboardRecord[];
}

export interface DashboardRefreshSummary {
  readonly fx: number;
  readonly assets: readonly {
    readonly asset: string;
    readonly status: 'fetched' | 'cached' | 'notFound' | 'failed';
    readonly source: string | null;
    readonly points: number;
  }[];
}

// --- Carry-over (F4.4, F4.4a) ---

export interface FileOption {
  readonly projectFileId: string;
  readonly displayName: string;
  readonly platform: string | null;
  readonly status: ProjectFileStatus;
  readonly periodFrom: string | null;
  readonly periodTo: string | null;
  readonly preselected: boolean;
}

export interface CorrectionOption {
  readonly id: string;
  readonly type: CorrectionType;
  readonly data: Record<string, unknown> & { type: CorrectionType };
  readonly reason: string;
  readonly createdAt: string;
}

export interface OpenItemOption {
  readonly key: string;
  readonly item: OpenItem;
  readonly note: string;
}

export interface FollowUpOptions {
  readonly source: Pick<Project, 'id' | 'name' | 'taxYear' | 'status'>;
  readonly taxYear: number;
  readonly country: Project['country'];
  readonly canton: string;
  readonly existing: readonly { readonly id: string; readonly name: string }[];
  readonly files: readonly FileOption[];
  readonly walletsAvailable: boolean;
  /** F4.4a: the project's wallets, preselected (absent on an older API). */
  readonly wallets?: readonly WalletOption[];
  readonly corrections: readonly CorrectionOption[];
  readonly openItems: readonly OpenItemOption[];
  readonly notes: string;
}

export interface CreateFollowUpRequest {
  readonly name: string;
  readonly taxYear: number;
  readonly canton: string;
  readonly fileIds: readonly string[];
  readonly correctionIds: readonly string[];
  readonly openItemKeys: readonly string[];
  readonly notes: boolean;
  readonly walletIds?: readonly string[];
}

export interface WalletOption {
  readonly walletId: string;
  readonly label: string;
  readonly address: string;
  readonly networks: readonly string[];
  readonly preselected: boolean;
}

export interface TakeOverSource {
  readonly projectId: string;
  readonly name: string;
  readonly taxYear: number;
  readonly status: Project['status'];
  readonly files: readonly (FileOption & { readonly inTarget: boolean })[];
}

export const CARRYOVER_KINDS = [
  'project',
  'file',
  'correction',
  'open_item',
  'notes',
  'wallet',
] as const;
export type CarryoverKind = (typeof CARRYOVER_KINDS)[number];

export interface Carryover {
  readonly id: string;
  readonly projectId: string;
  readonly sourceProjectId: string | null;
  readonly sourceProjectName: string;
  readonly kind: CarryoverKind;
  readonly ref: string | null;
  readonly label: string;
  readonly data: Record<string, unknown>;
  readonly createdAt: string;
  readonly done: boolean | null;
  readonly note: string | null;
}

// --- Packages (F10.8, F10.9) and data export (F10.7) ---

export interface ImportedProject {
  readonly projectId: string;
  readonly name: string;
  readonly files: number;
  readonly storedFilesCreated: number;
  readonly mappingsCreated: number;
  readonly mappingsReused: number;
  readonly corrections: number;
}

export interface ImportedAccount {
  readonly projects: readonly ImportedProject[];
  readonly mappingsCreated: number;
  readonly mappingsReused: number;
  readonly settingsApplied: boolean;
}

export interface DataExportFilter {
  readonly platform?: string;
  readonly account?: string;
  readonly asset?: string;
  readonly kind?: BookingKind | '';
  readonly from?: string;
  readonly to?: string;
}
