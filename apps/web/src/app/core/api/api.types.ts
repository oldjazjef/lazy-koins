/**
 * The API's response and request shapes, hand-mirrored from apps/api's DTOs (generating them from
 * `/api/openapi.json` is an open decision — see CLAUDE.md). Keep in step with:
 *
 * - `users/dto/me-response.dto.ts`
 * - `projects/dto/project.dto.ts`, `projects/domain/project.ts`
 * - `files/dto/project-file.dto.ts`, `mappings/dto/mapping.dto.ts`
 *
 * Quantities and amounts will arrive as decimal **strings** — never declare them as `number`.
 */

export interface Me {
  id: string;
  email: string;
  displayName: string;
  signInProvider: string;
  createdAt: string;
}

/** F4.1: in Arbeit / geprüft / abgeschlossen. */
export const PROJECT_STATUSES = ['in_progress', 'reviewed', 'closed'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const COUNTRIES = ['CH'] as const;
export type Country = (typeof COUNTRIES)[number];

/** The 26 Swiss cantons (official two-letter codes), as the API validates them. */
export const CH_CANTONS = [
  'AG',
  'AI',
  'AR',
  'BE',
  'BL',
  'BS',
  'FR',
  'GE',
  'GL',
  'GR',
  'JU',
  'LU',
  'NE',
  'NW',
  'OW',
  'SG',
  'SH',
  'SO',
  'SZ',
  'TG',
  'TI',
  'UR',
  'VD',
  'VS',
  'ZG',
  'ZH',
] as const;
export type Canton = (typeof CH_CANTONS)[number];

export const MIN_TAX_YEAR = 2009;
export const MAX_TAX_YEAR = 2100;

export interface Project {
  id: string;
  name: string;
  taxYear: number;
  country: Country;
  canton: string;
  status: ProjectStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

/** `POST /api/projects` */
export interface CreateProjectRequest {
  name: string;
  taxYear: number;
  country: Country;
  canton: string;
  notes?: string;
}

/** `PATCH /api/projects/:id` — a closed project accepts only `status` (reopening). */
export interface UpdateProjectRequest {
  name?: string;
  notes?: string;
  status?: ProjectStatus;
  canton?: string;
}

// --- Files (F5) — mirrors apps/api `files/dto/project-file.dto.ts` ---

/** standard = read in the standard format; mapped = through a mapping spec. */
export const PROJECT_FILE_STATUSES = [
  'standard',
  'mapped',
  'needs_mapping',
  'evidence_only',
] as const;
export type ProjectFileStatus = (typeof PROJECT_FILE_STATUSES)[number];

export interface Period {
  from: string;
  to: string;
}

export interface ProjectFile {
  id: string;
  sha256: string;
  displayName: string;
  kind: 'csv' | 'xlsx' | 'pdf';
  size: number;
  status: ProjectFileStatus;
  platform: string | null;
  mappingId: string | null;
  mappingName: string | null;
  period: Period | null;
  bookingCount: number;
  holdingCount: number;
  errorCount: number;
  origin: 'uploaded' | 'from_project';
  originProjectId: string | null;
  originProjectName: string | null;
  addedAt: string;
}

export const MISSING_FILE_KINDS = [
  'startsLate',
  'endsEarly',
  'noYearEndBalance',
] as const;
export type MissingFileKind = (typeof MISSING_FILE_KINDS)[number];

export interface MissingFileHint {
  platform: string;
  accountId: string;
  kind: MissingFileKind;
  date?: string;
  hintKey: string;
}

/** `GET /api/projects/:id/files` */
export interface ProjectFiles {
  taxYear: number;
  groups: { platform: string | null; files: ProjectFile[] }[];
  missing: MissingFileHint[];
}

/** `GET …/files/:fileId/preview` */
export interface FilePreview {
  kind: 'table' | 'pdf';
  sheets?: { name: string; rows: string[][]; totalRows: number }[];
}

/** `PATCH …/files/:fileId` */
export type FileAssignmentRequest =
  | { mode: 'evidenceOnly' }
  | { mode: 'automatic' }
  | { mode: 'mapping'; mappingId: string };

/** The closed booking kinds of the standard format. */
export const BOOKING_KINDS = [
  'trade',
  'deposit',
  'withdrawal',
  'fee',
  'transfer',
  'income_interest',
  'income_staking',
  'income_airdrop',
  'income_launchpool',
  'income_hardfork',
  'loss',
  'spam',
  'unknown',
] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];

/** A booking as the API shows it — quantities are decimal strings. */
export interface Booking {
  row: number;
  timestamp: string;
  platform: string;
  accountId: string;
  kind: BookingKind;
  asset: string;
  quantity: string;
  fee?: string;
  feeAsset?: string;
  priceChf?: string;
  priceUsd?: string;
  group?: string;
  note?: string;
  rawType: string;
  rawAsset?: string;
}

export interface Holding {
  row: number;
  platform: string;
  accountId: string;
  asset: string;
  quantity: string;
  asOf: string;
  evidence?: string;
}

export interface RowError {
  row: number;
  code: string;
  column?: string;
  sheet?: string;
}

/** `POST …/files/:fileId/mapping-preview` */
export interface MappingPreview {
  bookings: Booking[];
  holdings: Holding[];
  errors: RowError[];
  notes: { code: string; row?: number }[];
  period: Period | null;
  totals: { bookings: number; holdings: number; errors: number; notes: number };
}

// --- Mappings — mirrors apps/api `mappings/dto/mapping.dto.ts` ---

export const MAPPING_ORIGINS = ['ai', 'manual', 'copied'] as const;
export type MappingOrigin = (typeof MAPPING_ORIGINS)[number];

export interface Mapping {
  id: string;
  name: string;
  platform: string;
  fingerprint: string;
  version: number;
  origin: MappingOrigin;
  spec: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/projects/:id/mappings` */
export interface ProjectMapping {
  mapping: Mapping;
  files: { id: string; displayName: string }[];
}

/** `PUT /api/mappings/:id` */
export interface UpdatedMapping {
  mapping: Mapping;
  filesUsing: number;
}

/** A 400 for an invalid spec lists every issue. */
export interface SpecIssue {
  path: string;
  message: string;
}
