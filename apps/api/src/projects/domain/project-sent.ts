/**
 * F4.7 "An Treuhänder gesendet": whether and when a project's documents went to the Treuhänder —
 * date, recipient, way and which statements. Set automatically by a successful "An Treuhänder
 * senden" (F10.6a) or by hand; "rückgängig" removes it. Hand-written domain types.
 */

/** Mirrored by a CHECK in the migration. */
export const SENT_VIA = ['mail', 'post', 'personal', 'other'] as const;
export type SentVia = (typeof SENT_VIA)[number];

export interface ProjectSentState {
  readonly projectId: string;
  /** ISO timestamp. */
  readonly sentAt: string;
  /** Recipient as entered or mailed to; may be empty for a manual mark. */
  readonly sentTo: string;
  readonly via: SentVia;
  readonly note: string;
  /** The statements (project_export ids) that went out. */
  readonly exportIds: readonly string[];
  /** The mail_log entry of an automatic mark. */
  readonly mailLogId: string | null;
  /** Input hash of the latest calculation when it was sent. */
  readonly snapshotHash: string | null;
  readonly updatedAt: string;
}

export type SaveProjectSentInput = Omit<
  ProjectSentState,
  'projectId' | 'updatedAt'
>;

/** What happened in a project, compactly — enough to tell "changed since it was sent". */
export interface ProjectChangeFacts {
  readonly latestSnapshot: {
    readonly createdAt: string;
    readonly inputHash: string;
  } | null;
  readonly exports: readonly {
    readonly id: string;
    readonly createdAt: string;
  }[];
  /** Latest created or undone correction. */
  readonly lastCorrectionAt: string | null;
  readonly lastFileAddedAt: string | null;
}

export const NO_CHANGES: ProjectChangeFacts = {
  latestSnapshot: null,
  exports: [],
  lastCorrectionAt: null,
  lastFileAddedAt: null,
};

export const CHANGE_REASONS = [
  'calculation',
  'export',
  'correction',
  'file',
] as const;
export type ChangeReason = (typeof CHANGE_REASONS)[number];

const after = (value: string | null, sentAt: string): boolean =>
  value !== null && Date.parse(value) > Date.parse(sentAt);

/**
 * F4.7 "seit dem Versand geändert": a newer calculation with a **different** input than the one
 * sent (recalculating unchanged data does not count), a statement created afterwards that was not
 * sent, a correction made or undone afterwards, or a file added afterwards.
 */
export function changesSinceSent(
  state: Pick<ProjectSentState, 'sentAt' | 'exportIds' | 'snapshotHash'>,
  facts: ProjectChangeFacts,
): ChangeReason[] {
  const reasons: ChangeReason[] = [];
  const snapshot = facts.latestSnapshot;
  if (
    snapshot &&
    after(snapshot.createdAt, state.sentAt) &&
    snapshot.inputHash !== state.snapshotHash
  ) {
    reasons.push('calculation');
  }
  if (
    facts.exports.some(
      (item) =>
        after(item.createdAt, state.sentAt) &&
        !state.exportIds.includes(item.id),
    )
  ) {
    reasons.push('export');
  }
  if (after(facts.lastCorrectionAt, state.sentAt)) reasons.push('correction');
  if (after(facts.lastFileAddedAt, state.sentAt)) reasons.push('file');
  return reasons;
}

/**
 * The moment of a manual mark from the date the user picked (YYYY-MM-DD): today = now; an earlier
 * day = the end of that day (Swiss time is ahead of UTC, so 21:59:59 UTC is still that day).
 */
export function manualSentAt(date: string, now: Date): string {
  const today = now.toISOString().slice(0, 10);
  if (date >= today) return now.toISOString();
  return `${date}T21:59:59.999Z`;
}
