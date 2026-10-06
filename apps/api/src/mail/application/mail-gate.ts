import {
  ConflictException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { SecretBox } from '../../common/crypto/secret-box';
import {
  type MailAddress,
  type MailDelivery,
  type MailErrorDetail,
  type MailSecurity,
  MailTransportError,
  MailTransportPort,
  type OutgoingMail,
  type SmtpConnection,
} from '../../integrations/mail/mail-transport.port';
import {
  checkSmtpHost,
  defaultMailSettings,
  mailReady,
  type MailSettings,
} from '../domain/mail-settings';
import { MailSettingsRepositoryPort } from '../ports/mail.repository.port';

/** Process-wide mail options from the environment (bound in `MailModule`). */
export class MailRuntime {
  constructor(
    readonly box: SecretBox,
    /** `MAIL_ALLOW_PRIVATE_HOSTS` resolved (`config/env.ts`). */
    readonly allowPrivateHosts: boolean,
  ) {}
}

/** Stable codes of the mail answers (409/422/400); the app translates `mail.errors.<code>`. */
export const MAIL_STATE_CODES = [
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
] as const;
export type MailStateCode = (typeof MAIL_STATE_CODES)[number];

export function mailConflict(
  code: MailStateCode,
  message: string,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message,
    code,
  });
}

export function mailUnprocessable(
  code: MailStateCode,
  message: string,
  extra: Record<string, unknown> = {},
): UnprocessableEntityException {
  return new UnprocessableEntityException({
    statusCode: 422,
    error: 'Unprocessable Entity',
    message,
    code,
    ...extra,
  });
}

/** Unsaved values from the mailer form, for "Test-Mail an mich senden" before saving. */
export interface MailConnectionDraft {
  readonly host: string;
  readonly port: number;
  readonly security: MailSecurity;
  readonly username: string;
  /** Typed into the form; omitted = the saved password, "" = none. Never stored. */
  readonly password?: string;
  readonly fromName: string;
  readonly fromAddress: string;
}

export interface ReadyMailer {
  readonly connection: SmtpConnection;
  readonly from: MailAddress;
}

export type DeliveryOutcome =
  | { readonly ok: true; readonly delivery: MailDelivery }
  | { readonly ok: false; readonly detail: MailErrorDetail };

/**
 * The gate every mail passes: the mailer is on and configured, its host allowed, the password
 * decrypted only here and only for the call. Failures come back as redacted details, never with
 * the password.
 */
@Injectable()
export class MailGate {
  private readonly logger = new Logger(MailGate.name);

  constructor(
    private readonly settings: MailSettingsRepositoryPort,
    private readonly runtime: MailRuntime,
    private readonly transport: MailTransportPort,
  ) {}

  async settingsOf(userId: string): Promise<MailSettings> {
    return (await this.settings.find(userId)) ?? defaultMailSettings(userId);
  }

  /** The mailer from saved settings, or the 409 that says what is missing. */
  mailerOf(settings: MailSettings): ReadyMailer {
    if (!settings.enabled) {
      throw mailConflict('mailDisabled', 'The mailer is switched off');
    }
    if (!mailReady(settings)) {
      throw mailConflict(
        'mailNotConfigured',
        'Set the mail server and the sender address in the settings first',
      );
    }
    return this.mailerFrom(settings, this.openPassword(settings));
  }

  /**
   * The mailer for "Test-Mail an mich senden": the saved settings overlaid with the form's unsaved
   * values, so testing never requires saving first. The on/off switch is ignored; a password typed
   * into the form is used as is and never stored.
   */
  mailerForTest(saved: MailSettings, draft?: MailConnectionDraft): ReadyMailer {
    const settings: MailSettings = draft
      ? {
          ...saved,
          host: draft.host.trim(),
          port: draft.port,
          security: draft.security,
          username: draft.username.trim(),
          fromName: draft.fromName.trim(),
          fromAddress: draft.fromAddress.trim(),
        }
      : saved;
    if (settings.host === '' || settings.fromAddress === '') {
      throw mailConflict(
        'mailNotConfigured',
        'Enter the mail server and the sender address first',
      );
    }
    const typed = draft?.password;
    const password =
      typed === undefined
        ? this.openPassword(settings)
        : typed === ''
          ? undefined
          : typed;
    return this.mailerFrom(settings, password);
  }

  /** Sends; a failure is returned (redacted) for the log, not thrown. */
  async deliver(
    mailer: ReadyMailer,
    mail: OutgoingMail,
  ): Promise<DeliveryOutcome> {
    try {
      return {
        ok: true,
        delivery: await this.transport.send(mailer.connection, mail),
      };
    } catch (error) {
      if (error instanceof MailTransportError) {
        this.logger.warn(
          `Mail via ${error.detail.host}:${error.detail.port} failed: ${error.detail.kind}${error.detail.smtpCode ? ` (${error.detail.smtpCode})` : ''}`,
        );
        return { ok: false, detail: error.detail };
      }
      throw error;
    }
  }

  private openPassword(settings: MailSettings): string | undefined {
    if (!settings.passwordCipher) return undefined;
    const password = this.runtime.box.open(settings.passwordCipher);
    if (password === undefined) {
      throw mailConflict(
        'passwordUnreadable',
        'The stored SMTP password cannot be decrypted (SETTINGS_ENCRYPTION_KEY changed?) — enter it again',
      );
    }
    return password;
  }

  private mailerFrom(
    settings: MailSettings,
    password: string | undefined,
  ): ReadyMailer {
    const problem = checkSmtpHost(
      settings.host,
      this.runtime.allowPrivateHosts,
    );
    if (problem) {
      throw mailConflict(
        problem,
        problem === 'privateHost'
          ? 'Private or local mail servers are not allowed on this server'
          : 'The mail server must be a host name or an IP address',
      );
    }
    return {
      connection: {
        host: settings.host,
        port: settings.port,
        security: settings.security,
        username: settings.username,
        ...(password !== undefined ? { password } : {}),
      },
      from: { name: settings.fromName, address: settings.fromAddress },
    };
  }
}
