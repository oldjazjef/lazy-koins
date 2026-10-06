import { isPrivateHost } from '../../ai/domain/base-url';
import type { MailSecurity } from '../../integrations/mail/mail-transport.port';

/**
 * A user's mailer (F11.10) — hand-written domain type, never a Prisma model. The SMTP password is
 * held only sealed (`passwordCipher`, AES-256-GCM); the API returns `passwordHint`.
 */
export interface MailSettings {
  readonly userId: string;
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly security: MailSecurity;
  readonly username: string;
  readonly passwordCipher: string | null;
  readonly passwordHint: string | null;
  readonly fromName: string;
  readonly fromAddress: string;
  readonly updatedAt: string | null;
}

export type SaveMailSettingsInput = Omit<MailSettings, 'userId' | 'updatedAt'>;

export function defaultMailSettings(userId: string): MailSettings {
  return {
    userId,
    enabled: false,
    host: '',
    port: 587,
    security: 'starttls',
    username: '',
    passwordCipher: null,
    passwordHint: null,
    fromName: '',
    fromAddress: '',
    updatedAt: null,
  };
}

/** Switched on, a server and a sender: "An Treuhänder senden" can send. */
export function mailReady(settings: MailSettings): boolean {
  return (
    settings.enabled && settings.host !== '' && settings.fromAddress !== ''
  );
}

/** One plain address — no display name, no list, no header tricks. */
export function isMailAddress(value: string): boolean {
  return (
    value.length <= 254 &&
    /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]+$/.test(
      value,
    )
  );
}

export type SmtpHostProblem = 'invalidHost' | 'privateHost';

/**
 * The SMTP server a user may set. The API itself connects to it, so on a shared server a private
 * address would let users probe the server's own network (SSRF) — refused unless
 * `MAIL_ALLOW_PRIVATE_HOSTS` (default: allowed with AUTH_MODE local/dev). Same literal-host rule
 * as the AI plugin's base URL (`ai/domain/base-url.ts`); DNS rebinding is not covered.
 */
export function checkSmtpHost(
  host: string,
  allowPrivate: boolean,
): SmtpHostProblem | undefined {
  if (host === '') return undefined;
  const ipv6 = /^\[[0-9a-f:.]+\]$/i.test(host);
  const name =
    /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i.test(
      host,
    );
  if (!ipv6 && !name) return 'invalidHost';
  if (!allowPrivate && isPrivateHost(host)) return 'privateHost';
  return undefined;
}

/**
 * "an mich" — the address of the signed-in user: the account's e-mail, or the sender address when
 * the account has none worth writing to (the desktop app's `local@lazykoins.local`).
 */
export function ownAddress(accountEmail: string, fromAddress: string): string {
  const usable =
    isMailAddress(accountEmail) &&
    !/\.(local|localhost|invalid)$/i.test(accountEmail);
  return usable ? accountEmail : fromAddress;
}
