import { BadGatewayException, Optional } from '@nestjs/common';
import {
  CommandHandler,
  type ICommandHandler,
  type IQueryHandler,
  QueryHandler,
} from '@nestjs/cqrs';
import { secretHint } from '../../common/crypto/secret-box';
import type {
  MailErrorDetail,
  MailSecurity,
} from '../../integrations/mail/mail-transport.port';
import { NotificationService } from '../../notifications/application/notification.service';
import { Topics } from '../../notifications/domain/notification';
import { UserRepositoryPort } from '../../users/ports/user.repository.port';
import {
  checkSmtpHost,
  isMailAddress,
  mailReady,
  type MailSettings,
  ownAddress,
} from '../domain/mail-settings';
import { MailSettingsRepositoryPort } from '../ports/mail.repository.port';
import {
  type MailConnectionDraft,
  MailGate,
  MailRuntime,
  mailUnprocessable,
} from './mail-gate';

/** The mailer as the app sees it — never the password, only its hint. */
export interface MailSettingsView {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly security: MailSecurity;
  readonly username: string;
  readonly hasPassword: boolean;
  readonly passwordHint: string | null;
  readonly fromName: string;
  readonly fromAddress: string;
  /** On and configured: "An Treuhänder senden" sends. */
  readonly ready: boolean;
  /** False without SETTINGS_ENCRYPTION_KEY: a password cannot be saved. */
  readonly canStorePassword: boolean;
  /** Private/loopback SMTP hosts are allowed on this server. */
  readonly privateHostsAllowed: boolean;
  /** Where "Test-Mail an mich senden" goes (the account's address). */
  readonly testRecipient: string;
}

export function mailSettingsView(
  settings: MailSettings,
  runtime: MailRuntime,
  accountEmail: string,
): MailSettingsView {
  return {
    enabled: settings.enabled,
    host: settings.host,
    port: settings.port,
    security: settings.security,
    username: settings.username,
    hasPassword: settings.passwordCipher !== null,
    passwordHint: settings.passwordHint,
    fromName: settings.fromName,
    fromAddress: settings.fromAddress,
    ready: mailReady(settings),
    canStorePassword: runtime.box.available,
    privateHostsAllowed: runtime.allowPrivateHosts,
    testRecipient: ownAddress(accountEmail, settings.fromAddress),
  };
}

export class GetMailSettingsQuery {
  constructor(readonly userId: string) {}
}

@QueryHandler(GetMailSettingsQuery)
export class GetMailSettingsHandler implements IQueryHandler<
  GetMailSettingsQuery,
  MailSettingsView
> {
  constructor(
    private readonly gate: MailGate,
    private readonly runtime: MailRuntime,
    private readonly users: UserRepositoryPort,
  ) {}

  async execute({ userId }: GetMailSettingsQuery): Promise<MailSettingsView> {
    const user = await this.users.findById(userId);
    return mailSettingsView(
      await this.gate.settingsOf(userId),
      this.runtime,
      user?.email ?? '',
    );
  }
}

export interface SaveMailSettingsInput {
  readonly enabled: boolean;
  readonly host: string;
  readonly port: number;
  readonly security: MailSecurity;
  readonly username: string;
  /** `undefined` keeps the stored password, `''` removes it, anything else replaces it. */
  readonly password?: string;
  readonly fromName: string;
  readonly fromAddress: string;
}

export class SaveMailSettingsCommand {
  constructor(
    readonly userId: string,
    readonly input: SaveMailSettingsInput,
  ) {}
}

/** F11.10: server, port, security, user, password (sealed with AES-256-GCM), sender, on/off. */
@CommandHandler(SaveMailSettingsCommand)
export class SaveMailSettingsHandler implements ICommandHandler<
  SaveMailSettingsCommand,
  MailSettingsView
> {
  constructor(
    private readonly settings: MailSettingsRepositoryPort,
    private readonly gate: MailGate,
    private readonly runtime: MailRuntime,
    private readonly users: UserRepositoryPort,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async execute({
    userId,
    input,
  }: SaveMailSettingsCommand): Promise<MailSettingsView> {
    const current = await this.gate.settingsOf(userId);
    const host = input.host.trim().toLowerCase();
    const problem = checkSmtpHost(host, this.runtime.allowPrivateHosts);
    if (problem) {
      throw mailUnprocessable(
        problem,
        problem === 'privateHost'
          ? 'Private or local mail servers are not allowed on this server'
          : 'The mail server must be a host name or an IP address',
      );
    }
    const fromAddress = input.fromAddress.trim();
    if (fromAddress !== '' && !isMailAddress(fromAddress)) {
      throw mailUnprocessable(
        'invalidAddress',
        'The sender address is not an e-mail address',
      );
    }
    let passwordCipher = current.passwordCipher;
    let passwordHint = current.passwordHint;
    if (input.password === '') {
      passwordCipher = null;
      passwordHint = null;
    } else if (input.password !== undefined) {
      if (!this.runtime.box.available) {
        throw mailUnprocessable(
          'encryptionUnavailable',
          'Passwords cannot be stored: SETTINGS_ENCRYPTION_KEY is not set on the server',
        );
      }
      passwordCipher = this.runtime.box.seal(input.password);
      passwordHint = secretHint(input.password);
    }
    const saved = await this.settings.save(userId, {
      enabled: input.enabled,
      host,
      port: input.port,
      security: input.security,
      username: input.username.trim(),
      passwordCipher,
      passwordHint,
      fromName: input.fromName.trim(),
      fromAddress,
    });
    // The user fixed the mailer: "Schlüssel prüfen" is settled until the next failure (F11.11).
    await this.notifications?.resolve(userId, Topics.keyInvalid('mail'));
    const user = await this.users.findById(userId);
    return mailSettingsView(saved, this.runtime, user?.email ?? '');
  }
}

/** The 502 a failed SMTP conversation becomes: precise, redacted details for the app. */
export function smtpFailure(detail: MailErrorDetail): BadGatewayException {
  return new BadGatewayException({
    statusCode: 502,
    error: 'Bad Gateway',
    message: `The mail server did not accept the mail (${detail.kind})`,
    code: 'smtpFailed',
    smtp: detail,
  });
}

export class SendTestMailCommand {
  constructor(
    readonly userId: string,
    /** The form's unsaved values; absent = the saved settings. */
    readonly draft?: MailConnectionDraft,
  ) {}
}

export interface TestMailResult {
  readonly ok: true;
  readonly to: string;
  readonly millis: number;
  /** The server's answer, e.g. `250 2.0.0 Ok: queued as …`. */
  readonly response: string;
}

/**
 * "Test-Mail an mich senden" (F11.10): one short mail without any project data to the user's own
 * address, with the saved settings or the form's unsaved values.
 */
@CommandHandler(SendTestMailCommand)
export class SendTestMailHandler implements ICommandHandler<
  SendTestMailCommand,
  TestMailResult
> {
  constructor(
    private readonly gate: MailGate,
    private readonly users: UserRepositoryPort,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async execute({
    userId,
    draft,
  }: SendTestMailCommand): Promise<TestMailResult> {
    const saved = await this.gate.settingsOf(userId);
    const mailer = this.gate.mailerForTest(saved, draft);
    if (!isMailAddress(mailer.from.address)) {
      throw mailUnprocessable(
        'invalidAddress',
        'The sender address is not an e-mail address',
      );
    }
    const user = await this.users.findById(userId);
    const to = ownAddress(user?.email ?? '', mailer.from.address);
    const started = Date.now();
    const outcome = await this.gate.deliver(mailer, {
      from: mailer.from,
      to: [to],
      cc: [],
      subject: 'lazy-koins: Test-Mail',
      text: [
        'Hallo',
        '',
        'Das ist eine Test-Mail von lazy-koins. Wenn du sie liest, funktioniert der Mailer.',
        '',
        `Server: ${mailer.connection.host}:${mailer.connection.port} (${mailer.connection.security})`,
      ].join('\n'),
      attachments: [],
    });
    if (!outcome.ok) throw smtpFailure(outcome.detail);
    if (draft?.password === undefined) {
      // The saved password works again.
      await this.notifications?.resolve(userId, Topics.keyInvalid('mail'));
    }
    return {
      ok: true,
      to,
      millis: Date.now() - started,
      response: outcome.delivery.response,
    };
  }
}
