/**
 * The API's response and request shapes, hand-mirrored from apps/api's DTOs (generating them from
 * `/api/openapi.json` is an open decision — see CLAUDE.md). Keep in step with:
 *
 * - `users/dto/me-response.dto.ts`
 * - `projects/dto/project.dto.ts`, `projects/domain/project.ts`
 * - `files/dto/project-file.dto.ts`, `mappings/dto/mapping.dto.ts`, `ai/dto/ai.dto.ts`
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

/**
 * F4.1a: the currencies a project can be valued in (ISO 4217, the ECB reference rates) — mirrors
 * `TAX_CURRENCIES` of the engine. The form offers the country default and CHF, EUR, USD, GBP first.
 */
export const TAX_CURRENCIES = [
  'AUD',
  'BGN',
  'BRL',
  'CAD',
  'CHF',
  'CNY',
  'CZK',
  'DKK',
  'EUR',
  'GBP',
  'HKD',
  'HUF',
  'IDR',
  'ILS',
  'INR',
  'ISK',
  'JPY',
  'KRW',
  'MXN',
  'MYR',
  'NOK',
  'NZD',
  'PHP',
  'PLN',
  'RON',
  'SEK',
  'SGD',
  'THB',
  'TRY',
  'USD',
  'ZAR',
] as const;

/** The tax currency a new project in `country` gets (F4.1a: CH → CHF). */
export const DEFAULT_TAX_CURRENCY: Readonly<Record<string, string>> = {
  CH: 'CHF',
};

export const MIN_TAX_YEAR = 2009;
export const MAX_TAX_YEAR = 2100;

export interface Project {
  id: string;
  name: string;
  taxYear: number;
  country: Country;
  canton: string;
  /** F4.1a: ISO 4217 code every amount of the project is in. */
  taxCurrency: string;
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
  /** F4.1a; absent = the country default. */
  taxCurrency?: string;
  notes?: string;
}

/** `PATCH /api/projects/:id` — a closed project accepts only `status` (reopening). */
export interface UpdateProjectRequest {
  name?: string;
  notes?: string;
  status?: ProjectStatus;
  canton?: string;
  /** F4.1a: makes the latest calculation stale. */
  taxCurrency?: string;
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
  /** derived = a standard-format file the AI converted from a PDF of the project. */
  origin: 'uploaded' | 'from_project' | 'derived' | 'wallet';
  /** wallet = the records a wallet fetch derived (F6.3). */
  originWalletId?: string | null;
  originProjectId: string | null;
  originProjectName: string | null;
  /** The PDF a derived file was converted from (same project). */
  derivedFromFileId: string | null;
  derivedFromName: string | null;
  addedAt: string;
}

export const MISSING_FILE_KINDS = [
  'noYearData',
  'startsLate',
  'endsEarly',
  'noYearEndBalance',
] as const;
export type MissingFileKind = (typeof MISSING_FILE_KINDS)[number];

export const HINT_SEVERITIES = ['error', 'warning', 'info'] as const;
export type HintSeverity = (typeof HINT_SEVERITIES)[number];

export interface MissingFileHint {
  key: string;
  platform: string;
  /** '' = the whole platform (see `accounts`). */
  accountId: string;
  accounts: string[];
  kind: MissingFileKind;
  severity: HintSeverity;
  date?: string;
  zeroBalance?: boolean;
  hintKey: string;
}

/** F5.8 "Hinweise": coverage gaps plus file hints (no mapping, row errors). */
export const HINT_KINDS = [
  ...MISSING_FILE_KINDS,
  'unrecognisedFile',
  'rowErrors',
] as const;
export type HintKind = (typeof HINT_KINDS)[number];

export const HINT_STATUSES = ['open', 'done', 'ignored'] as const;
export type HintStatus = (typeof HINT_STATUSES)[number];

export interface ProjectHint {
  /** Stable — dismissals are stored under it and survive recalculation. */
  key: string;
  kind: HintKind;
  severity: HintSeverity;
  platform: string | null;
  accountId: string;
  accounts: string[];
  date: string | null;
  zeroBalance: boolean;
  hintKey: string;
  fileId: string | null;
  fileName: string | null;
  count: number | null;
  status: HintStatus;
  note: string;
}

/** `GET /api/projects/:id/hints` */
export interface ProjectHints {
  taxYear: number;
  hints: ProjectHint[];
  open: number;
}

/** `GET …/files/:fileId/row-errors` */
export interface FileRowErrors {
  total: number;
  errors: RowError[];
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

export const MAPPING_ORIGINS = ['ai', 'manual', 'copied', 'library'] as const;
export type MappingOrigin = (typeof MAPPING_ORIGINS)[number];

export interface Mapping {
  id: string;
  name: string;
  platform: string;
  fingerprint: string;
  version: number;
  origin: MappingOrigin;
  /**
   * Origin `library` (F5.16): the entry and version this private copy was taken from;
   * `server` (F5.18) = the web deployment a desktop copy came from, `null` = this deployment.
   */
  library?: { id: string; version: number; server?: string | null } | null;
  spec: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// --- Mapping library (F5.15–F5.17, web only) — mirrors apps/api `library/dto/library.dto.ts` ---

export const LIBRARY_SORTS = ['rating', 'usage', 'newest', 'name'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

/** A published mapping; the author only as a pseudonym (`null` = anonymous) and `mine`. */
export interface LibraryEntry {
  id: string;
  name: string;
  platform: string;
  description: string | null;
  fingerprint: string;
  version: number;
  authorName: string | null;
  ratingAverage: number | null;
  ratingCount: number;
  usageCount: number;
  publishedAt: string;
  updatedAt: string;
  mine: boolean;
  myRating: number | null;
}

export interface LibraryEntryDetail extends LibraryEntry {
  spec: Record<string, unknown>;
}

export const PRIVACY_FINDING_KINDS = [
  'email',
  'iban',
  'walletAddress',
  'accountId',
  'personName',
  'secret',
] as const;
export type PrivacyFindingKind = (typeof PRIVACY_FINDING_KINDS)[number];

export interface PrivacyFinding {
  path: string;
  kind: PrivacyFindingKind;
  value: string;
  removable: boolean;
}

/** `POST /api/library/review` — exactly what would become public. */
export interface PublishReview {
  spec: Record<string, unknown>;
  name: string;
  platform: string;
  fingerprint: string;
  size: number;
  maxSize: number;
  findings: PrivacyFinding[];
  target: { id: string; nextVersion: number } | null;
  existing: { id: string; version: number } | null;
  lastAuthorName: string | null;
}

/** `POST /api/library/:id/take` — my private copy (and the file it now reads). */
export interface TakenLibraryMapping {
  mapping: Mapping;
  created: boolean;
  projectFileId: string | null;
  fileStatus: ProjectFileStatus | null;
}

/**
 * `GET /api/library/status` (F5.18): `web` = this deployment's library; `remote` = the desktop,
 * linked to a web deployment's public library (read-only).
 */
export interface LibraryStatus {
  mode: 'web' | 'remote';
  available: boolean;
  readOnly: boolean;
  server: string | null;
  suggestions: boolean;
  reason: 'libraryNotConfigured' | 'offline' | null;
}

/** Einstellungen › Bibliothek (desktop, F5.18) — `GET|PUT /api/settings/library`. */
export interface RemoteLibrarySettings {
  url: string;
  enabled: boolean;
  suggestions: boolean;
  updatedAt: string | null;
}

export type SaveRemoteLibrarySettings = Pick<
  RemoteLibrarySettings,
  'url' | 'enabled' | 'suggestions'
>;

/** `POST /api/settings/library/test` — the server answered, with this many entries. */
export interface RemoteLibraryTest {
  server: string;
  total: number;
}

/** Why an address cannot be used (`422 libraryUrlInvalid`, `problem`). */
export const REMOTE_URL_PROBLEMS = [
  'invalidUrl',
  'httpsRequired',
  'credentialsInUrl',
  'tooLong',
] as const;
export type RemoteUrlProblem = (typeof REMOTE_URL_PROBLEMS)[number];

/** `GET /api/projects/:id/library-matches` — per file that needs a mapping. */
export interface LibraryFileMatches {
  projectFileId: string;
  displayName: string;
  matches: LibraryEntry[];
}

/** `GET /api/mappings` — every mapping of mine, with how many files use it (F11.0). */
export interface MappingSummary extends Mapping {
  filesUsing: number;
  projectsUsing: number;
}

/** `GET /api/mappings/:id/usage` — "Wird genutzt in": projects + files read with it. */
export interface MappingUsageProject {
  id: string;
  name: string;
  taxYear: number;
  status: ProjectStatus;
  files: { id: string; displayName: string; status: ProjectFileStatus }[];
}

/** `POST /api/mappings/:id/reapply` */
export interface ReapplyResult {
  reapplied: number;
  skippedClosed: number;
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

/**
 * The compact sample of a table file (libs/engine `mapping/sample.ts`) — the editor's raw table
 * and exactly what the AI would get (F5.14).
 */
export interface MappingSample {
  fileName: string;
  fileKind: 'csv' | 'xlsx';
  encoding?: string;
  delimiter?: string;
  sheets?: { name: string; rowCount: number }[];
  sheet?: string;
  rowCount: number;
  /** 1-based. */
  headerRowGuess: number;
  /** `rows[0]` is row 1 of the file (preamble included). */
  rows: string[][];
  distinctValues: { column: string; values: string[] }[];
}

/** Which reader an upload would pick for a file (F5.2). */
export interface SampleRecognition {
  standard: boolean;
  mapping: { id: string; name: string; confidence: number } | null;
}

/** `POST /api/mapping-samples/inspect` — nothing is stored. */
export interface SampleInspection {
  name: string;
  kind: 'csv' | 'xlsx';
  size: number;
  sample: MappingSample;
  /** "Vorlage aus Datei" — not necessarily valid yet. */
  skeleton: Record<string, unknown>;
  recognisedBy: SampleRecognition;
}

export const FINGERPRINT_VERDICTS = [
  'this',
  'other',
  'standard',
  'none',
] as const;
export type FingerprintVerdict = (typeof FINGERPRINT_VERDICTS)[number];

/** `POST /api/mapping-samples/preview` — an invalid spec comes back with its issues. */
export interface SamplePreview {
  valid: boolean;
  issues: SpecIssue[];
  preview: MappingPreview | null;
  kindCounts: Partial<Record<BookingKind, number>>;
  unknownValues: { value: string; count: number }[];
  fingerprint: {
    verdict: FingerprintVerdict;
    confidence: number;
    recognisedBy: SampleRecognition;
  } | null;
}

// --- AI plugin (F5.13, F5.14) — mirrors apps/api `ai/dto/ai.dto.ts` ---

export const AI_PROVIDERS = ['openai_compatible', 'anthropic'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** `GET /api/ai/settings` — the key itself never comes back, only its hint. */
export interface AiSettings {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyHint: string | null;
  consentAt: string | null;
  ready: boolean;
  canStoreKey: boolean;
  privateUrlsAllowed: boolean;
}

/** `PUT /api/ai/settings` — `apiKey` omitted = keep, `''` = remove. */
export interface SaveAiSettingsRequest {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey?: string;
  revokeConsent?: boolean;
  /** Give the consent up front (F5.14, setup wizard). */
  giveConsent?: boolean;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

/** `POST /api/ai/settings/test` */
/** Body of `POST /ai/settings/test`: the form's unsaved values; a typed key is never stored. */
export interface TestAiConnectionRequest {
  readonly provider: AiProvider;
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey?: string;
}

export interface AiConnectionTest {
  ok: true;
  model: string;
  usage: AiUsage | null;
  millis: number;
}

/** `GET …/ai/mapping/payload` and `…/ai/statement/payload`: exactly what would be sent. */
export interface AiRequestPreview<T = unknown> {
  payload: T;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  consentGiven: boolean;
}

/** `POST …/ai/mapping` — a proposal; nothing is saved. */
export interface MappingCandidate {
  spec: Record<string, unknown>;
  valid: boolean;
  issues: SpecIssue[];
  preview: MappingPreview | null;
  kindCounts: Partial<Record<BookingKind, number>>;
  unknownValues: { value: string; count: number }[];
  problems: string[];
  rounds: number;
  model: string;
  usage: AiUsage | null;
}

export const HOLDING_ISSUES = [
  'notVerbatim',
  'pageMismatch',
  'invalidNumber',
  'ambiguousSeparator',
  'priceNotVerbatim',
  'pageOutOfRange',
  'invalidRecord',
] as const;
export type HoldingIssue = (typeof HOLDING_ISSUES)[number];

/** One balance the AI read from a PDF statement. Quantities are decimal strings. */
export interface ExtractedHolding {
  asset: string;
  quantityAsPrinted: string;
  quantity: string | null;
  asOf: string;
  platform: string;
  account: string;
  priceChf: string | null;
  priceUsd: string | null;
  priceChfAsPrinted?: string;
  priceUsdAsPrinted?: string;
  page: number;
  verbatim: boolean;
  issues: HoldingIssue[];
}

/** `POST …/ai/statement` */
export interface StatementCandidate {
  holdings: ExtractedHolding[];
  truncated: boolean;
  rounds: number;
  model: string;
  usage: AiUsage | null;
}

/** `POST …/ai/statement/accept` — the kept records as the extraction returned them. */
export interface ConfirmedHolding {
  asset: string;
  quantityAsPrinted: string;
  asOf: string;
  platform: string;
  account?: string;
  priceChfAsPrinted?: string;
  priceUsdAsPrinted?: string;
  page: number;
}
