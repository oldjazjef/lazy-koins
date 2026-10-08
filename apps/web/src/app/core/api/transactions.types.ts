import type { BookingKind, ProjectStatus } from './api.types';
import type { TransactionStatus } from './calculation.types';

/** F9.5: a project that uses a transaction (through its file). */
export interface TransactionProject {
  projectId: string;
  name: string;
  taxYear: number;
  status: ProjectStatus;
  active: boolean;
}

/** F9.10: the AI's open suggestion for a transaction. */
export interface TransactionSuggestion {
  id: string;
  kind: BookingKind;
  reason: string;
  /** 0–100. */
  confidence: number;
  linkedKey: string | null;
}

/** `GET /api/transactions` row (F9.5). */
export interface Transaction {
  key: string;
  timestamp: string;
  platform: string;
  accountId: string;
  kind: BookingKind;
  originalKind: BookingKind | null;
  asset: string;
  originalAsset: string | null;
  /** Signed decimal string. */
  quantity: string;
  fee: string | null;
  feeAsset: string | null;
  /** In the page's currency at the booking's day; null = no price. */
  value: string | null;
  group: string | null;
  note: string | null;
  rawType: string;
  source: {
    fileId: string;
    fileName: string;
    row: number;
    walletId: string | null;
  };
  status: TransactionStatus;
  hidden: boolean;
  linkedKey: string | null;
  suggestion: TransactionSuggestion | null;
  projects: TransactionProject[];
  /** F9.9: closed projects that use it. */
  lockedBy: TransactionProject[];
}

export interface TransactionsPage {
  currency: string;
  total: number;
  offset: number;
  limit: number;
  rows: Transaction[];
  platforms: string[];
  accounts: string[];
  assets: string[];
  unreadable: number;
}

/** What a global edit changes (libs/engine TransactionChangesSchema). */
export interface TransactionChanges {
  kind?: BookingKind;
  asset?: string;
  note?: string;
  hidden?: boolean;
  linkedKey?: string | null;
}

export interface TransactionEdit {
  id: string;
  key: string;
  changes: TransactionChanges;
  reason: string;
  source: 'user' | 'ai' | 'migrated';
  status: 'active' | 'undone' | 'superseded';
  /** F9.11: "<project> <year>" of a migrated project correction. */
  origin: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface TransactionDetail {
  transaction: Transaction;
  raw: Record<string, string> | null;
  history: TransactionEdit[];
  linked: Transaction | null;
}

export interface EditResult {
  edited: number;
  projectIds: string[];
}

/** `POST /api/transactions/ai/payload` (F9.10, F5.14). */
export interface TransactionAiPayload {
  payload: {
    transactions: Record<string, unknown>[];
    possibleCounterBookings: Record<string, unknown>[];
  };
  count: number;
  consentGiven: boolean;
}

export interface TransactionAiResult {
  suggested: number;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
}
