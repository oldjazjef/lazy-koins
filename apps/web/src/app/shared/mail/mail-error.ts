import { HttpErrorResponse } from '@angular/common/http';
import {
  MAIL_ERROR_CODES,
  SMTP_ERROR_KINDS,
  type SmtpErrorDetail,
} from '../../core/api/mail.types';

/** The translated reason of a failed mail request (`mail.errors.<code>`). */
export function mailErrorKey(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return 'mail.errors.failed';
  const code = (error.error as { code?: unknown } | null)?.code;
  if (
    typeof code === 'string' &&
    (MAIL_ERROR_CODES as readonly string[]).includes(code)
  ) {
    return `mail.errors.${code}`;
  }
  if (error.status === 0) return 'mail.errors.unreachable';
  return 'mail.errors.failed';
}

/** The SMTP details of a 502 (`body.smtp`), already redacted by the API. */
export function smtpErrorOf(error: unknown): SmtpErrorDetail | null {
  if (!(error instanceof HttpErrorResponse) || error.status !== 502) {
    return null;
  }
  const smtp = (error.error as { smtp?: Partial<SmtpErrorDetail> } | null)
    ?.smtp;
  if (
    !smtp ||
    typeof smtp.kind !== 'string' ||
    !(SMTP_ERROR_KINDS as readonly string[]).includes(smtp.kind)
  ) {
    return null;
  }
  return {
    kind: smtp.kind,
    host: String(smtp.host ?? ''),
    port: Number(smtp.port ?? 0),
    smtpCode: typeof smtp.smtpCode === 'number' ? smtp.smtpCode : null,
    response: typeof smtp.response === 'string' ? smtp.response : null,
    command: typeof smtp.command === 'string' ? smtp.command : null,
    code: typeof smtp.code === 'string' ? smtp.code : null,
  };
}

/** `1.2 MB` / `850 KB` for attachment sizes. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
