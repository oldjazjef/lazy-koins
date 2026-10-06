/**
 * Shapes of the mail endpoints (F11.10, F10.6a) and the "An Treuhänder gesendet" status (F4.7),
 * hand-mirrored from apps/api (`mail/dto/mail.dto.ts`, `projects/dto/project-sent.dto.ts`).
 */

export const MAIL_SECURITIES = ['starttls', 'tls', 'none'] as const;
export type MailSecurity = (typeof MAIL_SECURITIES)[number];

/** `GET|PUT /api/mail/settings` — the password only as a hint. */
export interface MailSettings {
  enabled: boolean;
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  hasPassword: boolean;
  passwordHint: string | null;
  fromName: string;
  fromAddress: string;
  ready: boolean;
  canStorePassword: boolean;
  privateHostsAllowed: boolean;
  testRecipient: string;
}

/** `PUT /api/mail/settings` — `password` absent = keep, "" = remove. */
export interface SaveMailSettingsRequest {
  enabled: boolean;
  host: string;
  port: number;
  security: MailSecurity;
  username: string;
  password?: string;
  fromName: string;
  fromAddress: string;
}

/** `POST /api/mail/settings/test` — the form's unsaved values. */
export type TestMailRequest = Omit<SaveMailSettingsRequest, 'enabled'>;

export interface TestMailResult {
  ok: true;
  to: string;
  millis: number;
  response: string;
}

export const SMTP_ERROR_KINDS = [
  'auth',
  'tls',
  'connection',
  'dns',
  'timeout',
  'rejected',
  'protocol',
  'unknown',
] as const;
export type SmtpErrorKind = (typeof SMTP_ERROR_KINDS)[number];

/** The redacted details of a failed SMTP conversation (502 `body.smtp`). */
export interface SmtpErrorDetail {
  kind: SmtpErrorKind;
  host: string;
  port: number;
  smtpCode: number | null;
  response: string | null;
  command: string | null;
  code: string | null;
}

export const MAIL_PLACEHOLDERS = [
  'name',
  'treuhaender',
  'steuerjahr',
  'kanton',
  'vermoegen',
  'ertrag',
  'anhaenge',
  'offene_punkte',
  'datum',
  'projekt',
] as const;
export type MailPlaceholder = (typeof MAIL_PLACEHOLDERS)[number];

export interface RenderedMail {
  subject: string;
  body: string;
  unknownPlaceholders: string[];
}

/** `GET|PUT|DELETE /api/mail/template` */
export interface MailTemplate {
  language: string;
  subject: string;
  body: string;
  isDefault: boolean;
  defaultSubject: string;
  defaultBody: string;
  placeholders: MailPlaceholder[];
  sampleValues: Record<string, string>;
  preview: RenderedMail;
}

export interface MailTemplateText {
  subject: string;
  body: string;
}

/** A stored statement offered as an attachment. */
export interface AttachmentOption {
  id: string;
  kind: string;
  fileName: string;
  size: number;
  createdAt: string;
  internal: boolean;
  selected: boolean;
}

/** `POST /api/projects/:id/mail/compose` */
export interface MailComposition {
  mailerReady: boolean;
  to: string;
  advisorName: string;
  ownAddress: string;
  subject: string;
  body: string;
  unknownPlaceholders: string[];
  attachments: AttachmentOption[];
  maxAttachmentBytes: number;
  calculated: boolean;
}

/** `POST /api/projects/:id/mail/send` */
export interface SendMailRequest {
  to: string;
  ccMe: boolean;
  subject: string;
  body: string;
  exportIds: string[];
  confirmed: boolean;
}

export interface MailLogEntry {
  id: string;
  to: string;
  cc: string | null;
  subject: string;
  attachments: { exportId: string; fileName: string; size: number }[];
  status: 'sent' | 'failed';
  error: string | null;
  createdAt: string;
}

export const SENT_VIA = ['mail', 'post', 'personal', 'other'] as const;
export type SentVia = (typeof SENT_VIA)[number];

export const CHANGE_REASONS = [
  'calculation',
  'export',
  'correction',
  'file',
] as const;
export type ChangeReason = (typeof CHANGE_REASONS)[number];

/** `GET|PUT|DELETE /api/projects/:id/sent` (F4.7) */
export interface ProjectSentStatus {
  sent: {
    sentAt: string;
    sentTo: string;
    via: SentVia;
    note: string;
    exportIds: string[];
    mailLogId: string | null;
  } | null;
  changes: ChangeReason[];
}

/** `PUT /api/projects/:id/sent` — "als gesendet markieren". */
export interface MarkSentRequest {
  date: string;
  via: SentVia;
  note: string;
  to: string;
  exportIds: string[];
}

export interface SendMailResult {
  log: MailLogEntry;
  sent: ProjectSentStatus;
}

/** F4.7 in the project list. */
export interface ProjectSentSummary {
  sentAt: string;
  via: SentVia;
  changedSince: boolean;
}

/** The codes the mail endpoints answer with (`body.code`); each has `mail.errors.<code>`. */
export const MAIL_ERROR_CODES = [
  'mailDisabled',
  'mailNotConfigured',
  'passwordUnreadable',
  'privateHost',
  'invalidHost',
  'invalidAddress',
  'encryptionUnavailable',
  'confirmationRequired',
  'attachmentsTooLarge',
  'unknownExport',
  'emptyMail',
  'unknownPlaceholders',
  'smtpFailed',
] as const;
export type MailErrorCode = (typeof MAIL_ERROR_CODES)[number];
