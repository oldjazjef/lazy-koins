import {
  lucideDownload,
  lucideFileWarning,
  lucideLink2,
  lucidePenLine,
  lucideScanText,
  lucideSparkles,
  lucideUpload,
} from '@ng-icons/lucide';
import type { ProjectFile, ProjectHint } from '../../../../core/api/api.types';

/** A fixing action of a hint (F5.8); the first one is shown in the row, the rest when expanded. */
export interface HintAction {
  readonly kind:
    | 'upload'
    | 'aiStatement'
    | 'aiMapping'
    | 'manualHolding'
    | 'template'
    | 'assign'
    | 'rowErrors';
  /** i18n key. */
  readonly label: string;
  /** The lucide SVG (import), as `RowAction` takes it. */
  readonly icon: string;
  /** The file the action works on (AI, assignment). */
  readonly fileId?: string;
}

const UPLOAD: HintAction = {
  kind: 'upload',
  label: 'hints.actions.upload',
  icon: lucideUpload,
};
const TEMPLATE: HintAction = {
  kind: 'template',
  label: 'hints.actions.template',
  icon: lucideDownload,
};

/**
 * PDFs of the project that seem to belong to the platform (the name mentions it) — a PDF is
 * evidence only, it has no platform of its own until the AI reads it.
 */
export function pdfsFor(
  platform: string | null,
  files: readonly ProjectFile[],
): ProjectFile[] {
  const name = platform?.trim().toLowerCase();
  if (!name) return [];
  return files.filter(
    (file) =>
      file.kind === 'pdf' && file.displayName.toLowerCase().includes(name),
  );
}

/** What can fix a hint, the most useful first. */
export function hintActions(
  hint: ProjectHint,
  files: readonly ProjectFile[],
): HintAction[] {
  const [pdf] = pdfsFor(hint.platform, files);
  const aiStatement: HintAction[] = pdf
    ? [
        {
          kind: 'aiStatement',
          label: 'hints.actions.aiStatement',
          icon: lucideScanText,
          fileId: pdf.id,
        },
      ]
    : [];
  switch (hint.kind) {
    case 'noYearData':
    case 'startsLate':
    case 'endsEarly':
      return [UPLOAD, ...aiStatement, TEMPLATE];
    case 'noYearEndBalance':
      return [
        ...aiStatement,
        UPLOAD,
        {
          kind: 'manualHolding',
          label: 'hints.actions.manualHolding',
          icon: lucidePenLine,
        },
        { ...TEMPLATE, label: 'hints.actions.holdingsTemplate' },
      ];
    case 'unrecognisedFile':
      return hint.fileId
        ? [
            {
              kind: 'aiMapping',
              label: 'hints.actions.aiMapping',
              icon: lucideSparkles,
              fileId: hint.fileId,
            },
            {
              kind: 'assign',
              label: 'hints.actions.assign',
              icon: lucideLink2,
              fileId: hint.fileId,
            },
          ]
        : [];
    case 'rowErrors':
      return hint.fileId
        ? [
            {
              kind: 'rowErrors',
              label: 'hints.actions.rowErrors',
              icon: lucideFileWarning,
              fileId: hint.fileId,
            },
          ]
        : [];
  }
}

export type HintSort = 'severity' | 'kind' | 'date';

const SEVERITY = { error: 0, warning: 1, info: 2 } as const;
const KIND_ORDER: Record<ProjectHint['kind'], number> = {
  unrecognisedFile: 0,
  noYearData: 1,
  startsLate: 2,
  endsEarly: 3,
  noYearEndBalance: 4,
  rowErrors: 5,
};

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stable sort inside a platform group; ties by account, then key. */
export function sortHints(
  hints: readonly ProjectHint[],
  sort: HintSort,
): ProjectHint[] {
  const primary = (a: ProjectHint, b: ProjectHint): number => {
    switch (sort) {
      case 'severity':
        return SEVERITY[a.severity] - SEVERITY[b.severity];
      case 'kind':
        return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
      case 'date':
        return compareText(a.date ?? '9999', b.date ?? '9999');
    }
  };
  return [...hints].sort(
    (a, b) =>
      primary(a, b) ||
      compareText(a.accountId, b.accountId) ||
      compareText(a.key, b.key),
  );
}

export interface HintGroup {
  /** '' = files not read yet (no platform). */
  readonly platform: string;
  readonly hints: readonly ProjectHint[];
  readonly open: number;
}

/** Groups by platform (alphabetical, unread files last), keeping the order inside a group. */
export function hintsByPlatform(hints: readonly ProjectHint[]): HintGroup[] {
  const groups = new Map<string, ProjectHint[]>();
  for (const hint of hints) {
    const key = hint.platform ?? '';
    groups.set(key, [...(groups.get(key) ?? []), hint]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === ''
        ? 1
        : b === ''
          ? -1
          : compareText(a.toLowerCase(), b.toLowerCase()),
    )
    .map(([platform, list]) => ({
      platform,
      hints: list,
      open: list.filter((hint) => hint.status === 'open').length,
    }));
}
