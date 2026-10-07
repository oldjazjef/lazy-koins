/**
 * Sending mail over SMTP (F11.10, F10.6a). The port is the seam: the API binds the nodemailer
 * adapter in `IntegrationsModule`; handler specs use a fake transport — no test ever sends a
 * real mail.
 */

/** tls = implicit TLS (usually port 465), starttls = upgrade required (587), none = plain. */
export const MAIL_SECURITIES = ['tls', 'starttls', 'none'] as const;
export type MailSecurity = (typeof MAIL_SECURITIES)[number];

export interface SmtpConnection {
  readonly host: string;
  readonly port: number;
  readonly security: MailSecurity;
  /** Empty = no authentication. */
  readonly username: string;
  /** Opened from the sealed value only for this call; never logged. */
  readonly password?: string;
}

export interface MailAddress {
  readonly name: string;
  readonly address: string;
}

export interface MailAttachment {
  readonly fileName: string;
  readonly contentType: string;
  readonly content: Uint8Array;
}

/** A plain-text mail. */
export interface OutgoingMail {
  readonly from: MailAddress;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly subject: string;
  readonly text: string;
  readonly attachments: readonly MailAttachment[];
}

export interface MailDelivery {
  readonly messageId: string;
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
  /** The server's last answer, e.g. `250 2.0.0 Ok: queued`. */
  readonly response: string;
}

/**
 * Why a send failed, coarse enough for the app to explain it:
 * - auth: user name or password refused (SMTP 535 …)
 * - tls: TLS handshake / certificate / STARTTLS problem
 * - connection: refused, reset or closed (wrong host or port?)
 * - dns: the host name does not resolve
 * - timeout: no answer in time
 * - rejected: the server refused sender, a recipient or the message (SMTP 5xx/4xx)
 * - protocol: an answer that is not SMTP (wrong port / security?)
 * - unknown: anything else
 */
export const MAIL_ERROR_KINDS = [
  'auth',
  'tls',
  'connection',
  'dns',
  'timeout',
  'rejected',
  'protocol',
  'unknown',
] as const;
export type MailErrorKind = (typeof MAIL_ERROR_KINDS)[number];

/** The precise, already redacted details of a failed send. */
export interface MailErrorDetail {
  readonly kind: MailErrorKind;
  readonly host: string;
  readonly port: number;
  /** SMTP reply code (535, 550, …) when the server answered. */
  readonly smtpCode: number | null;
  /** The server's answer or the low-level reason — redacted, at most 500 characters. */
  readonly response: string | null;
  /** The SMTP command that failed (`AUTH PLAIN`, `RCPT TO`, `DATA`, `CONN`). */
  readonly command: string | null;
  /** Error code of the library or the socket (`EAUTH`, `ECONNREFUSED`, `CERT_HAS_EXPIRED`). */
  readonly code: string | null;
}

export class MailTransportError extends Error {
  constructor(readonly detail: MailErrorDetail) {
    super(`Mail could not be sent: ${detail.kind}`);
    this.name = 'MailTransportError';
  }
}

export abstract class MailTransportPort {
  /** Sends one mail; throws `MailTransportError` with redacted details on failure. */
  abstract send(
    connection: SmtpConnection,
    mail: OutgoingMail,
  ): Promise<MailDelivery>;
}
