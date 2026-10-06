/**
 * The protocol of mails sent from a project (F10.6a): when, to whom, subject, attachments and
 * whether it went out — never a password, and not the body.
 */
export const MAIL_LOG_STATUSES = ['sent', 'failed'] as const;
export type MailLogStatus = (typeof MAIL_LOG_STATUSES)[number];

export interface MailLogAttachment {
  readonly exportId: string;
  readonly fileName: string;
  readonly size: number;
}

export interface MailLogEntry {
  readonly id: string;
  readonly projectId: string;
  readonly to: string;
  readonly cc: string | null;
  readonly subject: string;
  readonly attachments: readonly MailLogAttachment[];
  readonly status: MailLogStatus;
  /** Short, redacted summary when `failed`. */
  readonly error: string | null;
  readonly messageId: string | null;
  readonly createdAt: string;
}

export type NewMailLogEntry = Omit<
  MailLogEntry,
  'id' | 'projectId' | 'createdAt'
>;

/** Total size of all attachments of one mail; most providers refuse more than 20–25 MB. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/**
 * Exports meant for the user, not for the Treuhänder (e.g. an internal working report): offered,
 * but never preselected and shown with a warning.
 */
export function isInternalExportKind(kind: string): boolean {
  return kind === 'internal_report' || kind.startsWith('internal');
}
