import {
  BOOKING_KINDS,
  type BookingKind,
  OPEN_ITEM_REASONS,
  type OpenItemReason,
} from '@lazykoins/engine';
import {
  EXPORT_KINDS,
  type ExportKind,
} from '../../exports/domain/project-export';
import {
  HINT_STATUSES,
  type HintStatus,
} from '../../files/domain/project-hint';
import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from '../../projects/domain/project';
import type { ToolText } from './tool';

/**
 * F11.2: the texts of the chat's proposal cards are keys of the web's message files
 * (`apps/web/public/i18n/<locale>.json`), rendered in the user's language by the web — the API
 * sends keys + values, never a sentence. Each key lists its placeholders; `preview-texts.spec.ts`
 * checks that every key exists in every message file with exactly these placeholders.
 */
export const PREVIEW_TEXTS = {
  // Summaries
  'chat.preview.fallback': [],
  'chat.preview.priceOverride': ['asset', 'date'],
  'chat.preview.reclassify': ['booking'],
  'chat.preview.excludeBooking': ['booking'],
  'chat.preview.manualBooking': ['asset', 'platform'],
  'chat.preview.manualHolding': ['asset', 'platform'],
  'chat.preview.openItem': ['item'],
  'chat.preview.createExport': ['kind'],
  'chat.preview.sendMail': ['to'],
  'chat.preview.hintStatus': ['hint', 'status'],
  'chat.preview.removeFile': ['file'],
  'chat.preview.deactivateFile': ['file'],
  'chat.preview.activateFile': ['file'],
  'chat.preview.createMapping': ['name'],
  'chat.preview.updateMapping': ['name', 'from', 'to'],
  'chat.preview.deleteMapping': ['name'],
  'chat.preview.publishMapping': ['name'],
  'chat.preview.publishMappingVersion': ['name', 'version'],
  'chat.preview.takeLibraryMapping': ['name', 'version'],
  'chat.preview.rateLibraryMapping': ['name'],
  'chat.preview.deleteLibraryMapping': ['name'],
  'chat.preview.createProject': ['name', 'year', 'canton'],
  'chat.preview.updateProject': ['name'],
  'chat.preview.deleteProject': ['name', 'year'],
  'chat.preview.updateSettings': [],
  // Line labels
  'chat.preview.label.reason': [],
  'chat.preview.label.price': ['asset', 'unit'],
  'chat.preview.label.kind': [],
  'chat.preview.label.booking': [],
  'chat.preview.label.holdingAt': ['date'],
  'chat.preview.label.done': [],
  'chat.preview.label.note': [],
  'chat.preview.label.export': [],
  'chat.preview.label.openItems': [],
  'chat.preview.label.to': [],
  'chat.preview.label.subject': [],
  'chat.preview.label.attachments': [],
  'chat.preview.label.status': [],
  'chat.preview.label.file': [],
  'chat.preview.label.active': [],
  'chat.preview.label.mapping': [],
  'chat.preview.label.version': [],
  'chat.preview.label.libraryEntry': [],
  'chat.preview.label.stars': [],
  'chat.preview.label.privacyFindings': [],
  'chat.preview.label.pseudonym': [],
  'chat.preview.label.name': [],
  'chat.preview.label.taxYear': [],
  'chat.preview.label.canton': [],
  'chat.preview.label.notes': [],
  'chat.preview.label.taxCurrency': [],
  'chat.preview.label.project': [],
  'chat.preview.label.displayName': [],
  'chat.preview.label.advisorName': [],
  'chat.preview.label.advisorEmail': [],
  'chat.preview.label.onlineRates': [],
  // Values
  'chat.preview.value.noPrice': [],
  'chat.preview.value.override': ['price', 'unit'],
  'chat.preview.value.yes': [],
  'chat.preview.value.no': [],
  'chat.preview.value.anonymous': [],
  'chat.preview.value.findingsRemoved': ['count'],
  'chat.preview.value.findingsKept': ['count'],
} as const satisfies Record<string, readonly string[]>;

export type PreviewKey = keyof typeof PREVIEW_TEXTS;
type ParamValue = string | number | ToolText;
type ParamsOf<K extends PreviewKey> =
  (typeof PREVIEW_TEXTS)[K] extends readonly []
    ? []
    : [Readonly<Record<(typeof PREVIEW_TEXTS)[K][number], ParamValue>>];

/** A card text; the compiler checks the placeholders against `PREVIEW_TEXTS`. */
export function previewText<K extends PreviewKey>(
  key: K,
  ...[params]: ParamsOf<K>
): ToolText {
  return params ? { key, params: params as ToolText['params'] } : { key };
}

/** A yes/no value. */
export function yesNo(value: boolean): ToolText {
  return previewText(
    value ? 'chat.preview.value.yes' : 'chat.preview.value.no',
  );
}

/**
 * Codes shown with the web's existing texts for them (`bookings.kind.trade`, …). The spec checks
 * every value of every family against the message files.
 */
export const ENUM_TEXTS = {
  bookingKind: { prefix: 'bookings.kind.', values: BOOKING_KINDS },
  exportKind: { prefix: 'exports.kind.', values: EXPORT_KINDS },
  projectStatus: { prefix: 'projects.status.', values: PROJECT_STATUSES },
  hintStatus: { prefix: 'hints.status.', values: HINT_STATUSES },
  openItemReason: { prefix: 'checks.reason.', values: OPEN_ITEM_REASONS },
} as const;

interface EnumValues {
  bookingKind: BookingKind;
  exportKind: ExportKind;
  projectStatus: ProjectStatus;
  hintStatus: HintStatus;
  openItemReason: OpenItemReason;
}

/** The web's text for a code; `params` for texts with placeholders (open-item reasons). */
export function enumText<F extends keyof EnumValues>(
  family: F,
  value: EnumValues[F],
  params?: Readonly<Record<string, string | number>>,
): ToolText {
  const key = `${ENUM_TEXTS[family].prefix}${value}`;
  return params && Object.keys(params).length > 0 ? { key, params } : { key };
}
